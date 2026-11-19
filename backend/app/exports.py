"""What a user downloads: a preview picture and a results package.

A segmentation NIfTI on its own is a label map (values 0–4, mostly zeros). Most
viewers show it as a few dim blobs on black, which looks broken. The package
therefore ships the mask together with the T1c and FLAIR it belongs to, colour
tables for ITK-SNAP and 3D Slicer, a PNG anyone can open, the 3D surfaces, and
a short README.
"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

import numpy as np

from .labels import FOREGROUND_LABELS, LABEL_BY_VALUE

PLAIN_NAMES = {
    1: "Non-enhancing tumor core",
    2: "Edema (swelling around the tumor)",
    3: "Enhancing tumor",
    4: "Resection cavity",
}


def _rgb(hex_colour: str) -> tuple[int, int, int]:
    value = int(hex_colour.lstrip("#"), 16)
    return (value >> 16) & 255, (value >> 8) & 255, value & 255


def write_preview(t1c_ras: np.ndarray, labels_ras: np.ndarray, spacing: list[float], path: Path) -> None:
    """Axial, coronal and sagittal slices through the largest tumor region, with overlay and legend.

    Arrays are on the RAS viewer grid (i → right, j → anterior, k → superior);
    shown in radiological convention like the website.
    """
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Patch

    foreground = np.argwhere(labels_ras > 0)
    centre = (
        np.round(foreground.mean(axis=0)).astype(int)
        if len(foreground)
        else (np.array(labels_ras.shape) // 2)
    )
    brain = t1c_ras[t1c_ras != 0]
    low, high = (np.percentile(brain, [1, 99.5]) if brain.size else (0.0, 1.0))

    colours = np.zeros((5, 4))
    for info in FOREGROUND_LABELS:
        colours[info.value, :3] = np.array(_rgb(info.color)) / 255.0
        colours[info.value, 3] = 0.55

    i, j, k = centre
    views = [
        ("Axial", t1c_ras[:, :, k], labels_ras[:, :, k], spacing[1] / spacing[0]),
        ("Coronal", t1c_ras[:, j, :], labels_ras[:, j, :], spacing[2] / spacing[0]),
        ("Sagittal", t1c_ras[i, :, :], labels_ras[i, :, :], spacing[2] / spacing[1]),
    ]
    figure, axes = plt.subplots(1, 3, figsize=(13.5, 5.2), facecolor="black")
    for axis, (title, image, overlay, aspect) in zip(axes, views):
        # displayed[row, col] = slice[n0-1-col, n1-1-row]: superior/anterior at
        # the top, patient's right (axial/coronal) or anterior (sagittal) on the
        # left — the same convention as the website's slice views.
        shown = image[::-1, ::-1].T
        mask = overlay[::-1, ::-1].T
        axis.imshow(shown, cmap="gray", vmin=low, vmax=high, aspect=aspect, interpolation="nearest")
        axis.imshow(colours[mask.astype(int)], aspect=aspect, interpolation="nearest")
        axis.set_title(title, color="white", fontsize=12)
        axis.axis("off")
    present = [info for info in FOREGROUND_LABELS if (labels_ras == info.value).any()]
    figure.legend(
        handles=[Patch(color=np.array(_rgb(info.color)) / 255.0, label=PLAIN_NAMES[info.value]) for info in present],
        loc="lower center",
        ncol=max(1, len(present)),
        frameon=False,
        labelcolor="white",
        fontsize=11,
    )
    figure.text(
        0.5, 0.955, "Research prototype — not for diagnosis. Axial and coronal: the patient's right is on the left.",
        color="#9aa7b6", ha="center", fontsize=10,
    )
    figure.tight_layout(rect=(0, 0.08, 1, 0.94))
    path.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(path, dpi=110, facecolor="black")
    plt.close(figure)


ITKSNAP_HEADER = """################################################
# ITK-SnAP Label Description File
# Columns = Index, Red, Green, Blue, Alpha, Visibility, Mesh visibility, Label
################################################
    0     0    0    0        0  0  0    "Clear Label"
"""


def itksnap_labels() -> str:
    lines = [ITKSNAP_HEADER.rstrip("\n")]
    for info in FOREGROUND_LABELS:
        r, g, b = _rgb(info.color)
        lines.append(f"{info.value:5d} {r:5d} {g:4d} {b:4d}        1  1  1    \"{PLAIN_NAMES[info.value]}\"")
    return "\n".join(lines) + "\n"


def slicer_color_table() -> str:
    lines = ["# 3D Slicer color table for segmentation.nii.gz", "0 Background 0 0 0 0"]
    for info in FOREGROUND_LABELS:
        r, g, b = _rgb(info.color)
        lines.append(f"{info.value} {PLAIN_NAMES[info.value].replace(' ', '_')} {r} {g} {b} 255")
    return "\n".join(lines) + "\n"


def readme(summary: dict) -> str:
    rows = "\n".join(
        f"  {entry['value']}  {PLAIN_NAMES[entry['value']]:<36} {entry['volume_ml']:8.2f} mL   {entry['component_count']} lesion(s)"
        for entry in summary["statistics"]["labels"]
    )
    model = summary["model"]
    made_by = (
        "DEMO mode: no model inference. The segmentation is the one that was uploaded (or the expert reference for a sample case)."
        if summary.get("demo")
        else f"nnU-Net v2 3d_fullres ({', '.join(m['name'] for m in model.get('members', []))})."
    )
    return f"""Postoperative glioma segmentation — results package
