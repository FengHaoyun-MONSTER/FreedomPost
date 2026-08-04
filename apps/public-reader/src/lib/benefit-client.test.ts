import { describe, expect, it, vi } from "vitest";
import {
  BenefitApiError,
  createWebmasterBenefitClient,
  describeBenefitError,
  type BenefitCampaign
} from "./benefit-client.js";

const campaign: BenefitCampaign = {
  id: "webmaster-benefit-v1",
  enabled: true,
  trafficBytes: 30 * 1024 * 1024 * 1024,
  durationDays: 15,
  hwidRequired: true,
  ipLimit: 2,
  turnstileSiteKey: "1x00000000000000000000AA"
};

function json(payload: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}

describe("webmaster benefit browser client", () => {
  it("loads the same-origin campaign contract without caching", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json(campaign));
    const client = createWebmasterBenefitClient(fetchImpl);

    await expect(client.getCampaign()).resolves.toEqual(campaign);
    expect(fetchImpl).toHaveBeenCalledWith("/api/benefits/webmaster", expect.objectContaining({
      method: "GET",
      cache: "no-store",
      credentials: "same-origin"
    }));
  });

  it("restores an existing claim and treats a missing browser claim as empty", async () => {
    const ready = {
      status: "ready",
      subscriptionUrl: "https://sub.example.test/sub/private-token",
      expiresAt: "2026-08-19T00:00:00.000Z",
      trafficBytes: campaign.trafficBytes,
      durationDays: 15,
      hwidRequired: true,
      ipLimit: 2
    };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ error: { code: "BENEFIT_CLAIM_NOT_FOUND" } }, 404))
      .mockResolvedValueOnce(json(ready));
    const client = createWebmasterBenefitClient(fetchImpl);

    await expect(client.restoreClaim()).resolves.toBeNull();
    await expect(client.restoreClaim()).resolves.toEqual(ready);
  });

  it("submits only the Turnstile token and accepts a provisioning response", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({
      status: "provisioning",
      retryAfterSeconds: 3
    }, 202, { "retry-after": "3" }));
    const client = createWebmasterBenefitClient(fetchImpl);

    await expect(client.claim("turnstile-token")).resolves.toEqual({
      status: "provisioning",
      retryAfterSeconds: 3
    });
    expect(fetchImpl).toHaveBeenCalledWith("/api/benefits/webmaster/claim", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ turnstileToken: "turnstile-token" })
    }));
  });

  it("rejects unsafe subscription schemes before rendering a QR code", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({
      status: "ready",
      subscriptionUrl: "javascript:alert(1)",
      expiresAt: "2026-08-19T00:00:00.000Z",
      trafficBytes: campaign.trafficBytes,
      durationDays: 15,
      hwidRequired: true,
      ipLimit: 2
    }));

    await expect(createWebmasterBenefitClient(fetchImpl).restoreClaim()).rejects.toMatchObject({
      code: "INVALID_RESPONSE"
    });
  });

  it("maps only allowlisted public errors and never reflects an upstream message", () => {
    expect(describeBenefitError(new BenefitApiError(429, "NETWORK_DAILY_LIMIT", 60))).toMatchObject({
      title: "今日领取次数已达上限",
      retryable: false
    });
    expect(describeBenefitError(new BenefitApiError(503, "private_upstream_detail"))).toEqual({
      title: "暂时无法完成领取",
      message: "服务暂时不可用，请稍后重试。",
      retryable: true
    });
  });
});
