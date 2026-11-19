import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { IconArrowRight, IconCheck, IconClock, IconClose, IconLock, IconShield, IconUpload, IconWarning } from "../components/Icons";
import { ApiError, createJob, getJob } from "../lib/api";
import { signInPath, useAuth } from "../lib/auth";
import { assignFiles, isAcceptedUpload, isNifti, SLOT_TITLES, type Slot } from "../lib/files";
import { formatBytes, rememberJob, useApiInfo } from "../lib/server";
import type { JobStage, JobStatus } from "../lib/types";

const SEQUENCES: { slot: Slot; hint: string }[] = [
  { slot: "t1", hint: "Before contrast" },
  { slot: "t1c", hint: "After contrast" },
  { slot: "t2", hint: "T2-weighted" },
  { slot: "flair", hint: "T2-FLAIR" },
];

/** The job's stages in order; "done" opens the viewer and is not shown as a step. */
const STAGES: { stage: JobStage; title: string; doing: string }[] = [
  { stage: "uploading", title: "Upload", doing: "Uploading" },
  { stage: "queued", title: "Queue", doing: "Waiting in the queue" },
  { stage: "preprocessing", title: "Prepare the scans", doing: "Preparing the scans" },
  { stage: "inference", title: "Segment", doing: "Segmenting" },
  { stage: "meshing", title: "Build the 3D model and measurements", doing: "Building the 3D model" },
];

type Files = Record<Slot, File | null>;
const EMPTY: Files = { t1: null, t1c: null, t2: null, flair: null, segmentation: null };

interface Running {
  stage: JobStage;
  fraction: number;
  message: string;
  queue: number;
  /** When the job started, in ms since the epoch: the server's clock once the job exists. */
  startedAt: number;
}