=====================================================

RESEARCH PROTOTYPE. Trained and internally validated on the MU-Glioma-Post
dataset only. Not a medical device, not for diagnosis or treatment decisions.
The model outlines regions; it does not classify tumor type or grade.

Made by: {made_by}

Files
-----
  preview.png                       the result at a glance (opens anywhere)
  segmentation.nii.gz               the segmentation as a label map, on the same voxel grid as t1c.nii.gz
  t1c.nii.gz, flair.nii.gz          the scans the segmentation belongs to
  segmentation_labels_itksnap.txt   label names and colours for ITK-SNAP
  segmentation_colors_slicer.ctbl   label names and colours for 3D Slicer
  3d/*.glb                          3D surfaces in millimetres (open with Windows 3D Viewer, Blender, ...)

Label values in segmentation.nii.gz
-----------------------------------
  0  background
{rows}

Opening it
----------
segmentation.nii.gz holds only the label numbers 0-4, so on its own it looks
like a few faint shapes on black. Open it ON TOP OF t1c.nii.gz:

  ITK-SNAP:   File > Open Main Image > t1c.nii.gz
              Segmentation > Open Segmentation > segmentation.nii.gz
              Segmentation > Label Editor > Actions > Import labels > segmentation_labels_itksnap.txt
  3D Slicer:  drag t1c.nii.gz and segmentation.nii.gz into Slicer; for the segmentation tick
              "Show options" > LabelMap (or Segmentation), and pick the colour table
              segmentation_colors_slicer.ctbl (load it the same way).
"""


def build_bundle(job_dir: Path, summary: dict) -> bytes:
    """The results package as an in-memory zip (scans are already gzip-compressed)."""
    output, inputs = job_dir / "output", job_dir / "input"
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        def add(path: Path, name: str, compress: bool = False) -> None:
            if path.is_file():
                archive.write(path, name, compress_type=zipfile.ZIP_DEFLATED if compress else zipfile.ZIP_STORED)

        add(output / "preview.png", "preview.png")
        add(output / "segmentation.nii.gz", "segmentation.nii.gz")
        add(inputs / "t1c.nii.gz", "t1c.nii.gz")
        add(inputs / "flair.nii.gz", "flair.nii.gz")
        for mesh in sorted((output / "meshes").glob("*.glb")):
            name = "brain" if mesh.stem == "brain" else PLAIN_NAMES[int(mesh.stem.split("_")[1])].split(" (")[0].lower().replace(" ", "_")
            add(mesh, f"3d/{name}.glb", compress=True)
        archive.writestr("segmentation_labels_itksnap.txt", itksnap_labels(), compress_type=zipfile.ZIP_DEFLATED)
        archive.writestr("segmentation_colors_slicer.ctbl", slicer_color_table(), compress_type=zipfile.ZIP_DEFLATED)
        archive.writestr("README.txt", readme(summary), compress_type=zipfile.ZIP_DEFLATED)
    return buffer.getvalue()


def reference_comparison(labels: np.ndarray, reference: np.ndarray, voxel_ml: float) -> dict:
    """Dice between the result and an expert reference, per region and for labels 1–3."""

    def dice(a: np.ndarray, b: np.ndarray):
        total = int(a.sum() + b.sum())
        return None if total == 0 else round(2.0 * float((a & b).sum()) / total, 4)

    regions = []
    for info in FOREGROUND_LABELS:
        mine, theirs = labels == info.value, reference == info.value
        regions.append(
            {
                "value": info.value,
                "dice": dice(mine, theirs),
                "result_ml": round(float(mine.sum()) * voxel_ml, 2),
                "reference_ml": round(float(theirs.sum()) * voxel_ml, 2),
            }
        )
    tumor = (np.isin(labels, (1, 2, 3)), np.isin(reference, (1, 2, 3)))
    return {"regions": regions, "tumor_related_dice": dice(*tumor), "label_names": {str(k): PLAIN_NAMES[k] for k in PLAIN_NAMES}}


__all__ = ["write_preview", "build_bundle", "reference_comparison", "PLAIN_NAMES", "LABEL_BY_VALUE"]
