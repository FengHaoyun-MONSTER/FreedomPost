import { describe, expect, it, vi } from "vitest";
import { BENEFIT_LOG_REDACT_PATHS, buildApp } from "../app.js";
import { MemoryContentRepository } from "../repositories/index.js";
import type { StoredBenefitCampaign } from "../repositories/types.js";
import { createBenefitClaimCredentialService } from "./claim-cookie.js";
import { Opus8IntegrationError } from "./opus8-client.js";
import { createSubscriptionLinkCipher } from "./subscription-cipher.js";
import type { WebmasterBenefitRouteDependencies } from "./benefit-routes.js";

const campaignId = "webmaster-benefit-v1";
const subscriptionUrl = "https://sub.example.test/sub/private-token";
const credentialSecret = "benefit-credential-secret-that-is-at-least-32-chars";
const encryptionKey = Buffer.alloc(32, 9).toString("base64url");

class EnabledBenefitRepository extends MemoryContentRepository {
  override async getBenefitCampaign(id: string): Promise<StoredBenefitCampaign | null> {
    const campaign = await super.getBenefitCampaign(id);
    return campaign ? { ...campaign, enabled: true } : null;
  }
}

function cookiePair(response: { headers: Record<string, string | string[] | number | undefined> }): string {
  const header = response.headers["set-cookie"];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== "string") throw new Error("Expected benefit cookie");
  return value.split(";")[0]!;
}

function dependencies(overrides: Partial<WebmasterBenefitRouteDependencies> = {}) {
  const credentialService = createBenefitClaimCredentialService({
    secret: credentialSecret,
    token: () => "A".repeat(43)
  });
  const opus8Client = {
    claimWebmasterBenefit: vi.fn(async (input: { externalClaimId: string; campaignId: typeof campaignId }) => ({
      externalClaimId: input.externalClaimId,
      opusUserId: "opus-user-1",
      opusDeviceId: "opus-device-1",
      subscriptionUrl,
      expiresAt: "2026-08-19T00:00:00.000Z",
      trafficBytes: 30 * 1024 * 1024 * 1024,
      durationDays: 15 as const,
      hwidRequired: true as const,
      ipLimit: 2 as const,
      created: true
    }))
  };
  return {
    credentialService,
    turnstileVerifier: { verify: vi.fn(async () => ({ valid: true as const })) },
    rateLimiter: {
      consume: vi.fn(async () => ({
        allowed: true,
        remaining: 5,
        retryAfterMs: 0,
        source: "redis" as const
      }))
    },
    opus8Client,
    subscriptionCipher: createSubscriptionLinkCipher({ encodedKey: encryptionKey }),
    turnstileSiteKey: "1x00000000000000000000AA",
    networkDailyLimit: 3,
    claimMinuteLimit: 6,
    secureCookies: true,
    now: () => Date.parse("2026-08-01T00:00:00.000Z"),
    ...overrides
  } satisfies WebmasterBenefitRouteDependencies;
}

