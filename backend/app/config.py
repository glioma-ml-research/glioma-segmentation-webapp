"""Runtime settings, all from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    model_dir: Path | None
    checkpoint_name: str | None
    device: str  # "auto" | "cuda" | "cpu"
    disable_tta: bool
    training_orientation: str
    job_ttl_hours: float
    max_upload_mb: int
    cors_origins: tuple[str, ...]
    brain_mesh_faces: int
    label_mesh_faces: int
    # Accounts and limits
    public_samples: bool = True  # sample cases can be opened without signing in
    cookie_secure: str = "auto"  # "auto" (when the request came over HTTPS) | "always" | "never"
    session_hours: float = 168.0  # absolute session lifetime
    session_idle_hours: float = 48.0  # sign out after this long without activity
    max_active_jobs_per_user: int = 2
    max_jobs_per_user_per_day: int = 30
    max_queue: int = 20
    public_url: str = ""  # base URL used in links printed to the console
    enable_api_docs: bool = False

    @property
    def jobs_dir(self) -> Path:
        return self.data_dir / "jobs"


def load_settings() -> Settings:
    backend_root = Path(__file__).resolve().parent.parent
    model_dir = os.environ.get("NNUNET_MODEL_DIR", "").strip()
    if not model_dir and (backend_root.parent / "models").is_dir():
        # The documented place for weights (models/README.md). Which model was
        # loaded is always reported by /api/info and in every job summary.
        model_dir = str(backend_root.parent / "models")
    orientation = os.environ.get("TRAINING_ORIENTATION", "LPS").strip().upper()
    if len(orientation) != 3 or any(
        sum(letter in orientation for letter in pair) != 1 for pair in ("LR", "PA", "IS")
    ):
        raise ValueError(f"TRAINING_ORIENTATION must be an axis code such as LPS or RAS, got {orientation!r}")
    return Settings(
        data_dir=Path(os.environ.get("GLIOMA_DATA_DIR", backend_root / "data")).resolve(),
        model_dir=Path(model_dir).expanduser().resolve() if model_dir else None,
        checkpoint_name=os.environ.get("NNUNET_CHECKPOINT", "").strip() or None,
        device=os.environ.get("NNUNET_DEVICE", "auto").strip().lower(),
        disable_tta=_env_bool("NNUNET_DISABLE_TTA", False),
        training_orientation=orientation,
        job_ttl_hours=float(os.environ.get("JOB_TTL_HOURS", "24")),
        # Per file. A zipped DICOM series of a 3D sequence is typically 20–150 MB.
        max_upload_mb=int(os.environ.get("MAX_UPLOAD_MB", "512")),
        cors_origins=tuple(
            origin.strip()
            for origin in os.environ.get(
                "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
            ).split(",")
            if origin.strip()
        ),
        brain_mesh_faces=int(os.environ.get("BRAIN_MESH_FACES", "80000")),
        label_mesh_faces=int(os.environ.get("LABEL_MESH_FACES", "40000")),
        public_samples=_env_bool("PUBLIC_SAMPLES", True),
        cookie_secure=_cookie_mode(os.environ.get("COOKIE_SECURE", "auto")),
        session_hours=float(os.environ.get("SESSION_HOURS", "168")),
        session_idle_hours=float(os.environ.get("SESSION_IDLE_HOURS", "48")),
        max_active_jobs_per_user=int(os.environ.get("MAX_ACTIVE_JOBS_PER_USER", "2")),
        max_jobs_per_user_per_day=int(os.environ.get("MAX_JOBS_PER_USER_PER_DAY", "30")),
        max_queue=int(os.environ.get("MAX_QUEUE", "20")),
        public_url=os.environ.get("PUBLIC_URL", "").strip().rstrip("/"),
        enable_api_docs=_env_bool("ENABLE_API_DOCS", False),
    )


def _cookie_mode(raw: str) -> str:
    mode = raw.strip().lower() or "auto"
    if mode in {"1", "true", "yes", "on"}:
        return "always"
    if mode in {"0", "false", "no", "off"}:
        return "never"
    if mode not in {"auto", "always", "never"}:
        raise ValueError(f"COOKIE_SECURE must be auto, always or never, got {raw!r}")
    return mode
