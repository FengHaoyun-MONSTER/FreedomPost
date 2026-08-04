import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  OPUS8_WEBMASTER_BENEFIT_PATH,
  Opus8IntegrationError,
  createOpus8IntegrationClient,
  loadOpus8IntegrationConfig
} from "./opus8-client.js";

const externalClaimId = "123e4567-e89b-42d3-a456-426614174000";
const campaignId = "webmaster-benefit-v1";
const secret = "test-integration-secret-that-is-at-least-32-characters";

function successPayload(overrides: Record<string, unknown> = {}) {
  return {
    externalClaimId,
    opusUserId: "opus-user-1",
    opusDeviceId: "opus-device-1",
    subscriptionUrl: "https://sub.example.test/sub/token",
    expiresAt: "2026-08-19T00:00:00.000Z",
    trafficBytes: 30 * 1024 * 1024 * 1024,
    durationDays: 15,
    hwidRequired: true,
    ipLimit: 2,
    created: true,
    ...overrides
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("Opus8 integration client", () => {
  it("signs the exact method, target and raw request body expected by Opus8", async () => {
    const now = 1_785_820_800_123;
    const requestId = "request-1234567890abcdef";
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(successPayload(), 201));
    const client = createOpus8IntegrationClient({
      baseUrl: "https://api.example.test",
      keyId: "freedompost-v1",
      secret,
      now: () => now,
      requestId: () => requestId,
      fetchImpl
    });

    const result = await client.claimWebmasterBenefit({ externalClaimId, campaignId });

    expect(result.created).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    const rawBody = String(init?.body);
    const bodyHash = createHash("sha256").update(rawBody).digest("hex");
    const message = [
      "opus8-integration-v1",
      String(now),
      requestId,
      "POST",
      OPUS8_WEBMASTER_BENEFIT_PATH,
      bodyHash
    ].join("\n");
    const expectedSignature = createHmac("sha256", secret).update(message).digest("hex");
    const headers = new Headers(init?.headers);

    expect(String(url)).toBe(`https://api.example.test${OPUS8_WEBMASTER_BENEFIT_PATH}`);
    expect(JSON.parse(rawBody)).toEqual({ externalClaimId, campaignId });
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-opus8-integration-key-id")).toBe("freedompost-v1");
    expect(headers.get("x-opus8-integration-timestamp")).toBe(String(now));
    expect(headers.get("x-opus8-integration-request-id")).toBe(requestId);
    expect(headers.get("x-opus8-integration-signature")).toBe(expectedSignature);
  });

  it("fails closed for unsafe or incomplete environment configuration", () => {
    const valid = {
      OPUS8_INTEGRATION_BASE_URL: "https://api.example.test",
      OPUS8_INTEGRATION_KEY_ID: "freedompost-v1",
      OPUS8_INTEGRATION_SECRET: secret
    };

    expect(loadOpus8IntegrationConfig(valid)).toMatchObject({
      baseUrl: "https://api.example.test",
      keyId: "freedompost-v1",
      secret,
      timeoutMs: 5_000
    });
    expect(() => loadOpus8IntegrationConfig({ ...valid, OPUS8_INTEGRATION_BASE_URL: "http://api.example.test" })).toThrow("HTTPS");
    expect(() => loadOpus8IntegrationConfig({ ...valid, OPUS8_INTEGRATION_BASE_URL: "https://user:pass@api.example.test" })).toThrow("credentials");
    expect(() => loadOpus8IntegrationConfig({ ...valid, OPUS8_INTEGRATION_BASE_URL: "https://api.example.test/control" })).toThrow("origin");
    expect(() => loadOpus8IntegrationConfig({ ...valid, OPUS8_INTEGRATION_KEY_ID: "x" })).toThrow("key ID");
    expect(() => loadOpus8IntegrationConfig({ ...valid, OPUS8_INTEGRATION_SECRET: "short" })).toThrow("secret");
  });

  it("aborts at the configured deadline and classifies the result as unknown", async () => {
    const fetchImpl: typeof fetch = (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
    const client = createOpus8IntegrationClient({
      baseUrl: "https://api.example.test",
      keyId: "freedompost-v1",
      secret,
      timeoutMs: 10,
      fetchImpl
    });

    const error = await client.claimWebmasterBenefit({ externalClaimId, campaignId }).catch((value) => value);

    expect(error).toBeInstanceOf(Opus8IntegrationError);
    expect(error).toMatchObject({
      code: "opus8_timeout",
      retryable: true,
      outcome: "unknown"
    });
  });

  it("keeps the deadline active while the upstream response body is being read", async () => {
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), { once: true });
        }
      });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };
    const client = createOpus8IntegrationClient({
      baseUrl: "https://api.example.test",
      keyId: "freedompost-v1",
      secret,
      timeoutMs: 10,
      fetchImpl
    });

    await expect(client.claimWebmasterBenefit({ externalClaimId, campaignId })).rejects.toMatchObject({
      code: "opus8_timeout",
      retryable: true,
      outcome: "unknown"
    });
  });

  it.each([
    [400, "opus8_contract_rejected", false, "known"],
    [401, "opus8_authentication_failed", false, "known"],
    [404, "opus8_endpoint_not_found", false, "known"],
    [429, "opus8_rate_limited", true, "known"],
    [503, "opus8_temporarily_unavailable", true, "unknown"]
  ] as const)("normalizes HTTP %i without exposing upstream response bodies", async (status, code, retryable, outcome) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("secret upstream details", { status }));
    const client = createOpus8IntegrationClient({
      baseUrl: "https://api.example.test",
      keyId: "freedompost-v1",
      secret,
      fetchImpl
    });

    const error = await client.claimWebmasterBenefit({ externalClaimId, campaignId }).catch((value) => value);

    expect(error).toBeInstanceOf(Opus8IntegrationError);
    expect(error).toMatchObject({ code, retryable, outcome, status });
    expect(String(error)).not.toContain("secret upstream details");
  });

  it("rejects a malformed success response as an unknown outcome", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(successPayload({
      externalClaimId: crypto.randomUUID(),
      trafficBytes: 1
    })));
    const client = createOpus8IntegrationClient({
      baseUrl: "https://api.example.test",
      keyId: "freedompost-v1",
      secret,
      fetchImpl
    });

    const error = await client.claimWebmasterBenefit({ externalClaimId, campaignId }).catch((value) => value);

    expect(error).toMatchObject({
      code: "opus8_invalid_response",
      retryable: true,
      outcome: "unknown"
    });
  });

  it("recovers after an ambiguous timeout by retrying the same external claim ID", async () => {
    let attempts = 0;
    let provisioned: ReturnType<typeof successPayload> | null = null;
    const bodies: string[] = [];
    const requestIds: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      attempts += 1;
      bodies.push(String(init?.body));
      requestIds.push(new Headers(init?.headers).get("x-opus8-integration-request-id") ?? "");
      if (!provisioned) provisioned = successPayload();

      if (attempts === 1) {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        });
      }

      return jsonResponse({ ...provisioned, created: false });
    };
    const client = createOpus8IntegrationClient({
      baseUrl: "https://api.example.test",
      keyId: "freedompost-v1",
      secret,
      timeoutMs: 10,
      fetchImpl
    });

    await expect(client.claimWebmasterBenefit({ externalClaimId, campaignId })).rejects.toMatchObject({
      code: "opus8_timeout",
      outcome: "unknown"
    });
    const recovered = await client.claimWebmasterBenefit({ externalClaimId, campaignId });

    expect(recovered).toMatchObject({ externalClaimId, created: false });
    expect(bodies.map((body) => JSON.parse(body).externalClaimId)).toEqual([externalClaimId, externalClaimId]);
    expect(requestIds[0]).not.toBe(requestIds[1]);
  });
});
