import json

import numpy as np
import SimpleITK as sitk

from app.comparison import REGISTRATION_LOCK, change_map, image_from_viewer, run_comparison
from app.geometry import voxel_to_world
from app.volumes import write_volume
from .conftest import PASSWORD, make_client, run_job, write_case
from . import synthetic


def test_public_registration_is_member_and_can_login(app):
    with make_client(app) as client:
        response = client.post('/api/auth/register', json={'username': 'new.doctor', 'password': PASSWORD, 'role': 'admin'})
        assert response.status_code == 201
        assert response.json()['user']['role'] == 'member'
        assert client.get('/api/auth/me').json()['user']['username'] == 'new.doctor'
        assert client.get('/api/admin/users').status_code == 403
        client.post('/api/auth/logout')
        assert client.post('/api/auth/login', json={'username': 'new.doctor', 'password': PASSWORD}).status_code == 200
        assert client.post('/api/auth/register', json={'username': 'new.doctor', 'password': PASSWORD}).status_code == 400


def test_registration_rate_limit(app):
    with make_client(app) as client:
        for i in range(5):
            assert client.post('/api/auth/register', json={'username': f'doctor{i}', 'password': PASSWORD}).status_code == 201
        assert client.post('/api/auth/register', json={'username': 'doctor6', 'password': PASSWORD}).status_code == 429


def test_comparison_requires_authentication_and_both_jobs(client, anonymous):
    assert anonymous.post('/api/comparisons/a/b?same_patient=true').status_code == 401
    assert client.post('/api/comparisons/a/b?same_patient=true').status_code == 404


def test_comparison_api_checks_both_owners_and_returns_aligned_volumes(app, client, tmp_path):
    paths = write_case(tmp_path / 'case', synthetic.oblique_affine())
    first, second = run_job(client, paths), run_job(client, paths)
    endpoint = f'/api/comparisons/{first}/{second}'
    other = make_client(app, username='other.doctor')
    assert other.post(endpoint + '?same_patient=true').status_code == 404
    assert other.get(endpoint).status_code == 404
    assert client.post(endpoint).status_code == 400  # explicit patient confirmation
    assert client.post(endpoint + '?same_patient=true').status_code == 202
    status = client.get(endpoint).json()
    assert status['status'] == 'done', status
    header = client.get(endpoint + '/volumes/labels/header').json()
    original = client.get(f'/api/jobs/{first}/volumes/labels/header').json()
    assert header['affine'] == original['affine']
    assert header['shape'] == original['shape']
    assert client.get(endpoint + '/volumes/changes').status_code == 200
    assert other.get(endpoint + '/volumes/changes').status_code == 404
    assert client.get(endpoint + '/meshes/label_3.glb').status_code == 200
    assert other.get(endpoint + '/meshes/label_3.glb').status_code == 404
    assert client.get(endpoint + '/meshes/not-a-mesh.glb').status_code == 404
    assert status['version'] == 2
    assert 'brain' in status['meshes']
    assert client.post(endpoint + '?same_patient=true').json()['status'] == 'done'  # cached


def test_change_map_excludes_cavity_and_missing_coverage():
    before = np.array([0, 1, 2, 4, 3, 0])
    after = np.array([3, 0, 1, 4, 0, 2])
    valid = np.array([1, 1, 1, 1, 0, 0], dtype=bool)
    assert change_map(before, after, valid).tolist() == [1, 2, 3, 0, 0, 0]


def test_viewer_to_sitk_preserves_oblique_world_coordinates(tmp_path):
    a = .31
    rotation = np.array([[np.cos(a), -np.sin(a), 0], [np.sin(a), np.cos(a), 0], [0, 0, 1]])
    affine = np.eye(4)
    affine[:3, :3] = rotation @ np.diag([1., 1.5, 2.])
    affine[:3, 3] = [-30, 15, 7]
    write_volume(tmp_path, 't1c', np.ones((12, 13, 14)), affine, kind='intensity')
    image, _ = image_from_viewer(tmp_path, 't1c')
    expected = voxel_to_world(np.array([2, 4, 6]), affine) * [-1, -1, 1]
    np.testing.assert_allclose(image.TransformIndexToPhysicalPoint((2, 4, 6)), expected)


def test_registration_identical_visits_no_spurious_change(tmp_path):
    # Non-symmetric textured anatomy gives the optimizer an identifiable solution.
    rng = np.random.default_rng(3)
    from scipy.ndimage import gaussian_filter
    anatomy = gaussian_filter(rng.uniform(10, 100, (40, 40, 40)), 1).astype(np.float32)
    labels = np.zeros(anatomy.shape, dtype=np.uint8)
    labels[15:25, 15:25, 15:25] = 3
    affine = np.diag([1., 1.2, 1.4, 1.])
    for visit in ('a', 'b'):
        directory = tmp_path / visit / 'output/viewer'
        visit_affine = affine.copy()
        if visit == 'b':
            visit_affine[:3, 3] = [8, -4, 3]  # same anatomy, different scanner origin
        for name, data in [('t1c', anatomy), ('flair', anatomy), ('labels', labels)]:
            write_volume(directory, name, data, visit_affine, kind='labels' if name == 'labels' else 'intensity')
    output = tmp_path / 'comparison'
    output.mkdir()
    assert REGISTRATION_LOCK.acquire(False)
    run_comparison(tmp_path / 'a', tmp_path / 'b', output)
    status = json.loads((output / 'status.json').read_text())
    assert status['status'] == 'done', status
    assert status['change_ml']['1'] < .1
    assert status['change_ml']['2'] < .1
    assert not REGISTRATION_LOCK.locked()
    registered = np.load(output / 'labels.npy')
    assert set(np.unique(registered)) <= {0, 3}
    # The second scanner origin was offset; its mesh must nevertheless be in
    # baseline space, not the original moving coordinate frame.
    import trimesh
    mesh = trimesh.load(output / 'meshes/label_3.glb', force='mesh')
    centre = mesh.bounds.mean(axis=0)
    np.testing.assert_allclose(centre, voxel_to_world([19.5, 19.5, 19.5], affine), atol=.15)
    assert 'label_3' in status['change_meshes']  # shared region
