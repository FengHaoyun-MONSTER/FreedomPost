import {
  createBenefitClaimCredentialService,
  loadBenefitClaimCredentialConfig
} from "./claim-cookie.js";
import {
  createOpus8IntegrationClient,
  loadOpus8IntegrationConfig
} from "./opus8-client.js";
import {
  createBenefitRateLimiter,
  MemoryRateLimitBackend
} from "./rate-limit.js";
import {
  createBenefitRedisConnection,
  loadBenefitRedisConfig
} from "./redis.js";
import {
  createSubscriptionLinkCipher,
  loadSubscriptionLinkCipherConfig
} from "./subscription-cipher.js";
import {
  createTurnstileVerifier,
  loadTurnstileConfig
} from "./turnstile.js";
import type { WebmasterBenefitRouteDependencies } from "./benefit-routes.js";

interface BenefitRuntimeEnvironment extends NodeJS.ProcessEnv {
  BENEFIT_CLAIM_HMAC_SECRET?: string;
  BENEFIT_LINK_ENCRYPTION_KEY?: string;
  BENEFIT_NETWORK_DAILY_LIMIT?: string;
  BENEFIT_CLAIM_MINUTE_LIMIT?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_EXPECTED_HOSTNAME?: string;
  TURNSTILE_EXPECTED_ACTION?: string;
  TURNSTILE_TIMEOUT_MS?: string;
  OPUS8_INTEGRATION_BASE_URL?: string;
  OPUS8_INTEGRATION_KEY_ID?: string;
  OPUS8_INTEGRATION_SECRET?: string;
  OPUS8_INTEGRATION_TIMEOUT_MS?: string;
  REDIS_URL?: string;
}

export interface WebmasterBenefitRuntime {
  dependencies: WebmasterBenefitRouteDependencies;
  connect(): Promise<boolean>;
  close(): Promise<void>;
}

export function createWebmasterBenefitRuntime(
  environment: BenefitRuntimeEnvironment = process.env,
  options: {
    secureCookies: boolean;
    onRedisError?: (error: Error) => void;
  }
): WebmasterBenefitRuntime | null {
  if (!environment.BENEFIT_CLAIM_HMAC_SECRET) return null;

  const credentialService = createBenefitClaimCredentialService(
    loadBenefitClaimCredentialConfig(environment)
  );
  const subscriptionCipher = createSubscriptionLinkCipher(
    loadSubscriptionLinkCipherConfig(environment)
  );
  const turnstileVerifier = createTurnstileVerifier(
    loadTurnstileConfig(environment)
  );
  const turnstileSiteKey = readTurnstileSiteKey(environment.TURNSTILE_SITE_KEY);
  const opus8Client = createOpus8IntegrationClient(
    loadOpus8IntegrationConfig(environment)
  );
  const redis = createBenefitRedisConnection(
    loadBenefitRedisConfig(environment),
    options.onRedisError
  );
  const rateLimiter = createBenefitRateLimiter({
    primary: redis.backend,
    fallback: new MemoryRateLimitBackend(),
    prefix: "freedompost:benefit"
  });
  const networkDailyLimit = readLimit(
    environment.BENEFIT_NETWORK_DAILY_LIMIT,
    3,
    1,
    50,
    "BENEFIT_NETWORK_DAILY_LIMIT"
  );
  const claimMinuteLimit = readLimit(
    environment.BENEFIT_CLAIM_MINUTE_LIMIT,
    6,
    1,
    100,
    "BENEFIT_CLAIM_MINUTE_LIMIT"
  );

  return {
    dependencies: {
      credentialService,
      subscriptionCipher,
      turnstileVerifier,
      turnstileSiteKey,
      opus8Client,
      rateLimiter,
      networkDailyLimit,
      claimMinuteLimit,
      secureCookies: options.secureCookies
    },
    connect: () => redis.connect(),
    close: () => redis.close()
  };
}

function readTurnstileSiteKey(value: string | undefined): string {
  const siteKey = value?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{10,256}$/.test(siteKey)) {
    throw new Error("TURNSTILE_SITE_KEY is invalid");
  }
  return siteKey;
}

function readLimit(
  value: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
  name: string
): number {
  const parsed = value === undefined || value === "" ? defaultValue : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}
