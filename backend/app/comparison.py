"""Exploratory longitudinal comparison; rigid registration is not a response assessment."""
from pathlib import Path
import json
import threading

import numpy as np
import SimpleITK as sitk

from .volumes import open_array, read_header, write_volume
from .meshing import clean_brain_mask, mask_to_mesh, export_glb

REGISTRATION_LOCK = threading.Lock()
COMPARISON_VERSION = 2


def comparison_meshes(output: Path, labels, t1c, changes, affine):
    """All surfaces are built in the same baseline RAS-mm frame as the slices."""
    meshes, change_meshes = {}, {}
    masks = {"brain": clean_brain_mask(t1c != 0)}
    masks.update({f"label_{i}": labels == i for i in range(1, 5)})
    masks.update({f"change_{i}": changes == i for i in range(1, 4)})
    for name, mask in masks.items():
        mesh = mask_to_mesh(mask, affine, target_faces=40000 if name == "brain" else 16000)
        if mesh is not None:
            stats = export_glb(mesh, output / "meshes" / f"{name}.glb", name=name)
            if name.startswith("change_"):
                change_meshes[name.replace("change_", "label_")] = stats
            else:
                meshes[name] = stats
    return meshes, change_meshes


def image_from_viewer(directory: Path, name: str):
    header = read_header(directory, name)
    data = np.asarray(open_array(directory, name), dtype=np.float32)
    data = data * header["scl_slope"] + header["scl_inter"]
    affine = np.asarray(header["affine"])
    spacing = np.linalg.norm(affine[:3, :3], axis=0)
    direction = affine[:3, :3] / spacing
    if not np.allclose(direction.T @ direction, np.eye(3), atol=1e-4):
        raise ValueError("Sheared grids require orthogonal resampling before registration.")
    ras_to_lps = np.diag([-1., -1., 1.])
    image = sitk.GetImageFromArray(data.transpose(2, 1, 0))
    image.SetSpacing(tuple(spacing))
    image.SetOrigin(tuple(ras_to_lps @ affine[:3, 3]))
    image.SetDirection(tuple((ras_to_lps @ direction).ravel()))
    return image, header


def change_map(before, after, valid):
    a, b = np.isin(before, [1, 2, 3]), np.isin(after, [1, 2, 3])
    result = np.zeros(a.shape, dtype=np.uint8)
    result[~a & b & valid] = 1
    result[a & ~b & valid] = 2
    result[a & b & valid] = 3
    return result


def write_status(directory, body):
    path = directory / "status.json"
    temporary = directory / "status.tmp"
    temporary.write_text(json.dumps(body), encoding="utf-8")
    temporary.replace(path)


def run_comparison(baseline: Path, followup: Path, output: Path):
    """Caller reserves REGISTRATION_LOCK; only one registration runs at a time."""
    try:
        fixed_dir, moving_dir = baseline / "output/viewer", followup / "output/viewer"
        fixed, header = image_from_viewer(fixed_dir, "t1c")
        moving, _ = image_from_viewer(moving_dir, "t1c")
        method = sitk.ImageRegistrationMethod()
        method.SetNumberOfThreads(2)
        method.SetMetricAsMattesMutualInformation(50)
        method.SetMetricSamplingStrategy(method.RANDOM)
        method.SetMetricSamplingPercentage(.15, 2026)
        method.SetInterpolator(sitk.sitkLinear)
        method.SetOptimizerAsRegularStepGradientDescent(1., 1e-4, 200)
        method.SetOptimizerScalesFromPhysicalShift()
        method.SetShrinkFactorsPerLevel([4, 2, 1])
        method.SetSmoothingSigmasPerLevel([2., 1., 0.])
        method.SmoothingSigmasAreSpecifiedInPhysicalUnitsOn()
        initial = sitk.CenteredTransformInitializer(fixed, moving, sitk.Euler3DTransform(), sitk.CenteredTransformInitializerFilter.GEOMETRY)
        method.SetInitialTransform(initial, inPlace=False)
        transform = method.Execute(fixed, moving)
        sitk.WriteTransform(transform, str(output / "followup_to_baseline.tfm"))
        affine = np.asarray(header["affine"])
        registered = {}
        for name in ("t1c", "flair", "labels"):
            image, _ = image_from_viewer(moving_dir, name)
            interpolation = sitk.sitkNearestNeighbor if name == "labels" else sitk.sitkLinear
            aligned = sitk.Resample(image, fixed, transform, interpolation, 0., sitk.sitkFloat32)
            data = sitk.GetArrayFromImage(aligned).transpose(2, 1, 0)
            registered[name] = data
            write_volume(output, name, data, affine, kind="labels" if name == "labels" else "intensity")
        coverage = sitk.Image(moving.GetSize(), sitk.sitkUInt8) + 1
        coverage.CopyInformation(moving)
        valid = sitk.GetArrayFromImage(sitk.Resample(coverage, fixed, transform, sitk.sitkNearestNeighbor, 0)).transpose(2, 1, 0) > 0
        changes = change_map(open_array(fixed_dir, "labels"), registered["labels"], valid)
        write_volume(output, "changes", changes, affine, kind="labels")
        meshes, change_meshes = comparison_meshes(output, registered["labels"], registered["t1c"], changes, affine)
        voxel_ml = abs(np.linalg.det(affine[:3, :3])) / 1000
        write_status(output, {
            "status": "done", "version": COMPARISON_VERSION, "meshes": meshes, "change_meshes": change_meshes,
            "method": "Rigid T1c registration, mutual information; nearest-neighbour labels",
            "coverage_fraction": float(valid.mean()),
            "change_ml": {str(i): float((changes == i).sum() * voxel_ml) for i in (1, 2, 3)},
            "note": "Review anatomical alignment before interpreting overlays. Apparent changes can reflect acquisition, registration or segmentation error. This is not a treatment-response classification.",
        })
    except Exception:
        write_status(output, {"status": "error", "message": "Registration could not be completed. Open the original visits to review their results."})
    finally:
        REGISTRATION_LOCK.release()
