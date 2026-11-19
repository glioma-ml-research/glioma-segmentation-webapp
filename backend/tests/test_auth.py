"""Accounts, sessions, invites, job ownership and the HTTP hardening."""

from __future__ import annotations

import dataclasses
import gzip
import logging
import re
import struct

import nibabel as nib
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.auth import AuthError, AuthStore, check_password_rules, hash_password, needs_rehash, verify_password
from app.main import create_app

from . import synthetic
from .conftest import PASSWORD, make_client, run_job, submit, wait_for, write_case


def _cookie_header(response) -> str:
    return "; ".join(value for key, value in response.headers.multi_items() if key == "set-cookie")


# ------------------------------------------------------------------ passwords


def test_password_hashes_are_salted_scrypt_and_verify(monkeypatch):
    monkeypatch.setenv("GLIOMA_SCRYPT_N", "1024")
    first, second = hash_password("a long passphrase here"), hash_password("a long passphrase here")
    assert first.startswith("scrypt$1024$8$1$") and first != second  # random salt
    assert verify_password("a long passphrase here", first)
    assert not verify_password("a long passphrase herE", first)
    assert not verify_password("anything", "not-a-hash")
    monkeypatch.setenv("GLIOMA_SCRYPT_N", str(2**17))
    assert needs_rehash(first)  # weaker than the production cost: upgraded at next sign-in


@pytest.mark.parametrize("password", ["short", "1234567890", "aaaaaaaaaaaa", "tester-is-my-name"])
def test_weak_passwords_are_refused(password):
    with pytest.raises(AuthError):
        check_password_rules(password, "tester")


def test_usernames_are_normalised_and_validated(tmp_path, monkeypatch):
    monkeypatch.setenv("GLIOMA_SCRYPT_N", "1024")
    store = AuthStore(tmp_path / "auth.db")
    assert store.create_user("  Dr.Aliyev ", PASSWORD).username == "dr.aliyev"
    with pytest.raises(AuthError):
        store.create_user("DR.ALIYEV", PASSWORD)  # same name, other case
    for bad in ("ab", "has space", "../etc", "x" * 40, "<script>"):
        with pytest.raises(AuthError):
            store.create_user(bad, PASSWORD)


# ------------------------------------------------------------------- sign in


def test_sign_in_sets_a_safe_cookie_and_sign_out_ends_the_session(app):
    with make_client(app) as browser:
        app.state.users.create_user("alice", PASSWORD)
        assert browser.get("/api/auth/me").json()["user"] is None

        wrong = browser.post("/api/auth/login", json={"username": "alice", "password": "nope nope nope"})
        unknown = browser.post("/api/auth/login", json={"username": "nobody", "password": "nope nope nope"})
        assert wrong.status_code == unknown.status_code == 401
        assert wrong.json() == unknown.json() == {"detail": "Wrong username or password."}  # no account enumeration

        ok = browser.post("/api/auth/login", json={"username": "Alice", "password": PASSWORD})
        assert ok.status_code == 200 and ok.json()["user"]["username"] == "alice"
        cookie = _cookie_header(ok).lower()
        assert "glioma_session=" in cookie and "httponly" in cookie and "samesite=strict" in cookie and "path=/" in cookie
        assert "password" not in ok.text
        assert browser.get("/api/auth/me").json()["user"]["username"] == "alice"

        token = browser.cookies.get("glioma_session")
        assert app.state.users.session_user(token) is not None
        assert browser.post("/api/auth/logout").status_code == 204
        assert app.state.users.session_user(token) is None  # gone on the server, not just in the browser
        assert browser.get("/api/auth/me").json()["user"] is None


def test_the_database_stores_only_hashes(app, settings):
    with make_client(app, username="tester") as browser:
        token = browser.cookies.get("glioma_session")
    raw = b"".join(path.read_bytes() for path in settings.data_dir.glob("auth.db*"))
    assert token.encode() not in raw and PASSWORD.encode() not in raw


