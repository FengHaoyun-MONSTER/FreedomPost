import { describe, expect, it } from "vitest";
import {
  BENEFIT_CLAIM_COOKIE_NAME,
  createBenefitClaimCredentialService,
  loadBenefitClaimCredentialConfig
} from "./claim-cookie.js";

const secret = "benefit-claim-hmac-secret-that-is-long-enough";
const now = Date.parse("2026-08-04T08:00:00.000Z");
const token = "A".repeat(43);

describe("benefit claim credential cookie", () => {
  it("issues a signed opaque credential and derives stable non-reversible hashes", () => {
    const service = createBenefitClaimCredentialService({
      secret,
      now: () => now,
      token: () => token
    });

    const issued = service.issue();
    const restored = service.verify(issued.cookieValue);

    expect(BENEFIT_CLAIM_COOKIE_NAME).toBe("fp_webmaster_benefit");
    expect(issued.cookieValue).toMatch(/^v1\./);
    expect(issued.browserKeyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(issued.cookieValue).not.toContain(issued.browserKeyHash);
    expect(restored).toEqual({ browserKeyHash: issued.browserKeyHash });
    expect(service.hashNetworkKey("203.0.113.9")).toMatch(/^[0-9a-f]{64}$/);
    expect(service.hashNetworkKey("203.0.113.9")).not.toContain("203.0.113.9");
  });

  it("rejects tampering, expiration and future-issued credentials", () => {
    const service = createBenefitClaimCredentialService({
      secret,
      now: () => now,
      token: () => token
    });
    const issued = service.issue();
    const tampered = `${issued.cookieValue.slice(0, -1)}x`;

    expect(service.verify(tampered)).toBeNull();
    expect(createBenefitClaimCredentialService({
      secret,
      now: () => now + 16 * 24 * 60 * 60 * 1000
    }).verify(issued.cookieValue)).toBeNull();
    expect(createBenefitClaimCredentialService({
      secret,
      now: () => now - 10 * 60 * 1000
    }).verify(issued.cookieValue)).toBeNull();
  });

  it("defines restrictive HttpOnly cookie options and validates configuration", () => {
    const service = createBenefitClaimCredentialService({ secret });
    expect(service.cookieOptions(true)).toMatchObject({
      path: "/api/benefits/webmaster",
      httpOnly: true,
      secure: true,
      sameSite: "lax"
    });
    expect(loadBenefitClaimCredentialConfig({ BENEFIT_CLAIM_HMAC_SECRET: secret })).toEqual({ secret });
    expect(() => loadBenefitClaimCredentialConfig({ BENEFIT_CLAIM_HMAC_SECRET: "short" })).toThrow("32");
  });
});
