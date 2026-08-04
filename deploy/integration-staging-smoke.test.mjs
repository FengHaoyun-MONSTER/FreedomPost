import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildIntegrationProbeRequest,
  runIntegrationStagingSmoke
} from "./integration-staging-smoke.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const config = {
  baseUrl: "https://api.example.com",
  keyId: "freedompost-staging",
  secret: "s".repeat(32)
};

test("builds the canonical Opus8 integration signature", () => {
  const request = buildIntegrationProbeRequest(config, {
    now: 1_785_000_000_000,
    requestId: "staging-probe-1234567890",
    externalClaimId: "018f47a7-9c41-4f35-8d9a-70b51d7857f9"
  });
  const bodyHash = createHash("sha256").update(request.body).digest("hex");
  const expected = createHmac("sha256", config.secret).update([
    "opus8-integration-v1",
    "1785000000000",
    "staging-probe-1234567890",
    "POST",
    "/api/integrations/freedompost/benefits/webmaster/claim",
    bodyHash
  ].join("\n")).digest("hex");
  assert.equal(request.headers["x-opus8-integration-signature"], expected);
  assert.match(request.body, /"campaignId":"staging-contract-probe-v1"/);
});

test("requires a rejected tampered request followed by an authenticated contract rejection", async () => {
  const observed = [];
  const result = await runIntegrationStagingSmoke(config, {
    now: () => 1_785_000_000_000,
    requestId: (() => {
      let index = 0;
      return () => `staging-probe-${String(++index).padStart(16, "0")}`;
    })(),
    externalClaimId: () => "018f47a7-9c41-4f35-8d9a-70b51d7857f9",
    fetchImpl: async (_url, init) => {
      observed.push(init.headers["x-opus8-integration-signature"]);
      return new Response(
        JSON.stringify({ error: observed.length === 1 ? "Unauthorized" : "Invalid benefit claim contract" }),
        { status: observed.length === 1 ? 401 : 400, headers: { "content-type": "application/json" } }
      );
    }
  });
  assert.deepEqual(result, { negativeStatus: 401, authenticatedStatus: 400 });
  assert.equal(observed[0], "0".repeat(64));
  assert.notEqual(observed[1], observed[0]);
});

test("fails when the shared credential is rejected and does not expose it", async () => {
  await assert.rejects(
    () => runIntegrationStagingSmoke(config, {
      fetchImpl: async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
    }),
    (error) => {
      assert.doesNotMatch(String(error), new RegExp(config.secret));
      return /authenticated probe expected HTTP 400/i.test(String(error));
    }
  );
});

test("manual campaign workflow is isolated, pinned, and fail closed", () => {
  const workflow = readFileSync(
    `${repositoryRoot}.github/workflows/benefit-campaign.yml`,
    "utf8"
  );
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\bpush:/);
  assert.match(workflow, /options:\s*\n\s*- enable\s*\n\s*- disable/);
  assert.match(workflow, /UPDATE benefit_campaigns/);
  assert.match(workflow, /--resolve "\$PREVIEW_DOMAIN:443:127\.0\.0\.1"/);
  for (const action of workflow.matchAll(/^\s*uses:\s*([^\s]+)$/gm)) {
    assert.match(action[1], /@[0-9a-f]{40}$/i);
  }
});
