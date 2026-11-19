import type { CSSProperties } from "react";

import { pct } from "../lib/metrics";
import { useRegionColours } from "../lib/prefs";
import { REGION_NAMES } from "../lib/regions";
import type { LabelInfo, StudyTarget } from "../lib/types";

/** The study's Dice per region as plain horizontal bars: name, bar, value. */
export function AccuracyBars({ targets, labelMap, lesions = false }: { targets: StudyTarget[]; labelMap?: LabelInfo[]; lesions?: boolean }) {
  const fallback = useRegionColours();
  return (
    <ul className="bars">
      {targets.map((target) => {
        const value = target.labels[0];
        const colour = labelMap?.find((entry) => entry.value === value)?.color ?? fallback[value] ?? "#888";
        return (
          <li key={target.key} style={{ "--bar": colour } as CSSProperties}>
            <span className="bar-name">{REGION_NAMES[value]}</span>
            <span className="bar-value">{pct(target.dice)}</span>
            <span className="bar-track" aria-hidden="true">
              <i style={{ width: `${target.dice * 100}%` }} />
            </span>
            {lesions && <span className="bar-note">Finds {pct(target.lesion_sensitivity)} of lesions</span>}
          </li>
        );
      })}
    </ul>
  );
}
