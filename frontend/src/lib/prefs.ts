import { useMemo } from "react";
import { create } from "zustand";

import type { LabelInfo } from "./types";

/**
 * Region colours. "standard" is the backend's label map (the colours in the
 * exported ITK-SNAP and Slicer tables). "safe" swaps in the Okabe–Ito palette,
 * which stays distinguishable with red–green or blue–yellow colour blindness:
 * under simulated deuteranopia the standard edema/enhancing pair (green/red)
 * drops to a colour difference of ~20 (ΔE), the safe pair stays above 100.
 */
export type Palette = "standard" | "safe";

export const STANDARD_COLOURS: Record<number, string> = { 1: "#F2C200", 2: "#2FA84F", 3: "#E0332B", 4: "#2F7DE1" };
export const SAFE_COLOURS: Record<number, string> = { 1: "#F0E442", 2: "#56B4E9", 3: "#D55E00", 4: "#0072B2" };

const KEY = "glioma.palette";

function stored(): Palette {
  try {
    return window.localStorage.getItem(KEY) === "safe" ? "safe" : "standard";
  } catch {
    return "standard";
  }
}

/** Appearance of the content pages. The viewer is always dark (a reading room). */
export type Theme = "system" | "light" | "dark";
const THEME_KEY = "glioma.theme";

function storedTheme(): Theme {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

interface Prefs {
  palette: Palette;
  setPalette: (palette: Palette) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const usePrefs = create<Prefs>((set) => ({
  palette: typeof window === "undefined" ? "standard" : stored(),
  setPalette: (palette) => {
    try {
      window.localStorage.setItem(KEY, palette);
    } catch {
      /* private mode: applies to this visit only */
    }
    set({ palette });
  },
  theme: typeof window === "undefined" ? "system" : storedTheme(),
  setTheme: (theme) => {
    try {
      if (theme === "system") window.localStorage.removeItem(THEME_KEY);
      else window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* private mode: applies to this visit only */
    }
    // public/theme.js applies the same attribute before the first paint on later visits.
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    set({ theme });
  },
}));

export function applyPalette(labelMap: LabelInfo[], palette: Palette): LabelInfo[] {
  if (palette === "standard") return labelMap;
  return labelMap.map((entry) => (SAFE_COLOURS[entry.value] ? { ...entry, color: SAFE_COLOURS[entry.value] } : entry));
}

/** The label map in the colours the visitor chose. */
export function useLabelMap<T extends LabelInfo[] | undefined>(labelMap: T): T {
  const palette = usePrefs((state) => state.palette);
  return useMemo(() => (labelMap ? applyPalette(labelMap, palette) : labelMap) as T, [labelMap, palette]);
}

/** Colour of one region before any label map has arrived. */
export function useRegionColours(): Record<number, string> {
  const palette = usePrefs((state) => state.palette);
  return palette === "safe" ? SAFE_COLOURS : STANDARD_COLOURS;
}
