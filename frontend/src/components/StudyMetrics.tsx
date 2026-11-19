import { dice, pct, useStudyMetrics } from "../lib/metrics";
import { REGION_HINTS, REGION_NAMES, TUMOR_AREA_HINT, TUMOR_AREA_NAME } from "../lib/regions";
import type { LabelInfo, StudyTarget } from "../lib/types";

function nameOf(target: StudyTarget): string {
  if (target.labels.length === 1) return REGION_NAMES[target.labels[0]];
  return target.labels.length === 3 ? TUMOR_AREA_NAME : "All regions incl. resection cavity";
}

function colourOf(target: StudyTarget, labelMap?: LabelInfo[]) {
  return target.labels.length === 1 ? labelMap?.find((entry) => entry.value === target.labels[0])?.color : undefined;
}

/** The study's full results table, with plain region names. */
export function StudyPerformance({ labelMap }: { labelMap?: LabelInfo[] }) {
  const metrics = useStudyMetrics();
  if (!metrics) return <p className="muted">Loading the study&apos;s results…</p>;
  return (
    <>
      <p>
        The model was tested on <strong>{metrics.primary.patients} patients</strong>, each by a version of the model that had never seen that
        patient. Its outlines were compared with outlines drawn by experts using the <em>Dice score</em>: 100% means identical, 0% means no overlap.
        For the whole tumor area the average was <strong>{pct(metrics.primary.mean_dice)}</strong> (95% confidence interval{" "}
        {pct(metrics.primary.ci95[0])}–{pct(metrics.primary.ci95[1])}).
      </p>
      <div className="table-wrap glass">
        <table className="data-table stack">
          <thead>
            <tr>
              <th scope="col">Region</th>
              <th scope="col" className="num" title="Average Dice score per patient, with 95% confidence interval">
                Dice (95% CI)
              </th>
              <th scope="col" className="num" title="Typical largest boundary error (95th-percentile Hausdorff distance, median over patients)">
                Boundary error
              </th>
              <th scope="col" className="num" title="Share of separate expert-outlined lesions that the model found">
                Lesions found
              </th>
              <th scope="col" className="num" title="Scans where the region was absent but the model still marked some of it">
                False alarms
              </th>
            </tr>
          </thead>
          <tbody>
            {metrics.targets.map((target) => {
              const colour = colourOf(target, labelMap);
              return (
                <tr key={target.key}>
                  <td title={target.labels.length === 1 ? REGION_HINTS[target.labels[0]] : TUMOR_AREA_HINT}>
                    <span className="region-cell">
                      <span className="swatch" style={{ background: colour ?? "transparent", boxShadow: colour ? undefined : "inset 0 0 0 1px var(--border-3)" }} />
                      <b>{nameOf(target)}</b>
                    </span>
                  </td>
                  <td className="num" data-label="Dice (95% CI)">
                    <span>
                      {pct(target.dice)} <span className="muted">({pct(target.dice_ci95[0])}–{pct(target.dice_ci95[1])})</span>
                    </span>
                  </td>
                  <td className="num" data-label="Boundary error">
                    {target.hd95_mm_median.toFixed(1)} mm
                  </td>
                  <td className="num" data-label="Lesions found">
                    {pct(target.lesion_sensitivity)}
                  </td>
                  <td className="num" data-label="False alarms">
                    {target.when_absent ? (
                      <span>
                        {pct(target.when_absent.false_positive_scan_rate)}{" "}
                        <span className="muted">
                          ({target.when_absent.false_positive_scans}/{target.when_absent.absent_scans})
                        </span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="table-note">
        Per test group (whole tumor area): {metrics.folds.map((fold) => `${fold.fold}: ${pct(fold.mean_dice)}`).join(" · ")}. On the 162 patients
        never looked at while the study was designed: {pct(metrics.unseen_162_patients.mean_dice)}. Source:{" "}
        <a href={`${metrics.source.repository}/tree/${metrics.source.commit}/results/final_analysis`} target="_blank" rel="noreferrer">
          study results
        </a>{" "}
        (commit <code>{metrics.source.commit.slice(0, 7)}</code>; mean Dice {dice(metrics.primary.mean_dice)}).
      </p>
    </>
  );
}
