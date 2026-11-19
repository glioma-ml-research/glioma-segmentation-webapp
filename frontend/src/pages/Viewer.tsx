import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { BrandMark, IconDownload, IconReport, IconFocus, IconGrid, IconSidebar, IconSwap } from "../components/Icons";
import { Inspector } from "../components/Inspector";
import { Readout } from "../components/Readout";
import { Scene3D } from "../components/Scene3D";
import { SliceView } from "../components/SliceView";
import { MaximizeButton } from "../components/ViewChrome";
import { ApiError, bundleUrl, deleteJob, getJob, getSummary, getVolume, getVoxel } from "../lib/api";
import { signInPath, useAuth } from "../lib/auth";
import { voxelToWorld, type Vec3 } from "../lib/geometry";
import { TUMOR_AREA_NAME } from "../lib/regions";
import { caseLabel, rememberJob } from "../lib/server";
import type { Summary } from "../lib/types";
import type { VolumeSet } from "../lib/volumes";
import { useViewerStore, type BaseVolume, type ViewId } from "../state/viewerStore";

interface Loaded {
  summary: Summary;
  volumes: VolumeSet;
}

type Layout = "grid" | "focus";

const LOAD_STEPS = ["Reading the result", "Loading voxel volumes", "Preparing the views"];
/** From this width up the inspector is docked beside the views; below it, it slides over them as a drawer. */
const DOCKED = "(min-width: 1200px)";
const DRAWER = "(min-width: 900px) and (max-width: 1199px)";
const VIEWS: { id: ViewId; title: string }[] = [
  { id: "3d", title: "3D" },
  { id: "axial", title: "Axial" },
  { id: "coronal", title: "Coronal" },
  { id: "sagittal", title: "Sagittal" },
];

