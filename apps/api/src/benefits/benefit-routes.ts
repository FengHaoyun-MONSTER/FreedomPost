import type { FastifyInstance, FastifyReply } from "fastify";
import type { ContentRepository, StoredBenefitClaim } from "../repositories/types.js";
import {
  BENEFIT_CLAIM_COOKIE_NAME,
  type BenefitClaimCredentialService
} from "./claim-cookie.js";
import type { BenefitRateLimiter } from "./rate-limit.js";
import {
  Opus8IntegrationError,
  type Opus8IntegrationClient
} from "./opus8-client.js";
import { WEBMASTER_BENEFIT_POLICY } from "./policy.js";
import type { SubscriptionLinkCipher } from "./subscription-cipher.js";
import type { TurnstileVerifier } from "./turnstile.js";

export interface WebmasterBenefitRouteDependencies {
  credentialService: BenefitClaimCredentialService;
  turnstileVerifier: TurnstileVerifier;
  rateLimiter: BenefitRateLimiter;
  opus8Client: Opus8IntegrationClient;
  subscriptionCipher: SubscriptionLinkCipher;
  turnstileSiteKey: string;
  networkDailyLimit: number;
  claimMinuteLimit: number;
  secureCookies: boolean;
  now?: () => number;
}

interface RegisterBenefitRoutesOptions {
  repository: ContentRepository;
  dependencies: WebmasterBenefitRouteDependencies | null;
}

