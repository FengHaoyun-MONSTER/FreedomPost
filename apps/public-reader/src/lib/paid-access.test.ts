import { describe, expect, it } from "vitest";
import { shouldBlockPaidShortcut } from "../scripts/paid-access.js";

describe("paid article content protection", () => {
  it("blocks copy, save, print and source shortcuts while allowing navigation", () => {
    expect(shouldBlockPaidShortcut("c", true, false)).toBe(true);
    expect(shouldBlockPaidShortcut("P", false, true)).toBe(true);
    expect(shouldBlockPaidShortcut("u", true, false)).toBe(true);
    expect(shouldBlockPaidShortcut("f", true, false)).toBe(false);
    expect(shouldBlockPaidShortcut("c", false, false)).toBe(false);
  });
});
