import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useShallow } from "zustand/react/shallow";

import { bundleUrl, downloadUrl, previewUrl } from "../lib/api";
import { targetForLabel, useStudyMetrics } from "../lib/metrics";
import { REGION_HINTS, TUMOR_AREA_HINT, TUMOR_AREA_NAME, regionName } from "../lib/regions";
import { caseLabel } from "../lib/server";
import type { LabelStats, Summary } from "../lib/types";
import { useViewerStore, type BaseVolume } from "../state/viewerStore";
import { IconChevron, IconClose, IconDownload, IconEye, IconOpacity, IconTrash, IconWarning } from "./Icons";

const percent = (value: number) => `${Math.round(value * 100)}%`;
const format = (value: number, digits = 1) => value.toFixed(digits);

function Slider({ value, onChange, min = 0, max = 1, step = 0.01, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; label: string }) {
  const fill = `${((Math.min(max, Math.max(min, value)) - min) / (max - min || 1)) * 100}%`;
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      title={label}
      style={{ "--fill": fill } as CSSProperties}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}

/* --------------------------------------------------------------- layers */

/** Legend, measurements and layer controls in one list: colour, volume and lesions per region, with show/hide and 3D opacity. */
function LayersTab({ summary }: { summary: Summary }) {
  const brain = useViewerStore((state) => state.brain);
  const layers = useViewerStore((state) => state.labels);
  const setBrain = useViewerStore((state) => state.setBrain);
  const setLabel = useViewerStore((state) => state.setLabel);
  const setCrosshair = useViewerStore((state) => state.setCrosshair);
  const [expanded, setExpanded] = useState<number | null>(null);
  const metrics = useStudyMetrics();

  const tumor = summary.statistics.composites.tumor_related_1_3;
  const jump = (target: number[] | null | undefined) => {
    if (target) setCrosshair([target[0], target[1], target[2]]);
  };

  return (
    <>
      <div className="group">
        <div className="group-title">
          <span>Regions</span>
          <span>volume, mL</span>
        </div>
        <div className="layer-list">
          {summary.statistics.labels.map((entry: LabelStats) => {
            const empty = entry.voxels === 0;
            const layer = layers[entry.value];
            const study = targetForLabel(metrics, entry.value);
            const name = regionName(entry.value);
            return (
              <div key={entry.value} className={`layer${empty ? " is-empty" : ""}${layer.visible ? "" : " is-hidden"}`}>
                <div className="layer-row">
                  <button className="eye" aria-pressed={layer.visible} aria-label={`Show ${name}`} title={layer.visible ? "Hide in 3D and on the slices" : "Show in 3D and on the slices"} onClick={() => setLabel(entry.value, { visible: !layer.visible })}>
                    <IconEye off={!layer.visible} />
                  </button>
                  <button
                    className="layer-name"
                    disabled={empty}
                    onClick={() => jump(entry.components[0]?.centroid_world_mm ?? entry.centroid_world_mm)}
                    title={`${REGION_HINTS[entry.value]}${study ? ` Accuracy in the study: ${percent(study.dice)} match with experts.` : ""} Click to go to the largest lesion.`}
                  >
                    <span className="swatch" style={{ background: entry.color }} />
                    <span>{name}</span>
                  </button>
                  <span className="layer-ml">{empty ? "—" : format(entry.volume_ml, 2)}</span>
                </div>
                <div className="layer-sub">
                  {empty ? (
                    <span className="hint">None found</span>
                  ) : (
                    <button
                      className="lesion-toggle"
                      disabled={entry.component_count < 2}
                      onClick={() => setExpanded(expanded === entry.value ? null : entry.value)}
                      aria-expanded={entry.component_count < 2 ? undefined : expanded === entry.value}
                      title={`Separate pieces (${summary.statistics.connectivity} connectivity)`}
                    >
                      {entry.component_count} lesion{entry.component_count === 1 ? "" : "s"}
                      {entry.component_count > 1 && <IconChevron open={expanded === entry.value} />}
                    </button>
                  )}
                  <span className="opacity" title="Opacity in 3D">
                    <IconOpacity />
                    <Slider label={`${name} opacity in 3D`} value={layer.opacity} onChange={(opacity) => setLabel(entry.value, { opacity })} />
                  </span>
                </div>
                {expanded === entry.value && (
                  <ol className="lesions">
                    {entry.components.map((component, index) => (
                      <li key={index}>
                        <button onClick={() => jump(component.centroid_world_mm)}>Lesion {index + 1}</button>
                        <span className="mono">{component.volume_ml < 0.01 ? "<0.01" : format(component.volume_ml, 2)} mL</span>
                      </li>
                    ))}
                    {entry.components_truncated && <li className="muted">…only the largest {entry.components.length} are listed</li>}
                  </ol>
                )}
              </div>
            );
          })}
        </div>
        <div className="layer-total" title={TUMOR_AREA_HINT}>
          <span>{TUMOR_AREA_NAME}</span>
          <span className="layer-ml">
            {format(tumor.volume_ml, 2)}
            <small>
              {tumor.component_count} lesion{tumor.component_count === 1 ? "" : "s"}
            </small>
          </span>
        </div>
      </div>

      <div className="group">
        <div className={`layer${brain.visible ? "" : " is-hidden"}`}>
          <div className="layer-row">
            <button className="eye" aria-pressed={brain.visible} aria-label="Show brain surface" title={brain.visible ? "Hide the brain surface" : "Show the brain surface"} onClick={() => setBrain({ visible: !brain.visible })}>
              <IconEye off={!brain.visible} />
            </button>
            <span className="layer-name static">
              <span className="swatch" style={{ background: "#cfc6bd" }} />
              <span>Brain surface</span>
            </span>
            <span className="opacity" title="Opacity in 3D" style={{ width: 104 }}>
              <IconOpacity />
              <Slider label="Brain surface opacity" value={brain.opacity} onChange={(opacity) => setBrain({ opacity })} />
            </span>
          </div>
        </div>
      </div>

      <p className="hint">Click a region to jump to its largest lesion. The model outlines regions; it does not tell tumor type or grade.</p>
    </>
  );
}

