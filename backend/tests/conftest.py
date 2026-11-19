from __future__ import annotations

import dataclasses
import time
from pathlib import Path

import nibabel as nib
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.config import load_settings
from app.main import create_app

from . import synthetic


def write_case(directory: Path, affine: np.ndarray, *, labels: np.ndarray | None = None) -> dict[str, Path]:
    """Four co-registered, skull-stripped-like sequences plus a segmentation."""
    directory.mkdir(parents=True, exist_ok=True)
    labels = synthetic.label_volume() if labels is None else labels
    paths = {}
    for index, slot in enumerate(("t1", "t1c", "t2", "flair")):
        image = synthetic.brain_volume(seed=index)
        image[labels > 0] += 150.0 * (index + 1)
        paths[slot] = directory / f"patient_DOE_JOHN_{slot}.nii.gz"  # PHI-looking name on purpose
        header = nib.Nifti1Header()
        header["descrip"] = b"DOE^JOHN 1961-02-03"
        nib.save(nib.Nifti1Image(image, affine, header), str(paths[slot]))
    paths["segmentation"] = directory / "seg.nii.gz"
    nib.save(nib.Nifti1Image(labels, affine), str(paths["segmentation"]))
    return paths


PASSWORD = "correct horse battery staple"


@pytest.fixture()
def settings(tmp_path, monkeypatch):
    monkeypatch.setenv("NNUNET_MODEL_DIR", str(tmp_path / "no-weights"))  # demo mode, whatever is in models/
    monkeypatch.setenv("GLIOMA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("FRONTEND_DIST", str(tmp_path / "no-frontend"))
    monkeypatch.setenv("GLIOMA_SCRYPT_N", "1024")  # fast hashes in tests; production uses 2**17
    return dataclasses.replace(
        load_settings(),
        brain_mesh_faces=4000,
        label_mesh_faces=2000,
        max_active_jobs_per_user=100,
        max_jobs_per_user_per_day=1000,
    )


def make_client(app, *, username: str | None = None, role: str = "member") -> TestClient:
    """A browser-like client: sends the web app's header and, given a username, is signed in."""
    test_client = TestClient(app, headers={"x-glioma-client": "test"})
    if username:
        users = app.state.users
        if users.find_user(username) is None:
            users.create_user(username, PASSWORD, role=role)
        response = test_client.post("/api/auth/login", json={"username": username, "password": PASSWORD})
        assert response.status_code == 200, response.text
    return test_client


@pytest.fixture()
def app(settings):
    return create_app(settings)


@pytest.fixture()
def client(app):
    """Signed in as an ordinary member."""
    with make_client(app, username="tester") as test_client:
        yield test_client


@pytest.fixture()
def anonymous(app, client):
    """Not signed in (shares the running app with ``client``)."""
    return TestClient(app, headers={"x-glioma-client": "test"})


def submit(client: TestClient, paths: dict[str, Path], *, already_preprocessed: bool = True, with_segmentation: bool = True):
    handles = {}
    try:
        for slot in ("t1", "t1c", "t2", "flair") + (("segmentation",) if with_segmentation else ()):
            handles[slot] = open(paths[slot], "rb")
        files = {slot: (paths[slot].name, handle, "application/gzip") for slot, handle in handles.items()}
        return client.post("/api/jobs", files=files, data={"already_preprocessed": str(already_preprocessed).lower()})
    finally:
        for handle in handles.values():
            handle.close()


def wait_for(client: TestClient, job_id: str, timeout: float = 120.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        state = client.get(f"/api/jobs/{job_id}").json()
        if state["status"] in ("done", "error"):
            return state
        time.sleep(0.2)
    raise AssertionError(f"job did not finish in {timeout}s: {state}")


def run_job(client: TestClient, paths: dict[str, Path], **kwargs) -> str:
    response = submit(client, paths, **kwargs)
    assert response.status_code == 201, response.text
    job_id = response.json()["job_id"]
    state = wait_for(client, job_id)
    assert state["status"] == "done", state
    return job_id
