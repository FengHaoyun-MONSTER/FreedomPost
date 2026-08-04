import { createHash, createHmac, randomUUID } from "node:crypto";
import { WEBMASTER_BENEFIT_POLICY } from "./policy.js";

export const OPUS8_WEBMASTER_BENEFIT_PATH =
  "/api/integrations/freedompost/benefits/webmaster/claim";
export const OPUS8_WEBMASTER_BENEFIT_CAMPAIGN_ID = "webmaster-benefit-v1";

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const WEBMASTER_TRAFFIC_BYTES = WEBMASTER_BENEFIT_POLICY.trafficBytes;
const WEBMASTER_DURATION_DAYS = WEBMASTER_BENEFIT_POLICY.durationDays;
const WEBMASTER_IP_LIMIT = WEBMASTER_BENEFIT_POLICY.ipLimit;

export type Opus8Outcome = "known" | "unknown";

export interface Opus8IntegrationRuntimeConfig {
  baseUrl: string;
  keyId: string;
  secret: string;
  timeoutMs: number;
}

export interface Opus8IntegrationClientConfig {
  baseUrl: string;
  keyId: string;
  secret: string;
  timeoutMs?: number;
  now?: () => number;
  requestId?: () => string;
  fetchImpl?: typeof fetch;
}

export interface Opus8WebmasterBenefitInput {
  externalClaimId: string;
  campaignId: typeof OPUS8_WEBMASTER_BENEFIT_CAMPAIGN_ID;
}

export interface Opus8WebmasterBenefitResult {
  externalClaimId: string;
  opusUserId: string;
  opusDeviceId: string;
  subscriptionUrl: string;
  expiresAt: string;
  trafficBytes: typeof WEBMASTER_TRAFFIC_BYTES;
  durationDays: typeof WEBMASTER_DURATION_DAYS;
  hwidRequired: true;
  ipLimit: typeof WEBMASTER_IP_LIMIT;
  created: boolean;
}

export interface Opus8IntegrationClient {
  claimWebmasterBenefit(
    input: Opus8WebmasterBenefitInput
  ): Promise<Opus8WebmasterBenefitResult>;
}

interface IntegrationEnvironment {
  OPUS8_INTEGRATION_BASE_URL?: string;
  OPUS8_INTEGRATION_KEY_ID?: string;
  OPUS8_INTEGRATION_SECRET?: string;
  OPUS8_INTEGRATION_TIMEOUT_MS?: string;
}

interface Opus8IntegrationErrorOptions {
  code: string;
  retryable: boolean;
  outcome: Opus8Outcome;
  status?: number;
}

export class Opus8IntegrationError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly outcome: Opus8Outcome;
  readonly status: number | undefined;

  constructor(message: string, options: Opus8IntegrationErrorOptions) {
    super(message);
    this.name = "Opus8IntegrationError";
    this.code = options.code;
    this.retryable = options.retryable;
    this.outcome = options.outcome;
    this.status = options.status;
  }
}

export function loadOpus8IntegrationConfig(
  environment: IntegrationEnvironment = process.env
): Opus8IntegrationRuntimeConfig {
  const timeoutText = environment.OPUS8_INTEGRATION_TIMEOUT_MS;
  const timeoutMs = timeoutText === undefined || timeoutText === ""
    ? DEFAULT_TIMEOUT_MS
    : Number(timeoutText);

  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new Error("OPUS8_INTEGRATION_TIMEOUT_MS must be an integer from 100 to 30000");
  }

  return validateConfig({
    baseUrl: environment.OPUS8_INTEGRATION_BASE_URL ?? "",
    keyId: environment.OPUS8_INTEGRATION_KEY_ID ?? "",
    secret: environment.OPUS8_INTEGRATION_SECRET ?? "",
    timeoutMs
  });
}

