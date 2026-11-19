"""Add a MU-Glioma-Post examination to the website's sample cases.

    python scripts/add_sample.py --case-dir ".../PatientID_0009/Timepoint_2" \
        --id large-tumor --title "Large tumor with necrotic core" \
        --description "Clear enhancing rim around a dead core, with swelling around it."

Copies the four sequences and the expert mask into backend/data/samples/<id>/
(headers rebuilt, as for an upload). That folder is never committed. Visitors
then open the sample from the upload page; the first opening runs the model
once and the result is kept for everyone after that.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from app.config import load_settings  # noqa: E402
from app.samples import add_sample  # noqa: E402

SUFFIXES = {"t1": "_brain_t1n", "t1c": "_brain_t1c", "t2": "_brain_t2w", "flair": "_brain_t2f"}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--case-dir", type=Path, required=True)
    parser.add_argument("--id", required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--description", required=True)
    arguments = parser.parse_args()

    def one(pattern: str) -> Path:
        matches = sorted(arguments.case_dir.glob(pattern))
        if len(matches) != 1:
            raise SystemExit(f"expected one {pattern} in {arguments.case_dir}, found {len(matches)}")
        return matches[0]

    images = {slot: one(f"*{suffix}.nii.gz") for slot, suffix in SUFFIXES.items()}
    reference = one("*_tumorMask.nii.gz")
    case_id = reference.name.removesuffix("_tumorMask.nii.gz")
    entry = add_sample(
        load_settings().data_dir,
        sample_id=arguments.id,
        title=arguments.title,
        description=arguments.description,
        case_id=case_id,
        images=images,
        reference=reference,
    )
    print(f"added sample '{entry['id']}' from {case_id}: reference volumes (mL) {entry['reference_ml']}")
