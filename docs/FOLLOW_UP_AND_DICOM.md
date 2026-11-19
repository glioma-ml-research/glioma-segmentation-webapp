# Follow-up comparison and DICOM

## DICOM does not by itself require retraining

NIfTI (`.nii` / `.nii.gz`) is an image container, not a distinct imaging modality.
The existing DICOM ingestion converts each complete series to NIfTI with dcm2niix,
with a SimpleITK fallback. The model still receives T1, contrast-enhanced T1, T2,
and FLAIR in the documented channel order. The upload UI now has explicit NIfTI
and DICOM choices. DICOM requires **one ZIP containing one series per sequence**;
it does not automatically sort an entire PACS export into the four modalities.

Raw hospital DICOM generally needs registration and skull stripping; choosing
DICOM therefore unticks Already preprocessed. HD-BET must be installed and its
weights available. Conversion alone does not make data equivalent to the training
set. Series completeness, spatial geometry, contrast timing, artifacts, resolution,
and scanner/protocol differences require validation. Only a representative external
evaluation can establish whether fine-tuning or retraining is needed. Never quote
the internal study's Dice as measured performance on a new hospital's DICOM scans.

Conversion removes header text and deletes the uploaded archive/extracted files.
This does not guarantee removal of identifiers burned into image pixels. Use
de-identified research scans. Outputs remain NIfTI/GLB, not DICOM SEG or PACS write-back.

Sources:
- https://github.com/rordenlab/dcm2niix
- https://github.com/MIC-DKFZ/nnUNet/blob/master/documentation/dataset_format_inference.md
- Local model specifics: MODEL_CONTRACT.md

## Longitudinal workflow

1. Open the first result and choose Add time point.
2. Upload the second examination using the normal segmentation pipeline.
3. Confirm that these are two examinations of the same patient in chronological order.
4. Start alignment and review both visits on linked slices; the original full 3D
   viewers remain available via links.

Registration is a rigid six-degree-of-freedom SimpleITK T1c-to-T1c alignment using
mutual information. RAS viewer affines are converted explicitly to SimpleITK's LPS
physical convention. The transform maps fixed output points to moving input points
for resampling. Labels use nearest-neighbour interpolation, intensities linear.
Sheared grids are rejected. A single in-process lock bounds registration concurrency.
The app assumes the documented single-process deployment.

Both columns use the baseline grid and shared world-mm crosshair. Original volumes
are calculated independently before registration; percentages use the first visit
as denominator and are undefined for a zero baseline. The optional change overlay
compares the union of labels 1–3: added, removed, shared. It excludes positions outside
the moving scan's resampled field of view. It does not show label-to-label transitions,
and confidence is not transferred to the registered volume.

The rigid model cannot account for all postoperative deformation. Registration has
no validated automatic quality score. Inspect brain boundaries and ventricles before
interpreting overlays; errors, acquisition differences and segmentation variation can
all appear as changes. No RANO classification or treatment-response claim is made.
This feature has synthetic geometry/registration and API tests; it has not yet been
validated against expert longitudinal annotations.

The comparison page also offers a **3D** view beside axial, coronal and sagittal.
Both visit panels use the baseline RAS-mm frame and linked camera coordinates, so
dragging or zooming one 3D panel updates the other. The follow-up brain and label
surfaces are rebuilt after registration. The change view can render added, removed,
and shared tumor-related regions as 3D surfaces. This is a geometric visualization;
it does not make the registration clinically valid.

Comparisons are cached under the second job, with at most five baselines per job.
Every endpoint checks access to both jobs. If either job expires/is deleted, comparison
access is denied; derived files follow the second job's retention. Another time point
starts a comparison with the latest visit, not a persistent patient record.
