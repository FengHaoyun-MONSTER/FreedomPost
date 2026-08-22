import { describe, expect, it } from "vitest";
import { formatCommissionEarnings } from "./market-commission.js";

describe("formatCommissionEarnings", () => {
  it("shows zero commission explicitly in yuan", () => {
    expect(formatCommissionEarnings(0, "CNY")).toBe("0.00元");
  });

  it("formats the configured commission from cents without recalculating it", () => {
    expect(formatCommissionEarnings(1250, "CNY")).toBe("12.50元");
    expect(formatCommissionEarnings(126000, "cny")).toBe("1,260.00元");
  });

  it("preserves the currency for non-CNY products", () => {
    expect(formatCommissionEarnings(1250, "USD")).toContain("12.50");
    expect(formatCommissionEarnings(1250, "USD")).not.toContain("元");
  });
});
