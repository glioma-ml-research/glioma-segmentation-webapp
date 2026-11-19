import { pct, useStudyMetrics } from "../lib/metrics";
import { REGION_NAMES } from "../lib/regions";
import type { LabelInfo, ModelInfo } from "../lib/types";
import { REPO } from "./SiteChrome";

/**
 * A "Model facts" label (Sendak et al., npj Digital Medicine 2020): the one
 * page a clinician needs to know how, when and when not to use the model's
 * output, in a fixed order: summary, mechanism, validation, uses and
 * directions, warnings, other information.
 */
export function ModelFacts({ labelMap, model, compact = false }: { labelMap?: LabelInfo[]; model?: ModelInfo | null; compact?: boolean }) {
  const metrics = useStudyMetrics();
  const regions = metrics?.targets.filter((target) => target.labels.length === 1) ?? [];
  const colour = (value: number) => labelMap?.find((entry) => entry.value === value)?.color;
  const checkpoint = model?.members?.[0]?.checkpoints?.[0];
  const whole = metrics?.targets.find((target) => target.labels.length === 3);
  const boundary = regions.map((target) => target.hd95_mm_median);
  const boundaryText = boundary.length ? `${Math.min(...boundary).toFixed(1)}–${Math.max(...boundary).toFixed(1)} mm` : "a few millimetres";

  return (
    <article className={`facts-label${compact ? " is-compact" : ""}`} aria-labelledby="facts-title">
      <header className="fl-head">
        <h2 id="facts-title">Model facts</h2>
        <p>
          nnU-Net v2, full-resolution 3D, for postoperative glioma
        </p>
        <p className="fl-status">Research prototype, not a medical device</p>
      </header>

      <section className="fl-section">
        <h3>Summary</h3>
        <p>
          Outlines {Object.values(REGION_NAMES).join(", ").toLowerCase()} on one postoperative brain MRI, with volumes. It does not grade
          tumors or tell recurrence from treatment effect.
        </p>
      </section>

      <section className="fl-section">
        <h3>Mechanism</h3>
        <dl className="fl-grid">
          <dt>Input</dt>
          <dd>T1, T1c, T2 and FLAIR from one examination after surgery, co-registered and skull-stripped</dd>
          <dt>Output</dt>
          <dd>A label for every voxel (four regions), volumes in mL, and an uncalibrated per-voxel confidence</dd>
          <dt>Population</dt>
          <dd>Adults after glioma resection, as in MU-Glioma-Post (one US institution)</dd>
          <dt>Method</dt>
          <dd>3D convolutional network (nnU-Net v2, full resolution), with test-time mirroring</dd>
        </dl>
      </section>

      <section className="fl-section">
        <h3>Validation and performance</h3>
        <p>
          594 examinations from 203 patients, each scored by a model trained without them. Dice: 100% means identical to the experts.
        </p>
        {metrics && (
          <table className="fl-table">
            <thead>
              <tr>
                <th scope="col">Region</th>
                <th scope="col" className="num">
                  Dice
                </th>
                <th scope="col" className="num">
                  Lesions found
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="fl-total">
                <th scope="row">Whole tumor area</th>
                <td className="num">
                  {pct(metrics.primary.mean_dice)}{" "}
                  <span className="muted">
                    ({pct(metrics.primary.ci95[0])}–{pct(metrics.primary.ci95[1])})
                  </span>
                </td>
                <td className="num">{whole ? pct(whole.lesion_sensitivity) : "—"}</td>
              </tr>
              {regions.map((target) => (
                <tr key={target.key}>
                  <th scope="row">
                    <span className="swatch" style={{ background: colour(target.labels[0]) }} /> {REGION_NAMES[target.labels[0]]}
                  </th>
                  <td className="num">{pct(target.dice)}</td>
                  <td className="num">{pct(target.lesion_sensitivity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="fl-section">
        <h3>Uses and directions</h3>
        <ul>
          <li>Research, teaching and demonstration of the study&apos;s best pipeline.</li>
          <li>Read every outline against the images; start with the areas the viewer hatches as uncertain.</li>
          <li>Treat volumes as estimates: the typical boundary error (median HD95) is {boundaryText}, depending on the region.</li>
        </ul>
      </section>

      <section className="fl-section fl-warnings">
        <h3>Warnings</h3>
        <ul>
          <li>Internal validation on one dataset only; other scanners, protocols and populations are untested.</li>
          <li>Small regions and small lesions are outlined less reliably; it can mark a region that is absent.</li>
          <li>The experts&apos; reference started from an automated ensemble that included nnU-Net, which may flatter it.</li>
          <li>Not for scans taken before surgery.</li>
        </ul>
      </section>

      <section className="fl-section">
        <h3>Other information</h3>
        <dl className="fl-grid">
          <dt>Study</dt>
          <dd>
            Nested patient-grouped benchmarking of 3D pipelines (manuscript, not yet peer reviewed) ·{" "}
            <a href={REPO} target="_blank" rel="noreferrer">
              code and results
            </a>
          </dd>
          <dt>Data</dt>
          <dd>MU-Glioma-Post, The Cancer Imaging Archive, doi:10.7937/7K9K-3C83</dd>
          {checkpoint?.sha256 && (
            <>
              <dt>Weights</dt>
              <dd>
                {checkpoint.file}, checksum {checkpoint.sha256.slice(0, 12)}
              </dd>
            </>
          )}
        </dl>
      </section>
    </article>
  );
}