export function createOpus8IntegrationClient(
  config: Opus8IntegrationClientConfig
): Opus8IntegrationClient {
  const validated = validateConfig({
    baseUrl: config.baseUrl,
    keyId: config.keyId,
    secret: config.secret,
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  });
  const now = config.now ?? Date.now;
  const generateRequestId = config.requestId ?? randomUUID;
  const fetchImpl = config.fetchImpl ?? fetch;

  return {
    async claimWebmasterBenefit(input) {
      validateClaimInput(input);
      const timestamp = now();
      if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
        throw new Error("Opus8 integration clock returned an invalid timestamp");
      }

      const requestId = generateRequestId();
      if (!/^[A-Za-z0-9._:-]{16,128}$/.test(requestId)) {
        throw new Error("Opus8 integration request ID is invalid");
      }

      const rawBody = JSON.stringify({
        externalClaimId: input.externalClaimId,
        campaignId: input.campaignId
      });
      const bodyHash = createHash("sha256").update(rawBody, "utf8").digest("hex");
      const signatureMessage = [
        "opus8-integration-v1",
        String(timestamp),
        requestId,
        "POST",
        OPUS8_WEBMASTER_BENEFIT_PATH,
        bodyHash
      ].join("\n");
      const signature = createHmac("sha256", validated.secret)
        .update(signatureMessage, "utf8")
        .digest("hex");
      const controller = new AbortController();
      let deadlineReached = false;
      const deadline = setTimeout(() => {
        deadlineReached = true;
        controller.abort();
      }, validated.timeoutMs);

      let response: Response | undefined;
      try {
        response = await fetchImpl(
          `${validated.baseUrl}${OPUS8_WEBMASTER_BENEFIT_PATH}`,
          {
            method: "POST",
            redirect: "error",
            signal: controller.signal,
            headers: {
              "content-type": "application/json",
              "accept": "application/json",
              "x-opus8-integration-key-id": validated.keyId,
              "x-opus8-integration-timestamp": String(timestamp),
              "x-opus8-integration-request-id": requestId,
              "x-opus8-integration-signature": signature
            },
            body: rawBody
          }
        );

        if (!response.ok) {
          void response.body?.cancel().catch(() => undefined);
          throw normalizeHttpError(response.status);
        }

        const payload = await readJsonResponse(response);
        return validateSuccessPayload(payload, input.externalClaimId);
      } catch (error) {
        if (error instanceof Opus8IntegrationError) throw error;
        if (deadlineReached || controller.signal.aborted) {
          throw integrationError(
            "Opus8 request timed out",
            "opus8_timeout",
            true,
            "unknown"
          );
        }
        if (!response) {
          throw integrationError(
            "Opus8 network request failed",
            "opus8_network_error",
            true,
            "unknown"
          );
        }
        throw integrationError(
          "Opus8 returned an invalid success response",
          "opus8_invalid_response",
          true,
          "unknown"
        );
      } finally {
        clearTimeout(deadline);
      }
    }
  };
}

function validateConfig(
  config: Opus8IntegrationRuntimeConfig
): Opus8IntegrationRuntimeConfig {
  let url: URL;
  try {
    url = new URL(config.baseUrl);
  } catch {
    throw new Error("OPUS8_INTEGRATION_BASE_URL must be a valid absolute URL");
  }

  if (url.protocol !== "https:") {
    throw new Error("OPUS8_INTEGRATION_BASE_URL must use HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("OPUS8_INTEGRATION_BASE_URL must not contain credentials");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("OPUS8_INTEGRATION_BASE_URL must contain only an origin");
  }
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(config.keyId)) {
    throw new Error("OPUS8_INTEGRATION_KEY_ID contains an invalid key ID");
  }
  if (config.secret.length < 32 || config.secret.length > 4_096) {
    throw new Error("OPUS8_INTEGRATION_SECRET must contain a 32 to 4096 character secret");
  }
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > 30_000) {
    throw new Error("Opus8 integration timeout must be an integer from 1 to 30000");
  }

  return {
    baseUrl: url.origin,
    keyId: config.keyId,
    secret: config.secret,
    timeoutMs: config.timeoutMs
  };
}

