import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Scene3D, type CameraLink } from "../components/Scene3D";
import { SliceView, type Plane } from "../components/SliceView";
import { comparisonMeshUrl, meshUrl, getComparison, getComparisonVolume, getSummary, getVolume, startComparison, type ComparisonStatus } from "../lib/api";
import { volumeChange } from "../lib/comparison";
import { voxelToWorld } from "../lib/geometry";
import type { Summary } from "../lib/types";
import type { VolumeSet } from "../lib/volumes";
import { useViewerStore } from "../state/viewerStore";

const CHANGE_LABELS = [
  { value: 1, name: "Present only at second visit", color: "#E0332B", short: "Added", key: "added" },
  { value: 2, name: "Present only at first visit", color: "#2F7DE1", short: "Removed", key: "removed" },
  { value: 3, name: "Present at both visits", color: "#F2C200", short: "Shared", key: "shared" },
];

export default function Compare() {
  const { baseline = "", followup = "" } = useParams();
  const [summaries, setSummaries] = useState<[Summary, Summary] | null>(null);
  const [volumes, setVolumes] = useState<[VolumeSet, VolumeSet, VolumeSet] | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<ComparisonStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plane, setPlane] = useState<Plane | "3d">("3d");
  const [changes, setChanges] = useState(false);
  const cameraLink = useMemo<CameraLink>(() => ({ version: 0 }), [baseline, followup]);
  const base = useViewerStore(state => state.base);

  useEffect(() => {
    let cancelled = false;
    setSummaries(null); setVolumes(null); setStatus(null); setError(null); setConfirmed(false); setRunning(false);
    useViewerStore.getState().resetAll();
    Promise.all([getSummary(baseline), getSummary(followup)]).then(values => {
      if (!cancelled) setSummaries(values);
    }).catch(reason => { if (!cancelled) setError(reason.message); });
    return () => { cancelled = true; };
  }, [baseline, followup]);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const state = await getComparison(baseline, followup);
        if (cancelled) return;
        setStatus(state);
        if (state.status === "error") throw new Error(state.message);
        if (state.status !== "done") { timer = setTimeout(poll, 1500); return; }
        const [aLabels, aT1, aFlair, bLabels, bT1, bFlair, changeLabels] = await Promise.all([
          getVolume(baseline, "labels"), getVolume(baseline, "t1c"), getVolume(baseline, "flair"),
          getComparisonVolume(baseline, followup, "labels"), getComparisonVolume(baseline, followup, "t1c"),
          getComparisonVolume(baseline, followup, "flair"), getComparisonVolume(baseline, followup, "changes"),
        ]);
        if (cancelled) return;
        const store = useViewerStore.getState();
        store.setWindow("t1c", ...(aT1.header.display_range ?? [0, 1]));
        store.setWindow("flair", ...(aFlair.header.display_range ?? [0, 1]));
        const { shape, affine } = aLabels.header;
        store.setCrosshair(voxelToWorld([(shape[0]-1)/2, (shape[1]-1)/2, (shape[2]-1)/2], affine));
        setVolumes([
          { labels: aLabels, t1c: aT1, flair: aFlair, confidence: null },
          { labels: bLabels, t1c: bT1, flair: bFlair, confidence: null },
          { labels: changeLabels, t1c: aT1, flair: aFlair, confidence: null },
        ]);
        setRunning(false);
      } catch (reason) {
        if (!cancelled) { setError(reason instanceof Error ? reason.message : "Could not load comparison."); setStatus(null); setRunning(false); }
      }
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [running, baseline, followup]);

  const start = async () => {
    setError(null);
    setStatus({ status: "registering" });
    try { await startComparison(baseline, followup); setRunning(true); }
    catch (reason) { setStatus(null); setError(reason instanceof Error ? reason.message : "Could not start comparison."); }
  };
  const busy = status?.status === "registering" || running;

  return <main className="container comparison-page">
    <header className="page-head"><h1>Compare time points</h1><p>Two examinations. One patient. Review the anatomy and measured region changes together.</p></header>
    {error && <p className="callout callout-error" role="alert">{error}</p>}
    {!summaries && !error && <p role="status">Loading examinations…</p>}
    {summaries && <>
      {summaries.some(s => s.demo) && <p className="chip chip-demo">DEMO — comparison includes an uploaded mask, not model inference</p>}
      {!volumes && <section className="glass" style={{ padding: 24 }}>
        <label className="comparison-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />I confirm these are two time points of the same patient, with the earlier visit first.</label>
        <p className="comparison-note">Patient identity is not inferred from de-identified scans. Alignment uses T1c and can take a few minutes.</p>
        <button className="btn btn-primary" disabled={!confirmed || busy} onClick={() => void start()}>{busy ? "Aligning the second visit…" : "Align and compare"}</button>
      </section>}
      <div className="comparison-toolbar">
        {volumes && <><div className="seg" aria-label="Plane" role="group">{(["3d", "axial", "coronal", "sagittal"] as const).map(p => <button key={p} aria-pressed={plane === p} onClick={() => setPlane(p)}>{p === "3d" ? "3D" : p[0].toUpperCase()+p.slice(1)}</button>)}</div>
        <div className="seg" aria-label="Sequence" role="group">{(["t1c", "flair"] as const).map(b => <button key={b} aria-pressed={base === b} onClick={() => useViewerStore.getState().setBase(b)}>{b === "t1c" ? "T1c" : "FLAIR"}</button>)}</div>
        <button className="btn btn-secondary" aria-pressed={changes} onClick={() => setChanges(!changes)}>Change overlay</button></>}
        <Link className="btn btn-secondary" to={`/new?baseline=${followup}`}>Add another time point</Link>
      </div>
      <div className="comparison-pair">{summaries.map((summary, index) => <section className="glass comparison-visit" key={summary.job_id}>
        <header><b>{index === 0 ? "First visit" : "Second visit"}</b><Link to={`/viewer/${summary.job_id}`}>Open 3D &amp; full viewer</Link></header>
        {volumes && <div className="comparison-slice">{plane === "3d" ? <Scene3D
          jobId={summary.job_id} volumes={volumes[index]} cameraLink={cameraLink} boundsSummary={summaries[0]}
          summary={index === 0 ? summary : { ...summary, meshes: status?.meshes ?? {}, grid: summaries[0].grid }}
          meshSource={index === 0 ? undefined : name => comparisonMeshUrl(baseline, followup, name)}
        /> : <SliceView plane={plane} volumes={volumes[index]} labelMap={summary.label_map} />}</div>}
      </section>)}</div>
      {volumes && <p className="comparison-note">Linked 3D rotation, zoom and crosshair in first-visit RAS mm. The second visit is resampled using rigid registration. Compare brain boundaries and ventricles before interpreting differences. Overlay confidence is unavailable after registration.</p>}
      {changes && volumes && <section className="glass comparison-change"><div className="comparison-legend">{CHANGE_LABELS.map(label => <span key={label.value}><i style={{ background: label.color }} />{label.name} ({status?.change_ml?.[String(label.value)]?.toFixed(1)} mL)</span>)}</div><div className="comparison-slice">{plane === "3d" ? <Scene3D jobId={baseline} volumes={volumes[2]} cameraLink={cameraLink} boundsSummary={summaries[0]}
        summary={{ ...summaries[0], label_map: CHANGE_LABELS, meshes: { ...(summaries[0].meshes.brain ? { brain: summaries[0].meshes.brain } : {}), ...status?.change_meshes } }}
        meshSource={name => name === "brain" ? meshUrl(baseline, name) : comparisonMeshUrl(baseline, followup, name.replace("label_", "change_"))}
      /> : <SliceView plane={plane} volumes={volumes[2]} labelMap={CHANGE_LABELS} />}</div><p className="comparison-note">Tumor-related region: enhancing tumor, non-enhancing core and surrounding FLAIR hyperintensity combined. Resection cavity excluded. Areas outside the second scan’s field of view are excluded.</p></section>}
      <div className="comparison-scroll"><table className="comparison-table"><thead><tr><th>Region</th><th>First visit</th><th>Second visit</th><th>Change</th><th>Change %</th></tr></thead><tbody>
        {summaries[0].statistics.labels.map(a => {
          const b = summaries[1].statistics.labels.find(item => item.value === a.value);
          const diff = volumeChange(a.volume_ml, b?.volume_ml ?? 0);
          return <tr key={a.value}><th>{a.name}</th><td>{a.volume_ml.toFixed(1)} mL</td><td>{b?.volume_ml.toFixed(1) ?? "0.0"} mL</td><td>{diff.ml > 0 ? "+" : ""}{diff.ml.toFixed(1)} mL</td><td>{diff.percent === null ? "— (zero baseline)" : `${diff.percent > 0 ? "+" : ""}${diff.percent.toFixed(1)}%`}</td></tr>;
        })}
      </tbody></table></div>
      <p className="comparison-note">Volumes use each visit’s original segmentation, before registration. {status?.note ?? "Changes in scan acquisition or segmentation can affect these measurements. They do not determine tumor progression or treatment response."}</p>
      <p className="comparison-note">Comparisons are available only while both examinations are retained (normally 24 hours).</p>
    </>}
  </main>;
}
