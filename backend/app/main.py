"""FastAPI application."""

from __future__ import annotations

import gzip
import json
import logging
import math
import os
import shutil
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.datastructures import UploadFile

from .comparison import COMPARISON_VERSION, REGISTRATION_LOCK, run_comparison, write_status
from . import __version__
from .auth import AuthStore, RateLimiter, User
from .auth_routes import build_auth_routers, current_user, link_path, require_user
from .config import Settings, load_settings
from .geometry import is_in_bounds, world_to_voxel
from .inference import ModelStatus, resolve_model
from .io_utils import (
    InputError,
    dicom_zip_to_nifti,
    kind_of_upload,
    nifti_suffix,
    sanitize_nifti,
    sanitize_segmentation,
)
from .jobs import ACTIVE_STAGES, CleanupThread, JobStore, Worker
from .labels import (
    CONFIDENCE_NOTE,
    DISCLAIMER,
    LABEL_BY_VALUE,
    SCOPE_NOTE,
    SEQUENCE_DISPLAY,
    SEQUENCES,
    label_map_json,
)
from .exports import build_bundle
from .pipeline import run_pipeline
from . import samples as sample_library
from .sample_case import ensure_sample_case
from .security import CLIENT_HEADER, BodyLimit, CrossSiteGuard, SecurityHeaders
from .volumes import VOLUME_NAMES, open_array, read_header

log = logging.getLogger(__name__)

STUDY_METRICS = Path(__file__).resolve().parent / "resources" / "study_metrics.json"
MESH_NAMES = ("brain", "label_1", "label_2", "label_3", "label_4")
CHUNK = 1024 * 1024
NOT_FOUND = (
    "Result not found. Results are deleted automatically after 24 hours, "
    "and each one is visible only to the account that created it."
)
SIGN_IN = "Sign in to open this result."
MODEL_UNAVAILABLE = (
    "The model could not be loaded, so no new analyses can run. "
    "The administrator can see the reason in the server log."
)
UPLOAD_FIELDS = ("t1", "t1c", "t2", "flair", "segmentation")


async def _save_upload(upload: UploadFile, destination: Path, limit_bytes: int, slot: str) -> None:
    written = 0
    with open(destination, "wb") as sink:
        while chunk := await upload.read(CHUNK):
            written += len(chunk)
            if written > limit_bytes:
                raise InputError(f"{slot}: file is larger than the {limit_bytes // 1024**2} MB upload limit.")
            sink.write(chunk)
    if written == 0:
        raise InputError(f"{slot}: the uploaded file is empty.")


