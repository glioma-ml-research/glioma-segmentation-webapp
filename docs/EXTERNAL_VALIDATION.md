# External evaluation: RHUH-GBM

Date run: 2026-11-09. This is a small exploratory external evaluation, not a
claim of clinical validation.

## Source and scope

Three public, skull-stripped, atlas-registered NIfTI examinations were obtained
from the RHUH-GBM release (CC BY 4.0):

- RHUH-0001, early postoperative time point 1
- RHUH-0001, recurrence/follow-up time point 2
- RHUH-0002, early postoperative time point 1

RHUH-GBM contains the four required MRI sequences and expert-corrected masks.
Its mask labels 1–3 correspond closely enough to necrosis, peritumoral FLAIR
alteration, and enhancing tumor to calculate exploratory overlap. It has no
resection-cavity label, so app label 4 is not scored.

The four images were uploaded through the app's real HTTP job endpoint and
processed by the configured nnU-Net checkpoint on CUDA. The reference mask was
not supplied to inference; it was used only after prediction. Download URLs,
file hashes, job IDs, predictions, and machine-readable scores are retained
under `backend/data/external-validation/` and excluded from Git.

## Results

| Examination | Tumor-region Dice (labels 1–3) | Reference mL | Predicted mL | Recall | Precision |
|---|---:|---:|---:|---:|---:|
| RHUH-0001 / 1 | 0.149 | 25.2 | 311.6 | 0.994 | 0.080 |
| RHUH-0001 / 2 | 0.641 | 190.4 | 398.9 | 0.993 | 0.474 |
| RHUH-0002 / 1 | 0.057 | 6.6 | 226.7 | 0.994 | 0.029 |

The app found nearly all reference tumor voxels, but produced very large false
positive regions. On this deliberately small external sample, the model did
not reproduce the paper's internal mean Dice of 0.879. It should not be
described as accurate on RHUH-GBM or on new hospital protocols based on these
results. Three selected examinations are not a statistically representative
external validation, but they reveal a serious domain-shift failure worth
investigating before broader deployment.

Possible contributors include different institutions/scanners, SRI24 atlas
registration and normalization, acquisition protocols, postoperative timing,
reference-definition differences, and the use of only the single available
fold-2 model rather than the paper's pooled five outer-fold models. These are
hypotheses, not explanations established by this run.

## DICOM boundary

This run validates external NIfTI inference, not raw-DICOM ingestion. The raw
DICOM releases for the most relevant postoperative glioma collections found
during the search (RHUH-GBM, Brain-Tumor-Progression, and QIN-GBM Treatment
Response) require controlled-access approval and a TCIA download workflow. No
credentials or approval were available, so those files were not downloaded.

The app's DICOM conversion remains covered by synthetic DICOM tests: safe ZIP
extraction, one-series enforcement, dcm2niix conversion, geometry preservation,
identifier removal, and deletion of extracted files. Passing those tests does
not establish segmentation accuracy on raw clinical DICOM.

Sources:

- RHUH-GBM collection and access terms: https://www.cancerimagingarchive.net/collection/rhuh-gbm/
- RHUH-GBM publication: https://pmc.ncbi.nlm.nih.gov/articles/PMC10551826/
- Public NIfTI mirror used here: https://huggingface.co/datasets/MedOtter/RHUH-GBM
- Brain-Tumor-Progression: https://www.cancerimagingarchive.net/collection/brain-tumor-progression/
- QIN-GBM Treatment Response: https://www.cancerimagingarchive.net/collection/qin-gbm-treatment-response/
