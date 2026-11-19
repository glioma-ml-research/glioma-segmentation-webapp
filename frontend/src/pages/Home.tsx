import { lazy, Suspense, useCallback, useEffect, useState, type CSSProperties } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";

import { AccuracyRings } from "../components/AccuracyRings";
import { IconArrowRight, IconCube, IconUpload, IconWarning } from "../components/Icons";
import { DEFAULT_COLOURS, Reveal, RingsArt } from "../components/Motion";
import { createSampleJob, getSummary, openSample, previewUrl } from "../lib/api";
import { pct, useStudyMetrics } from "../lib/metrics";
import { REGION_HINTS, REGION_NAMES } from "../lib/regions";
import { caseLabel, rememberJob, useApiInfo, useSamples } from "../lib/server";
import type { ApiInfo, LabelInfo, SampleCase, Summary } from "../lib/types";

// three.js and the meshes arrive after the page has painted.
const HeroScene = lazy(() => import("../components/HeroScene"));

function colourFor(labelMap: LabelInfo[] | undefined, value: number): string {
  return labelMap?.find((entry) => entry.value === value)?.color ?? DEFAULT_COLOURS[value] ?? "#888";
}

const presentRegions = (sample: SampleCase) => [1, 2, 3, 4].filter((value) => (sample.reference_ml[String(value)] ?? 0) > 0);

/** What the sample shows, in words: the experts' outline (demo mode) or the model's output. */
function outlineSource(summary: Summary | null, info: ApiInfo | null): string {
  const demo = summary ? summary.demo : info?.mode === "demo";
  if (demo) return "the experts' outline (demo mode: no model ran)";
  const dice = summary?.reference_comparison?.tumor_related_dice;
  return dice != null ? `the model's output, ${pct(dice)} overlap with the experts' outline` : "the model's output";
}

/** Skip the 3D download when the visitor asked to save data or is on a slow connection. */
function canAfford3d(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !(connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? ""));
}

/* ------------------------------------------------------------------ hero */