def test_repeated_failures_are_rate_limited(app):
    with make_client(app) as browser:
        app.state.users.create_user("bob", PASSWORD)
        for _ in range(5):
            assert browser.post("/api/auth/login", json={"username": "bob", "password": "wrong password"}).status_code == 401
        blocked = browser.post("/api/auth/login", json={"username": "bob", "password": PASSWORD})
        assert blocked.status_code == 429 and int(blocked.headers["retry-after"]) > 0
        # Other accounts from the same address are not locked out by it.
        app.state.users.create_user("carol", PASSWORD)
        assert browser.post("/api/auth/login", json={"username": "carol", "password": PASSWORD}).status_code == 200


def test_disabled_accounts_cannot_sign_in_and_lose_their_sessions(app):
    admin = make_client(app, username="boss", role="admin")
    member = make_client(app, username="dana")
    dana = app.state.users.find_user("dana")
    assert admin.patch(f"/api/admin/users/{dana.id}", json={"disabled": True}).status_code == 200
    assert member.get("/api/auth/me").json()["user"] is None
    assert member.post("/api/auth/login", json={"username": "dana", "password": PASSWORD}).status_code == 401


# ------------------------------------------------------------------- invites


def test_first_administrator_comes_from_the_setup_link(settings, caplog):
    caplog.set_level(logging.WARNING)
    with TestClient(create_app(settings), headers={"x-glioma-client": "test"}) as browser:
        assert browser.get("/api/auth/me").json()["setup_required"] is True
        token = re.search(r"/signup#invite=([\w-]+)", caplog.text).group(1)
        assert browser.post("/api/auth/invite", json={"token": token}).json()["first_admin"] is True
        made = browser.post("/api/auth/signup", json={"token": token, "username": "founder", "display_name": "The Founder", "password": PASSWORD})
        assert made.status_code == 200 and made.json()["user"]["role"] == "admin"
        assert browser.get("/api/auth/me").json() == {**browser.get("/api/auth/me").json(), "setup_required": False}
        again = browser.post("/api/auth/signup", json={"token": token, "username": "second", "password": PASSWORD})
        assert again.status_code == 400  # single use


def test_invites_create_members_once_and_only_admins_make_them(app):
    admin = make_client(app, username="boss", role="admin")
    member = make_client(app, username="tester")
    assert member.post("/api/admin/invites", json={}).status_code == 403
    assert member.get("/api/admin/users").status_code == 403

    created = admin.post("/api/admin/invites", json={"role": "member", "note": "Dr. Aliyev", "hours": 1}).json()
    token = created["path"].split("#invite=")[1]
    assert [item["note"] for item in admin.get("/api/admin/invites").json()] == ["Dr. Aliyev"]
    assert token not in admin.get("/api/admin/invites").text  # the token is shown once, never listed

    guest = make_client(app)
    assert guest.post("/api/auth/invite", json={"token": token}).json()["kind"] == "signup"
    weak = guest.post("/api/auth/signup", json={"token": token, "username": "newbie", "password": "short"})
    assert weak.status_code == 400 and "characters" in weak.json()["detail"]
    ok = guest.post("/api/auth/signup", json={"token": token, "username": "newbie", "password": PASSWORD})
    assert ok.status_code == 200 and ok.json()["user"]["role"] == "member"
    assert make_client(app).post("/api/auth/signup", json={"token": token, "username": "other", "password": PASSWORD}).status_code == 400
    assert admin.get("/api/admin/invites").json() == []


def test_reset_links_set_a_new_password_and_sign_out_everywhere(app):
    admin = make_client(app, username="boss", role="admin")
    member = make_client(app, username="tester")
    tester = app.state.users.find_user("tester")
    token = admin.post(f"/api/admin/users/{tester.id}/reset-link").json()["path"].split("#invite=")[1]
    guest = make_client(app)
    assert guest.post("/api/auth/invite", json={"token": token}).json() == {
        **guest.post("/api/auth/invite", json={"token": token}).json(),
        "kind": "reset",
        "username": "tester",
    }
    assert guest.post("/api/auth/signup", json={"token": token, "password": "a brand new passphrase"}).status_code == 200
    assert member.get("/api/auth/me").json()["user"] is None  # the old session is gone
    assert guest.get("/api/auth/me").json()["user"]["username"] == "tester"


