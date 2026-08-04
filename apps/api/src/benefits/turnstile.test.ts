import { describe, expect, it, vi } from "vitest";
import {
  TURNSTILE_SITEVERIFY_URL,
  createTurnstileVerifier,
  loadTurnstileConfig
} from "./turnstile.js";

const now = Date.parse("2026-08-04T08:00:00.000Z");
const secretKey = "test-turnstile-secret-key-123456789";

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function successfulChallenge(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    challenge_ts: "2026-08-04T07:59:30.000Z",
    hostname: "freedompost.example.test",
    action: "webmaster_benefit_claim",
    "error-codes": [],
    ...overrides
  };
}

describe("Turnstile server-side verifier", () => {
  it("submits the token server-side and validates hostname, action and challenge age", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(successfulChallenge()));
    const verifier = createTurnstileVerifier({
      secretKey,
      expectedHostname: "freedompost.example.test",
      expectedAction: "webmaster_benefit_claim",
      now: () => now,
      idempotencyKey: () => "123e4567-e89b-42d3-a456-426614174000",
      fetchImpl
    });

    const result = await verifier.verify("valid-turnstile-token", "203.0.113.9");

    expect(result).toEqual({ valid: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    const form = new URLSearchParams(String(init?.body));
    expect(String(url)).toBe(TURNSTILE_SITEVERIFY_URL);
    expect(form.get("secret")).toBe(secretKey);
    expect(form.get("response")).toBe("valid-turnstile-token");
    expect(form.get("remoteip")).toBe("203.0.113.9");
    expect(form.get("idempotency_key")).toBe("123e4567-e89b-42d3-a456-426614174000");
  });

  it("rejects malformed, replayed and context-mismatched challenges without exposing details", async () => {
    const invalidFetch = vi.fn<typeof fetch>().mockResolvedValue(response({
      success: false,
      "error-codes": ["timeout-or-duplicate", "private-detail"]
    }));
    const invalidVerifier = createTurnstileVerifier({
      secretKey,
      expectedHostname: "freedompost.example.test",
      expectedAction: "webmaster_benefit_claim",
      fetchImpl: invalidFetch
    });

    await expect(invalidVerifier.verify("x".repeat(2049), "203.0.113.9")).resolves.toEqual({
      valid: false,
      code: "turnstile_rejected",
      retryable: false
    });
    expect(invalidFetch).not.toHaveBeenCalled();
    await expect(invalidVerifier.verify("spent-token", "203.0.113.9")).resolves.toEqual({
      valid: false,
      code: "turnstile_rejected",
      retryable: false
    });

    const mismatchVerifier = createTurnstileVerifier({
      secretKey,
      expectedHostname: "freedompost.example.test",
      expectedAction: "webmaster_benefit_claim",
      now: () => now,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response(successfulChallenge({ action: "login" })))
    });
    await expect(mismatchVerifier.verify("valid-token", "203.0.113.9")).resolves.toMatchObject({
      valid: false,
      code: "turnstile_context_mismatch",
      retryable: false
    });
  });

  it("retries a temporary failure once with the same idempotency key", async () => {
    const requestBodies: string[] = [];
    const fetchImpl: typeof fetch = vi.fn(async (_url, init) => {
      requestBodies.push(String(init?.body));
      if (requestBodies.length === 1) throw new TypeError("temporary network failure");
      return response(successfulChallenge());
    });
    const verifier = createTurnstileVerifier({
      secretKey,
      expectedHostname: "freedompost.example.test",
      expectedAction: "webmaster_benefit_claim",
      now: () => now,
      idempotencyKey: () => "123e4567-e89b-42d3-a456-426614174000",
      fetchImpl
    });

    await expect(verifier.verify("valid-token", "203.0.113.9")).resolves.toEqual({ valid: true });
    expect(requestBodies).toHaveLength(2);
    expect(requestBodies.map((body) => new URLSearchParams(body).get("idempotency_key")))
      .toEqual(["123e4567-e89b-42d3-a456-426614174000", "123e4567-e89b-42d3-a456-426614174000"]);
  });

  it("fails closed when both verification attempts time out", async () => {
    const fetchImpl: typeof fetch = (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
    const verifier = createTurnstileVerifier({
      secretKey,
      expectedHostname: "freedompost.example.test",
      expectedAction: "webmaster_benefit_claim",
      timeoutMs: 10,
      fetchImpl
    });

    await expect(verifier.verify("valid-token", "203.0.113.9")).resolves.toEqual({
      valid: false,
      code: "turnstile_unavailable",
      retryable: true
    });
  });

  it("loads strict production configuration", () => {
    expect(loadTurnstileConfig({
      TURNSTILE_SECRET_KEY: secretKey,
      TURNSTILE_EXPECTED_HOSTNAME: "freedompost.example.test"
    })).toMatchObject({
      secretKey,
      expectedHostname: "freedompost.example.test",
      expectedAction: "webmaster_benefit_claim"
    });
    expect(() => loadTurnstileConfig({
      TURNSTILE_SECRET_KEY: "short",
      TURNSTILE_EXPECTED_HOSTNAME: "https://freedompost.example.test"
    })).toThrow();
  });
});
