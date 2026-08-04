import {
  createCipheriv,
  createDecipheriv,
  randomBytes as nodeRandomBytes
} from "node:crypto";

interface SubscriptionLinkCipherEnvironment {
  BENEFIT_LINK_ENCRYPTION_KEY?: string;
}

export interface SubscriptionLinkCipherConfig {
  encodedKey: string;
}

export interface SubscriptionLinkCipherFactoryConfig extends SubscriptionLinkCipherConfig {
  randomBytes?: (size: number) => Buffer;
}

export interface SubscriptionCipherContext {
  campaignId: string;
  claimId: string;
}

export interface SubscriptionLinkCipher {
  encrypt(subscriptionUrl: string, context: SubscriptionCipherContext): string;
  decrypt(encrypted: string, context: SubscriptionCipherContext): string;
}

export function loadSubscriptionLinkCipherConfig(
  environment: SubscriptionLinkCipherEnvironment = process.env
): SubscriptionLinkCipherConfig {
  return validateConfig({ encodedKey: environment.BENEFIT_LINK_ENCRYPTION_KEY ?? "" });
}

export function createSubscriptionLinkCipher(
  config: SubscriptionLinkCipherFactoryConfig
): SubscriptionLinkCipher {
  const validated = validateConfig(config);
  const key = Buffer.from(validated.encodedKey, "base64url");
  const createRandomBytes = config.randomBytes ?? nodeRandomBytes;

  return {
    encrypt(subscriptionUrl, context) {
      validateSubscriptionUrl(subscriptionUrl);
      const aad = contextAad(context);
      const iv = createRandomBytes(12);
      if (iv.length !== 12) throw new Error("Subscription cipher IV source is invalid");
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(aad);
      const ciphertext = Buffer.concat([
        cipher.update(subscriptionUrl, "utf8"),
        cipher.final()
      ]);
      const tag = cipher.getAuthTag();
      return [
        "v1",
        iv.toString("base64url"),
        ciphertext.toString("base64url"),
        tag.toString("base64url")
      ].join(".");
    },

    decrypt(encrypted, context) {
      try {
        if (encrypted.length > 4_096) throw new Error("Encrypted subscription is too large");
        const [version, ivText, ciphertextText, tagText, extra] = encrypted.split(".");
        if (version !== "v1" || !ivText || !ciphertextText || !tagText || extra !== undefined) {
          throw new Error("Encrypted subscription format is invalid");
        }
        const iv = Buffer.from(ivText, "base64url");
        const ciphertext = Buffer.from(ciphertextText, "base64url");
        const tag = Buffer.from(tagText, "base64url");
        if (iv.length !== 12 || tag.length !== 16 || ciphertext.length < 1) {
          throw new Error("Encrypted subscription components are invalid");
        }
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAAD(contextAad(context));
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([
          decipher.update(ciphertext),
          decipher.final()
        ]).toString("utf8");
        validateSubscriptionUrl(plaintext);
        return plaintext;
      } catch {
        throw new Error("Subscription link decrypt failed");
      }
    }
  };
}

function validateConfig(config: SubscriptionLinkCipherConfig): SubscriptionLinkCipherConfig {
  if (!/^[A-Za-z0-9_-]{43}$/.test(config.encodedKey)) {
    throw new Error("BENEFIT_LINK_ENCRYPTION_KEY must be a base64url-encoded 256-bit key");
  }
  const key = Buffer.from(config.encodedKey, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== config.encodedKey) {
    throw new Error("BENEFIT_LINK_ENCRYPTION_KEY must be a base64url-encoded 256-bit key");
  }
  return { encodedKey: config.encodedKey };
}

function contextAad(context: SubscriptionCipherContext): Buffer {
  if (
    context.campaignId !== "webmaster-benefit-v1"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(context.claimId)
  ) {
    throw new Error("Subscription cipher context is invalid");
  }
  return Buffer.from(`benefit-subscription-v1\n${context.campaignId}\n${context.claimId}`, "utf8");
}

function validateSubscriptionUrl(value: string): void {
  if (value.length < 1 || value.length > 2_048) throw new Error("Subscription URL is invalid");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Subscription URL must use HTTPS without credentials");
  }
}