def test_password_change_needs_the_current_password(app):
    member = make_client(app, username="tester")
    other_device = make_client(app, username="tester")
    assert member.post("/api/auth/password", json={"current_password": "wrong one!", "new_password": "another long phrase"}).status_code == 400
    assert member.post("/api/auth/password", json={"current_password": PASSWORD, "new_password": "another long phrase"}).status_code == 200
    assert member.get("/api/auth/me").json()["user"]["username"] == "tester"  # this device stays signed in
    assert other_device.get("/api/auth/me").json()["user"] is None


def test_the_last_administrator_cannot_be_removed(app):
    admin = make_client(app, username="boss", role="admin")
    boss = app.state.users.find_user("boss")
    assert admin.patch(f"/api/admin/users/{boss.id}", json={"role": "member"}).status_code == 400
    assert admin.delete(f"/api/admin/users/{boss.id}").status_code == 400
    with pytest.raises(AuthError):
        app.state.users.update_user(boss.id, disabled=True)


# ----------------------------------------------------------------- ownership


def test_results_belong_to_their_account(app, client, tmp_path):
    job_id = run_job(client, write_case(tmp_path / "case", synthetic.oblique_affine()))
    mine = client.get("/api/jobs").json()
    assert [item["id"] for item in mine] == [job_id] and mine[0]["tumor_ml"] > 0 and "owner" not in mine[0]

    stranger = make_client(app, username="stranger")
    anonymous = make_client(app)
    for path in ("", "/summary", "/volumes/labels", "/volumes/labels/header", "/meshes/brain.glb", "/voxel?x=0&y=0&z=0", "/download/results.zip"):
        assert stranger.get(f"/api/jobs/{job_id}{path}").status_code == 404, path
        assert anonymous.get(f"/api/jobs/{job_id}{path}").status_code == 401, path
    assert stranger.delete(f"/api/jobs/{job_id}").status_code == 404
    assert stranger.get("/api/jobs").json() == []
    # Someone else's job and a job that does not exist look the same.
    assert stranger.get(f"/api/jobs/{job_id}").json() == stranger.get(f"/api/jobs/{'0' * 32}").json()

    admin = make_client(app, username="boss", role="admin")
    assert admin.get(f"/api/jobs/{job_id}/summary").status_code == 200
    everyone = admin.get("/api/jobs?all=true").json()
    assert everyone[0]["owner_username"] == "tester"
    assert client.delete(f"/api/jobs/{job_id}").status_code == 204


def test_signing_in_is_required_to_upload(app, tmp_path):
    anonymous = make_client(app)
    paths = write_case(tmp_path / "case", synthetic.oblique_affine())
    assert submit(anonymous, paths).status_code == 401
    assert anonymous.post("/api/demo/sample").status_code == 401
    assert anonymous.get("/api/jobs").status_code == 401
    assert list((app.state.settings.jobs_dir).iterdir()) == []  # nothing was stored


def test_samples_are_public_unless_configured_otherwise(settings, tmp_path):
    from .test_api import _add_synthetic_sample

    _add_synthetic_sample(settings, tmp_path)
    private = create_app(dataclasses.replace(settings, public_samples=False))
    with make_client(private) as anonymous:
        assert anonymous.get("/api/samples").status_code == 401
        assert anonymous.post("/api/samples/demo-case/open").status_code == 401
    with make_client(create_app(settings)) as anonymous:
        assert anonymous.get("/api/samples").status_code == 200
        job_id = anonymous.post("/api/samples/demo-case/open").json()["job_id"]
        assert wait_for(anonymous, job_id)["status"] == "done"
        assert anonymous.get(f"/api/jobs/{job_id}/summary").status_code == 200
        assert anonymous.delete(f"/api/jobs/{job_id}").status_code == 401


def test_daily_quota(settings, tmp_path):
    with make_client(create_app(dataclasses.replace(settings, max_jobs_per_user_per_day=1)), username="tester") as member:
        paths = write_case(tmp_path / "case", synthetic.oblique_affine())
        assert submit(member, paths).status_code == 201
        refused = submit(member, paths)
        assert refused.status_code == 429 and "per day" in refused.json()["detail"]


