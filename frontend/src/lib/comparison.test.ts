import { describe, expect, it } from "vitest";
import { volumeChange } from "./comparison";

describe("longitudinal volume change", () => {
  it("uses baseline volume as denominator", () => {
    expect(volumeChange(20, 30)).toEqual({ ml: 10, percent: 50 });
    expect(volumeChange(20, 10)).toEqual({ ml: -10, percent: -50 });
  });
  it("does not invent a percentage for an absent baseline", () => {
    expect(volumeChange(0, 3)).toEqual({ ml: 3, percent: null });
    expect(volumeChange(0, 0)).toEqual({ ml: 0, percent: null });
  });
});
