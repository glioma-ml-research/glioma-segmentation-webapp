import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { AccuracyRings } from "../components/AccuracyRings";
import { IconBan, IconCheck, IconWarning } from "../components/Icons";
import { Reveal } from "../components/Motion";
import { DATASET, REPO, TEAM } from "../components/SiteChrome";
import { StudyPerformance } from "../components/StudyMetrics";
import { pct, useStudyMetrics } from "../lib/metrics";
import { REGION_NAMES } from "../lib/regions";
import { useApiInfo } from "../lib/server";

const SECTIONS = [
  { id: "use", title: "Intended use" },
  { id: "study", title: "The study" },
  { id: "performance", title: "Performance" },
  { id: "limitations", title: "Limitations" },
  { id: "privacy", title: "Privacy" },
  { id: "team", title: "Team" },
  { id: "references", title: "References" },
];
const SECTION_IDS = SECTIONS.map((section) => section.id);

const LIMITATIONS = [
  ["Internal validation only.", "Trained and tested on one public dataset from one institution. Performance on other scanners, protocols, field strengths or populations is unknown."],
  ["Not evaluated clinically.", "The study is a technical comparison, not a diagnostic-accuracy study. It provides no evidence of clinical utility."],
  [
    "Reference masks were machine-initialised.",
    "The dataset's masks started from an automated ensemble that included nnU-Net and were then corrected and reviewed by radiologists. Agreement with them may overstate agreement with independent annotations.",
  ],
  [
    "Confidence is not calibrated.",
    "The percentage shown per voxel is the model's maximum softmax probability. Calibration was not evaluated, so it is not a probability of being correct.",
  ],
  [
    "Preprocessing matters.",
    "The model has only seen skull-stripped, co-registered images prepared as in MU-Glioma-Post. The app's own preprocessing of raw scans only approximates that and is untested.",
  ],
  ["Small and absent regions.", "Lesion-level sensitivity was lower than for the simpler models (0.746), and the model sometimes predicts a region that is absent in the reference."],
  ["Not studied.", "Longitudinal volume change, fairness across demographic or molecular groups, and effect on decisions."],
];

/** Which section is on screen, for the contents rail. */
function useActiveSection(ids: string[]): string {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -65% 0px" },
    );
    ids.forEach((id) => {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, [ids]);
  return active;
}

function SectionTitle({ index, children }: { index: number; children: string }) {
  return (
    <h2>
      <span className="sec-num">{index}</span>
      {children}
    </h2>
  );
}

