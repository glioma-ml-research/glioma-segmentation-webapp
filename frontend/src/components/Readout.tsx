import type { CSSProperties } from "react";

import { targetForLabel, useStudyMetrics } from "../lib/metrics";
import { REGION_HINTS, regionName } from "../lib/regions";
import type { Summary, VoxelInfo } from "../lib/types";
import { useViewerStore } from "../state/viewerStore";

const format = (value: number, digits = 1) => value.toFixed(digits);
const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

/**
 * One fixed-height line under the views: the voxel under the cursor, or the
 * last clicked point when nothing is hovered. Fixed height so the layout never
 * jumps while the pointer moves; lower-priority fields drop out when narrow.
 */
export function Readout({ summary }: { summary: Summary }) {
  const hover = useViewerStore((state) => state.hover);
  const picked = useViewerStore((state) => state.picked);
  const verification = useViewerStore((state) => state.verification);
  const metrics = useStudyMetrics();
  const info: VoxelInfo | null = hover ?? picked;
  const showingPicked = !hover && picked !== null;

  if (!info) {
    return (
      <div className="readout glass">
        <span className="readout-idle">
          {touch
            ? "Tap an image to read the voxel there and move the crosshair to it."
            : "Point at an image to read the voxel under the cursor. Click to move the crosshair there and keep the reading."}
        </span>
      </div>
    );
  }

  const label = info.label != null ? summary.label_map.find((entry) => entry.value === info.label) : undefined;
  const tumor = label !== undefined && label.value !== 0;
  const study = tumor ? targetForLabel(metrics, label.value) : undefined;

  return (
    <div className="readout glass">
      <span className="readout-source">{showingPicked ? "Clicked point" : `At cursor · ${info.source.toUpperCase()}`}</span>
      {!info.inBounds ? (
        <span className="readout-idle">Outside the image volume.</span>
      ) : (
        <>
          <span className="readout-region" title={tumor ? REGION_HINTS[label.value] : undefined}>
            <span className="swatch" style={{ background: tumor ? label.color : "transparent" } as CSSProperties} />
            {label ? regionName(label.value) : "?"}
          </span>
          <span className="readout-item" title={summary.confidence_note}>
            Confidence
            {info.confidence === null ? <span>n/a (no model ran)</span> : <span className="mono">{format(info.confidence * 100)}%</span>}
            {info.confidence !== null && <span>uncalibrated</span>}
          </span>
          {study && (
            <span className="readout-item" title="How closely the model's outlines of this region matched the experts' in the study (100% = identical).">
              Study accuracy <span className="mono">{Math.round(study.dice * 100)}%</span>
              {study.dice < 0.7 && <span>· less reliable</span>}
            </span>
          )}
          <span className="readout-item">
            <span className="mono">
              R {format(info.world[0])} A {format(info.world[1])} S {format(info.world[2])}
            </span>
            mm
          </span>
          <span className="readout-item p2">
            T1c <span className="mono">{info.t1c === null ? "—" : format(info.t1c, 0)}</span> FLAIR <span className="mono">{info.flair === null ? "—" : format(info.flair, 0)}</span>
          </span>
          <span className="readout-item p3">
            Voxel <span className="mono">{info.voxel.join(", ")}</span>
          </span>
          {showingPicked && (
            <span className="readout-item" title="Every click is looked up again by the server; both must name the same voxel and label.">
              {verification === "match" && <span className="ok">✓ Server agrees</span>}
              {verification === "mismatch" && <span className="bad">Server lookup MISMATCH</span>}
              {verification === "pending" && <span>Checking with the server…</span>}
              {verification === "unavailable" && <span>Server not reachable</span>}
            </span>
          )}
        </>
      )}
    </div>
  );
}