# ----------------------------------------------------------------- hardening


def test_state_changes_need_the_app_header_and_a_same_site_origin(app):
    with make_client(app, username="tester") as member:
        bare = TestClient(app, cookies=dict(member.cookies))
        assert bare.post("/api/auth/logout").status_code == 403  # a plain cross-site form cannot add the header
        assert member.post("/api/auth/logout", headers={"origin": "https://evil.example"}).status_code == 403
        assert member.post("/api/auth/logout", headers={"origin": "null"}).status_code == 403
        assert member.post("/api/auth/logout", headers={"origin": "https://testserver.evil.example"}).status_code == 403
        # A proxy that drops the port from Host (nginx "$host") still counts as this site.
        assert member.post("/api/auth/logout", headers={"origin": "http://testserver:8080"}).status_code == 204
        assert member.post("/api/auth/logout", headers={"origin": "http://testserver"}).status_code == 204


def test_security_headers_and_no_api_docs(client):
    response = client.get("/api/info")
    headers = response.headers
    assert "default-src 'self'" in headers["content-security-policy"] and "frame-ancestors 'none'" in headers["content-security-policy"]
    assert headers["x-content-type-options"] == "nosniff" and headers["x-frame-options"] == "DENY"
    assert headers["referrer-policy"] == "no-referrer" and headers["cache-control"] == "no-store"
    assert "server" not in headers
    for path in ("/api/docs", "/api/openapi.json", "/docs", "/openapi.json"):
        assert client.get(path).status_code == 404


def test_oversized_requests_are_refused_before_reading(client):
    big = client.post("/api/auth/login", content=b"x" * (65 * 1024), headers={"content-type": "application/json"})
    assert big.status_code == 413

    def chunks():  # no Content-Length: counted while streaming
        for _ in range(80):
            yield b"x" * 1024

    streamed = client.post("/api/auth/login", content=chunks(), headers={"content-type": "application/json"})
    assert streamed.status_code == 413


def test_a_tiny_file_claiming_a_huge_volume_is_refused_without_decompressing(client, tmp_path):
    # A valid NIfTI header for 1024 x 1024 x 1024 float32 (4 GB) followed by almost no data.
    header = nib.Nifti1Image(np.zeros((2, 2, 2), np.float32), np.eye(4)).header.copy()
    header.set_data_shape((1024, 1024, 1024))
    header["vox_offset"] = 352
    bomb = tmp_path / "bomb.nii.gz"
    with gzip.open(bomb, "wb") as sink:
        sink.write(header.binaryblock + struct.pack("<4x") + b"\0" * 1024)
    paths = write_case(tmp_path / "case", synthetic.oblique_affine())
    paths["t1"] = bomb
    response = submit(client, paths)
    assert response.status_code == 400 and "too large" in response.json()["detail"]

    four_d = tmp_path / "series.nii.gz"
    nib.save(nib.Nifti1Image(np.zeros((32, 32, 32, 3), np.float32), np.eye(4)), str(four_d))
    paths["t1"] = four_d
    response = submit(client, paths)
    assert response.status_code == 400 and "3D" in response.json()["detail"]


def test_internal_errors_are_not_shown_to_users(client, tmp_path, monkeypatch):
    import app.main as main

    def broken(*args, **kwargs):
        raise RuntimeError(r"CUDA out of memory at C:\secret\models\fold_2")

    monkeypatch.setattr(main, "run_pipeline", broken)
    job_id = submit(client, write_case(tmp_path / "case", synthetic.oblique_affine())).json()["job_id"]
    state = wait_for(client, job_id)
    assert state["status"] == "error"
    assert "secret" not in state["error"] and "CUDA" not in state["error"] and "reference" in state["error"]


def test_voxel_lookup_rejects_non_finite_coordinates(client, tmp_path):
    job_id = run_job(client, write_case(tmp_path / "case", synthetic.oblique_affine()))
    assert client.get(f"/api/jobs/{job_id}/voxel?x=nan&y=0&z=0").status_code == 400
    assert client.get(f"/api/jobs/{job_id}/voxel?x=inf&y=0&z=0").status_code == 400