export default function About() {
  const { info } = useApiInfo();
  const metrics = useStudyMetrics();
  const active = useActiveSection(SECTION_IDS);
  const regions = (info?.label_map ?? []).filter((entry) => entry.value !== 0);

  return (
    <main>
      <section className="container doc-hero">
        <div className="doc-hero-grid">
          <div>
            <span className="kicker">Model card</span>
            <h1>nnU-Net v2 for postoperative glioma segmentation</h1>
            <p>
              This app runs the best-performing pipeline from our benchmark study on an uploaded postoperative brain MRI examination and shows the
              result on the patient&apos;s own anatomy. It is a research demonstration of a segmentation model. It is not a diagnostic tool.
            </p>
            {info && (
              <div className="callout">
                <IconWarning />
                {info.disclaimer}
              </div>
            )}
          </div>
          {metrics && (
            <Reveal>
              <AccuracyRings targets={metrics.targets.filter((target) => target.labels.length === 1).sort((a, b) => b.dice - a.dice)} labelMap={info?.label_map}>
                <strong>{pct(metrics.primary.mean_dice)}</strong>
                <span>mean Dice, whole tumor area</span>
              </AccuracyRings>
            </Reveal>
          )}
        </div>
      </section>

      <div className="container">
        <dl className="facts glass">
          <div className="fact">
            <dt>Architecture</dt>
            <dd>
              nnU-Net v2, <code>3d_fullres</code>
            </dd>
          </div>
          <div className="fact">
            <dt>Inputs</dt>
            <dd>
              T1, T1c, T2, FLAIR
              <small>Co-registered and skull-stripped, taken after surgery</small>
            </dd>
          </div>
          <div className="fact">
            <dt>Outputs</dt>
            <dd>
              Four regions
              {regions.length > 0 && (
                <span className="swatches" aria-hidden="true">
                  {regions.map((entry) => (
                    <span key={entry.value} className="swatch" style={{ background: entry.color }} />
                  ))}
                </span>
              )}
              <small>{Object.values(REGION_NAMES).join(", ")}</small>
            </dd>
          </div>
          <div className="fact">
            <dt>Data</dt>
            <dd>
              MU-Glioma-Post
              <small>594 longitudinal examinations from 203 patients</small>
            </dd>
          </div>
          <div className="fact">
            <dt>Evaluation</dt>
            <dd>
              Patient-grouped cross-validation
              <small>Five outer folds, separate inner split for checkpoint selection</small>
            </dd>
          </div>
          <div className="fact">
            <dt>Whole tumor area</dt>
            <dd>
              {metrics ? `${pct(metrics.primary.mean_dice)} mean Dice` : "…"}
              {metrics && (
                <small>
                  95% CI {pct(metrics.primary.ci95[0])}–{pct(metrics.primary.ci95[1])}, internal validation only
                </small>
              )}
            </dd>
          </div>
        </dl>
      </div>

      <div className="container doc">
        <nav className="toc" aria-label="On this page">
          <span className="toc-title">On this page</span>
          {SECTIONS.map((section) => (
            <Link key={section.id} to={`#${section.id}`} className={active === section.id ? "is-active" : ""} aria-current={active === section.id ? "location" : undefined}>
              {section.title}
            </Link>
          ))}
        </nav>

        <div className="doc-body">
          <section id="use" className="doc-section">
            <SectionTitle index={1}>Intended use</SectionTitle>
            <div className="use-grid">
              <div className="use-col glass yes">
                <h3>
                  <IconCheck /> Built for
                </h3>
                <ul>
                  <li>
                    <IconCheck size={14} />
                    Demonstrating the best pipeline from our benchmark study on postoperative MRI
                  </li>
                  <li>
                    <IconCheck size={14} />
                    Outlining tumor-related sub-regions and the resection cavity
                  </li>
                  <li>
                    <IconCheck size={14} />
                    Exploring a segmentation on the patient&apos;s own anatomy, in 3D and on slices
                  </li>
                </ul>
              </div>
              <div className="use-col glass no">
                <h3>
                  <IconBan /> Not for
                </h3>
                <ul>
                  <li>
                    <IconBan />
                    Diagnosis or treatment decisions; it is not a medical device
                  </li>
                  <li>
                    <IconBan />
                    Scans taken before surgery: it was trained on postoperative scans only
                  </li>
                  <li>
                    <IconBan />
                    Telling tumor type or grade, or recurrence from treatment effect
                  </li>
                  <li>
                    <IconBan />
                    Data you are not permitted to process on this server
                  </li>
                </ul>
              </div>
            </div>
          </section>

          <section id="study" className="doc-section">
            <SectionTitle index={2}>The study</SectionTitle>
            <blockquote className="paper-title">
              Nested Patient-Grouped Benchmarking of 3D Deep-Learning Pipelines for Multiclass Postoperative Glioma Segmentation on Longitudinal MRI
            </blockquote>
            <p>
              The study compares 3D U-Net, Residual 3D U-Net, 3D V-Net and 3D U-Net++ in one controlled pipeline, and evaluates nnU-Net v2 (3D full
              resolution) as a whole-pipeline comparator, on 594 longitudinal examinations from 203 patients of the public MU-Glioma-Post collection.
              All splits are grouped by patient: five outer folds for evaluation, with a separate inner split for checkpoint selection.
            </p>
            <p>
              Manuscript, notebooks, frozen splits and results are on{" "}
              <a href={REPO} target="_blank" rel="noreferrer">
                GitHub
              </a>
              . The manuscript has not yet completed journal peer review.
            </p>
          </section>

          <section id="performance" className="doc-section">
            <SectionTitle index={3}>Performance in the study</SectionTitle>
            <StudyPerformance labelMap={info?.label_map} />
          </section>

          <section id="limitations" className="doc-section">
            <SectionTitle index={4}>Limitations</SectionTitle>
            <ol className="numbered">
              {LIMITATIONS.map(([title, text]) => (
                <li key={title}>
                  <b>{title}</b> {text}
                </li>
              ))}
            </ol>
          </section>

          <section id="privacy" className="doc-section">
            <SectionTitle index={5}>Privacy</SectionTitle>
            <p>
              Uploaded files are re-written with a clean header on arrival (free-text header fields are dropped, DICOM files are converted and
              deleted), stored under a random job id, never logged by name, and deleted after {info?.job_ttl_hours ?? 24} hours or when you delete
              the job. Image data itself can still be identifying; do not use this prototype with data you are not permitted to process on this
              server.
            </p>
            {info?.model && (
              <p className="server-line">
                Loaded on this server: {info.message}. nnunetv2 {info.model.nnunetv2_version}, torch {info.model.torch_version}.
                {info.model.notes?.map((note) => ` ${note}`)}
              </p>
            )}
            {info?.mode === "demo" && <p className="server-line">This server is running in demo mode: no model weights are loaded.</p>}
          </section>

          <section id="team" className="doc-section">
            <SectionTitle index={6}>Team</SectionTitle>
            <ul className="team-list">
              {TEAM.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </section>

          <section id="references" className="doc-section">
            <SectionTitle index={7}>Dataset and references</SectionTitle>
            <ol className="numbered">
              <li>
                Yaseen D, Garrett F, Gass J, et al. <em>University of Missouri Post-operative Glioma Dataset (MU-Glioma-Post), Version 1</em> [data
                set]. The Cancer Imaging Archive, 2025.{" "}
                <a href={DATASET} target="_blank" rel="noreferrer">
                  doi:10.7937/7K9K-3C83
                </a>
              </li>
              <li>
                Mahmoud E, Gass J, Dhemesh Y, et al. MU-Glioma Post: a comprehensive dataset of automated MR multi-sequence segmentation and clinical
                features. <em>Scientific Data</em> 2025;12:1847.{" "}
                <a href="https://doi.org/10.1038/s41597-025-06011-7" target="_blank" rel="noreferrer">
                  doi:10.1038/s41597-025-06011-7
                </a>
              </li>
              <li>
                Isensee F, Jaeger PF, Kohl SAA, Petersen J, Maier-Hein KH. nnU-Net: a self-configuring method for deep learning-based biomedical
                image segmentation. <em>Nature Methods</em> 2021;18:203–211.
              </li>
            </ol>
          </section>
        </div>
      </div>
    </main>
  );
}
