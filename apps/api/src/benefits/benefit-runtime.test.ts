import { describe, expect, it } from "vitest";
import { createWebmasterBenefitRuntime } from "./benefit-runtime.js";

const environment = {
  BENEFIT_CLAIM_HMAC_SECRET: "benefit-credential-secret-that-is-at-least-32-chars",
  BENEFIT_LINK_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString("base64url"),
  BENEFIT_NETWORK_DAILY_LIMIT: "3",
  BENEFIT_CLAIM_MINUTE_LIMIT: "6",
  TURNSTILE_SECRET_KEY: "turnstile-secret-key-that-is-long-enough",
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  TURNSTILE_EXPECTED_HOSTNAME: "freedompost.example.test",
  TURNSTILE_EXPECTED_ACTION: "webmaster_benefit_claim",
  OPUS8_INTEGRATION_BASE_URL: "https://api.example.test",
  OPUS8_INTEGRATION_KEY_ID: "freedompost-v1",
  OPUS8_INTEGRATION_SECRET: "opus8-integration-secret-that-is-at-least-32-chars",
  REDIS_URL: "redis://redis:6379"
};

describe("webmaster benefit runtime", () => {
  it("stays disabled when the feature root secret is absent", () => {
    expect(createWebmasterBenefitRuntime({}, { secureCookies: true })).toBeNull();
  });

  it("fails closed on partial configuration and constructs complete dependencies", async () => {
    expect(() => createWebmasterBenefitRuntime({
      BENEFIT_CLAIM_HMAC_SECRET: environment.BENEFIT_CLAIM_HMAC_SECRET
    }, { secureCookies: true })).toThrow();

    const runtime = createWebmasterBenefitRuntime(environment, { secureCookies: true });
    expect(runtime?.dependencies).toMatchObject({
      networkDailyLimit: 3,
      claimMinuteLimit: 6,
      secureCookies: true,
      turnstileSiteKey: "1x00000000000000000000AA"
    });
    await runtime?.close();
  });

  it("rejects unsafe operational limits", () => {
    expect(() => createWebmasterBenefitRuntime({
      ...environment,
      BENEFIT_NETWORK_DAILY_LIMIT: "0"
    }, { secureCookies: true })).toThrow("BENEFIT_NETWORK_DAILY_LIMIT");
  });
});
