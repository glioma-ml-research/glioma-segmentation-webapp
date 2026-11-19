"""Small external NIfTI smoke evaluation via the real HTTP upload/inference API.

Requires the public skull-stripped RHUH files in data/external-validation.
Never uploads reference masks to inference. This is NOT raw-DICOM validation.
"""
import json
import os
import secrets
import time
from pathlib import Path

import nibabel as nib
import numpy as np
import requests

ROOT = Path(__file__).resolve().parents[1] / "data/external-validation"
BASE = os.environ.get("GLIOMA_API", "http://127.0.0.1:8000")
CASES = [("RHUH-0001", 1), ("RHUH-0001", 2), ("RHUH-0002", 1)]


def metrics(reference, prediction, voxel_ml):
    nref, npred = int(reference.sum()), int(prediction.sum())
    intersection = int((reference & prediction).sum())
    return {
        "reference_ml": nref * voxel_ml, "prediction_ml": npred * voxel_ml,
        "dice": 2 * intersection / (nref + npred) if nref + npred else None,
        "reference_present": bool(nref),
        "precision": intersection / npred if npred else None,
        "recall": intersection / nref if nref else None,
    }


def main():
    session = requests.Session()
    session.headers["X-Glioma-Client"] = "external-validation"
    credentials_path = ROOT / ".credentials.json"
    if credentials_path.exists():
        credentials = json.loads(credentials_path.read_text())
        response = session.post(BASE + "/api/auth/login", json=credentials, timeout=30)
    else:
        credentials = {"username": "evaluation-" + secrets.token_hex(4), "password": secrets.token_urlsafe(24)}
        response = session.post(BASE + "/api/auth/register", json=credentials, timeout=30)
        response.raise_for_status()
        credentials_path.write_text(json.dumps(credentials))
    response.raise_for_status()
    results = []
    for patient, tp in CASES:
        case_id = f"{patient}_{tp}"
        directory = ROOT / patient / str(tp)
        job_file = directory / "job_id.txt"
        job_id = job_file.read_text().strip() if job_file.exists() else None
        if job_id:
            existing = session.get(BASE + f"/api/jobs/{job_id}", timeout=30)
            if existing.status_code == 404:
                job_id = None  # normal after the app's 24-hour retention period
            else:
                existing.raise_for_status()
        if not job_id:
            handles = {slot: open(directory / f"{case_id}_{suffix}.nii.gz", "rb")
                       for slot, suffix in {"t1": "t1", "t1c": "t1ce", "t2": "t2", "flair": "flair"}.items()}
            try:
                response = session.post(BASE + "/api/jobs", files={slot: (slot + ".nii.gz", handle, "application/gzip") for slot, handle in handles.items()}, data={"already_preprocessed": "true"}, timeout=180)
                response.raise_for_status()
                job_id = response.json()["job_id"]
                job_file.write_text(job_id)
            finally:
                for handle in handles.values(): handle.close()
        print(case_id, "job", job_id, flush=True)
        last_stage = None
        deadline = time.monotonic() + 1800
        while time.monotonic() < deadline:
            response = session.get(BASE + f"/api/jobs/{job_id}", timeout=90)
            response.raise_for_status()
            state = response.json()
            if state["status"] != last_stage:
                print(case_id, state["status"], flush=True)
                last_stage = state["status"]
            if state["status"] in ("done", "error"): break
            time.sleep(3)
        if state["status"] != "done":
            results.append({"case": case_id, "job_id": job_id, "error": state.get("error") or "Timed out"})
            (ROOT / "results.json").write_text(json.dumps(results, indent=2))
            continue
        response = session.get(BASE + f"/api/jobs/{job_id}/summary", timeout=90)
        response.raise_for_status()
        summary = response.json()
        assert not summary["demo"] and summary["mode"] == "inference"
        response = session.get(BASE + f"/api/jobs/{job_id}/download/segmentation.nii.gz", timeout=90)
        response.raise_for_status()
        output = directory / "app_prediction.nii.gz"
        output.write_bytes(response.content)
        reference_image = nib.load(directory / f"{case_id}_segmentations.nii.gz")
        predicted_image = nib.load(output)
        assert reference_image.shape == predicted_image.shape
        np.testing.assert_allclose(reference_image.affine, predicted_image.affine, atol=1e-4)
        ref, pred = np.asanyarray(reference_image.dataobj), np.asanyarray(predicted_image.dataobj)
        voxel_ml = abs(np.linalg.det(reference_image.affine[:3, :3])) / 1000
        scores = {str(i): metrics(ref == i, pred == i, voxel_ml) for i in (1, 2, 3)}
        scores["union_1_3"] = metrics(np.isin(ref, [1, 2, 3]), np.isin(pred, [1, 2, 3]), voxel_ml)
        result = {"case": case_id, "job_id": job_id, "format": "public preprocessed NIfTI (not raw DICOM)",
                  "scores": scores, "cavity_prediction_ml_unscored": float((pred == 4).sum() * voxel_ml),
                  "model": summary["model"], "runtime_seconds": summary["runtime_seconds"]}
        results.append(result)
        (ROOT / "results.json").write_text(json.dumps(results, indent=2))
        print(case_id, json.dumps(scores), flush=True)


if __name__ == "__main__": main()
