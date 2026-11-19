import { SAFE_COLOURS, STANDARD_COLOURS, usePrefs, type Palette } from "../lib/prefs";

const PALETTES: { id: Palette; title: string; colours: Record<number, string> }[] = [
  { id: "standard", title: "Standard", colours: STANDARD_COLOURS },
  { id: "safe", title: "Colour-blind safe", colours: SAFE_COLOURS },
];

/** Standard colours, or the Okabe–Ito set that stays distinct with colour-vision deficiency. Remembered on this device. */
export function PalettePicker() {
  const palette = usePrefs((state) => state.palette);
  const setPalette = usePrefs((state) => state.setPalette);
  return (
    <div className="seg full palette-seg" role="group" aria-label="Region colours">
      {PALETTES.map((option) => (
        <button key={option.id} aria-pressed={palette === option.id} onClick={() => setPalette(option.id)}>
          <span className="palette-dots" aria-hidden="true">
            {[1, 2, 3, 4].map((value) => (
              <i key={value} style={{ background: option.colours[value] }} />
            ))}
          </span>
          {option.title}
        </button>
      ))}
    </div>
  );
}
