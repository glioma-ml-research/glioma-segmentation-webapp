import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { IconArrowRight, IconFolder, IconTrash, IconUpload, IconWarning } from "../components/Icons";
import { deleteJob, listMyJobs } from "../lib/api";
import { timeAgo, timeLeft } from "../lib/format";
import { TUMOR_AREA_NAME } from "../lib/regions";
import type { JobListItem } from "../lib/types";

const RUNNING = new Set(["uploading", "queued", "preprocessing", "inference", "meshing"]);

function StatusChip({ job }: { job: JobListItem }) {
  if (job.status === "done") return <span className="state ok">Ready</span>;
  if (job.status === "error") return <span className="state error">Failed</span>;
  return <span className="state">{job.status === "queued" ? "Waiting" : "Working"} · {Math.round(job.progress * 100)}%</span>;
}

function title(job: JobListItem): string {
  if (job.source === "sample") return "Synthetic sample";
  return job.mode === "demo" ? "Uploaded examination (demo)" : "Uploaded examination";
}

export default function Results() {
  const [jobs, setJobs] = useState<JobListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listMyJobs()
      .then(setJobs)
      .catch((reason: Error) => setError(reason.message));
  }, []);
  useEffect(() => load(), [load]);

  // Refresh while something is still running.
  useEffect(() => {
    if (!jobs?.some((job) => RUNNING.has(job.status))) return;
    const timer = setTimeout(load, 3000);
    return () => clearTimeout(timer);
  }, [jobs, load]);

  const remove = async (job: JobListItem) => {
    if (!window.confirm("Delete this result and all its files from the server?")) return;
    try {
      await deleteJob(job.id);
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete.");
    }
  };

  return (
    <main className="container settings-page">
      <header className="page-head compact results-head">
        <div>
          <h1>My results</h1>
          <p>Only your account can see these. Each result is deleted automatically 24 hours after the upload.</p>
        </div>
        {jobs && jobs.length > 0 && (
          <Link className="btn btn-primary" to="/new">
            <IconUpload /> Upload scans
          </Link>
        )}
      </header>

      {error && (
        <div className="callout callout-error" role="alert" style={{ marginBottom: 18 }}>
          <IconWarning />
          {error}
        </div>
      )}

      {jobs === null ? (
        <p className="muted">Loading…</p>
      ) : jobs.length === 0 ? (
        <div className="empty glass">
          <span className="empty-icon" aria-hidden="true">
            <IconFolder size={22} />
          </span>
          <h2>No results yet</h2>
          <p>Upload the four MRI sequences of one examination, or look at a sample case first.</p>
          <div className="empty-actions">
            <Link className="btn btn-primary" to="/new">
              Upload scans
            </Link>
            <Link className="btn btn-secondary" to="/#samples">
              Sample cases
            </Link>
          </div>
        </div>
      ) : (
        <ul className="result-list">
          {jobs.map((job) => {
            const open = job.status === "done" ? `/viewer/${job.id}` : RUNNING.has(job.status) ? `/new?job=${job.id}` : null;
            return (
              <li key={job.id} className="result glass">
                <div className="result-main">
                  <div className="result-title">
                    <b>{title(job)}</b>
                    <StatusChip job={job} />
                  </div>
                  <span className="muted">
                    <span className="mono">{job.id.slice(0, 8)}</span> · uploaded {timeAgo(job.created_at)} · deleted {timeLeft(job.expires_at)}
                  </span>
                  {job.status === "error" && job.error && <span className="result-error">{job.error}</span>}
                </div>
                {job.tumor_ml != null && (
                  <div className="result-metric">
                    <span className="mono">{job.tumor_ml.toFixed(1)} mL</span>
                    <span className="muted">{TUMOR_AREA_NAME}</span>
                  </div>
                )}
                <div className="result-actions">
                  {open && (
                    <Link className="btn btn-secondary btn-sm" to={open}>
                      {job.status === "done" ? "Open" : "Progress"} <IconArrowRight size={14} />
                    </Link>
                  )}
                  <button className="btn btn-ghost btn-sm btn-icon" onClick={() => remove(job)} aria-label="Delete this result" title="Delete">
                    <IconTrash />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
