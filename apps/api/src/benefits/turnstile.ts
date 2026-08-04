import { isIP } from "node:net";
import { randomUUID } from "node:crypto";

export const TURNSTILE_SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const DEFAULT_ACTION = "webmaster_benefit_claim";
const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_MAX_ATTEMPTS = 2;
const MAX_RESPONSE_BYTES = 16 * 1024;
const MAX_CHALLENGE_AGE_MS = 5 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;

interface TurnstileEnvironment {
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_EXPECTED_HOSTNAME?: string;
  TURNSTILE_EXPECTED_ACTION?: string;
  TURNSTILE_TIMEOUT_MS?: string;
}

export interface TurnstileRuntimeConfig {
  secretKey: string;
  expectedHostname: string;
  expectedAction: string;
  timeoutMs: number;
}

export interface TurnstileVerifierConfig extends TurnstileRuntimeConfig {
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  idempotencyKey?: () => string;
}

export type TurnstileVerificationResult =
  | { valid: true }
  | {
      valid: false;
      code:
        | "turnstile_rejected"
        | "turnstile_context_mismatch"
        | "turnstile_invalid_response"
        | "turnstile_unavailable";
      retryable: boolean;
    };

export interface TurnstileVerifier {
  verify(token: string, remoteIp?: string): Promise<TurnstileVerificationResult>;
}

type AttemptResult =
  | { kind: "response"; payload: unknown }
  | { kind: "rejected-http" }
  | { kind: "temporary-failure" };

export function loadTurnstileConfig(
  environment: TurnstileEnvironment = process.env
): TurnstileRuntimeConfig {
  const timeoutText = environment.TURNSTILE_TIMEOUT_MS;
  const timeoutMs = timeoutText === undefined || timeoutText === ""
    ? DEFAULT_TIMEOUT_MS
    : Number(timeoutText);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) {
    throw new Error("TURNSTILE_TIMEOUT_MS must be an integer from 100 to 10000");
  }
  return validateConfig({
    secretKey: environment.TURNSTILE_SECRET_KEY ?? "",
    expectedHostname: environment.TURNSTILE_EXPECTED_HOSTNAME ?? "",
    expectedAction: environment.TURNSTILE_EXPECTED_ACTION ?? DEFAULT_ACTION,
    timeoutMs
  });
}

export function createTurnstileVerifier(
  config: Omit<TurnstileVerifierConfig, "timeoutMs"> & { timeoutMs?: number }
): TurnstileVerifier {
  const validated = validateConfig({
    secretKey: config.secretKey,
    expectedHostname: config.expectedHostname,
    expectedAction: config.expectedAction,
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  });
  const maxAttempts = config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new Error("Turnstile max attempts must be from 1 to 3");
  }
  const fetchImpl = config.fetchImpl ?? fetch;
  const now = config.now ?? Date.now;
  const createIdempotencyKey = config.idempotencyKey ?? randomUUID;

  return {
    async verify(token, remoteIp) {
      if (typeof token !== "string" || token.length < 1 || token.length > 2_048) {
        return rejected("turnstile_rejected", false);
      }
      if (remoteIp !== undefined && isIP(remoteIp) === 0) {
        return rejected("turnstile_rejected", false);
      }
      const idempotencyKey = createIdempotencyKey();
      if (!isUuid(idempotencyKey)) {
        throw new Error("Turnstile idempotency key is invalid");
      }

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const result = await performAttempt({
          config: validated,
          token,
          idempotencyKey,
          fetchImpl,
          ...(remoteIp === undefined ? {} : { remoteIp })
        });
        if (result.kind === "temporary-failure") {
          if (attempt < maxAttempts) continue;
          return rejected("turnstile_unavailable", true);
        }
        if (result.kind === "rejected-http") {
          return rejected("turnstile_invalid_response", false);
        }

        const payload = result.payload;
        if (!isRecord(payload) || typeof payload.success !== "boolean") {
          if (attempt < maxAttempts) continue;
          return rejected("turnstile_invalid_response", true);
        }
        if (!payload.success) {
          const errorCodes = Array.isArray(payload["error-codes"])
            ? payload["error-codes"].filter((value): value is string => typeof value === "string")
            : [];
          if (errorCodes.includes("internal-error") && attempt < maxAttempts) continue;
          if (errorCodes.includes("internal-error")) return rejected("turnstile_unavailable", true);
          return rejected("turnstile_rejected", false);
        }

        const challengeTime = typeof payload.challenge_ts === "string"
          ? Date.parse(payload.challenge_ts)
          : Number.NaN;
        const currentTime = now();
        if (
          payload.hostname !== validated.expectedHostname
          || payload.action !== validated.expectedAction
          || !Number.isFinite(challengeTime)
          || !Number.isSafeInteger(currentTime)
          || challengeTime > currentTime + CLOCK_SKEW_MS
          || currentTime - challengeTime > MAX_CHALLENGE_AGE_MS + CLOCK_SKEW_MS
        ) {
          return rejected("turnstile_context_mismatch", false);
        }
        return { valid: true };
      }

      return rejected("turnstile_unavailable", true);
    }
  };
}

async function performAttempt(input: {
  config: TurnstileRuntimeConfig;
  token: string;
  remoteIp?: string;
  idempotencyKey: string;
  fetchImpl: typeof fetch;
}): Promise<AttemptResult> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), input.config.timeoutMs);
  const form = new URLSearchParams({
    secret: input.config.secretKey,
    response: input.token,
    idempotency_key: input.idempotencyKey,
    ...(input.remoteIp ? { remoteip: input.remoteIp } : {})
  });

  try {
    const response = await input.fetchImpl(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "accept": "application/json"
      },
      body: form.toString()
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      return response.status === 408 || response.status === 429 || response.status >= 500
        ? { kind: "temporary-failure" }
        : { kind: "rejected-http" };
    }
    return { kind: "response", payload: await readJsonResponse(response) };
  } catch {
    return { kind: "temporary-failure" };
  } finally {
    clearTimeout(deadline);
  }
}

function validateConfig(config: TurnstileRuntimeConfig): TurnstileRuntimeConfig {
  if (config.secretKey.length < 20 || config.secretKey.length > 256) {
    throw new Error("TURNSTILE_SECRET_KEY is invalid");
  }
  const hostname = config.expectedHostname.trim().toLowerCase();
  if (
    hostname.length < 1
    || hostname.length > 253
    || hostname.includes("://")
    || hostname.includes("/")
    || !/^[a-z0-9.-]+$/.test(hostname)
  ) {
    throw new Error("TURNSTILE_EXPECTED_HOSTNAME is invalid");
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(config.expectedAction)) {
    throw new Error("TURNSTILE_EXPECTED_ACTION is invalid");
  }
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > 10_000) {
    throw new Error("Turnstile timeout must be an integer from 1 to 10000");
  }
  return {
    secretKey: config.secretKey,
    expectedHostname: hostname,
    expectedAction: config.expectedAction,
    timeoutMs: config.timeoutMs
  };
}

function rejected(
  code: Exclude<TurnstileVerificationResult, { valid: true }>["code"],
  retryable: boolean
): TurnstileVerificationResult {
  return { valid: false, code, retryable };
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > MAX_RESPONSE_BYTES) {
    throw new Error("Turnstile response is too large");
  }
  if (!response.body) return JSON.parse(await response.text());

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Turnstile response is too large");
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(combined));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