export default function Viewer() {
  const { jobId = "" } = useParams();
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<{ message: string; status: number } | null>(null);
  const [step, setStep] = useState(0);
  const location = useLocation();
  const { user } = useAuth();
  const [layout, setLayout] = useState<Layout>("grid");
  const [focus, setFocus] = useState<ViewId>("3d");
  // Docked screens start with the inspector open; on tablets the views get the whole width first.
  const [inspector, setInspector] = useState(() => window.matchMedia(DOCKED).matches || !window.matchMedia(DRAWER).matches);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setError(null);
    setStep(0);
    useViewerStore.getState().resetAll();
    (async () => {
      const job = await getJob(jobId);
      if (job.status !== "done") {
        navigate(`/new?job=${jobId}`, { replace: true });
        return;
      }
      const summary = await getSummary(jobId);
      if (cancelled) return;
      setStep(1);
      const [labels, t1c, flair, confidence] = await Promise.all([
        getVolume(jobId, "labels"),
        getVolume(jobId, "t1c"),
        getVolume(jobId, "flair"),
        summary.confidence_available ? getVolume(jobId, "confidence") : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setStep(2);

      const store = useViewerStore.getState();
      for (const [base, volume] of [["t1c", t1c], ["flair", flair]] as const) {
        const [low, high] = volume.header.display_range ?? [0, 1];
        store.setWindow(base, low, high);
      }
      // Start on the largest tumor-related lesion, or the middle of the volume.
      const tumor = summary.statistics.composites.tumor_related_1_3;
      const start = tumor.components[0]?.centroid_world_mm ?? summary.statistics.composites.all_postoperative_1_4.centroid_world_mm;
      if (start) {
        store.setCrosshair([start[0], start[1], start[2]]);
      } else {
        const { shape, affine } = summary.grid.viewer;
        store.setCrosshair(voxelToWorld([(shape[0] - 1) / 2, (shape[1] - 1) / 2, (shape[2] - 1) / 2], affine));
      }
      setLoaded({ summary, volumes: { labels, t1c, flair, confidence } });
    })().catch((reason: Error) => {
      if (!cancelled) setError({ message: reason.message, status: reason instanceof ApiError ? reason.status : 0 });
    });
    return () => {
      cancelled = true;
    };
  }, [jobId, navigate, user?.id]);

  // Every click (2D or 3D) is cross-checked against the backend's own lookup.
  const picked = useViewerStore((state) => state.picked);
  useEffect(() => {
    if (!picked) return;
    const controller = new AbortController();
    useViewerStore.getState().setVerification("pending");
    getVoxel(jobId, picked.world as Vec3, controller.signal)
      .then((remote) => {
        const sameVoxel = remote.voxel.every((value, axis) => value === picked.voxel[axis]);
        const sameLabel = remote.label === picked.label;
        useViewerStore.getState().setVerification(sameVoxel && sameLabel && remote.in_bounds === picked.inBounds ? "match" : "mismatch");
      })
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") useViewerStore.getState().setVerification("unavailable");
      });
    return () => controller.abort();
  }, [picked, jobId]);

  // Esc closes the inspector drawer first, then leaves the enlarged view.
  const maximized = useViewerStore((state) => state.maximized);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (inspector && window.matchMedia(DRAWER).matches) setInspector(false);
      else if (maximized) useViewerStore.getState().toggleMaximized(maximized);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maximized, inspector]);

  const base = useViewerStore((state) => state.base);
  const setBase = useViewerStore((state) => state.setBase);

  // The visitor's colour choice (standard or colour-vision safe) applies to every view.
  const labelMap = loaded?.summary.label_map;
  const summary = useMemo(() => (loaded && labelMap ? { ...loaded.summary, label_map: labelMap } : null), [loaded, labelMap]);

  const ranges = useMemo(() => {
    if (!loaded) return null;
    return {
      t1c: loaded.volumes.t1c.header.display_range ?? [0, 1],
      flair: loaded.volumes.flair.header.display_range ?? [0, 1],
    } as Record<BaseVolume, [number, number]>;
  }, [loaded]);

  if (error) {
    const signIn = error.status === 401;
    return (
      <main className="viewer-app">
        <div className="viewer-state">
          <div className="glass viewer-error">
            <h2>{signIn ? "Sign in to open this result" : "Could not open this result"}</h2>
            <p>{signIn ? "Results of uploaded examinations are visible only to the account that created them." : error.message}</p>
            <div className="viewer-error-actions">
              {signIn ? (
                <Link className="btn btn-primary" to={signInPath(location)}>
                  Sign in
                </Link>
              ) : (
                <Link className="btn btn-primary" to={user ? "/results" : "/"}>
                  {user ? "My results" : "Back to the start"}
                </Link>
              )}
              <Link className="btn btn-secondary" to="/">
                Home
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }
  if (!loaded || !ranges || !summary) {
    return (
      <main className="viewer-app">
        <div className="viewer-state">
          <div className="loader" role="status">
            <div className="spinner" aria-hidden="true" />
            <ol>
              {LOAD_STEPS.map((title, index) => (
                <li key={title} className={index < step ? "past" : index === step ? "current" : ""}>
                  {title}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </main>
    );
  }

  const { volumes } = loaded;
  const onDelete = async () => {
    if (!window.confirm("Delete this job and all its files from the server?")) return;
    await deleteJob(jobId);
    rememberJob(null);
    navigate(user ? "/results" : "/");
  };

  const sample = summary.sample;
  const title = sample?.title ?? (summary.synthetic_sample ? "Synthetic sample" : "Uploaded examination");
  const tumorMl = summary.statistics.composites.tumor_related_1_3.volume_ml;
  const viewClass = (view: ViewId) => `viewport${view === "3d" ? " viewport-3d" : ""}${focus === view ? " is-focus" : ""}${maximized === view ? " is-max" : ""}`;
  /** In the focus layout, the small views can be swapped into the big slot. */
  const swap = (view: ViewId) =>
    layout === "focus" && focus !== view ? (
      <button className="icon-button" onClick={() => setFocus(view)} title="Make this the main view" aria-label="Make this the main view">
        <IconSwap />
      </button>
    ) : null;

  return (
    <main className="viewer-app">
      <header className="vbar">
        <Link className="vbar-home" to="/" aria-label="Home">
          <BrandMark />
        </Link>
        <span className="vbar-sep" aria-hidden="true" />
        <div className="vbar-title">
          <span className="vbar-name">{title}</span>
          <span className="vbar-meta">
            {summary.demo && <span className="is-demo">Demo · no model</span>}
            {summary.demo && <span className="dot" />}
            {sample ? <span>{caseLabel(sample.case_id)}</span> : <span>{summary.synthetic_sample ? "Not a patient" : `Job ${jobId.slice(0, 8)}`}</span>}
            <span className="dot" />
            <span>
              {TUMOR_AREA_NAME} {tumorMl.toFixed(1)} mL
            </span>
          </span>
        </div>
        <div className="vbar-center">
          <div className="seg seg-layout" role="group" aria-label="Layout">
            <button aria-pressed={layout === "grid"} onClick={() => setLayout("grid")} title="Four equal views">
              <IconGrid /> Grid
            </button>
            <button aria-pressed={layout === "focus"} onClick={() => setLayout("focus")} title="One large view and three small ones">
              <IconFocus /> Focus
            </button>
          </div>
          <div className="seg" role="group" aria-label="Slice image">
            {(["t1c", "flair"] as BaseVolume[]).map((name) => (
              <button key={name} aria-pressed={base === name} onClick={() => setBase(name)}>
                {name === "t1c" ? "T1c" : "FLAIR"}
              </button>
            ))}
          </div>
        </div>
        <div className="vbar-right">
          <Link className="btn btn-secondary btn-sm timepoint-link" to={`/new?baseline=${jobId}`}>Add time point</Link>
          <Link className="btn btn-secondary btn-sm vbar-report" to={`/report/${jobId}`} title="One-page report to print or save as PDF">
            <IconReport />
            <span className="btn-label">Report</span>
          </Link>
          <a className="btn btn-secondary btn-sm" href={bundleUrl(jobId)} download title="Download the results package (.zip)">
            <IconDownload />
            <span className="btn-label">Download</span>
          </a>
          <button
            className="btn btn-secondary btn-sm inspector-toggle"
            onClick={() => setInspector((open) => !open)}
            aria-pressed={inspector}
            aria-controls="inspector"
            title={inspector ? "Hide the controls" : "Show the controls"}
          >
            <IconSidebar />
            <span className="btn-label">Controls</span>
          </button>
        </div>
      </header>

      <div className="vbody" data-inspector={inspector ? "open" : "closed"}>
        <div className="vstage">
          <div className="seg full view-tabs" role="group" aria-label="View">
            {VIEWS.map((view) => (
              <button key={view.id} aria-pressed={focus === view.id} onClick={() => setFocus(view.id)}>
                {view.title}
              </button>
            ))}
          </div>
          <div className={`viewports${maximized ? " has-max" : ""}`} data-layout={layout}>
            <div className={viewClass("3d")}>
              <div className="slice-title">
                <span>
                  3D
                </span>
                <span className="slice-index">
                  {swap("3d")}
                  <MaximizeButton view="3d" />
                </span>
              </div>
              <Scene3D jobId={jobId} summary={summary} volumes={volumes} compact={layout === "focus" && focus !== "3d" && maximized !== "3d"} />
            </div>
            {(["axial", "coronal", "sagittal"] as const).map((plane) => (
              <div className={viewClass(plane)} key={plane}>
                <SliceView plane={plane} volumes={volumes} labelMap={summary.label_map} actions={swap(plane)} />
              </div>
            ))}
          </div>
          <Readout summary={summary} />
        </div>
        <Inspector summary={summary} jobId={jobId} ranges={ranges} onDelete={onDelete} onClose={() => setInspector(false)} />
      </div>
    </main>
  );
}
