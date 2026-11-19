import { usePrefs, type Theme } from "../lib/prefs";

const OPTIONS: { id: Theme; title: string }[] = [
  { id: "system", title: "System" },
  { id: "light", title: "Light" },
  { id: "dark", title: "Dark" },
];

/** Light, dark, or whatever the device uses. The image viewer stays dark either way. */
export function ThemePicker() {
  const theme = usePrefs((state) => state.theme);
  const setTheme = usePrefs((state) => state.setTheme);
  return (
    <div className="seg full" role="group" aria-label="Appearance">
      {OPTIONS.map((option) => (
        <button key={option.id} aria-pressed={theme === option.id} onClick={() => setTheme(option.id)}>
          {option.title}
        </button>
      ))}
    </div>
  );
}