def _ingest(incoming: Path, kind: str, destination: Path, scratch: Path, slot: str) -> None:
    """Convert (if DICOM), validate, and re-write with a clean header."""
    source = dicom_zip_to_nifti(incoming, scratch, slot) if kind == "dicom_zip" else incoming
    sanitize_nifti(source, destination, slot)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    store = JobStore(settings.jobs_dir)
    users = AuthStore(
        settings.data_dir / "auth.db", session_hours=settings.session_hours, idle_hours=settings.session_idle_hours
    )
    limiter = RateLimiter()
    model_status: ModelStatus = resolve_model(settings)

    def run(state, report) -> None:
        run_pipeline(state, store.path(state.id), settings, model_status.model, report)

    worker = Worker(store, run)
    cleanup = CleanupThread(store, settings.job_ttl_hours)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        store.fail_interrupted()
        worker.start()
        cleanup.start()
        log.info("mode=%s  %s", model_status.mode, model_status.message)
        announce_setup_link()
        yield
        worker.stop()
        cleanup.stop()

    def announce_setup_link() -> None:
        """No accounts yet: print a one-time link for the first administrator."""
        if users.count_active_admins():
            return
        users.revoke_setup_invites()
        token, _ = users.create_invite(role="admin", note="first administrator", hours=24)
        host, port = os.environ.get("GLIOMA_HOST", "127.0.0.1"), os.environ.get("GLIOMA_PORT", "8000")
        base = settings.public_url or f"http://{'localhost' if host in ('127.0.0.1', '0.0.0.0') else host}:{port}"
        log.warning(
            "No administrator yet. Create the first administrator (link valid 24 h, single use):\n\n    %s%s\n",
            base,
            link_path(token),
        )

    docs = settings.enable_api_docs
    app = FastAPI(
        title="Postoperative glioma segmentation",
        version=__version__,
        lifespan=lifespan,
        docs_url="/api/docs" if docs else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if docs else None,
    )
    # Added innermost first: CORS, then the cross-site guard, the size limits,
    # and outermost the security headers (so even refusals carry them).
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["content-type", CLIENT_HEADER],
        expose_headers=["X-Volume-Header"],
    )
    app.add_middleware(CrossSiteGuard, allowed_origins=settings.cors_origins + ((settings.public_url,) if settings.public_url else ()))
    upload_limit = len(UPLOAD_FIELDS) * settings.max_upload_mb * 1024**2 + 1024**2

    def body_limit(method: str, path: str) -> int:
        return upload_limit if (method, path) == ("POST", "/api/jobs") else 64 * 1024

    app.add_middleware(BodyLimit, limit_for=body_limit)
    app.add_middleware(SecurityHeaders)
    app.state.settings, app.state.store, app.state.model_status = settings, store, model_status
    app.state.users = users

    def job_counts() -> dict[str, int]:
        counts: dict[str, int] = {}
        for state in store.all_states():
            if state.owner:
                counts[state.owner] = counts.get(state.owner, 0) + 1
        return counts

    auth_router, admin_router = build_auth_routers(settings, users, limiter, job_counts)
    app.include_router(auth_router)
    app.include_router(admin_router)

    # ------------------------------------------------------------- helpers

    def is_sample(state) -> bool:
        return state.pinned and state.source == "sample_case"

    def visible_job(job_id: str, user: User | None):
        """The job if this visitor may see it. Someone else's job looks exactly like a missing one."""
        try:
            state = store.load(job_id)
        except KeyError:
            raise HTTPException(404 if user else 401, NOT_FOUND if user else SIGN_IN)
        if is_sample(state) and (settings.public_samples or user is not None):
            return state
        if user is None:
            raise HTTPException(401, SIGN_IN)
        if user.is_admin or (state.owner is not None and state.owner == user.id):
            return state
        raise HTTPException(404, NOT_FOUND)

    def done_job_dir(job_id: str, user: User | None) -> Path:
        state = visible_job(job_id, user)
        if state.status != "done":
            raise HTTPException(409, f"The analysis is not finished (status: {state.status}).")
        return store.path(job_id)

    def check_quota(user: User) -> None:
        if worker.queue_length() >= settings.max_queue:
            raise HTTPException(503, "The server is busy with other analyses. Try again in a few minutes.")
        if user.is_admin:
            return
        running = ACTIVE_STAGES + ("uploading",)
        active = sum(1 for state in store.all_states() if state.owner == user.id and state.status in running)
        if active >= settings.max_active_jobs_per_user:
            raise HTTPException(
                429,
                f"You already have {active} analyses waiting or running. "
                "Wait for one to finish before starting another.",
            )
        wait = limiter.retry_after(f"jobs:{user.id}", settings.max_jobs_per_user_per_day, 86400.0)
        if wait:
            raise HTTPException(
                429,
                f"You have reached the limit of {settings.max_jobs_per_user_per_day} analyses per day. "
                f"Try again in about {math.ceil(wait / 3600)} h.",
                headers={"Retry-After": str(int(wait))},
            )

    # ---------------------------------------------------------------- info

    @app.get("/api/info")
    def info(user: User | None = Depends(current_user)):
        message = model_status.message
        if model_status.mode == "model_error" and not (user and user.is_admin):
            message = MODEL_UNAVAILABLE
        return {
            "app_version": __version__,
            "mode": model_status.mode,  # "inference" | "demo" | "model_error"
            "message": message,
            "banner": "DEMO — no model inference" if model_status.mode == "demo" else None,
            "model": model_status.describe(),
            "disclaimer": DISCLAIMER,
            "scope_note": SCOPE_NOTE,
            "confidence_note": CONFIDENCE_NOTE,
            "label_map": label_map_json(),
            "sequences": [{"slot": slot, "name": SEQUENCE_DISPLAY[slot]} for slot in SEQUENCES],
            "hd_bet_available": model_status.hd_bet_available,
            "job_ttl_hours": settings.job_ttl_hours,
            "max_upload_mb": settings.max_upload_mb,
            "queue_length": worker.queue_length(),
            "sample_case_available": model_status.mode == "demo",
            "samples_available": len(sample_library.load_index(settings.data_dir)),
            "public_samples": settings.public_samples,
        }

    # ------------------------------------------------------------- samples

    def model_signature() -> str:
        if model_status.mode != "inference":
            return model_status.mode
        description = model_status.describe() or {}
        return "inference:" + ",".join(
            f"{m['name']}/{'+'.join(c['file'] for c in m['checkpoints'])}" for m in description.get("members", [])
        )

    def sample_job_state(sample_id: str):
        job_id = sample_library.cached_job(settings.data_dir, sample_id, model_signature())
        if not job_id:
            return None
        try:
            state = store.load(job_id)
        except KeyError:
            return None
        return None if state.status == "error" else state

    def samples_allowed(user: User | None) -> None:
        if not settings.public_samples and user is None:
            raise HTTPException(401, "Sign in to open the sample cases.")

    @app.get("/api/samples")
    def list_samples(user: User | None = Depends(current_user)):
        """Curated real cases anyone can open without uploading."""
        samples_allowed(user)
        members = [m["name"] for m in (model_status.describe() or {}).get("members", [])]
        result = []
        for entry in sample_library.load_index(settings.data_dir):
            state = sample_job_state(entry["id"])
            result.append(
                {
                    **entry,
                    "unseen_by_model": sample_library.unseen_by_model(entry["patient_id"], members) if members else None,
                    "job_id": state.id if state else None,
                    "status": state.status if state else None,
                }
            )
        return result

    @app.post("/api/samples/{sample_id}/open")
    async def open_sample(sample_id: str, user: User | None = Depends(current_user)):
        """The sample's result: reused if it already exists for the current model, else computed once."""
        samples_allowed(user)
        entry = sample_library.get_sample(settings.data_dir, sample_id)
        if entry is None:
            raise HTTPException(404, "No such sample case.")
        if model_status.mode == "model_error":
            raise HTTPException(503, MODEL_UNAVAILABLE)
        existing = sample_job_state(sample_id)
        if existing is not None:
            return {"job_id": existing.id, "status": existing.status}
        demo = model_status.mode == "demo"
        state = store.create(
            mode="demo" if demo else "inference",
            already_preprocessed=True,
            source="sample_case",
            sample_id=sample_id,
            pinned=True,
        )
        await run_in_threadpool(
            sample_library.copy_inputs, settings.data_dir, sample_id, store.path(state.id) / "input", reference_as_segmentation=demo
        )
        sample_library.remember_job(settings.data_dir, sample_id, model_signature(), state.id)
        state.status, state.message = "queued", "Waiting for the worker"
        store.save(state)
        worker.submit(state.id)
        return {"job_id": state.id, "status": state.status}

    @app.get("/api/model/metrics")
    def study_metrics():
        """The study's published nnU-Net results (results/final_analysis of the research repo)."""
        return JSONResponse(json.loads(STUDY_METRICS.read_text(encoding="utf-8")))

    @app.post("/api/demo/sample", status_code=201)
    async def create_sample_job(user: User = Depends(require_user)):
        """Demo mode only: run the built-in synthetic (non-patient) case. No upload needed."""
        if model_status.mode != "demo":
            raise HTTPException(
                409,
                "The synthetic sample is only offered in demo mode. With a model loaded it would "
                "mean running the model on generated shapes, which says nothing about the model.",
            )
        check_quota(user)
        state = store.create(mode="demo", already_preprocessed=True, source="sample", owner=user.id)
        try:
            await run_in_threadpool(_ingest_sample, settings.data_dir / "sample_case", store.path(state.id) / "input")
        except Exception:
            store.delete(state.id)
            log.exception("could not prepare the sample case for job %s", state.id)
            raise HTTPException(500, "The sample case could not be prepared.")
        state.status, state.message = "queued", "Waiting for the worker"
        store.save(state)
        worker.submit(state.id)
        return {"job_id": state.id, "status": state.status, "mode": state.mode}

    # ---------------------------------------------------------------- jobs

    @app.get("/api/jobs")
    def list_jobs(user: User = Depends(require_user), everyone: bool = Query(False, alias="all")):
        """The signed-in account's results, newest first (administrators: everyone's, with ?all=true)."""
        everyone = everyone and user.is_admin
        names = {account.id: account.username for account in users.list_users()} if everyone else {}
        result = []
        for state in store.all_states():
            if state.pinned or not (everyone or state.owner == user.id):
                continue
            data = state.public(settings.job_ttl_hours)
            data["tumor_ml"] = None
            if state.status == "done":
                try:
                    summary = json.loads((store.path(state.id) / "output" / "summary.json").read_text(encoding="utf-8"))
                    data["tumor_ml"] = summary["statistics"]["composites"]["tumor_related_1_3"]["volume_ml"]
                except Exception:
                    pass
            if everyone:
                data["owner_username"] = names.get(state.owner or "")
            result.append(data)
        result.sort(key=lambda item: item["created_at"], reverse=True)
        return result

    @app.post("/api/jobs", status_code=201)
    async def create_job(request: Request, user: User = Depends(require_user)):
        # The body is read only after the account and quota checks have passed
        # (BodyLimit has already refused anything over the size limit).
        if model_status.mode == "model_error":
            raise HTTPException(503, MODEL_UNAVAILABLE)
        check_quota(user)
        try:
            form = await request.form(max_files=len(UPLOAD_FIELDS), max_fields=4, max_part_size=4096)
        except Exception:
            raise HTTPException(400, "The upload could not be read. Please send the files again.")
        try:
            return await create_job_from_form(form, user)
        finally:
            await form.close()

    async def create_job_from_form(form, user: User):
        files = {name: form.get(name) for name in UPLOAD_FIELDS}
        missing = [SEQUENCE_DISPLAY[slot] for slot in SEQUENCES if not isinstance(files[slot], UploadFile)]
        if missing:
            raise HTTPException(400, f"Missing file(s): {', '.join(missing)}. Upload all four sequences.")
        segmentation = files["segmentation"] if isinstance(files["segmentation"], UploadFile) else None
        flag = str(form.get("already_preprocessed", "true")).strip().lower()
        already_preprocessed = flag not in {"false", "0", "no", "off"}
        t1, t1c, t2, flair = (files[slot] for slot in SEQUENCES)

        demo = model_status.mode == "demo"
        if demo and segmentation is None:
            raise HTTPException(
                400,
                "DEMO — no model inference: no model weights are configured, so an existing "
                "segmentation NIfTI must be uploaded with the four sequences.",
            )

        state = store.create(
            mode="demo" if demo else "inference", already_preprocessed=already_preprocessed, owner=user.id
        )
        limiter.hit(f"jobs:{user.id}")
        job_dir = store.path(state.id)
        incoming = job_dir / "incoming"
        incoming.mkdir()
        limit = settings.max_upload_mb * 1024**2
        uploads = {"t1": t1, "t1c": t1c, "t2": t2, "flair": flair}
        if demo:
            uploads["segmentation"] = segmentation
        try:
            for slot, upload in uploads.items():
                display = SEQUENCE_DISPLAY.get(slot, "segmentation")
                # The client file name is used only to detect the format; it is
                # never stored or logged.
                try:
                    kind = kind_of_upload(upload.filename or "")
                except InputError as error:
                    raise InputError(f"{display}: {error}") from error
                if slot == "segmentation" and kind != "nifti":
                    raise InputError("segmentation: must be a NIfTI file (.nii or .nii.gz).")
                suffix = ".zip" if kind == "dicom_zip" else nifti_suffix(upload.filename or "")
                raw_path = incoming / f"{slot}{suffix}"
                await _save_upload(upload, raw_path, limit, display)
                if slot == "segmentation":
                    await run_in_threadpool(
                        sanitize_segmentation, raw_path, job_dir / "input" / "segmentation.nii.gz", set(LABEL_BY_VALUE)
                    )
                else:
                    await run_in_threadpool(
                        _ingest, raw_path, kind, job_dir / "input" / f"{slot}.nii.gz", incoming / f"{slot}_scratch", display
                    )
        except InputError as error:
            store.delete(state.id)
            raise HTTPException(400, str(error))
        except Exception:
            store.delete(state.id)
            log.exception("upload failed for job %s", state.id)
            raise HTTPException(500, "The upload could not be processed.")
        finally:
            # Original files (with their original headers) are not kept.
            shutil.rmtree(incoming, ignore_errors=True)

        state.status, state.message = "queued", "Waiting for the worker"
        store.save(state)
        worker.submit(state.id)
        return {"job_id": state.id, "status": state.status, "mode": state.mode}

    @app.get("/api/jobs/{job_id}")
    def job_status(job_id: str, user: User | None = Depends(current_user)):
        state = visible_job(job_id, user)
        data = state.public(settings.job_ttl_hours)
        data["queue_length"] = worker.queue_length() if state.status in ACTIVE_STAGES else 0
        return data

    @app.delete("/api/jobs/{job_id}", status_code=204)
    def delete_job(job_id: str, user: User = Depends(require_user)):
        if visible_job(job_id, user).pinned:
            raise HTTPException(403, "Sample results are shared with every visitor and cannot be deleted.")
        store.delete(job_id)
        return Response(status_code=204)

    def comparison_dir(baseline_id: str, followup_id: str, user: User):
        baseline = done_job_dir(baseline_id, user)
        followup = done_job_dir(followup_id, user)
        if baseline_id == followup_id:
            raise HTTPException(400, "Choose two different examinations.")
        return baseline, followup, followup / "comparisons" / baseline_id

    @app.post("/api/comparisons/{baseline_id}/{followup_id}", status_code=202)
    def start_comparison(baseline_id: str, followup_id: str, tasks: BackgroundTasks,
                         same_patient: bool = Query(False), user: User = Depends(require_user)):
        baseline, followup, directory = comparison_dir(baseline_id, followup_id, user)
        if not same_patient:
            raise HTTPException(400, "Confirm these are two visits of the same patient.")
        status = directory / "status.json"
        if status.exists():
            saved = json.loads(status.read_text())
            if saved["status"] == "done" and saved.get("version") == COMPARISON_VERSION:
                return saved
        if not REGISTRATION_LOCK.acquire(blocking=False):
            raise HTTPException(409, "A comparison is already running. Please try again shortly.")
        try:
            if not directory.exists() and len(list((followup / "comparisons").glob("*"))) >= 5:
                raise HTTPException(429, "This examination already has five comparisons.")
            directory.mkdir(parents=True, exist_ok=True)
            write_status(directory, {"status": "registering"})
            tasks.add_task(run_comparison, baseline, followup, directory)
        except Exception:
            REGISTRATION_LOCK.release()
            raise
        return {"status": "registering"}

    @app.get("/api/comparisons/{baseline_id}/{followup_id}")
    def comparison_status(baseline_id: str, followup_id: str, user: User = Depends(require_user)):
        _, _, directory = comparison_dir(baseline_id, followup_id, user)
        status = directory / "status.json"
        if not status.exists():
            raise HTTPException(404, "Comparison not started.")
        return json.loads(status.read_text())

    @app.get("/api/comparisons/{baseline_id}/{followup_id}/meshes/{name}.glb")
    def comparison_mesh(baseline_id: str, followup_id: str, name: str, user: User = Depends(require_user)):
        _, _, directory = comparison_dir(baseline_id, followup_id, user)
        if name not in ("brain", "label_1", "label_2", "label_3", "label_4", "change_1", "change_2", "change_3"):
            raise HTTPException(404, "Unknown comparison mesh.")
        status = directory / "status.json"
        path = directory / "meshes" / f"{name}.glb"
        if not status.exists() or json.loads(status.read_text()).get("status") != "done" or not path.exists():
            raise HTTPException(404, "Comparison mesh not available.")
        return FileResponse(path, media_type="model/gltf-binary", headers={"Cache-Control": "private, no-store"})

    @app.get("/api/comparisons/{baseline_id}/{followup_id}/volumes/{name}/header")
    def comparison_header(baseline_id: str, followup_id: str, name: str, user: User = Depends(require_user)):
        _, _, directory = comparison_dir(baseline_id, followup_id, user)
        status = directory / "status.json"
        if not status.exists() or json.loads(status.read_text()).get("status") != "done":
            raise HTTPException(409, "Comparison is not ready.")
        if name not in ("labels", "t1c", "flair", "changes") or not (directory / name).with_suffix(".json").exists():
            raise HTTPException(404, "Comparison volume not available.")
        return json.loads((directory / f"{name}.json").read_text())

    @app.get("/api/comparisons/{baseline_id}/{followup_id}/volumes/{name}")
    def comparison_volume(baseline_id: str, followup_id: str, name: str, user: User = Depends(require_user)):
        comparison_header(baseline_id, followup_id, name, user)
        _, _, directory = comparison_dir(baseline_id, followup_id, user)
        return FileResponse(directory / f"{name}.bin.gz", media_type="application/octet-stream",
                            headers={"Content-Encoding": "gzip", "Cache-Control": "no-store"})

    @app.get("/api/jobs/{job_id}/summary")
    def job_summary(job_id: str, user: User | None = Depends(current_user)):
        path = done_job_dir(job_id, user) / "output" / "summary.json"
        return JSONResponse(json.loads(path.read_text(encoding="utf-8")))

    @app.get("/api/jobs/{job_id}/meshes/{name}.glb")
    def job_mesh(job_id: str, name: str, request: Request, user: User | None = Depends(current_user)):
        if name not in MESH_NAMES:
            raise HTTPException(404, f"Unknown mesh; expected one of {', '.join(MESH_NAMES)}.")
        path = done_job_dir(job_id, user) / "output" / "meshes" / f"{name}.glb"
        if not path.exists():
            raise HTTPException(404, f"No {name} mesh: that region is empty in this segmentation.")
        cache = {"Vary": "Accept-Encoding", "Cache-Control": "private, max-age=3600"}
        if "gzip" not in request.headers.get("accept-encoding", ""):
            return FileResponse(path, media_type="model/gltf-binary", headers=cache)
        # Float vertices compress by about 40%. Compressed on first request and kept
        # next to the mesh (the results package only collects *.glb).
        packed = path.with_suffix(".glb.gz")
        if not packed.exists():
            partial = path.with_suffix(f".{uuid.uuid4().hex}.part")
            with path.open("rb") as source, gzip.open(partial, "wb", compresslevel=6) as target:
                shutil.copyfileobj(source, target)
            partial.replace(packed)
        return FileResponse(packed, media_type="model/gltf-binary", headers={"Content-Encoding": "gzip", **cache})

    @app.get("/api/jobs/{job_id}/volumes/{name}/header")
    def job_volume_header(job_id: str, name: str, user: User | None = Depends(current_user)):
        return _volume_header(done_job_dir(job_id, user), name)

    @app.get("/api/jobs/{job_id}/volumes/{name}")
    def job_volume(job_id: str, name: str, user: User | None = Depends(current_user)):
        """Raw voxels, gzip-encoded; the JSON header is also sent as X-Volume-Header."""
        job_dir = done_job_dir(job_id, user)
        header = _volume_header(job_dir, name)
        path = job_dir / "output" / "viewer" / f"{name}.bin.gz"
        return FileResponse(
            path,
            media_type="application/octet-stream",
            headers={
                "Content-Encoding": "gzip",
                "X-Volume-Header": json.dumps({k: v for k, v in header.items() if k != "label_map"}),
                "Cache-Control": "private, max-age=3600",
            },
        )

    @app.get("/api/jobs/{job_id}/voxel")
    def job_voxel(
        job_id: str,
        x: float = Query(..., description="world mm, RAS: +x = patient right"),
        y: float = Query(..., description="world mm, RAS: +y = anterior"),
        z: float = Query(..., description="world mm, RAS: +z = superior"),
        user: User | None = Depends(current_user),
    ):
        if not all(math.isfinite(value) and abs(value) < 1e5 for value in (x, y, z)):
            raise HTTPException(400, "Coordinates must be finite numbers in millimetres.")
        viewer = done_job_dir(job_id, user) / "output" / "viewer"
        header = read_header(viewer, "labels")
        affine = np.array(header["affine"])
        continuous = world_to_voxel([x, y, z], affine)
        index = world_to_voxel([x, y, z], affine, round_to_index=True)
        result = {
            "world_mm": [x, y, z],
            "voxel": index.tolist(),
            "voxel_continuous": continuous.tolist(),
            "in_bounds": is_in_bounds(index, header["shape"]),
            "label": None,
            "label_short": None,
            "label_name": None,
            "color": None,
            "confidence": None,
            "intensities": {"t1c": None, "flair": None},
        }
        if not result["in_bounds"]:
            return result
        i, j, k = (int(v) for v in index)
        label = int(open_array(viewer, "labels")[i, j, k])
        info = LABEL_BY_VALUE[label]
        result.update(label=label, label_short=info.short, label_name=info.name, color=info.color)
        confidence = open_array(viewer, "confidence")
        if confidence is not None:
            result["confidence"] = float(confidence[i, j, k]) / 255.0
        for name in ("t1c", "flair"):
            array, volume_header = open_array(viewer, name), read_header(viewer, name)
            if array is not None:
                result["intensities"][name] = (
                    float(array[i, j, k]) * volume_header["scl_slope"] + volume_header["scl_inter"]
                )
        return result

    @app.get("/api/jobs/{job_id}/download/results.zip")
    def job_download_bundle(job_id: str, user: User | None = Depends(current_user)):
        """Mask + the scans it belongs to + colour tables + preview + 3D surfaces + README."""
        job_dir = done_job_dir(job_id, user)
        summary = json.loads((job_dir / "output" / "summary.json").read_text(encoding="utf-8"))
        return Response(
            build_bundle(job_dir, summary),
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="glioma_segmentation_{job_id[:8]}.zip"'},
        )

    @app.get("/api/jobs/{job_id}/download/preview.png")
    def job_download_preview(job_id: str, user: User | None = Depends(current_user)):
        path = done_job_dir(job_id, user) / "output" / "preview.png"
        if not path.exists():
            raise HTTPException(404, "No preview picture for this job.")
        return FileResponse(path, media_type="image/png", filename=f"glioma_segmentation_{job_id[:8]}.png")

    @app.get("/api/jobs/{job_id}/download/segmentation.nii.gz")
    def job_download(job_id: str, user: User | None = Depends(current_user)):
        path = done_job_dir(job_id, user) / "output" / "segmentation.nii.gz"
        return FileResponse(path, media_type="application/gzip", filename=f"segmentation_{job_id[:8]}.nii.gz")

    # --------------------------------------------- optional built frontend
    dist = Path(os.environ.get("FRONTEND_DIST", Path(__file__).resolve().parents[2] / "frontend" / "dist"))
    if (dist / "index.html").exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):
            if path == "api" or path.startswith("api/"):
                raise HTTPException(404, "Not found")
            candidate = (dist / path).resolve()
            if path and dist.resolve() in candidate.parents and candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(dist / "index.html")

    return app


def _ingest_sample(cache_dir: Path, input_dir: Path) -> None:
    """Copy the synthetic case into a job through the same validation as an upload."""
    paths = ensure_sample_case(cache_dir)
    for slot in SEQUENCES:
        sanitize_nifti(paths[slot], input_dir / f"{slot}.nii.gz", SEQUENCE_DISPLAY[slot])
    sanitize_segmentation(paths["segmentation"], input_dir / "segmentation.nii.gz", set(LABEL_BY_VALUE))


def _volume_header(job_dir: Path, name: str) -> dict:
    if name not in VOLUME_NAMES:
        raise HTTPException(404, f"Unknown volume; expected one of {', '.join(VOLUME_NAMES)}.")
    header = read_header(job_dir / "output" / "viewer", name)
    if header is None:
        detail = (
            "No confidence volume: this job ran in demo mode, without model inference."
            if name == "confidence"
            else f"Volume {name} is not available."
        )
        raise HTTPException(404, detail)
    return header


def get_app() -> FastAPI:
    """Factory for ``uvicorn app.main:get_app --factory``."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    return create_app()
