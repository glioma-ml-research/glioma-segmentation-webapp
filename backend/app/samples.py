"""Curated sample cases that visitors can open without uploading anything.

Each sample is a real MU-Glioma-Post examination stored under
``<data_dir>/samples/<id>/`` (t1, t1c, t2, flair and the expert reference
mask), described in ``<data_dir>/samples/index.json``. Samples are added with
``scripts/add_sample.py``; the folder lives under ``data/`` and is never
committed.

Opening a sample runs it through the normal pipeline once (with the model, or
in demo mode with the reference mask) and keeps that result as a pinned job,
so every later visitor gets it instantly.
"""

from __future__ import annotations

import json
import shutil
import threading
from pathlib import Path

import numpy as np

from .io_utils import load_segmentation, sanitize_nifti, sanitize_segmentation
from .labels import LABEL_BY_VALUE, SEQUENCE_DISPLAY, SEQUENCES

INDEX_NAME = "index.json"
FILES = SEQUENCES + ("reference",)
_lock = threading.Lock()


def samples_dir(data_dir: Path) -> Path:
    return data_dir / "samples"


def load_index(data_dir: Path) -> list[dict]:
    path = samples_dir(data_dir) / INDEX_NAME
    if not path.is_file():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def _save_index(data_dir: Path, entries: list[dict]) -> None:
    directory = samples_dir(data_dir)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / INDEX_NAME).write_text(json.dumps(entries, indent=2), encoding="utf-8")


def add_sample(
    data_dir: Path,
    *,
    sample_id: str,
    title: str,
    description: str,
    case_id: str,
    images: dict[str, Path],
    reference: Path,
) -> dict:
    """Copy one examination into the sample library (headers rebuilt, like an upload)."""
    if not sample_id.replace("-", "").isalnum():
        raise ValueError("sample_id may contain only letters, digits and dashes")
    target = samples_dir(data_dir) / sample_id
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    for slot in SEQUENCES:
        sanitize_nifti(images[slot], target / f"{slot}.nii.gz", SEQUENCE_DISPLAY[slot])
    sanitize_segmentation(reference, target / "reference.nii.gz", set(LABEL_BY_VALUE))

    labels, affine = load_segmentation(target / "reference.nii.gz", set(LABEL_BY_VALUE))
    voxel_ml = abs(float(np.linalg.det(affine[:3, :3]))) / 1000.0
    entry = {
        "id": sample_id,
        "title": title,
        "description": description,
        "case_id": case_id,
        "patient_id": case_id.split("_Timepoint_")[0],
        "reference_ml": {str(v): round(float((labels == v).sum()) * voxel_ml, 2) for v in (1, 2, 3, 4)},
    }
    with _lock:
        entries = [e for e in load_index(data_dir) if e["id"] != sample_id]
        entries.append(entry)
        _save_index(data_dir, entries)
    return entry


def get_sample(data_dir: Path, sample_id: str) -> dict | None:
    return next((e for e in load_index(data_dir) if e["id"] == sample_id), None)


def copy_inputs(data_dir: Path, sample_id: str, input_dir: Path, *, reference_as_segmentation: bool) -> None:
    """Put a sample's files into a job's input folder."""
    source = samples_dir(data_dir) / sample_id
    input_dir.mkdir(parents=True, exist_ok=True)
    for slot in SEQUENCES:
        shutil.copyfile(source / f"{slot}.nii.gz", input_dir / f"{slot}.nii.gz")
    # With a model the reference is kept aside for comparison; in demo mode it
    # *is* the segmentation shown.
    name = "segmentation.nii.gz" if reference_as_segmentation else "reference.nii.gz"
    shutil.copyfile(source / "reference.nii.gz", input_dir / name)


def cached_job(data_dir: Path, sample_id: str, signature: str) -> str | None:
    path = samples_dir(data_dir) / sample_id / "job.json"
    if not path.is_file():
        return None
    record = json.loads(path.read_text(encoding="utf-8"))
    return record["job_id"] if record.get("signature") == signature else None


def remember_job(data_dir: Path, sample_id: str, signature: str, job_id: str) -> None:
    path = samples_dir(data_dir) / sample_id / "job.json"
    path.write_text(json.dumps({"job_id": job_id, "signature": signature}), encoding="utf-8")


def outer_test_fold(patient_id: str) -> int | None:
    table = json.loads((Path(__file__).parent / "resources" / "outer_test_patients.json").read_text(encoding="utf-8"))
    for fold, entry in table["folds"].items():
        if patient_id in entry["outer_test_patients"]:
            return int(fold)
    return None


RUN_FOLD = {"no29": 1, "no30": 2, "no31": 3, "no32": 4, "no33": 5, "no34": 1, "no35": 1}


def unseen_by_model(patient_id: str, member_names: list[str]) -> bool | None:
    """True if every loaded model is the study run that held this patient out.

    None when it cannot be told (unknown runs or patient).
    """
    fold = outer_test_fold(patient_id)
    runs = [next((run for run in RUN_FOLD if run in name), None) for name in member_names]
    if fold is None or not runs or any(run is None for run in runs):
        return None
    return all(RUN_FOLD[run] == fold for run in runs)