export function registerWebmasterBenefitRoutes(
  app: FastifyInstance,
  options: RegisterBenefitRoutesOptions
): void {
  const { repository, dependencies } = options;

  app.addHook("onSend", async (request, reply, payload) => {
    if (request.url.startsWith("/api/benefits/webmaster")) noStore(reply);
    return payload;
  });

  app.get("/api/benefits/webmaster", async (request, reply) => {
    noStore(reply);
    const campaign = await repository.getBenefitCampaign(WEBMASTER_BENEFIT_POLICY.campaignId);
    const enabled = dependencies !== null && campaignIsActive(campaign, dependencies.now?.() ?? Date.now());
    if (dependencies && !dependencies.credentialService.verify(request.cookies[BENEFIT_CLAIM_COOKIE_NAME])) {
      const issued = dependencies.credentialService.issue();
      reply.setCookie(
        BENEFIT_CLAIM_COOKIE_NAME,
        issued.cookieValue,
        dependencies.credentialService.cookieOptions(dependencies.secureCookies)
      );
    }
    return {
      id: WEBMASTER_BENEFIT_POLICY.campaignId,
      enabled,
      trafficBytes: WEBMASTER_BENEFIT_POLICY.trafficBytes,
      durationDays: WEBMASTER_BENEFIT_POLICY.durationDays,
      hwidRequired: WEBMASTER_BENEFIT_POLICY.hwidRequired,
      ipLimit: WEBMASTER_BENEFIT_POLICY.ipLimit,
      turnstileSiteKey: dependencies?.turnstileSiteKey ?? null
    };
  });

  app.post<{ Body: unknown }>(
    "/api/benefits/webmaster/claim",
    { bodyLimit: 4_096 },
    async (request, reply) => {
      noStore(reply);
      if (!dependencies) return publicError(reply, 503, "BENEFIT_UNAVAILABLE");
      const now = dependencies.now?.() ?? Date.now();
      const campaign = await repository.getBenefitCampaign(WEBMASTER_BENEFIT_POLICY.campaignId);
      if (!campaignIsActive(campaign, now)) {
        return publicError(reply, 403, "BENEFIT_DISABLED");
      }

      const body = strictClaimBody(request.body);
      if (!body) return publicError(reply, 400, "INVALID_REQUEST");
      const credential = dependencies.credentialService.verify(
        request.cookies[BENEFIT_CLAIM_COOKIE_NAME]
      );
      if (!credential) return publicError(reply, 403, "CLAIM_CREDENTIAL_REQUIRED");

      let claim = await repository.getBenefitClaimByBrowserKey(
        WEBMASTER_BENEFIT_POLICY.campaignId,
        credential.browserKeyHash
      );
      if (claim?.status === "ready") {
        return sendReady(reply, 200, claim, dependencies);
      }
      if (claim?.status === "revoked" || claim?.status === "expired") {
        return publicError(reply, 410, "BENEFIT_CLAIM_UNAVAILABLE");
      }

      const networkKeyHash = dependencies.credentialService.hashNetworkKey(request.ip);
      const rateLimit = await dependencies.rateLimiter.consume(
        "claim-minute",
        networkKeyHash,
        dependencies.claimMinuteLimit,
        60_000
      );
      if (!rateLimit.allowed) {
        reply.header("retry-after", String(Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000))));
        return publicError(reply, 429, "RATE_LIMITED");
      }

      const turnstile = await dependencies.turnstileVerifier.verify(body.turnstileToken, request.ip);
      if (!turnstile.valid) {
        return publicError(
          reply,
          turnstile.retryable ? 503 : 403,
          turnstile.retryable ? "TURNSTILE_UNAVAILABLE" : "TURNSTILE_REJECTED"
        );
      }

      let createdLocally = false;
      if (!claim) {
        const since = new Date(now - 24 * 60 * 60 * 1000).toISOString();
        const recentClaims = await repository.countBenefitClaimsByNetworkSince(
          WEBMASTER_BENEFIT_POLICY.campaignId,
          networkKeyHash,
          since
        );
        if (recentClaims >= dependencies.networkDailyLimit) {
          return publicError(reply, 429, "NETWORK_DAILY_LIMIT");
        }
        const created = await repository.createBenefitClaim({
          campaignId: WEBMASTER_BENEFIT_POLICY.campaignId,
          externalClaimId: crypto.randomUUID(),
          browserKeyHash: credential.browserKeyHash,
          networkKeyHash
        });
        claim = created.claim;
        createdLocally = created.created;
      }

      if (claim.status === "provisioning") {
        const recovered = await repository.recoverStaleBenefitProvisioning(
          claim.id,
          new Date(now - 30_000).toISOString()
        );
        if (!recovered) return sendProvisioning(reply);
        claim = recovered;
      }
      const provisioning = await repository.beginBenefitProvisioning(claim.id);
      if (!provisioning) {
        const current = await repository.getBenefitClaimById(claim.id);
        if (current?.status === "ready") return sendReady(reply, 200, current, dependencies);
        if (current?.status === "provisioning") return sendProvisioning(reply);
        return publicError(reply, 409, "CLAIM_STATE_CONFLICT");
      }

      try {
        const upstream = await dependencies.opus8Client.claimWebmasterBenefit({
          externalClaimId: provisioning.externalClaimId,
          campaignId: WEBMASTER_BENEFIT_POLICY.campaignId
        });
        const encryptedUrl = dependencies.subscriptionCipher.encrypt(upstream.subscriptionUrl, {
          campaignId: provisioning.campaignId,
          claimId: provisioning.id
        });
        const completed = await repository.completeBenefitClaim(provisioning.id, {
          opusUserId: upstream.opusUserId,
          opusDeviceId: upstream.opusDeviceId,
          subscriptionUrlEnc: encryptedUrl,
          expiresAt: upstream.expiresAt
        });
        if (!completed) return publicError(reply, 409, "CLAIM_STATE_CONFLICT");
        return sendReady(reply, createdLocally ? 201 : 200, completed, dependencies);
      } catch (error) {
        const errorCode = error instanceof Opus8IntegrationError && /^[a-z0-9_]{1,64}$/.test(error.code)
          ? error.code
          : "benefit_provisioning_failed";
        await repository.failBenefitClaim(provisioning.id, errorCode).catch(() => null);
        request.log.warn({ errorCode }, "Webmaster benefit provisioning failed");
        return publicError(reply, 503, "BENEFIT_PROVISIONING_UNAVAILABLE");
      }
    }
  );

  app.get("/api/benefits/webmaster/claim", async (request, reply) => {
    noStore(reply);
    if (!dependencies) return publicError(reply, 503, "BENEFIT_UNAVAILABLE");
    const credential = dependencies.credentialService.verify(
      request.cookies[BENEFIT_CLAIM_COOKIE_NAME]
    );
    if (!credential) return publicError(reply, 404, "BENEFIT_CLAIM_NOT_FOUND");
    const claim = await repository.getBenefitClaimByBrowserKey(
      WEBMASTER_BENEFIT_POLICY.campaignId,
      credential.browserKeyHash
    );
    if (!claim) return publicError(reply, 404, "BENEFIT_CLAIM_NOT_FOUND");
    if (claim.status === "ready") return sendReady(reply, 200, claim, dependencies);
    if (claim.status === "revoked" || claim.status === "expired") {
      return publicError(reply, 410, "BENEFIT_CLAIM_UNAVAILABLE");
    }
    return sendProvisioning(reply);
  });
}

