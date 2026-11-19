# Hosting the web application

This public repository contains application source only. Trained model weights, patient scans, cached sample results, account databases and deployment ZIPs are excluded.

Install Docker Engine and Docker Compose v2. Supply the authorized model privately under `models/no30/model/` with `checkpoint_best.pth`, `dataset.json` and `plans.json`. Create `backend/data`, then run:

```bash
docker compose up -d --build
```

Open port 8080. For NVIDIA GPU use:

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build
```

Without weights, the application uses demo mode and requires an uploaded reference segmentation. Public sample cases must be supplied separately. See `README.md` for adding samples and model installation.

Set `PUBLIC_URL` for the public domain, use an HTTPS reverse proxy, and protect the data and model directories. The first administrator's setup link appears in the backend log. Members register at `/signup`. HD-BET must be enabled for raw-scan preprocessing; review converter availability before accepting DICOM uploads.

See `docs/SECURITY.md`, `docs/MODEL_CONTRACT.md` and `docs/EXTERNAL_VALIDATION.md`. Container deployment needs verification on the target server. Research prototype only; not for diagnosis or treatment decisions.
