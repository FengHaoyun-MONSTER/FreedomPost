import { describe, expect, it } from "vitest";
import { benefitPanelForState, type BenefitPageState } from "./benefit-state.js";

describe("webmaster benefit page states", () => {
  it.each([
    ["loading", "progress"],
    ["verifying", "progress"],
    ["claiming", "progress"],
    ["provisioning", "progress"],
    ["idle", "claim"],
    ["ready", "ready"],
    ["error", "error"],
    ["disabled", "disabled"]
  ] satisfies Array<[BenefitPageState, string]>)("maps %s to only the %s panel", (state, panel) => {
    expect(benefitPanelForState(state)).toBe(panel);
  });
});
