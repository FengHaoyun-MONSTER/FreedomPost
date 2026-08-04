import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const BENEFIT_CLAIM_COOKIE_NAME = "fp_webmaster_benefit";

const COOKIE_VERSION = "v1";
const CREDENTIAL_LIFETIME_MS = 15 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

interface BenefitClaimCredentialEnvironment {
  BENEFIT_CLAIM_HMAC_SECRET?: string;
}

export interface BenefitClaimCredentialConfig {
  secret: string;
}

export interface BenefitClaimCredentialServiceConfig extends BenefitClaimCredentialConfig {
  now?: () => number;
  token?: () => string;
}

export interface IssuedBenefitClaimCredential {
  cookieValue: string;
  browserKeyHash: string;
}

export interface VerifiedBenefitClaimCredential {
  browserKeyHash: string;
}

export interface BenefitClaimCookieOptions {
  path: string;
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  maxAge: number;
}

export interface BenefitClaimCredentialService {
  issue(): IssuedBenefitClaimCredential;
  verify(cookieValue: string | undefined): VerifiedBenefitClaimCredential | null;
  hashNetworkKey(networkKey: string): string;
  cookieOptions(secure: boolean): BenefitClaimCookieOptions;
}

export function loadBenefitClaimCredentialConfig(
  environment: BenefitClaimCredentialEnvironment = process.env
): BenefitClaimCredentialConfig {
  return validateConfig({ secret: environment.BENEFIT_CLAIM_HMAC_SECRET ?? "" });
}

export function createBenefitClaimCredentialService(
  config: BenefitClaimCredentialServiceConfig
): BenefitClaimCredentialService {
  const { secret } = validateConfig(config);
  const now = config.now ?? Date.now;
  const createToken = config.token ?? (() => randomBytes(32).toString("base64url"));

  return {
    issue() {
      const issuedAt = now();
      if (!Number.isSafeInteger(issuedAt) || issuedAt <= 0) {
        throw new Error("Benefit credential clock returned an invalid timestamp");
      }
      const token = createToken();
      if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) {
        throw new Error("Benefit credential token is invalid");
      }
      const signature = signCookie(secret, issuedAt, token);
      return {
        cookieValue: [COOKIE_VERSION, String(issuedAt), token, signature].join("."),
        browserKeyHash: hashBrowserKey(secret, token)
      };
    },

    verify(cookieValue) {
      if (!cookieValue || cookieValue.length > 512) return null;
      const parts = cookieValue.split(".");
      if (parts.length !== 4) return null;
      const [version, issuedAtText, token, signature] = parts;
      if (
        version !== COOKIE_VERSION
        || !/^\d{1,16}$/.test(issuedAtText ?? "")
        || !/^[A-Za-z0-9_-]{43,128}$/.test(token ?? "")
        || !/^[0-9a-f]{64}$/.test(signature ?? "")
      ) {
        return null;
      }

      const issuedAt = Number(issuedAtText);
      const currentTime = now();
      if (
        !Number.isSafeInteger(issuedAt)
        || !Number.isSafeInteger(currentTime)
        || issuedAt > currentTime + CLOCK_SKEW_MS
        || currentTime - issuedAt > CREDENTIAL_LIFETIME_MS
      ) {
        return null;
      }

      const expected = signCookie(secret, issuedAt, token!);
      if (!safeEqualHex(expected, signature!)) return null;
      return { browserKeyHash: hashBrowserKey(secret, token!) };
    },

    hashNetworkKey(networkKey) {
      const normalized = networkKey.trim().toLowerCase();
      if (!normalized || normalized.length > 256) {
        throw new Error("Benefit network key is invalid");
      }
      return createHmac("sha256", secret)
        .update(`benefit-network-key-v1\n${normalized}`, "utf8")
        .digest("hex");
    },

    cookieOptions(secure) {
      return {
        path: "/api/benefits/webmaster",
        httpOnly: true,
        secure,
        sameSite: "lax",
        maxAge: CREDENTIAL_LIFETIME_MS / 1000
      };
    }
  };
}

function validateConfig(config: BenefitClaimCredentialConfig): BenefitClaimCredentialConfig {
  if (config.secret.length < 32 || config.secret.length > 4_096) {
    throw new Error("BENEFIT_CLAIM_HMAC_SECRET must contain 32 to 4096 characters");
  }
  return { secret: config.secret };
}

function signCookie(secret: string, issuedAt: number, token: string): string {
  return createHmac("sha256", secret)
    .update(`benefit-claim-cookie-v1\n${issuedAt}\n${token}`, "utf8")
    .digest("hex");
}

function hashBrowserKey(secret: string, token: string): string {
  return createHmac("sha256", secret)
    .update(`benefit-browser-key-v1\n${token}`, "utf8")
    .digest("hex");
}

function safeEqualHex(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