/* -------------------------------------------------------------- display */

function DisplayTab({ ranges }: { ranges: Record<BaseVolume, [number, number]> }) {
  // Only what this tab shows: the hover state changes on every mouse move.
  const state = useViewerStore(
    useShallow((store) => ({
      base: store.base,
      windows: store.windows,
      overlayOpacity: store.overlayOpacity,
      voxelMode: store.voxelMode,
      surfaceVoxelsOnly: store.surfaceVoxelsOnly,
      clip: store.clip,
      setBase: store.setBase,
      setWindow: store.setWindow,
      setOverlayOpacity: store.setOverlayOpacity,
      setVoxelMode: store.setVoxelMode,
      setSurfaceVoxelsOnly: store.setSurfaceVoxelsOnly,
      setClip: store.setClip,
    })),
  );
  const [fullLow, fullHigh] = ranges[state.base];
  const span = Math.max(1e-9, fullHigh - fullLow);
  const window = state.windows[state.base];
  const width = window.high - window.low;
  const level = (window.high + window.low) / 2;
  const setWidthLevel = (nextWidth: number, nextLevel: number) => state.setWindow(state.base, nextLevel - nextWidth / 2, nextLevel + nextWidth / 2);

  return (
    <>
      <div className="group">
        <div className="group-title">Slices</div>
        <div className="ctrl wide">
          <span>Image</span>
          <div className="seg full" role="group" aria-label="Slice image">
            {(["t1c", "flair"] as BaseVolume[]).map((base) => (
              <button key={base} aria-pressed={state.base === base} onClick={() => state.setBase(base)}>
                {base === "t1c" ? "T1c" : "FLAIR"}
              </button>
            ))}
          </div>
        </div>
        <div className="ctrl">
          <span>Overlay</span>
          <Slider label="Overlay opacity on the slices" value={state.overlayOpacity} onChange={state.setOverlayOpacity} />
          <span className="ctrl-value">{percent(state.overlayOpacity)}</span>
        </div>
        <div className="ctrl">
          <span>Window</span>
          <Slider label="Window width" min={span * 0.01} max={span * 2} step={span / 500} value={width} onChange={(value) => setWidthLevel(value, level)} />
          <span className="ctrl-value">{Math.round(width)}</span>
        </div>
        <div className="ctrl">
          <span>Level</span>
          <Slider label="Window level" min={fullLow - span * 0.5} max={fullHigh + span * 0.5} step={span / 500} value={level} onChange={(value) => setWidthLevel(width, value)} />
          <span className="ctrl-value">{Math.round(level)}</span>
        </div>
      </div>

      <div className="group">
        <div className="group-title">3D</div>
        <div className="ctrl-stack">
          <label className="switch" title="Draw every tumor voxel as its own cube instead of a smoothed surface">
            <input type="checkbox" role="switch" checked={state.voxelMode} onChange={(event) => state.setVoxelMode(event.target.checked)} />
            <span className="switch-track" aria-hidden="true" />
            Voxel mode
          </label>
          <label className="switch" title="Skip voxels hidden inside a region; the picture is the same with far fewer cubes">
            <input type="checkbox" role="switch" disabled={!state.voxelMode} checked={state.surfaceVoxelsOnly} onChange={(event) => state.setSurfaceVoxelsOnly(event.target.checked)} />
            <span className="switch-track" aria-hidden="true" />
            Visible shell only
          </label>
          <label className="switch">
            <input type="checkbox" role="switch" checked={state.clip.enabled} onChange={(event) => state.setClip({ enabled: event.target.checked })} />
            <span className="switch-track" aria-hidden="true" />
            Clip plane
          </label>
        </div>
        {state.clip.enabled && (
          <>
            <div className="ctrl wide">
              <span>Cut along</span>
              <div className="seg full" role="group" aria-label="Clip plane axis">
                {(["R–L", "A–P", "S–I"] as const).map((name, axis) => (
                  <button key={name} aria-pressed={state.clip.axis === axis} onClick={() => state.setClip({ axis: axis as 0 | 1 | 2 })}>
                    {name}
                  </button>
                ))}
                <button aria-pressed={state.clip.flip} onClick={() => state.setClip({ flip: !state.clip.flip })} title="Keep the other side">
                  Flip
                </button>
              </div>
            </div>
            <div className="ctrl">
              <span>Position</span>
              <Slider label="Clipping plane position" value={state.clip.fraction} onChange={(fraction) => state.setClip({ fraction })} />
              <span className="ctrl-value">{percent(state.clip.fraction)}</span>
            </div>
            {state.voxelMode && state.surfaceVoxelsOnly && <p className="hint">With “visible shell only”, cut regions look hollow. Turn it off to see the cut filled.</p>}
          </>
        )}
      </div>

      <div className="group">
        <div className="group-title">Controls</div>
        <ul className="keys">
          <li>
            Move through slices <kbd>scroll</kbd>
          </li>
          <li>
            Set the crosshair <kbd>click / drag</kbd>
          </li>
          <li>
            Window / level <kbd>right-drag</kbd>
          </li>
          <li>
            Enlarge a view <kbd>double-click</kbd>
          </li>
          <li>
            Back to all views <kbd>Esc</kbd>
          </li>
        </ul>
      </div>
    </>
  );
}

