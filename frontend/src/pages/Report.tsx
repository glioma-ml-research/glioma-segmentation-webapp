import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";

import { ModelFacts } from "../components/ModelFacts";
import { IconArrowLeft, IconDownload, IconWarning } from "../components/Icons";
import { ApiError, bundleUrl, getJob, getSummary, previewUrl } from "../lib/api";
import { signInPath } from "../lib/auth";
import { pct, targetForLabel, useStudyMetrics } from "../lib/metrics";
import { regionName, TUMOR_AREA_NAME } from "../lib/regions";
import { caseLabel, useApiInfo } from "../lib/server";
import type { JobStatus, Summary } from "../lib/types";

const dateTime = (seconds: number) =>
  new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });

/**
 * One printable page per result, for a tumor board, a mentor or the file:
 * the figure, the measurements with how reliable each region was in the
 * study, and the model facts. Printed in the standard colours, so it matches
 * the figure and the downloaded files.
 */
export default function Report() {
  const { jobId = "" } = useParams();
  const location = useLocation();
  const { info } = useApiInfo();
  const metrics = useStudyMetrics();
  const [data, setData] = useState<{ summary: Summary; job: JobStatus } | null>(null);
  const [error, setError] = useState<{ message: string; status: number } | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([getJob(jobId), getSummary(jobId)])
      .then(([job, summary]) => alive && setData({ job, summary }))
      .catch((reason: Error) => alive && setError({ message: reason.message, status: reason instanceof ApiError ? reason.status : 0 }));
    return () => {
      alive = false;
    };
  }, [jobId]);

  useEffect(() => {
    if (!data) return;
    const previous = document.title;
    document.title = `Segmentation report · ${data.summary.sample?.title ?? jobId.slice(0, 8)}`;
    return () => {
      document.title = previous;
    };
  }, [data, jobId]);

  if (error) {
    return (
      <main className="container report-page">
        <div className="report-state">
          <h1>{error.status === 401 ? "Sign in to open this report" : "Could not open this report"}</h1>
          <p>{error.status === 401 ? "Reports of uploaded examinations are visible only to the account that created them." : error.message}</p>
          <Link className="btn btn-primary" to={error.status === 401 ? signInPath(location) : "/"}>
            {error.status === 401 ? "Sign in" : "Home"}
          </Link>
        </div>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="container report-page">
        <div className="report-state">
          <div className="spinner" role="status" aria-label="Loading the report" />
        </div>
      </main>
    );
  }

  const { summary, job } = data;
  const colour = (value: number) => summary.label_map.find((entry) => entry.value === value)?.color;
  const comparison = summary.reference_comparison;
  const tumor = summary.statistics.composites.tumor_related_1_3;
  const all = summary.statistics.composites.all_postoperative_1_4;
  const title = summary.sample?.title ?? (summary.synthetic_sample ? "Synthetic sample" : "Uploaded examination");
  const subject = summary.sample ? caseLabel(summary.sample.case_id) : summary.synthetic_sample ? "Generated shapes, not a patient" : `Result ${jobId.slice(0, 8)}`;
  const regions = summary.statistics.labels.filter((entry) => entry.value !== 0);

  return (
    <main className="container report-page">
      <div className="report-tools">
        <Link className="btn btn-ghost btn-sm" to={`/viewer/${jobId}`}>
          <IconArrowLeft /> Back to the viewer
        </Link>
        <div>
          <a className="btn btn-secondary btn-sm" href={bundleUrl(jobId)} download>
            <IconDownload /> Results package
          </a>
          <button className="btn btn-primary btn-sm" onClick={() => window.print()}>
            Print or save as PDF
          </button>
        </div>
      </div>

      <article className="report">
        <header className="report-head">
          <p className="report-kind">Segmentation report</p>
          <h1>{title}</h1>
          <dl className="report-meta">
            <div>
              <dt>Examination</dt>
              <dd>{subject}</dd>
            </div>
            <div>
              <dt>Analysed</dt>
              <dd>{dateTime(job.created_at)}</dd>
            </div>
            <div>
              <dt>Method</dt>
              <dd>{summary.demo ? "Demo mode: shown segmentation was uploaded, no model ran" : "nnU-Net v2, 3d_fullres (study run no30)"}</dd>
            </div>
            <div>
              <dt>Input</dt>
              <dd>{summary.already_preprocessed ? "Preprocessed as in MU-Glioma-Post" : "Raw scans, aligned and skull-stripped by the app (untested)"}</dd>
            </div>
          </dl>
          <p className="report-disclaimer" role="note">
            <IconWarning />
            <span>
              <b>Research prototype.</b> {summary.disclaimer.replace(/^Research prototype\.\s*/i, "")} Every outline must be checked against the
              images.
            </span>
          </p>
        </header>

        <figure className="report-figure">
          <div className="report-image on-dark">
            <img src={previewUrl(jobId)} alt={`Axial, coronal and sagittal T1c slices of ${title} with the regions overlaid`} />
          </div>
          <figcaption>
            Axial, coronal and sagittal contrast-enhanced T1 slices through the centre of the
            segmented regions, radiological convention (patient right on image left).
            <span className="report-legend">
              {regions.map((entry) => (
                <span key={entry.value}>
                  <span className="swatch" style={{ background: colour(entry.value) }} /> {regionName(entry.value)}
                </span>
              ))}
            </span>
          </figcaption>
        </figure>

        <section className="report-section">
          <h2>Measurements</h2>
          <table className="report-table">
            <thead>
              <tr>
                <th scope="col">Region</th>
                <th scope="col" className="num">
                  Volume
                </th>
                <th scope="col" className="num">
                  Separate lesions
                </th>
                <th scope="col" className="num" title="Mean Dice of this region in the study (internal validation)">
                  Study accuracy
                </th>
                {comparison && (
                  <th scope="col" className="num" title="Overlap with the experts' outline of this examination">
                    Agreement here
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {regions.map((entry) => {
                const study = targetForLabel(metrics, entry.value);
                const here = comparison?.regions.find((region) => region.value === entry.value);
                return (
                  <tr key={entry.value}>
                    <th scope="row">
                      <span className="swatch" style={{ background: colour(entry.value) }} /> {regionName(entry.value)}
                    </th>
                    <td className="num">{entry.volume_ml.toFixed(1)} mL</td>
                    <td className="num">{entry.component_count}</td>
                    <td className="num">{study ? pct(study.dice) : "—"}</td>
                    {comparison && (
                      <td className="num">{here ? (here.reference_ml === 0 ? "experts: none" : here.dice !== null ? pct(here.dice) : "—") : "—"}</td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">{TUMOR_AREA_NAME}</th>
                <td className="num">{tumor.volume_ml.toFixed(1)} mL</td>
                <td className="num">{tumor.component_count}</td>
                <td className="num">{metrics ? pct(metrics.primary.mean_dice) : "—"}</td>
                {comparison && <td className="num">{comparison.tumor_related_dice !== null ? pct(comparison.tumor_related_dice) : "—"}</td>}
              </tr>
              <tr className="report-sub">
                <th scope="row">All regions, including the resection cavity</th>
                <td className="num">{all.volume_ml.toFixed(1)} mL</td>
                <td className="num">{all.component_count}</td>
                <td className="num" />
                {comparison && <td className="num" />}
              </tr>
            </tfoot>
          </table>
          <p className="report-note">
            {TUMOR_AREA_NAME}: non-enhancing tumor core, edema and enhancing tumor together. Study accuracy: the model&apos;s mean Dice for that region
            on patients it had never seen (100% = identical to the experts).{comparison && " Agreement here: overlap with the experts' outline of this examination."}{" "}
            Lesions are 26-connected groups of voxels.
          </p>
          {(summary.warnings.length > 0 || summary.sample?.unseen_by_model === false) && (
            <ul className="report-warnings">
              {summary.sample?.unseen_by_model === false && <li>This patient was in the model&apos;s training data, so this result is better than on new patients.</li>}
              {summary.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="report-section">
          <ModelFacts labelMap={summary.label_map} model={summary.model} compact />
        </section>

        <footer className="report-foot">
          Generated {dateTime(Date.now() / 1000)} by Postoperative glioma segmentation{info ? ` v${info.app_version}` : ""}. Result{" "}
          <span className="mono">{jobId.slice(0, 8)}</span>
          {summary.pinned ? " (shared sample result)." : `, deleted from the server ${job.expires_at ? dateTime(job.expires_at) : "after 24 hours"}.`}
        </footer>
      </article>
    </main>
  );
}