function SequenceTile({ slot, hint, file, disabled, onFiles, onClear }: { slot: Slot; hint: string; file: File | null; disabled: boolean; onFiles: (files: File[], slot: Slot) => void; onClear: () => void }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      className={`seq${over ? " is-over" : ""}${file ? " is-filled" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setOver(false);
        if (!disabled) onFiles([...event.dataTransfer.files], slot);
      }}
    >
      <input
        ref={input}
        type="file"
        accept={slot === "segmentation" ? ".nii,.gz" : ".nii,.gz,.zip"}
        hidden
        onChange={(event) => {
          onFiles([...(event.target.files ?? [])], slot);
          event.target.value = "";
        }}
      />
      <button className="seq-pick" type="button" disabled={disabled} onClick={() => input.current?.click()} aria-label={`${SLOT_TITLES[slot]}, ${hint}: ${file ? `${file.name}, choose another file` : "choose a file"}`}>
        <span className="seq-top">
          <span className={`seq-glyph seq-glyph-${slot}`} aria-hidden="true" />
          <span className="seq-name">{SLOT_TITLES[slot]}</span>
          {file && (
            <span className="seq-check" aria-hidden="true">
              <IconCheck size={12} />
            </span>
          )}
        </span>
        <span className="seq-hint">{hint}</span>
        {file ? (
          <span className="seq-file">
            <span className="seq-file-name" title={file.name}>
              {file.name}
            </span>
            <span className="seq-file-size">{formatBytes(file.size)}</span>
          </span>
        ) : (
          <span className="seq-empty">
            <IconUpload size={13} /> Drop or browse
          </span>
        )}
      </button>
      {file && !disabled && (
        <button className="seq-remove" type="button" aria-label={`Remove ${file.name}`} title="Remove" onClick={onClear}>
          <IconClose size={13} />
        </button>
      )}
    </div>
  );
}

function RunView({ running }: { running: Running }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const elapsed = Math.max(0, Math.round((now - running.startedAt) / 1000));
  const active = Math.max(0, STAGES.findIndex((entry) => entry.stage === running.stage));
  const circumference = 2 * Math.PI * 52;
  return (
    <section className="glass run" role="status" aria-live="polite">
      <div className="run-ring" aria-hidden="true">
        <svg viewBox="0 0 120 120">
          <circle className="track" cx="60" cy="60" r="52" strokeWidth="5" />
          {/* A wide faint stroke under the arc is its glow (a CSS filter here would paint its whole box). */}
          <circle className="arc arc-glow" cx="60" cy="60" r="52" strokeWidth="11" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - Math.max(0.02, running.fraction))} />
          <circle className="arc" cx="60" cy="60" r="52" strokeWidth="5" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - Math.max(0.02, running.fraction))} />
          <g className="orbit">
            <circle cx="112" cy="60" r="7" fill="var(--cyan)" opacity="0.2" />
            <circle cx="112" cy="60" r="3" fill="var(--cyan)" />
          </g>
        </svg>
        <div className="run-ring-label">
          <strong>
            {active + 1}/{STAGES.length}
          </strong>
          <span>steps</span>
        </div>
      </div>
      <div className="run-body">
        <h2>{STAGES[active].doing}…</h2>
        <p>
          {running.message}
          {running.stage === "queued" && running.queue > 0 ? ` (${running.queue} job${running.queue === 1 ? "" : "s"} ahead; one runs at a time)` : ""}
        </p>
        <ol className="timeline">
          {STAGES.map((entry, index) => (
            <li key={entry.stage} className={`tl${index < active ? " is-done" : index === active ? " is-current" : ""}`}>
              <span className="tl-mark">{index < active && <IconCheck size={12} />}</span>
              <span className="tl-text">{entry.title}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="run-foot">
        <span>
          Running for <span className="mono">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</span>
        </span>
        <span>The viewer opens by itself. You can reload this page; the job keeps running.</span>
      </div>
    </section>
  );
}

export default function Upload() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { info, error: infoError } = useApiInfo();
  const [files, setFiles] = useState<Files>(EMPTY);
  const [notice, setNotice] = useState<string | null>(null);
  const baseline = params.get("baseline");
  const [format, setFormat] = useState<"nifti" | "dicom">("nifti");
  const [preprocessed, setPreprocessed] = useState(true);
  const [running, setRunning] = useState<Running | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const multiInput = useRef<HTMLInputElement>(null);
  const { user, ready: authReady } = useAuth();
  const location = useLocation();

  const follow = useCallback(
    (jobId: string) => {
      let stopped = false;
      const poll = async () => {
        if (stopped) return;
        let job: JobStatus;
        try {
          job = await getJob(jobId);
        } catch (reason) {
          if (reason instanceof ApiError && reason.status === 401) {
            setRunning(null);
            setError("Sign in to follow this analysis.");
            return;
          }
          if (reason instanceof ApiError && reason.status === 404) {
            setRunning(null);
            setError("That analysis no longer exists, or belongs to another account. Results are deleted after 24 h.");
            setParams({}, { replace: true });
            return;
          }
          setTimeout(poll, 3000);
          return;
        }
        if (job.status === "done") {
          navigate(baseline ? `/compare/${baseline}/${jobId}` : `/viewer/${jobId}`);
          return;
        }
        if (job.status === "error") {
          setRunning(null);
          setError(job.error ?? "The job failed.");
          setParams({}, { replace: true });
          return;
        }
        setRunning({ stage: job.status, fraction: job.progress, message: job.message, queue: job.queue_length, startedAt: job.created_at * 1000 });
        setTimeout(poll, 1000);
      };
      void poll();
      return () => {
        stopped = true;
      };
    },
    [navigate, setParams, baseline],
  );

  // Follow a job after a reload, or one started from the home page (?job=<id>).
  const resumeId = params.get("job");
  useEffect(() => {
    if (!resumeId) return;
    setRunning((current) => current ?? { stage: "queued", fraction: 0, message: "Connecting…", queue: 0, startedAt: Date.now() });
    return follow(resumeId);
  }, [resumeId, follow]);

  const demo = info?.mode === "demo";
  const blocked = info?.mode === "model_error";
  const busy = running !== null;
  const slots: Slot[] = demo ? ["t1", "t1c", "t2", "flair", "segmentation"] : ["t1", "t1c", "t2", "flair"];

  /** One file on a tile goes to that tile; several files are matched to sequences by name. */
  const takeFiles = (incoming: File[], target: Slot | null) => {
    if (incoming.length === 0) return;
    setNotice(null);
    const scans = incoming.filter(file => target !== "segmentation" && !/seg/i.test(file.name));
    if (scans.some(file => format === "dicom" ? !/\.zip$/i.test(file.name) : !isNifti(file.name))) {
      setNotice(format === "dicom" ? "Choose a ZIP containing one DICOM series per sequence." : "Choose NIfTI files, or switch to DICOM for ZIP archives.");
      return;
    }
    if (incoming.length === 1 && target) {
      const [file] = incoming;
      const valid = target === "segmentation" ? isNifti(file.name) : isAcceptedUpload(file.name);
      if (!valid) {
        setNotice(`${SLOT_TITLES[target]}: needs ${target === "segmentation" ? ".nii or .nii.gz" : ".nii, .nii.gz or a DICOM .zip"}.`);
        return;
      }
      setFiles((current) => ({ ...current, [target]: file }));
      return;
    }
    const accepted = incoming.filter((file) => isAcceptedUpload(file.name));
    const { assigned, unmatched } = assignFiles(accepted, slots);
    const skipped = [...unmatched, ...incoming.filter((file) => !isAcceptedUpload(file.name)).map((file) => file.name)];
    setFiles((current) => ({ ...current, ...assigned }));
    const placed = Object.keys(assigned).length;
    setNotice(
      skipped.length > 0
        ? `Matched ${placed} file${placed === 1 ? "" : "s"} by name. Could not place: ${skipped.join(", ")}. Drop ${skipped.length === 1 ? "it" : "them"} on the right tile.`
        : placed > 0
          ? `Matched ${placed} file${placed === 1 ? "" : "s"} by file name. Check that each tile shows the right file.`
          : null,
    );
  };

  const needsSkullStrip = !preprocessed && info !== null && !info.hd_bet_available;
  const filled = slots.filter((slot) => files[slot]).length;
  const missing = slots.filter((slot) => !files[slot]);
  const ready = info !== null && !blocked && !busy && missing.length === 0 && !needsSkullStrip;

  const run = async () => {
    if (!files.t1 || !files.t1c || !files.t2 || !files.flair) return;
    setError(null);
    const startedAt = Date.now();
    setRunning({ stage: "uploading", fraction: 0, message: "Preparing files…", queue: 0, startedAt });
    // The progress card replaces the (taller) form; bring its top into view.
    window.scrollTo({ top: 0, behavior: "smooth" });
    try {
      const { job_id } = await createJob(
        { t1: files.t1, t1c: files.t1c, t2: files.t2, flair: files.flair, segmentation: demo ? files.segmentation : null },
        preprocessed,
        (fraction) =>
          setRunning({
            stage: "uploading",
            fraction: fraction * 0.9,
            message: fraction < 1 ? `Uploading… ${Math.round(fraction * 100)}%` : "Checking and de-identifying on the server…",
            queue: 0,
            startedAt,
          }),
      );
      rememberJob(job_id);
      setParams({ job: job_id, ...(baseline ? { baseline } : {}) }, { replace: true });
    } catch (reason) {
      setRunning(null);
      setError(reason instanceof Error ? reason.message : "Upload failed.");
    }
  };

  if (authReady && !user && !resumeId) {
    return (
      <main className="container new-page">
        <header className="page-head">
          <h1>Upload one examination</h1>
          <p>T1, T1c, T2 and FLAIR from one examination after surgery, as NIfTI or zipped DICOM.</p>
        </header>
        <section className="gate glass">
          <span className="gate-icon" aria-hidden="true">
            <IconLock size={20} />
          </span>
          <div>
            <h2>Sign in to upload</h2>
            <p>
              Uploads are tied to your account: only you can see the result, and it is deleted after {info?.job_ttl_hours ?? 24} hours. Create an account with a username and password to get started.
            </p>
          </div>
          <div className="gate-actions">
            <Link className="btn btn-primary btn-lg" to={signInPath(location)}>
              Sign in
            </Link>
            <Link className="btn btn-secondary btn-lg" to="/signup">Create account</Link>
            <Link className="btn btn-secondary btn-lg" to="/#samples">
              Explore a sample instead
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="container new-page">
      <header className="page-head">
        <h1>{busy ? "Analysing the examination" : (baseline ? "Add the second time point" : "Upload one examination")}</h1>
        {info && !busy && (
          <span className={`status ${demo ? "demo" : blocked ? "error" : "ok"}`}>
            {demo ? "Demo mode, no model" : blocked ? "Model unavailable" : "Model ready"}
          </span>
        )}
        {!busy && (
          <p>
            T1, T1c, T2 and FLAIR from one examination after surgery, as NIfTI or zipped DICOM.
            {demo && " In demo mode no model runs, so add an existing segmentation too."}
          </p>
        )}
      </header>

      {(infoError || blocked || error) && (
        <div className="page-alerts">
          {infoError && (
            <div className="callout callout-error">
              <IconWarning />
              {infoError}
            </div>
          )}
          {blocked && (
            <div className="callout callout-error">
              <IconWarning />
              <span>
                <b>The model could not be loaded.</b> {info!.message}
              </span>
            </div>
          )}
          {error && (
            <div className="callout callout-error" role="alert">
              <IconWarning />
              {error}
            </div>
          )}
        </div>
      )}

      <div className="new-grid">
        {running ? (
          <RunView running={running} />
        ) : (
          <section
            className={`glass upload${dragging ? " is-over" : ""}`}
            aria-label="Files"
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              takeFiles([...event.dataTransfer.files], null);
            }}
          >
            <div className="upload-body">
              {baseline && <p>Upload a later examination of the same patient. Both visits remain available separately.</p>}
              <div className="seg" role="group" aria-label="Upload format">
                <button type="button" aria-pressed={format === "nifti"} onClick={() => { setFormat("nifti"); setFiles(EMPTY); }}>NIfTI</button>
                <button type="button" aria-pressed={format === "dicom"} onClick={() => { setFormat("dicom"); setFiles(EMPTY); setPreprocessed(false); }}>DICOM</button>
              </div>
              <p>{format === "dicom" ? "One ZIP per sequence, containing one complete DICOM series. Converted to NIfTI on the server before preprocessing and segmentation." : "Upload .nii or .nii.gz volumes, one per sequence."}</p>
              <div className="upload-head">
                <div>
                  <span className="upload-icon">
                    <IconUpload size={20} />
                  </span>
                  <span>
                    <b>Drop all files on this card at once</b>
                    They are matched by file name (<span className="mono">t1, t1c, t2, flair{demo ? ", seg" : ""}</span>), or drop each on its tile.
                  </span>
                </div>
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => multiInput.current?.click()}>
                  Browse files
                </button>
                <input
                  ref={multiInput}
                  type="file"
                  multiple
                  hidden
                  accept=".nii,.gz,.zip"
                  onChange={(event) => {
                    takeFiles([...(event.target.files ?? [])], null);
                    event.target.value = "";
                  }}
                />
              </div>

              <div className={`seq-grid${demo ? " with-seg" : ""}`}>
                {SEQUENCES.map(({ slot, hint }) => (
                  <SequenceTile key={slot} slot={slot} hint={hint} file={files[slot]} disabled={busy} onFiles={takeFiles} onClear={() => setFiles((current) => ({ ...current, [slot]: null }))} />
                ))}
                {demo && (
                  <SequenceTile
                    slot="segmentation"
                    hint="Needed in demo mode"
                    file={files.segmentation}
                    disabled={busy}
                    onFiles={takeFiles}
                    onClear={() => setFiles((current) => ({ ...current, segmentation: null }))}
                  />
                )}
              </div>

              {notice && <div className="callout callout-info">{notice}</div>}

              <label className="option-row">
                <span>
                  <b>Already preprocessed</b>
                  <span>MU-Glioma-Post format: skull-stripped, all four sequences on one grid.</span>
                </span>
                <span className="switch">
                  <input type="checkbox" role="switch" checked={preprocessed} onChange={(event) => setPreprocessed(event.target.checked)} />
                  <span className="switch-track" aria-hidden="true" />
                </span>
              </label>
              {!preprocessed && (
                <div className="callout">
                  <IconWarning />
                  <span>
                    The server will align the scans and remove the skull first (a few minutes). This only approximates the preparation the model
                    was trained on.
                    {needsSkullStrip && <strong> Skull stripping (HD-BET) is not installed on this server.</strong>}
                  </span>
                </div>
              )}
            </div>

            <div className="action-bar">
              <div className="slot-count">
                <ol aria-hidden="true">
                  {slots.map((slot) => (
                    <li key={slot} className={files[slot] ? "is-filled" : ""} />
                  ))}
                </ol>
                <span>
                  {missing.length === 0 ? (
                    <b>All files in place</b>
                  ) : (
                    <>
                      <b>
                        {filled} of {slots.length}
                      </b>{" "}
                      · still needs {missing.map((slot) => SLOT_TITLES[slot]).join(", ")}
                    </>
                  )}
                </span>
              </div>
              <button className="btn btn-primary btn-lg" type="button" disabled={!ready} onClick={run}>
                {demo ? "Open in the viewer" : "Run segmentation"}
              </button>
            </div>
          </section>
        )}

        <ul className="notes" aria-label="About your files">
          <li className="is-warn">
            <IconWarning />
            <span>
              <b>Postoperative scans only</b>
              Trained on scans taken after surgery. It does not grade tumors.
            </span>
          </li>
          <li>
            <IconShield />
            <span>
              <b>De-identified on arrival</b>
              Header text is removed and DICOM files are deleted after conversion.
            </span>
          </li>
          <li>
            <IconClock />
            <span>
              <b>Deleted after {info?.job_ttl_hours ?? 24} hours</b>
              Or delete it yourself from the viewer.
            </span>
          </li>
          <li>
            <IconArrowRight />
            <span>
              <b>No files at hand?</b>
              <Link to="/#samples">Open a sample case</Link> instead.
            </span>
          </li>
        </ul>
      </div>
    </main>
  );
}