function Hero({ sample, info, labelMap, onOpen, opening }: { sample: SampleCase | null; info: ApiInfo | null; labelMap?: LabelInfo[]; onOpen: () => void; opening: boolean }) {
  const jobId = sample?.job_id ?? null;
  const [summary, setSummary] = useState<Summary | null>(null);
  const [load3d, setLoad3d] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    getSummary(jobId)
      .then((value) => alive && setSummary(value))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [jobId]);

  // Start the 3D download once the page is idle, so the words paint first.
  useEffect(() => {
    if (!summary || !canAfford3d()) return;
    const start = () => setLoad3d(true);
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(start, { timeout: 1200 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(start, 500);
    return () => clearTimeout(id);
  }, [summary]);

  const onReady = useCallback(() => setReady(true), []);
  const step = (i: number) => ({ "--i": i }) as CSSProperties;

  return (
    <section className="hero">
      <div className="hero-stage">
        {!ready && <RingsArt />}
        {load3d && summary && jobId && (
          <Suspense fallback={null}>
            <HeroScene jobId={jobId} summary={summary} onReady={onReady} />
          </Suspense>
        )}
      </div>

      <div className="container hero-content">
        <div className="hero-copy">
          <span className="chip chip-live rise" style={step(0)}>
            Research prototype · nnU-Net v2
          </span>
          <h1 className="hero-title rise" style={step(1)}>
            Postoperative glioma, <span className="grad">mapped in 3D.</span>
          </h1>
          <p className="hero-sub rise" style={step(2)}>
            Upload four MRI sequences from one examination. The best pipeline from our benchmark study outlines the tumor regions and the resection
            cavity on the patient&apos;s own brain, ready to explore in 3D and on linked slices.
          </p>
          <div className="hero-actions rise" style={step(3)}>
            <Link className="btn btn-primary btn-lg" to="/#samples">
              Explore a sample case <IconArrowRight size={16} />
            </Link>
            <Link className="btn btn-secondary btn-lg" to="/new">
              Upload scans
            </Link>
          </div>
          <ul className="hero-legend" aria-label="Regions">
            {[1, 2, 3, 4].map((value) => (
              <li key={value}>
                <span className="swatch" style={{ background: colourFor(labelMap, value) }} />
                {REGION_NAMES[value]}
              </li>
            ))}
          </ul>
          <div className="hero-notice rise" style={step(4)} role="note">
            <IconWarning />
            <span>
              <b>Not a medical device.</b> A research prototype for postoperative MRI only, validated on one dataset (MU-Glioma-Post). It outlines
              regions; it does not tell tumor type or grade. <Link to="/about">Read the model card</Link>
            </span>
          </div>
        </div>
      </div>

      {sample && (
        <p className="hero-caption">
          <span>
            {ready ? "Live 3D" : "Sample case"} · <b>“{sample.title}”</b> · {outlineSource(summary, info)}
          </span>
          <button className="btn-link" onClick={onOpen} disabled={opening}>
            {opening ? "Opening…" : "Open"} <IconArrowRight size={14} />
          </button>
        </p>
      )}
    </section>
  );
}

/* --------------------------------------------------------------- samples */

function SampleCard({ sample, labelMap, featured, busy, opening, onOpen }: { sample: SampleCase; labelMap?: LabelInfo[]; featured: boolean; busy: boolean; opening: boolean; onOpen: () => void }) {
  const ready = sample.status === "done" && sample.job_id !== null;
  return (
    <button className={`sample spot${featured ? " featured" : ""}`} disabled={busy} onClick={onOpen} aria-busy={opening}>
      <div className="sample-media">
        {ready ? (
          <img src={previewUrl(sample.job_id!)} alt="" loading="lazy" />
        ) : (
          <div className="sample-empty">
            <RingsArt className="sample-art" />
            <span>Preview appears after the first opening</span>
          </div>
        )}
        <span className="sample-badge">
          {opening ? (
            <span className="chip chip-live">Opening…</span>
          ) : ready ? (
            <span className="chip chip-ok chip-dot">Ready</span>
          ) : (
            <span className="chip">First opening takes a few minutes</span>
          )}
        </span>
      </div>
      <div className="sample-body">
        <div>
          <h3 className="sample-title">{sample.title}</h3>
          <p className="sample-desc">{sample.description}</p>
          <div className="sample-meta">
            <span>{caseLabel(sample.case_id)}</span>
            <span className="sample-vols" aria-label="Volumes in the experts' outline">
              {presentRegions(sample).map((value) => (
                <span key={value} title={`${REGION_NAMES[value]}, experts' outline`}>
                  <span className="swatch" style={{ background: colourFor(labelMap, value) }} />
                  <span className="mono">{sample.reference_ml[String(value)].toFixed(1)}</span> mL
                  <span className="sr-only">{REGION_NAMES[value]}</span>
                </span>
              ))}
            </span>
          </div>
        </div>
        <span className="sample-open" aria-hidden="true">
          <IconArrowRight size={18} />
        </span>
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ page */

const STEPS = [
  { icon: <IconUpload size={20} />, title: "Upload one examination", text: "T1, contrast-enhanced T1, T2 and FLAIR from one postoperative examination, as NIfTI or a .zip of DICOM. De-identified on arrival." },
  { icon: <IconCube />, title: "The model segments it", text: "nnU-Net v2 at 3D full resolution, the best pipeline in our study, outlines four regions. Raw scans can be aligned and skull-stripped first." },
  { icon: <IconArrowRight size={20} />, title: "Explore and measure", text: "The patient's own brain in 3D, linked slices under one crosshair, volumes per region, and a package to download." },
];

export default function Home() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { info } = useApiInfo();
  const { samples, loaded } = useSamples();
  const metrics = useStudyMetrics();
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openSampleCase = async (sample: SampleCase) => {
    setError(null);
    setOpening(sample.id);
    try {
      const { job_id, status } = await openSample(sample.id);
      if (status === "done") {
        navigate(`/viewer/${job_id}`);
        return;
      }
      // The first visitor waits while the case is prepared; follow it on the progress page.
      rememberJob(job_id);
      navigate(`/new?job=${job_id}`);
    } catch (reason) {
      setOpening(null);
      setError(reason instanceof Error ? reason.message : "The sample could not be opened.");
    }
  };

  const openSynthetic = async () => {
    setError(null);
    setOpening("synthetic");
    try {
      const { job_id } = await createSampleJob();
      rememberJob(job_id);
      navigate(`/new?job=${job_id}`);
    } catch (reason) {
      setOpening(null);
      setError(reason instanceof Error ? reason.message : "The sample could not be started.");
    }
  };

  // Links from earlier versions followed a running job at /?job=<id>.
  const legacyJob = params.get("job");
  if (legacyJob) return <Navigate to={`/new?job=${legacyJob}`} replace />;

  const labelMap = info?.label_map;
  const heroSample = samples.find((sample) => sample.status === "done" && sample.job_id) ?? null;
  const ordered = heroSample ? [heroSample, ...samples.filter((sample) => sample !== heroSample)] : samples;
  const regionTargets = (metrics?.targets ?? []).filter((target) => target.labels.length === 1).sort((a, b) => b.dice - a.dice);
  const busy = opening !== null;

  return (
    <main>
      <Hero sample={loaded ? heroSample : null} info={info} labelMap={labelMap} onOpen={() => heroSample && openSampleCase(heroSample)} opening={heroSample !== null && opening === heroSample.id} />

      <section id="samples" className="section">
        <div className="container">
          <Reveal className="section-head">
            <span className="kicker">Sample cases</span>
            <h2 className="section-title">
              Start with a <span className="grad">real patient.</span>
            </h2>
            <p className="section-sub">
              Examinations from the MU-Glioma-Post study, ready to open without any files.
              {info?.mode === "demo" && " In demo mode they show the experts' outlines, not the model's."}
            </p>
          </Reveal>
          {error && (
            <div className="callout callout-error" role="alert" style={{ marginBottom: 18 }}>
              <IconWarning />
              {error}
            </div>
          )}
          {ordered.length > 0 ? (
            <div className="samples-grid">
              {ordered.map((sample, index) => (
                <Reveal key={sample.id} index={index % 2} className={index === 0 ? "featured-wrap" : ""}>
                  <SampleCard sample={sample} labelMap={labelMap} featured={index === 0} busy={busy} opening={opening === sample.id} onOpen={() => openSampleCase(sample)} />
                </Reveal>
              ))}
            </div>
          ) : (
            <div className="glass samples-empty">
              <div>
                <b>{loaded ? "No sample cases on this server" : "Loading sample cases…"}</b>
                <p>{info?.sample_case_available ? "Open a generated example instead: shapes, not a real patient." : "You can still upload an examination of your own."}</p>
              </div>
              {info?.sample_case_available ? (
                <button className="btn btn-primary" disabled={busy} onClick={openSynthetic}>
                  {opening === "synthetic" ? "Starting…" : "Open the synthetic sample"}
                </button>
              ) : (
                <Link className="btn btn-secondary" to="/new">
                  Upload scans
                </Link>
              )}
            </div>
          )}
        </div>
      </section>

      <section id="how" className="section">
        <div className="container">
          <Reveal className="section-head">
            <span className="kicker">How it works</span>
            <h2 className="section-title">
              Four scans in. <span className="grad">A brain you can explore out.</span>
            </h2>
          </Reveal>
          <div className="steps">
            {STEPS.map((item, index) => (
              <Reveal key={item.title} as="article" index={index} className="step glass spot">
                <div className="step-top">
                  <span className="step-num">0{index + 1}</span>
                  <span className="step-icon">{item.icon}</span>
                </div>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section id="accuracy" className="section">
        <div className="container">
          <Reveal className="section-head">
            <span className="kicker">Accuracy</span>
            <h2 className="section-title">
              Tested on patients it <span className="grad">had never seen.</span>
            </h2>
            <p className="section-sub">
              Every patient in our study was scored by a version of the model that never saw them: five patient-grouped folds, 594 examinations from
              203 patients. Dice measures how much the model&apos;s outline overlaps the experts&apos;; 100% means identical.
            </p>
          </Reveal>
          {metrics ? (
            <div className="acc">
              <Reveal>
                <AccuracyRings targets={regionTargets} labelMap={labelMap}>
                  <strong>{pct(metrics.primary.mean_dice)}</strong>
                  <span>
                    mean Dice, whole tumor area
                    <br />
                    95% CI {pct(metrics.primary.ci95[0])}–{pct(metrics.primary.ci95[1])}
                  </span>
                </AccuracyRings>
              </Reveal>
              <Reveal className="acc-body" index={1}>
                <ol className="acc-rows">
                  {regionTargets.map((target) => {
                    const value = target.labels[0];
                    return (
                      <li key={target.key} className="acc-row" style={{ "--region": colourFor(labelMap, value) } as CSSProperties}>
                        <span className="swatch" style={{ background: colourFor(labelMap, value) }} />
                        <b>{REGION_NAMES[value]}</b>
                        <span className="mono">
                          {pct(target.dice)}
                          <em>finds {pct(target.lesion_sensitivity)} of lesions</em>
                        </span>
                        <small>{REGION_HINTS[value]}</small>
                      </li>
                    );
                  })}
                </ol>
                <ul className="caveats">
                  <li>
                    <b>Internal validation only.</b> One public dataset from one institution; performance on other scanners and protocols is unknown.
                  </li>
                  <li>
                    <b>The reference may flatter it.</b> The experts&apos; outlines started from an automated ensemble that included nnU-Net.
                  </li>
                  <li>
                    <b>Small regions are harder.</b> Small regions and lesions are outlined less reliably, and it sometimes marks a region that is not there.
                  </li>
                </ul>
                <Link className="btn-link" to="/about#limitations">
                  All limitations and full results <IconArrowRight size={14} />
                </Link>
              </Reveal>
            </div>
          ) : (
            <p className="muted">Loading the study&apos;s results…</p>
          )}
        </div>
      </section>

      <section className="section">
        <div className="container">
          <Reveal className="closing glass">
            <div>
              <h2>
                Have an examination <span className="grad">to look at?</span>
              </h2>
              <p>
                T1, T1c, T2 and FLAIR from one postoperative examination. Files are de-identified on arrival and deleted after{" "}
                {info?.job_ttl_hours ?? 24} hours.
              </p>
            </div>
            <div className="closing-actions">
              <Link className="btn btn-primary btn-lg" to="/new">
                Upload scans <IconArrowRight size={16} />
              </Link>
              <Link className="btn btn-secondary btn-lg" to="/about">
                Model card
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </main>
  );
}