describe("webmaster benefit public API", () => {
  it("issues a browser credential, provisions once and restores only decrypted output", async () => {
    const repository = new EnabledBenefitRepository([]);
    const benefit = dependencies();
    const app = buildApp({ repository, benefit });

    const campaign = await app.inject({ method: "GET", url: "/api/benefits/webmaster" });
    const cookie = cookiePair(campaign);
    const claim = await app.inject({
      method: "POST",
      url: "/api/benefits/webmaster/claim",
      headers: { cookie },
      payload: { turnstileToken: "valid-turnstile-token" }
    });
    const restore = await app.inject({
      method: "GET",
      url: "/api/benefits/webmaster/claim",
      headers: { cookie }
    });

    expect(campaign.statusCode).toBe(200);
    expect(campaign.headers["cache-control"]).toBe("no-store");
    expect(campaign.json()).toEqual({
      id: campaignId,
      enabled: true,
      trafficBytes: 30 * 1024 * 1024 * 1024,
      durationDays: 15,
      hwidRequired: true,
      ipLimit: 2,
      turnstileSiteKey: "1x00000000000000000000AA"
    });
    expect(claim.statusCode).toBe(201);
    expect(claim.json()).toMatchObject({ status: "ready", subscriptionUrl });
    expect(restore.statusCode).toBe(200);
    expect(restore.json()).toEqual(claim.json());
    expect(benefit.opus8Client.claimWebmasterBenefit).toHaveBeenCalledTimes(1);

    const verified = benefit.credentialService.verify(cookie.split("=")[1]);
    expect(verified).not.toBeNull();
    const stored = await repository.getBenefitClaimByBrowserKey(campaignId, verified!.browserKeyHash);
    expect(stored?.subscriptionUrlEnc).toMatch(/^v1\./);
    expect(stored?.subscriptionUrlEnc).not.toContain(subscriptionUrl);
    await app.close();
  });

  it("requires the pre-issued signed credential and enforces rate limit before Turnstile", async () => {
    const repository = new EnabledBenefitRepository([]);
    const turnstileVerifier = { verify: vi.fn(async () => ({ valid: true as const })) };
    const rateLimiter = {
      consume: vi.fn(async () => ({
        allowed: false,
        remaining: 0,
        retryAfterMs: 30_000,
        source: "fallback" as const
      }))
    };
    const benefit = dependencies({ turnstileVerifier, rateLimiter });
    const app = buildApp({ repository, benefit });

    const missingCookie = await app.inject({
      method: "POST",
      url: "/api/benefits/webmaster/claim",
      payload: { turnstileToken: "valid-turnstile-token" }
    });
    const campaign = await app.inject({ method: "GET", url: "/api/benefits/webmaster" });
    const limited = await app.inject({
      method: "POST",
      url: "/api/benefits/webmaster/claim",
      headers: { cookie: cookiePair(campaign) },
      payload: { turnstileToken: "valid-turnstile-token" }
    });

    expect(missingCookie.statusCode).toBe(403);
    expect(missingCookie.json().error.code).toBe("CLAIM_CREDENTIAL_REQUIRED");
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("30");
    expect(turnstileVerifier.verify).not.toHaveBeenCalled();
    await app.close();
  });

  it("keeps disabled campaigns closed before any anti-bot or provisioning work", async () => {
    const repository = new MemoryContentRepository([]);
    const benefit = dependencies();
    const app = buildApp({ repository, benefit });
    const campaign = await app.inject({ method: "GET", url: "/api/benefits/webmaster" });
    const claim = await app.inject({
      method: "POST",
      url: "/api/benefits/webmaster/claim",
      headers: { cookie: cookiePair(campaign) },
      payload: { turnstileToken: "valid-turnstile-token" }
    });

    expect(campaign.json().enabled).toBe(false);
    expect(claim.statusCode).toBe(403);
    expect(benefit.turnstileVerifier.verify).not.toHaveBeenCalled();
    expect(benefit.opus8Client.claimWebmasterBenefit).not.toHaveBeenCalled();
    await app.close();
  });

  it("enforces the PostgreSQL-backed network daily limit without creating another claim", async () => {
    const repository = new EnabledBenefitRepository([]);
    const benefit = dependencies();
    const networkKeyHash = benefit.credentialService.hashNetworkKey("203.0.113.9");
    for (let index = 0; index < 3; index += 1) {
      await repository.createBenefitClaim({
        campaignId,
        externalClaimId: crypto.randomUUID(),
        browserKeyHash: index.toString(16).repeat(64),
        networkKeyHash
      });
    }
    const app = buildApp({ repository, benefit, trustProxy: true });
    const campaign = await app.inject({ method: "GET", url: "/api/benefits/webmaster" });
    const response = await app.inject({
      method: "POST",
      url: "/api/benefits/webmaster/claim",
      headers: {
        cookie: cookiePair(campaign),
        "x-forwarded-for": "203.0.113.9"
      },
      payload: { turnstileToken: "valid-turnstile-token" }
    });

    expect(response.statusCode).toBe(429);
    expect(response.json().error.code).toBe("NETWORK_DAILY_LIMIT");
    expect(benefit.opus8Client.claimWebmasterBenefit).not.toHaveBeenCalled();
    await app.close();
  });

  it("recovers an ambiguous Opus8 timeout with the same external claim ID", async () => {
    const repository = new EnabledBenefitRepository([]);
    const externalIds: string[] = [];
    let attempt = 0;
    const opus8Client = {
      claimWebmasterBenefit: vi.fn(async (input: { externalClaimId: string; campaignId: typeof campaignId }) => {
        externalIds.push(input.externalClaimId);
        attempt += 1;
        if (attempt === 1) {
          throw new Opus8IntegrationError("timeout", {
            code: "opus8_timeout",
            retryable: true,
            outcome: "unknown"
          });
        }
        return {
          externalClaimId: input.externalClaimId,
          opusUserId: "opus-user-1",
          opusDeviceId: "opus-device-1",
          subscriptionUrl,
          expiresAt: "2026-08-19T00:00:00.000Z",
          trafficBytes: 30 * 1024 * 1024 * 1024,
          durationDays: 15 as const,
          hwidRequired: true as const,
          ipLimit: 2 as const,
          created: false
        };
      })
    };
    const app = buildApp({ repository, benefit: dependencies({ opus8Client }) });
    const campaign = await app.inject({ method: "GET", url: "/api/benefits/webmaster" });
    const cookie = cookiePair(campaign);
    const first = await app.inject({
      method: "POST",
      url: "/api/benefits/webmaster/claim",
      headers: { cookie },
      payload: { turnstileToken: "first-token" }
    });
    const pending = await app.inject({
      method: "GET",
      url: "/api/benefits/webmaster/claim",
      headers: { cookie }
    });
    const recovered = await app.inject({
      method: "POST",
      url: "/api/benefits/webmaster/claim",
      headers: { cookie },
      payload: { turnstileToken: "second-token" }
    });

    expect(first.statusCode).toBe(503);
    expect(pending.statusCode).toBe(202);
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json()).toMatchObject({ status: "ready", subscriptionUrl });
    expect(externalIds).toHaveLength(2);
    expect(externalIds[0]).toBe(externalIds[1]);
    await app.close();
  });

  it("redacts every credential-bearing header and payload field from logs", () => {
    expect(BENEFIT_LOG_REDACT_PATHS).toEqual(expect.arrayContaining([
      "req.headers.cookie",
      "req.headers.authorization",
      "req.body.turnstileToken",
      "res.headers.set-cookie"
    ]));
  });

  it("allows only configured cross-origin callers", async () => {
    const app = buildApp({
      benefit: null,
      corsAllowedOrigins: ["https://freedompost.example.test"]
    });
    const allowed = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://freedompost.example.test" }
    });
    const denied = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://attacker.example.test" }
    });

    expect(allowed.headers["access-control-allow-origin"]).toBe("https://freedompost.example.test");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });
});
