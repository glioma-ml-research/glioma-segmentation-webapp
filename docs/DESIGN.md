Current design decision (2026-11-09): the user explicitly chose the supplied
`glioma-segmentation-app_v2.zip` design. Its original CSS, Geist fonts, homepage,
About page and graphical components are restored. Account and longitudinal
comparison pages reuse those tokens. Earlier redesign recommendations below are
historical, not the current visual specification. Apple-design principles apply to
interaction/accessibility; its system-font preference is overridden by the user's
requirement to retain the ZIP's Geist typography.

# Design

Why the interface looks and behaves the way it does.

## Who uses it

| Person | Device and setting | What they need first |
|---|---|---|
| Radiologist | Desktop, dimmed reading room | Large, undistorted images; zoom, window/level, outlines; numbers they can trust |
| Neurosurgeon / oncologist | Tablet at a tumour board | The 3D picture and the volumes at a glance; a page to print |
| Teammates, mentors, reviewers | A phone, from a link | What it does, a sample case in one tap, honest accuracy |
| Administrator | Desktop | Invite people, see who uses it |

## Direction: modern healthtech

Clean, clinical and calm, like a well-made health product: minimal but not
bare, never futuristic and never "editorial".

- **One typeface.** Inter, at normal letter-spacing, for everything.
  Hierarchy comes from size and weight. Numbers use tabular figures so they
  line up, without a monospace font.
- **Space instead of lines.** White pages with soft grey filled panels; no
  bordered boxes, few divider lines, no gradients.
- **One action colour.** Medical blue for buttons and links. The only other
  saturated colours are the four tumour regions.
- **Plain language, sentence case.** No small labels above headings, no
  capitals, no section numbers, no periods in titles, short copy.
- **Simple data.** One large number and a plain bar per region instead of
  decorative charts.
- **A dark viewer.** Medical images are read in dim rooms to keep their
  contrast (Pollard et al. 2012), so the viewer and every image frame are dark,
  while text pages are light: dark text on light is read more accurately
  (Piepenbrock et al. 2013). A dark appearance for the pages follows the device
  setting, or the switch in the footer and on the Account page.

## What the research added

- **Model facts** (Sendak et al., npj Digital Medicine 2020): one page that
  tells clinicians how, when and when not to use the model: summary,
  mechanism, validation, uses, warnings, other information. It leads the model
  card and ends every printed report. The FDA / Health Canada / MHRA
  transparency principles (2024) make the same point: model information belongs
  in the interface.
- **Where the model is unsure.** Clinicians preferred a simple uncertain / not
  uncertain voxel display to a continuous scale, and uncertain areas hold most
  segmentation errors. The viewer can highlight voxels below a confidence
  threshold (75% by default), labelled as uncalibrated.
- **Outline or fill.** As in 3D Slicer and ITK-SNAP: Fill + outline (default),
  Outline (anatomy visible inside) or Fill.
- **Zoom and scale.** On a phone one voxel is about 1.6 pixels. Every slice
  zooms with a pinch, Ctrl/⌘ + scroll or the magnifier, anchored under the
  fingers; a millimetre scale bar follows the zoom.
- **A report to print.** One page per result: figure, measurements, study
  accuracy per region, model facts. Prints to A4 or PDF.
- **Colours you can tell apart.** Under simulated deuteranopia the standard
  edema/enhancing pair (green/red) drops to a colour difference of 20 ΔE; the
  Okabe–Ito palette keeps it above 100. One switch, remembered per device.
- **Touch targets.** At least 40 px on touch screens (WCAG 2.2 asks 24 px,
  Apple 44 pt); fields use 16 px text so iOS does not zoom.

## Layout per device

| Width | Viewer |
|---|---|
| ≥ 1200 px | 2 × 2 views, controls docked on the right |
| 900–1199 px | 2 × 2 views, controls as a drawer |
| 600–899 px (tablet portrait) | 2 × 2 views, controls below |
| < 600 px (phone) | one view at a time with tabs, controls below |
| landscape phone | views fill the height |

System settings respected: reduce motion, reduce transparency, increase
contrast, forced colours.

## Sources

- Piepenbrock, Mayr, Mund, Buchner, *Positive display polarity is advantageous for both younger and older adults*, Ergonomics 56(7), 2013
- Pollard et al., J Digit Imaging 2012: <https://doi.org/10.1007/s10278-012-9459-5>
- Sendak, Gao, Brajer, Balu, *Presenting machine learning model information to clinical end users with model facts labels*, npj Digital Medicine 3:41, 2020: <https://doi.org/10.1038/s41746-020-0253-3>
- FDA, Health Canada, MHRA, *Transparency for Machine Learning-Enabled Medical Devices: Guiding Principles*, 2024: <https://www.fda.gov/medical-devices/software-medical-device-samd/transparency-machine-learning-enabled-medical-devices-guiding-principles>
- Uncertainty maps and manual corrections in auto-segmentation, 2025: <https://arxiv.org/abs/2502.18973>; MIDL: <https://proceedings.mlr.press/v315/maruccio26a.html>
- 3D Slicer forum on outline and fill display: <https://discourse.slicer.org/t/how-to-get-manual-and-auto-segmentation-outcomes-in-a-single-image-using-dash-and-solid-lines/31828>
- Machado, Oliveira, Fernandes, IEEE TVCG 2009 (colour-vision simulation); Okabe and Ito, *Color Universal Design*, 2008
- W3C, *Understanding SC 2.5.8 Target Size (Minimum)*, WCAG 2.2; Apple Human Interface Guidelines