/* ----------------------------------------------------------------- case */

function CaseTab({ summary, jobId, onDelete }: { summary: Summary; jobId: string; onDelete: () => void }) {
  const sample = summary.sample;
  const comparison = summary.reference_comparison;
  const model = summary.model;
  const colour = (value: number) => summary.label_map.find((entry) => entry.value === value)?.color ?? "#888";

  return (
    <>
      <div className="group case-info">
        <h3>{sample?.title ?? (summary.synthetic_sample ? "Synthetic sample" : "Uploaded examination")}</h3>
        {sample && (
          <p>
            {sample.description} Real patient from the MU-Glioma-Post study ({caseLabel(sample.case_id)}).
          </p>
        )}
        {summary.synthetic_sample && <p>Generated shapes, not a real patient.</p>}
        {summary.demo && <p>{sample ? "Shown: the experts' outline. No model is loaded on this server." : "Demo mode: the uploaded segmentation is shown; no model ran."}</p>}
        {sample?.unseen_by_model === true && <p className="note-good">The model never saw this patient while it was trained.</p>}
        {sample?.unseen_by_model === false && <p>This patient was in the model&apos;s training data, so the result looks better than on new patients.</p>}
      </div>

      {comparison && comparison.tumor_related_dice !== null && (
        <div className="group">
          <div className="agree-head">
            <span>
              Overlap with the experts&apos; outline
              <br />
              whole tumor area (Dice)
            </span>
            <span className="agree-score">{percent(comparison.tumor_related_dice)}</span>
          </div>
          <div className="agree-rows">
            {comparison.regions
              .filter((region) => region.dice !== null)
              .map((region) => (
                <div key={region.value} className="agree-row" title={`Model ${region.result_ml.toFixed(1)} mL, experts ${region.reference_ml.toFixed(1)} mL`}>
                  <span>
                    <span className="swatch" style={{ background: colour(region.value) }} />
                    {regionName(region.value)}
                  </span>
                  {region.reference_ml === 0 ? (
                    <span className="agree-absent">experts: none · model {region.result_ml < 0.1 ? "<0.1" : region.result_ml.toFixed(1)} mL</span>
                  ) : (
                    <>
                      <span className="meter" style={{ "--region": colour(region.value) } as CSSProperties}>
                        <i style={{ width: `${region.dice! * 100}%` }} />
                      </span>
                      <span className="mono">{percent(region.dice!)}</span>
                    </>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      <div className="group">
        <div className="group-title">Download</div>
        <div className="dl">
          <a className="btn btn-primary" href={bundleUrl(jobId)} download>
            <IconDownload /> Results package (.zip)
          </a>
          <div className="dl-links">
            <a className="btn btn-secondary btn-sm" href={previewUrl(jobId)} download>
              Preview picture
            </a>
            <a className="btn btn-secondary btn-sm" href={downloadUrl(jobId)} download title="Label values 0–4 only; open it on top of the T1c scan">
              Mask (.nii.gz)
            </a>
          </div>
          <p className="hint">The package has a preview picture, the segmentation with the scans it belongs to, colours for ITK-SNAP and 3D Slicer, the 3D models and a how-to-open note.</p>
        </div>
      </div>

      {summary.warnings.length > 0 && (
        <div className="group">
          {summary.warnings.map((warning, index) => (
            <div key={index} className="callout" style={{ marginTop: index ? 8 : 0 }}>
              <IconWarning />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      )}

      <details className="group details">
        <summary>Model &amp; run details</summary>
        <div className="details-body">
          {summary.demo ? (
            <p>{model.description}</p>
          ) : (
            <ul>
              <li>
                {model.family} {model.configuration} · {model.ensemble}
              </li>
              <li>
                nnunetv2 {model.nnunetv2_version} · torch {model.torch_version} · {model.device?.toUpperCase()}
                {model.gpu ? ` (${model.gpu})` : ""}
              </li>
              <li>Test-time mirroring: {model.test_time_mirroring ? "on" : "off"}</li>
              {model.members?.map((member) => (
                <li key={member.name}>
                  <code>{member.name}</code> — {member.trainer}; {member.checkpoints.map((c) => `${c.file} (sha256 ${c.sha256?.slice(0, 12)}…)`).join(", ")}
                </li>
              ))}
              {model.notes?.map((note, index) => <li key={index}>{note}</li>)}
            </ul>
          )}
          <p>
            Runtime {summary.runtime_seconds}s · viewer grid {summary.grid.viewer.axcodes}, {summary.grid.viewer.spacing_mm.map((value) => value.toFixed(2)).join(" × ")} mm
          </p>
          <p>{summary.confidence_note}</p>
        </div>
      </details>

      {!summary.pinned && (
        <div className="group">
          <button className="btn btn-danger btn-sm" onClick={onDelete}>
            <IconTrash /> Delete this job and its files
          </button>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------ inspector */

type Tab = "layers" | "display" | "case";
const TABS: { id: Tab; title: string }[] = [
  { id: "layers", title: "Layers" },
  { id: "display", title: "Display" },
  { id: "case", title: "Case" },
];

export function Inspector({ summary, jobId, ranges, onDelete, onClose }: { summary: Summary; jobId: string; ranges: Record<BaseVolume, [number, number]>; onDelete: () => void; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("layers");
  const buttons = useRef<Record<Tab, HTMLButtonElement | null>>({ layers: null, display: null, case: null });

  /** WAI-ARIA tabs: arrow keys, Home and End move between tabs. */
  const onKeyDown = (event: KeyboardEvent) => {
    const index = TABS.findIndex((entry) => entry.id === tab);
    const next =
      event.key === "ArrowRight" ? (index + 1) % TABS.length : event.key === "ArrowLeft" ? (index + TABS.length - 1) % TABS.length : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    setTab(TABS[next].id);
    buttons.current[TABS[next].id]?.focus();
  };

  return (
    <aside id="inspector" className="glass inspector" aria-label="Controls">
      <div className="inspector-head">
        <div className="tabs" role="tablist" aria-label="Controls" onKeyDown={onKeyDown}>
          {TABS.map((entry) => (
            <button
              key={entry.id}
              ref={(element) => {
                buttons.current[entry.id] = element;
              }}
              id={`tab-${entry.id}`}
              className="tab"
              role="tab"
              aria-selected={tab === entry.id}
              aria-controls={`panel-${entry.id}`}
              tabIndex={tab === entry.id ? 0 : -1}
              onClick={() => setTab(entry.id)}
            >
              {entry.title}
            </button>
          ))}
        </div>
        {/* Only shown when the inspector is a drawer over the views. */}
        <button className="icon-button inspector-close" onClick={onClose} aria-label="Close the controls" title="Close (Esc)">
          <IconClose size={16} />
        </button>
      </div>
      <div className="tab-panel" data-panel="layers" role="tabpanel" id="panel-layers" aria-labelledby="tab-layers" hidden={tab !== "layers"}>
        <LayersTab summary={summary} />
      </div>
      <div className="tab-panel" data-panel="display" role="tabpanel" id="panel-display" aria-labelledby="tab-display" hidden={tab !== "display"}>
        <DisplayTab ranges={ranges} />
      </div>
      <div className="tab-panel" data-panel="case" role="tabpanel" id="panel-case" aria-labelledby="tab-case" hidden={tab !== "case"}>
        <CaseTab summary={summary} jobId={jobId} onDelete={onDelete} />
      </div>
    </aside>
  );
}
