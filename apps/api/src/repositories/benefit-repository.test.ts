import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MemoryContentRepository } from "./memory.js";

const campaignId = "webmaster-benefit-v1";

function claimInput(overrides: Partial<{
  externalClaimId: string;
  browserKeyHash: string;
  networkKeyHash: string;
}> = {}) {
  return {
    campaignId,
    externalClaimId: crypto.randomUUID(),
    browserKeyHash: "browser-" + "a".repeat(56),
    networkKeyHash: "network-" + "b".repeat(56),
    ...overrides
  };
}

describe("benefit repository", () => {
  it("ships the webmaster campaign disabled until release activation", async () => {
    const repository = new MemoryContentRepository([]);

    await expect(repository.getBenefitCampaign(campaignId)).resolves.toMatchObject({
      id: campaignId,
      name: "站长福利",
      enabled: false
    });
  });

  it("creates one claim per campaign and browser and restores duplicates", async () => {
    const repository = new MemoryContentRepository([]);
    const input = claimInput();

    const first = await repository.createBenefitClaim(input);
    const repeatedBrowser = await repository.createBenefitClaim({
      ...claimInput({ browserKeyHash: input.browserKeyHash }),
      campaignId
    });
    const repeatedExternalId = await repository.createBenefitClaim(input);

    expect(first.created).toBe(true);
    expect(repeatedBrowser).toEqual({ claim: first.claim, created: false });
    expect(repeatedExternalId).toEqual({ claim: first.claim, created: false });
    await expect(
      repository.getBenefitClaimByBrowserKey(campaignId, input.browserKeyHash)
    ).resolves.toEqual(first.claim);
    await expect(
      repository.getBenefitClaimByExternalId(input.externalClaimId)
    ).resolves.toEqual(first.claim);
    await expect(repository.createBenefitClaim({
      ...input,
      browserKeyHash: "browser-" + "c".repeat(56)
    })).rejects.toThrow("External benefit claim ownership mismatch");
  });

  it("counts recent claims by network without storing a raw address", async () => {
    const repository = new MemoryContentRepository([]);
    const networkKeyHash = "network-" + "e".repeat(56);
    await repository.createBenefitClaim(claimInput({ networkKeyHash }));
    await repository.createBenefitClaim(claimInput({
      browserKeyHash: "browser-" + "f".repeat(56),
      networkKeyHash
    }));

    await expect(repository.countBenefitClaimsByNetworkSince(
      campaignId,
      networkKeyHash,
      new Date(Date.now() - 60_000).toISOString()
    )).resolves.toBe(2);
  });

  it("enforces pending/failed -> provisioning -> ready transitions atomically", async () => {
    const repository = new MemoryContentRepository([]);
    const created = await repository.createBenefitClaim(claimInput());

    const provisioning = await repository.beginBenefitProvisioning(created.claim.id);
    expect(provisioning).toMatchObject({ status: "provisioning", attemptCount: 1 });
    await expect(repository.beginBenefitProvisioning(created.claim.id)).resolves.toBeNull();

    const ready = await repository.completeBenefitClaim(created.claim.id, {
      opusUserId: "opus-user-1",
      opusDeviceId: "opus-device-1",
      subscriptionUrlEnc: "v1.encrypted-subscription",
      expiresAt: "2026-08-19T00:00:00.000Z"
    });
    expect(ready).toMatchObject({
      status: "ready",
      opusUserId: "opus-user-1",
      opusDeviceId: "opus-device-1",
      subscriptionUrlEnc: "v1.encrypted-subscription",
      lastErrorCode: null
    });
    await expect(
      repository.failBenefitClaim(created.claim.id, "upstream_timeout")
    ).resolves.toBeNull();
  });

  it("allows a failed provisioning attempt to retry without creating a new claim", async () => {
    const repository = new MemoryContentRepository([]);
    const created = await repository.createBenefitClaim(claimInput({
      browserKeyHash: "browser-" + "d".repeat(56)
    }));

    await repository.beginBenefitProvisioning(created.claim.id);
    const failed = await repository.failBenefitClaim(
      created.claim.id,
      "opus8_temporarily_unavailable"
    );
    expect(failed).toMatchObject({
      id: created.claim.id,
      status: "failed",
      attemptCount: 1,
      lastErrorCode: "opus8_temporarily_unavailable"
    });

    const retried = await repository.beginBenefitProvisioning(created.claim.id);
    expect(retried).toMatchObject({
      id: created.claim.id,
      status: "provisioning",
      attemptCount: 2,
      lastErrorCode: null
    });
  });

  it("atomically recovers a provisioning claim abandoned by a crashed process", async () => {
    const repository = new MemoryContentRepository([]);
    const created = await repository.createBenefitClaim(claimInput());
    await repository.beginBenefitProvisioning(created.claim.id);

    await expect(repository.recoverStaleBenefitProvisioning(
      created.claim.id,
      new Date(Date.now() - 60_000).toISOString()
    )).resolves.toBeNull();
    const recovered = await repository.recoverStaleBenefitProvisioning(
      created.claim.id,
      new Date(Date.now() + 60_000).toISOString()
    );
    expect(recovered).toMatchObject({
      status: "failed",
      lastErrorCode: "provisioning_stale",
      attemptCount: 1
    });
    await expect(repository.beginBenefitProvisioning(created.claim.id)).resolves.toMatchObject({
      status: "provisioning",
      attemptCount: 2
    });
  });

  it("defines database constraints that match the repository idempotency contract", () => {
    const migrationPath = fileURLToPath(
      new URL("../../../../deploy/migrations/0009_benefit_claims.sql", import.meta.url)
    );
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS benefit_campaigns/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS benefit_claims/i);
    expect(migration).toMatch(/external_claim_id UUID NOT NULL UNIQUE/i);
    expect(migration).toMatch(/UNIQUE \(campaign_id, browser_key_hash\)/i);
    expect(migration).toMatch(/CHECK \(status IN \('pending', 'provisioning', 'ready', 'failed', 'revoked', 'expired'\)\)/i);
  });
});
