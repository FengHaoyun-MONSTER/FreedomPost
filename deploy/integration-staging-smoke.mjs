import { createHash, createHmac, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const INTEGRATION_PATH = "/api/integrations/freedompost/benefits/webmaster/claim";
const PROBE_CAMPAIGN_ID = "staging-contract-probe-v1";
const REQUEST_TIMEOUT_MS = 10_000;

export function buildIntegrationProbeRequest(config, options = {}) {
  const validated = validateConfig(config);
  const timestamp = options.now ?? Date.now();
  const requestId = options.requestId ?? `staging-${randomUUID()}`;
  const externalClaimId = options.externalClaimId ?? randomUUID();
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw new Error("Invalid staging probe clock");
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(requestId)) throw new Error("Invalid staging probe request ID");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(externalClaimId)) {
    throw new Error("Invalid staging probe claim ID");
  }

  const body = JSON.stringify({ externalClaimId, campaignId: PROBE_CAMPAIGN_ID });
  const bodyHash = createHash("sha256").update(body, "utf8").digest("hex");
  const signature = createHmac("sha256", validated.secret).update([
    "opus8-integration-v1",
    String(timestamp),
    requestId,
    "POST",
    INTEGRATION_PATH,
    bodyHash
  ].join("\n"), "utf8").digest("hex");
  return {
    url: `${validated.baseUrl}${INTEGRATION_PATH}`,
    body,
    headers: {
      "content-type": "application/json",
      "accept": "application/json",
      "x-opus8-integration-key-id": validated.keyId,
      "x-opus8-integration-timestamp": String(timestamp),
      "x-opus8-integration-request-id": requestId,
      "x-opus8-integration-signature": signature
    }
  };
}

export async function runIntegrationStagingSmoke(config, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const requestId = options.requestId ?? (() => `staging-${randomUUID()}`);
  const externalClaimId = options.externalClaimId ?? randomUUID;
  const negative = buildIntegrationProbeRequest(config, {
    now: now(),
    requestId: requestId(),
    externalClaimId: externalClaimId()
  });
  negative.headers["x-opus8-integration-signature"] = "0".repeat(64);
  const negativeResponse = await performRequest(fetchImpl, negative);
  if (negativeResponse.status !== 401) {
    throw new Error(`Tampered staging probe expected HTTP 401, received ${negativeResponse.status}`);
  }

  const authenticated = buildIntegrationProbeRequest(config, {
    now: now(),
    requestId: requestId(),
    externalClaimId: externalClaimId()
  });
  const authenticatedResponse = await performRequest(fetchImpl, authenticated);
  if (authenticatedResponse.status !== 400) {
    throw new Error(`Authenticated probe expected HTTP 400, received ${authenticatedResponse.status}`);
  }
  return {
    negativeStatus: negativeResponse.status,
    authenticatedStatus: authenticatedResponse.status
  };
}

async function performRequest(fetchImpl, request) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(request.url, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: request.headers,
      body: request.body
    });
    void response.body?.cancel().catch(() => undefined);
    return response;
  } catch {
    throw new Error("Opus8 staging probe network failure");
  } finally {
    clearTimeout(timeout);
  }
}

function validateConfig(config) {
  let url;
  try {
    url = new URL(String(config.baseUrl ?? ""));
  } catch {
    throw new Error("Invalid Opus8 staging origin");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Invalid Opus8 staging origin");
  }
  const keyId = String(config.keyId ?? "");
  const secret = String(config.secret ?? "");
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(keyId)) throw new Error("Invalid Opus8 staging key ID");
  if (secret.length < 32 || secret.length > 4_096 || /[\r\n]/.test(secret)) {
    throw new Error("Invalid Opus8 staging secret");
  }
  return { baseUrl: url.origin, keyId, secret };
}

async function runCli() {
  const result = await runIntegrationStagingSmoke({
    baseUrl: process.env.OPUS8_INTEGRATION_BASE_URL,
    keyId: process.env.OPUS8_INTEGRATION_KEY_ID,
    secret: process.env.OPUS8_INTEGRATION_SECRET
  });
  process.stdout.write(`OK integration-staging-smoke negative=${result.negativeStatus} authenticated=${result.authenticatedStatus}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCli().catch((error) => {
    process.stderr.write(`ERROR integration-staging-smoke: ${error instanceof Error ? error.message : "unknown failure"}\n`);
    process.exitCode = 1;
  });
}