function validateClaimInput(input: Opus8WebmasterBenefitInput): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.externalClaimId)) {
    throw new Error("Invalid external benefit claim ID");
  }
  if (input.campaignId !== OPUS8_WEBMASTER_BENEFIT_CAMPAIGN_ID) {
    throw new Error("Invalid webmaster benefit campaign ID");
  }
}

function normalizeHttpError(status: number): Opus8IntegrationError {
  if (status === 400 || status === 413 || status === 422) {
    return integrationError("Opus8 rejected the claim contract", "opus8_contract_rejected", false, "known", status);
  }
  if (status === 401) {
    return integrationError("Opus8 integration authentication failed", "opus8_authentication_failed", false, "known", status);
  }
  if (status === 403) {
    return integrationError("Opus8 integration authorization failed", "opus8_authorization_failed", false, "known", status);
  }
  if (status === 404 || status === 405) {
    return integrationError("Opus8 integration endpoint was not found", "opus8_endpoint_not_found", false, "known", status);
  }
  if (status === 409) {
    return integrationError("Opus8 reported an idempotency conflict", "opus8_idempotency_conflict", false, "known", status);
  }
  if (status === 408) {
    return integrationError("Opus8 request timed out upstream", "opus8_timeout", true, "unknown", status);
  }
  if (status === 429) {
    return integrationError("Opus8 rate limited the request", "opus8_rate_limited", true, "known", status);
  }
  if (status >= 500) {
    return integrationError("Opus8 is temporarily unavailable", "opus8_temporarily_unavailable", true, "unknown", status);
  }
  return integrationError("Opus8 returned an unexpected status", "opus8_unexpected_status", false, "known", status);
}

function integrationError(
  message: string,
  code: string,
  retryable: boolean,
  outcome: Opus8Outcome,
  status?: number
): Opus8IntegrationError {
  return new Opus8IntegrationError(message, {
    code,
    retryable,
    outcome,
    ...(status === undefined ? {} : { status })
  });
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > MAX_RESPONSE_BYTES) {
    throw new Error("Opus8 response is too large");
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
      throw new Error("Opus8 response is too large");
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

function validateSuccessPayload(
  payload: unknown,
  expectedExternalClaimId: string
): Opus8WebmasterBenefitResult {
  if (!isRecord(payload)) throw new Error("Invalid Opus8 response object");
  if (payload.externalClaimId !== expectedExternalClaimId) throw new Error("Mismatched external claim ID");
  if (!validIdentifier(payload.opusUserId) || !validIdentifier(payload.opusDeviceId)) {
    throw new Error("Invalid Opus8 resource identifiers");
  }
  if (!validHttpsUrl(payload.subscriptionUrl)) throw new Error("Invalid Opus8 subscription URL");
  if (typeof payload.expiresAt !== "string" || !Number.isFinite(Date.parse(payload.expiresAt))) {
    throw new Error("Invalid Opus8 expiry");
  }
  if (
    payload.trafficBytes !== WEBMASTER_TRAFFIC_BYTES
    || payload.durationDays !== WEBMASTER_DURATION_DAYS
    || payload.hwidRequired !== true
    || payload.ipLimit !== WEBMASTER_IP_LIMIT
    || typeof payload.created !== "boolean"
  ) {
    throw new Error("Opus8 benefit policy mismatch");
  }

  return {
    externalClaimId: payload.externalClaimId,
    opusUserId: payload.opusUserId,
    opusDeviceId: payload.opusDeviceId,
    subscriptionUrl: payload.subscriptionUrl,
    expiresAt: payload.expiresAt,
    trafficBytes: WEBMASTER_TRAFFIC_BYTES,
    durationDays: WEBMASTER_DURATION_DAYS,
    hwidRequired: true,
    ipLimit: WEBMASTER_IP_LIMIT,
    created: payload.created
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function validHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}
