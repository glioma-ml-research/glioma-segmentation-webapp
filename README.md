# Postoperative glioma segmentation — web app

Upload a patient's four MRI sequences, segment them with the nnU-Net v2
`3d_fullres` pipeline from our study, and inspect the result on a 3D model of
that patient's own brain and on 2D slices.

**Live website:** [glioma-segmentation.codemasters.az](https://glioma-segmentation.codemasters.az/)

> **Research prototype. Trained and internally validated on the MU-Glioma-Post
> dataset only. Not a medical device, not for diagnosis or treatment
> decisions.**
>
> The model segments tumor-related sub-regions and the resection cavity. It does
> not classify tumor type or grade.

Study: *Nested Patient-Grouped Benchmarking of 3D Deep-Learning Pipelines for
Multiclass Postoperative Glioma Segmentation on Longitudinal MRI* —
<https://github.com/glioma-ml-research/mu-glioma-segmentation-benchmark>

- [docs/MODEL_CONTRACT.md](docs/MODEL_CONTRACT.md) — label map, channel order,
  weights layout, and where the research repo differs from the original brief.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — pipeline, coordinate rule, API,
  tests.
- [docs/SECURITY.md](docs/SECURITY.md) — accounts, sessions, upload checks,
  headers, deployment hardening.
- [docs/DESIGN.md](docs/DESIGN.md) — who the interface is for, the design
  research, and the decisions (dark reading-room UI, colour-blind-safe
  palette, touch and tablet layouts).

## Research Team

This research project was collaboratively conducted by:

- **[Atilla Mustafa](https://github.com/atilla-m)**
- **[Elkhan Aghakishiyev](https://github.com/agakisiyev25)**
- **[Jamila Jabrayilli](https://github.com/Jamajab)**

## Quick start (Windows, PowerShell)

Needs Python 3.11 and Node 20.

```powershell
# backend
cd backend
py -3.11 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m app
```

```powershell
# frontend (second terminal)
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. With no weights configured the app starts in
**demo mode**.

On Linux/macOS use `python3.11 -m venv .venv` and `.venv/bin/python`.

### Single process

`npm run build` in `frontend/` writes `frontend/dist`. If that folder exists the
backend serves it, so the whole app is at <http://localhost:8000> with no Node
process.

## Demo mode — no model needed

Demo mode is what you get when `NNUNET_MODEL_DIR` is unset or holds no weights.
You upload the four sequences **plus an existing segmentation** (labels 0–4).
No inference runs; everything after it (measurements, meshes, slices, voxel
lookups, download) works the same. The UI is labelled "DEMO — no model
inference" and shows no confidence values.

**Fastest way to see it:** on the home page, under **Sample cases**, click
**Open the synthetic sample** (shown when no real sample cases are installed).
The server generates a non-patient case (shapes, not anatomy) with all
four regions and a small second lesion, and opens it in the viewer in a few
seconds. The button exists only in demo mode; the viewer marks the result
"Synthetic sample · not a patient".

To exercise the upload path with the same case as files:

```powershell
cd backend
.venv\Scripts\python scripts\make_sample_case.py     # → backend\data\sample_case\
```

Drop all five files at once on the upload page (**Upload scans**, `/new`). They
are matched to sequences by file name (`t1`/`t1n`, `t1c`/`t1ce`, `t2`/`t2w`,
`flair`/`t2f`, `seg`/`mask`); anything that cannot be matched is listed so you
can drop it on its tile.

## Sample cases

The home page offers a few real MU-Glioma-Post examinations visitors can open
with one click; once a case has been run, its preview picture is shown in the
list, and the first ready case turns in 3D at the top of the page (loaded after
the page has painted, and skipped when the browser asks to save data). They live in
`backend/data/samples/` (never committed) and are added with:

```powershell
cd backend
.venv\Scripts\python scripts/add_sample.py --case-dir "...\PatientID_0009\Timepoint_2" --id large-tumor `
    --title "Large tumor with a dead core" --description "A ring of enhancing tumor around a non-enhancing core, with swelling around it."
```

The first opening runs the model once (about 3 minutes on the GTX 1650); the
result is kept for every later visitor, never expires and cannot be deleted
from the website. With a model loaded, the viewer also shows how closely the
result matches the experts' outline. Pick patients the loaded run never
trained on (for run no30: fold-2 outer-test patients) so the samples show the
model's real performance; the viewer says whether that is the case.

## Downloads

**Download results (.zip)** contains `preview.png` (the result at a glance),
`segmentation.nii.gz` with the `t1c.nii.gz` and `flair.nii.gz` it belongs to,
colour tables for ITK-SNAP and 3D Slicer, the 3D surfaces (`3d/*.glb`) and a
README on how to open them. The mask alone is a label map (values 0–4), so on
its own it looks like faint shapes on black; open it on top of the T1c.

## Running the real model

### 1. Install the inference stack

Same versions as the study. Install PyTorch **and torchvision** first, from the
PyTorch index:

```powershell
cd backend
# NVIDIA GPU (CUDA 12.6):
.venv\Scripts\python -m pip install torch==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cu126
# or CPU only:
# .venv\Scripts\python -m pip install torch==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cpu

.venv\Scripts\python -m pip install -c constraints.txt -r requirements-inference.txt
```

Do not skip the torchvision pin: nnU-Net pulls in `timm`, which pulls in an
unpinned torchvision, and pip then replaces torch with a newer CPU-only build
without saying so.

### 2. Put the weights in place

The weights are not in any repository. They are inside the study's validated
result archives, under `model/`. See [models/README.md](models/README.md):

```
models/
  no29/model/checkpoint_best.pth
  no29/model/plans.json
  no29/model/dataset.json
  no30/model/…          (optional: more runs → probability-averaged ensemble)
```

### 3. Start the backend

If the weights are in the project's `models/` folder, nothing else is needed:
the backend loads from there when `NNUNET_MODEL_DIR` is not set. To keep them
elsewhere, set the variable:

```powershell
$env:NNUNET_MODEL_DIR = "C:\path\to\models"
.venv\Scripts\python -m app
```

`GET http://localhost:8000/api/info` reports `mode`:

- `inference` — weights loaded;
- `demo` — no weights found;
- `model_error` — weights found but they are not the study's model (wrong
  channel order or label map, unknown trainer) or PyTorch/nnU-Net is missing.
  The app refuses jobs in this state. It never substitutes another model.

Check a weights folder without starting the server:

```powershell
.venv\Scripts\python scripts\inspect_contract.py --model-dir C:\path\to\models
```

### Which model to load

The study did not train one model with five folds. It trained five independent
nnU-Nets (runs no29–no33), one per outer fold, each with its own plans. The
paper's Dice of 0.879 is a pool of their single-model, out-of-fold predictions.

- **One run** — closest to what the paper evaluated.
- **Several runs** — averaged probabilities. Sensible for a new patient, but an
  ensemble was not evaluated in the paper.

### Runtime

A GPU is detected automatically; without one the app runs on CPU and warns that
it is slow. In the study, inference took about 3 s per case on an A40 and 12 s
on a P100. Expect minutes on a small laptop GPU and considerably longer on CPU.
If the GPU runs out of memory the job retries on CPU instead of failing.

## Uploads

- Four sequences: **T1, T1c, T2, FLAIR**, each `.nii` / `.nii.gz`, or a `.zip`
  with one DICOM series.
- **Already preprocessed (MU-Glioma-Post format)** — ticked by default. Use it
  for skull-stripped sequences that share one voxel grid. They go to the model
  untouched.
- Unticked: T1/T2/FLAIR are rigidly co-registered to T1c and the brain is
  extracted with HD-BET (`pip install -c constraints.txt hd-bet`; it downloads
  its own weights on first use). This approximates the dataset's preprocessing
  and **has not been validated against reference masks**.

Jobs are stored one folder each under `backend/data/jobs/` and deleted after
24 hours. Headers are stripped of free-text fields on arrival; see
ARCHITECTURE.md → Patient data. Uploading needs an account, and each result is
visible only to the account that created it (see below).

## Accounts and security

Users can **create their own member accounts** at `/signup` with a username and password, then sign in. Public registration never grants administrator privileges.

1. **First administrator.** On the first start, with no administrator yet, the
   backend prints a one-time link (valid 24 h) to its console:
   `No administrator yet. Create the first administrator … /signup#invite=…`.
   Open it and choose a username and password. Or run
   `.venv\Scripts\python -m app.users invite --admin` in `backend/`.
2. **Everyone else.** Use **Sign in → Create an account**. Administrators can also issue invite and password-reset links from `/team`.
3. **Members** upload examinations and see only their own results
   (**My results**). **Administrators** also manage the team and can open
   every result. The sample cases stay public unless `PUBLIC_SAMPLES=0`.

`python -m app.users --help` lists the command-line tools (list, invite,
create, reset, disable, enable, delete, promote, demote). How passwords,
sessions, uploads and headers are protected is in
[docs/SECURITY.md](docs/SECURITY.md); the design research behind the interface
is in [docs/DESIGN.md](docs/DESIGN.md).

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `NNUNET_MODEL_DIR` | `models/` if it exists, else demo mode | folder with the model weights |
| `NNUNET_CHECKPOINT` | `checkpoint_best.pth`, then `checkpoint_final.pth` | force a checkpoint file name |
| `NNUNET_DEVICE` | `auto` | `auto`, `cuda` or `cpu` |
| `NNUNET_DISABLE_TTA` | `0` | `1` turns off mirroring (faster; the study used it) |
| `TRAINING_ORIENTATION` | `LPS` | axis order given to the model for raw uploads |
| `GLIOMA_DATA_DIR` | `backend/data` | job storage |
| `GLIOMA_HOST` / `GLIOMA_PORT` | `127.0.0.1` / `8000` | where `python -m app` listens |
| `JOB_TTL_HOURS` | `24` | auto-delete age |
| `MAX_UPLOAD_MB` | `512` | per-file limit (the whole request: five files' worth) |
| `BRAIN_MESH_FACES` / `LABEL_MESH_FACES` | `80000` / `40000` | decimation targets |
| `CORS_ORIGINS` | `http://localhost:5173,…` | only needed when not using the dev proxy |
| `PUBLIC_URL` | — | public base address, used in links printed to the console |
| `PUBLIC_SAMPLES` | `1` | `0` = sample cases need an account too |
| `COOKIE_SECURE` | `auto` | `auto` (Secure when the request came over HTTPS), `always`, `never` |
| `SESSION_HOURS` / `SESSION_IDLE_HOURS` | `168` / `48` | sign-in lifetime / sign-out after this long unused |
| `MAX_ACTIVE_JOBS_PER_USER` | `2` | waiting or running analyses per member |
| `MAX_JOBS_PER_USER_PER_DAY` | `30` | analyses per member per 24 h (administrators are exempt) |
| `MAX_QUEUE` | `20` | server-wide queue length before new uploads are refused |
| `ENABLE_API_DOCS` | `0` | `1` serves the interactive API docs at `/api/docs` |

## API

Every request that changes something must carry the header
`X-Glioma-Client: web` (the web app adds it; see SECURITY.md). Job routes
answer only the owner and administrators, except the public sample results.

| Method and path | Purpose |
|---|---|
| `GET /api/info` | mode, model info, label map, disclaimer |
| `GET /api/auth/me` | the signed-in account (or `null`), whether first-time setup is pending |
| `POST /api/auth/login` · `/logout` | sign in (sets the session cookie) · sign out |
| `POST /api/auth/invite` · `/signup` | check a link · create the account (or set the password) from it |
| `POST /api/auth/password` · `PATCH /api/auth/profile` | change password · display name |
| `GET/PATCH/DELETE /api/admin/users[/{id}]` | administrators: the team; `POST …/{id}/reset-link` |
| `GET/POST/DELETE /api/admin/invites[/{id}]` | administrators: open invite links |
| `GET /api/jobs` | the signed-in account's results (administrators: `?all=true` for everyone's) |
| `POST /api/jobs` | signed in: multipart `t1`, `t1c`, `t2`, `flair`, optional `segmentation`, `already_preprocessed` → `job_id` |
| `GET /api/model/metrics` | the study's published nnU-Net results (per-region Dice with CI, HD95, surface Dice, lesion sensitivity, false alarms, per fold), from `app/resources/study_metrics.json` |
| `POST /api/demo/sample` | demo mode only: start a job on the built-in synthetic case → `job_id` (409 when a model is loaded) |
| `GET /api/jobs/{id}` | status, stage, progress, message |
| `GET /api/jobs/{id}/summary` | volumes (mL), components, boxes, centroids, label map, model info, disclaimer |
| `GET /api/jobs/{id}/meshes/{name}.glb` | `brain`, `label_1` … `label_4`; vertices in world mm; gzip-encoded when the client accepts it |
| `GET /api/jobs/{id}/volumes/{name}` | `labels`, `confidence`, `t1c`, `flair`: gzip-encoded raw voxels, header in `X-Volume-Header` |
| `GET /api/jobs/{id}/volumes/{name}/header` | the same header as JSON (shape, affine, inverse affine, spacing, label map) |
| `GET /api/jobs/{id}/voxel?x=&y=&z=` | world mm → voxel, label, confidence, intensities |
| `GET /api/jobs/{id}/download/segmentation.nii.gz` | mask in the uploaded T1c space |
| `DELETE /api/jobs/{id}` | delete the job and its files |

Interactive docs (off by default): start with `ENABLE_API_DOCS=1`, then <http://localhost:8000/api/docs>.

## Tests

```powershell
cd backend
.venv\Scripts\python -m pytest            # 59 tests; the 11 inference tests skip without torch + nnunetv2

cd ..\frontend
npm test                                  # 15 tests: geometry, lookup and picking against the shared fixture; file-name matching
npm run build                             # type-check + production build
```

### End-to-end on a MU-Glioma-Post case

Needs the weights and one case folder from the dataset. With the backend
running in inference mode:

```powershell
cd backend
.venv\Scripts\python scripts\e2e_case.py --case-dir "D:\MU-Glioma-Post\PatientID_0005\Timepoint_1"
```

It uploads the four sequences, downloads the mask, checks it is on the
reference grid, and prints Dice for the six targets of the study next to the
paper's numbers. It also tells you which run never saw that patient: every
dataset patient was a training patient for four of the five runs, so a Dice
computed with any other run (or an ensemble) is optimistic. `PatientID_0005` is
an outer-test patient of fold 1 → load run **no29** alone for a fair check.

Before the first real run, confirm the two facts the research repo does not
record (stored orientation of the dataset files and the planned spacing):

```powershell
.venv\Scripts\python scripts\inspect_contract.py --case-dir "D:\MU-Glioma-Post\PatientID_0005\Timepoint_1" --model-dir C:\path\to\models
```

## Permanent public address (Tailscale Funnel)

The app is published at **https://glioma.tail7d9208.ts.net** through Tailscale
Funnel (free; Tailscale machine name `glioma`).

- Double-click **`start-server.bat`** to run the app on that address. Keep the
  window open and the PC awake (Settings → System → Power: sleep "Never").
- The address never changes. Funnel is saved by Tailscale and comes back after
  a reboot, but the app itself only runs while `start-server.bat` is open.
- Turn public access off: `tailscale funnel --https=443 off`. Turn it back on:
  run `start-server.bat`, which runs `tailscale funnel --bg 8000`.
- There is no login: anyone with the address can upload and view results.
  Don't use it with real, identifiable patient scans.

## Temporary public link (Cloudflare quick tunnel)

Double-click **`share.bat`** in the project folder, or run `powershell -ExecutionPolicy Bypass -File share.ps1`.
It builds the website if needed, starts the backend (which serves the website
and runs the model on this PC's GPU), and opens a free Cloudflare quick tunnel.
The link, `https://<random words>.trycloudflare.com`, is printed in the window.

- Keep that window open and the PC awake (Settings → System → Power: sleep
  "Never" while sharing). Closing the window ends the link.
- The link changes every time the script starts. A permanent address needs a
  free Cloudflare account plus your own domain (a "named tunnel").
- There is no login: anyone with the link can upload and view results. Don't
  share it publicly with real, identifiable patient scans.
- Jobs run one at a time. With several users, uploads wait in the queue.
- Cloudflare's free tunnel rejects requests over ~100 MB. The upload page gzips
  `.nii` files in the browser first, so four sequences fit comfortably.
- Install the tunnel client once with `winget install --id Cloudflare.cloudflared`.

## Docker

```bash
docker compose up --build                                              # CPU
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build   # NVIDIA GPU
```

The app is at <http://localhost:8080>. Weights are read from `./models`, or
from the host path in `NNUNET_MODEL_DIR`. Build arguments: `INSTALL_INFERENCE=0`
for a small demo-only image, `INSTALL_HDBET=1` to add skull stripping.

## Viewer controls

| Where | Action |
|---|---|
| 3D | drag to orbit, right-drag to pan, wheel to zoom; **A P R L S I** buttons look from that side; **Reset** |
| 3D and slices | point at a voxel for a read-out at the cursor (label, coordinates, confidence); click to move the crosshair there |
| Slices | wheel or slider to change slice; click/drag to move the crosshair; right-drag for window/level |
| Any view | double-click, or the corner button, to enlarge it; Esc to return to four views |
| Regions | one table: colour, volume (mL), lesion count, show/hide, 3D opacity. Click a region to jump to its largest lesion; click a lesion count above 1 to list and visit each lesion |
| Slices: zoom | pinch, Ctrl/⌘ + wheel, trackpad pinch or the magnifier button (anchored under the cursor/fingers); once zoomed, drag with one finger, the middle button or Shift + drag to pan; the square button fits the slice again. A millimetre scale bar follows the zoom |
| Display | T1c / FLAIR; regions as **Fill + outline**, **Outline** or **Fill**; opacity; window/level (and reset); **Show uncertain areas** below a confidence threshold (model runs only); region colours: standard or **colour-blind safe**; **Voxel mode**, **Clip plane** |
| Result | one-page **Report** (print or save as PDF), the results package, the mask, delete the job, model and run details |

World coordinates are shown as (R, A, S) in millimetres. Slices use the
radiological convention: the patient's right is on the left of the screen.

## Follow-up examinations

From a result choose **Add time point**, upload all four sequences from the later visit,
and confirm that both visits belong to the same patient. The app rigidly registers the
second T1c to the first, resamples labels with nearest-neighbour interpolation, and
shows linked axial/coronal/sagittal views plus original per-label volumes, mL changes
and percent changes. A zero baseline has no percentage. **Change overlay** shows
added, removed and shared tumor-related region (labels 1–3), excluding uncovered
field of view. Each original full 3D viewer remains accessible. Add another time
point compares the newest pair; this is not a persistent patient timeline.

The comparison also has linked **3D** panels. The follow-up brain and region
surfaces, plus the added/removed/shared change surfaces, use the baseline RAS-mm
frame so the two visits can be rotated and zoomed together.

Always inspect anatomical alignment. This exploratory feature has synthetic tests,
not clinical longitudinal validation. It does not classify progression or response.
Comparisons require access to both jobs and stop being accessible when either expires.

The current design restores the user-supplied v2 ZIP's CSS, Geist fonts, homepage,
model card and graphical assets. New account and comparison controls reuse its tokens.
See [docs/FOLLOW_UP_AND_DICOM.md](docs/FOLLOW_UP_AND_DICOM.md).
The small RHUH-GBM external run and its poor generalization result are documented in
[docs/EXTERNAL_VALIDATION.md](docs/EXTERNAL_VALIDATION.md).
