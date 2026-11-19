import type { CSSProperties, ReactNode } from "react";

import type { LabelInfo, StudyTarget } from "../lib/types";
import { DEFAULT_COLOURS } from "./Motion";

/**
 * The study's Dice per region as concentric rings in the region colours (the
 * tumor cross-section motif), with whatever `children` says in the centre.
 * The arcs draw in when an ancestor gets .is-in (see Reveal).
 */
export function AccuracyRings({ targets, labelMap, children }: { targets: StudyTarget[]; labelMap?: LabelInfo[]; children?: ReactNode }) {
  return (
    <div className="rings-wrap">
      <svg className="rings" viewBox="0 0 400 400" role="img" aria-label={targets.map((target) => `${target.name} ${Math.round(target.dice * 100)}%`).join(", ")}>
        {targets.map((target, index) => {
          const radius = 186 - index * 27;
          const circumference = 2 * Math.PI * radius;
          const value = target.labels[0];
          const colour = labelMap?.find((entry) => entry.value === value)?.color ?? DEFAULT_COLOURS[value] ?? "#888";
          return (
            <g key={target.key}>
              <circle className="ring-track" cx="200" cy="200" r={radius} strokeWidth="14" />
              <circle
                className="ring-arc"
                cx="200"
                cy="200"
                r={radius}
                strokeWidth="14"
                stroke={colour}
                transform="rotate(-90 200 200)"
                style={{ "--len": circumference * target.dice, "--c": circumference, "--i": index, filter: `drop-shadow(0 0 7px ${colour})` } as CSSProperties}
              />
            </g>
          );
        })}
      </svg>
      {children && <div className="rings-center">{children}</div>}
    </div>
  );
}
