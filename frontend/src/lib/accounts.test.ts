import { describe, expect, it } from "vitest";

import { passwordStrength } from "../components/Fields";
import { initials, safeNext } from "./auth";
import { timeAgo, timeLeft } from "./format";
import { applyPalette, SAFE_COLOURS, STANDARD_COLOURS } from "./prefs";
import type { LabelInfo } from "./types";

describe("safeNext (where to go after signing in)", () => {
  it("keeps paths on this site", () => {
    expect(safeNext("/new")).toBe("/new");
    expect(safeNext("/viewer/abc?x=1")).toBe("/viewer/abc?x=1");
  });
  it("refuses other sites and odd forms of them", () => {
    for (const next of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", null]) {
      expect(safeNext(next)).toBe("/");
    }
  });
  it("does not loop back to the sign-in pages", () => {
    expect(safeNext("/signin?next=/new")).toBe("/");
    expect(safeNext("/signup")).toBe("/");
  });
});

describe("initials", () => {
  it("uses first and last name, skipping titles", () => {
    expect(initials({ display_name: "Dr. Leyla Aliyeva", username: "leyla" })).toBe("LA");
    expect(initials({ display_name: "elkhan", username: "elkhan" })).toBe("EL");
    expect(initials({ display_name: "", username: "j.jabrayilli" })).toBe("JJ");
  });
});

describe("passwordStrength", () => {
  it("matches the server's minimum and rewards length", () => {
    expect(passwordStrength("short").score).toBe(0);
    expect(passwordStrength("aaaaaaaaaaaa").score).toBe(0);
    expect(passwordStrength("abcdefghij").score).toBe(1);
    expect(passwordStrength("correct horse battery staple").score).toBe(3);
  });
});

describe("palettes", () => {
  const labels: LabelInfo[] = [0, 1, 2, 3, 4].map((value) => ({
    value,
    short: `L${value}`,
    name: `Label ${value}`,
    color: value ? STANDARD_COLOURS[value] : "#000000",
  })) as LabelInfo[];

  it("standard leaves the backend colours alone", () => {
    expect(applyPalette(labels, "standard")).toBe(labels);
  });
  it("colour-blind safe swaps the four regions, keeps the background", () => {
    const safe = applyPalette(labels, "safe");
    expect(safe.map((entry) => entry.color)).toEqual(["#000000", SAFE_COLOURS[1], SAFE_COLOURS[2], SAFE_COLOURS[3], SAFE_COLOURS[4]]);
    expect(labels[1].color).toBe(STANDARD_COLOURS[1]); // not mutated
  });
});

describe("time formatting", () => {
  const now = Date.UTC(2026, 10, 4, 12) as number;
  const at = (secondsAgo: number) => now / 1000 - secondsAgo;
  it("says how long ago", () => {
    expect(timeAgo(null, now)).toBe("never");
    expect(timeAgo(at(10), now)).toBe("just now");
    expect(timeAgo(at(300), now)).toBe("5 min ago");
    expect(timeAgo(at(3 * 3600), now)).toBe("3 h ago");
    expect(timeAgo(at(30 * 3600), now)).toBe("yesterday");
  });
  it("says how long is left", () => {
    expect(timeLeft(null, now)).toBe("kept");
    expect(timeLeft(at(-1800), now)).toBe("in 30 min");
    expect(timeLeft(at(-20 * 3600), now)).toBe("in 20 h");
    expect(timeLeft(at(5), now)).toBe("expired");
  });
});