function sendReady(
  reply: FastifyReply,
  statusCode: 200 | 201,
  claim: StoredBenefitClaim,
  dependencies: WebmasterBenefitRouteDependencies
) {
  if (!claim.subscriptionUrlEnc || !claim.expiresAt) {
    return publicError(reply, 503, "BENEFIT_RESTORE_UNAVAILABLE");
  }
  const now = dependencies.now?.() ?? Date.now();
  if (Date.parse(claim.expiresAt) <= now) {
    return publicError(reply, 410, "BENEFIT_CLAIM_UNAVAILABLE");
  }
  try {
    const decryptedUrl = dependencies.subscriptionCipher.decrypt(claim.subscriptionUrlEnc, {
      campaignId: claim.campaignId,
      claimId: claim.id
    });
    return reply.code(statusCode).send({
      status: "ready",
      subscriptionUrl: decryptedUrl,
      expiresAt: claim.expiresAt,
      trafficBytes: WEBMASTER_BENEFIT_POLICY.trafficBytes,
      durationDays: WEBMASTER_BENEFIT_POLICY.durationDays,
      hwidRequired: WEBMASTER_BENEFIT_POLICY.hwidRequired,
      ipLimit: WEBMASTER_BENEFIT_POLICY.ipLimit
    });
  } catch {
    return publicError(reply, 503, "BENEFIT_RESTORE_UNAVAILABLE");
  }
}

function sendProvisioning(reply: FastifyReply) {
  reply.header("retry-after", "3");
  return reply.code(202).send({ status: "provisioning", retryAfterSeconds: 3 });
}

function strictClaimBody(value: unknown): { turnstileToken: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).length !== 1
    || typeof body.turnstileToken !== "string"
    || body.turnstileToken.length < 1
    || body.turnstileToken.length > 2_048
  ) {
    return null;
  }
  return { turnstileToken: body.turnstileToken };
}

function campaignIsActive(
  campaign: Awaited<ReturnType<ContentRepository["getBenefitCampaign"]>>,
  now: number
): boolean {
  if (!campaign?.enabled || !Number.isSafeInteger(now)) return false;
  if (campaign.startsAt && Date.parse(campaign.startsAt) > now) return false;
  if (campaign.endsAt && Date.parse(campaign.endsAt) <= now) return false;
  return true;
}

function noStore(reply: FastifyReply): void {
  reply.header("cache-control", "no-store");
  reply.header("pragma", "no-cache");
  reply.header("x-content-type-options", "nosniff");
  reply.header("referrer-policy", "no-referrer");
}

function publicError(reply: FastifyReply, statusCode: number, code: string) {
  return reply.code(statusCode).send({ error: { code, message: "Request could not be completed" } });
}
