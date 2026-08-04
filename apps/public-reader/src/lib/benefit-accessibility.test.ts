import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../pages/benefit.astro", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/benefit.css", import.meta.url), "utf8");

describe("webmaster benefit accessibility and responsive contract", () => {
  it("announces progress and errors without exposing the subscription as text", () => {
    expect(page).toContain('role="status" aria-live="polite"');
    expect(page).toContain('role="alert"');
    expect(page).toContain('aria-label="站长福利订阅二维码"');
    expect(page).toContain('aria-busy="true"');
    expect(page).not.toContain('id="benefitSubscriptionUrl"');
  });

  it("gives each interactive panel an accessible heading relationship", () => {
    expect(page).toContain('aria-labelledby="benefitClaimHeading"');
    expect(page).toContain('aria-labelledby="benefitReadyHeading"');
    expect(page).toContain('aria-labelledby="benefitErrorTitle"');
  });

  it("preserves visible keyboard focus and narrow-screen layouts", () => {
    expect(styles).toContain(":focus-visible");
    expect(styles).toContain("@media (max-width: 560px)");
    expect(styles).toContain("@media (max-width: 420px)");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("uses the compact Turnstile widget when a narrow viewport cannot fit flexible mode", () => {
    const script = readFileSync(new URL("../scripts/benefit.ts", import.meta.url), "utf8");

    expect(script).toContain('matchMedia("(max-width: 380px)")');
    expect(script).toContain('"compact"');
    expect(script).toContain('"flexible"');
  });
});
