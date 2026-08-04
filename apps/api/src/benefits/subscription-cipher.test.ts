import { describe, expect, it } from "vitest";
import {
  createSubscriptionLinkCipher,
  loadSubscriptionLinkCipherConfig
} from "./subscription-cipher.js";

const encodedKey = Buffer.alloc(32, 7).toString("base64url");

describe("subscription link encryption", () => {
  it("encrypts with randomized authenticated encryption and binds claim context", () => {
    const cipher = createSubscriptionLinkCipher({
      encodedKey,
      randomBytes: (size) => Buffer.alloc(size, 3)
    });
    const context = { campaignId: "webmaster-benefit-v1", claimId: crypto.randomUUID() };
    const subscriptionUrl = "https://sub.example.test/sub/private-token";

    const encrypted = cipher.encrypt(subscriptionUrl, context);

    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain(subscriptionUrl);
    expect(cipher.decrypt(encrypted, context)).toBe(subscriptionUrl);
    expect(() => cipher.decrypt(encrypted, { ...context, claimId: crypto.randomUUID() })).toThrow("decrypt");
    const parts = encrypted.split(".");
    const tag = parts[3]!;
    parts[3] = `${tag[0] === "A" ? "B" : "A"}${tag.slice(1)}`;
    expect(() => cipher.decrypt(parts.join("."), context)).toThrow("decrypt");
  });

  it("requires an exact 256-bit deployment key", () => {
    expect(loadSubscriptionLinkCipherConfig({ BENEFIT_LINK_ENCRYPTION_KEY: encodedKey }))
      .toEqual({ encodedKey });
    expect(() => loadSubscriptionLinkCipherConfig({ BENEFIT_LINK_ENCRYPTION_KEY: "short" }))
      .toThrow("256-bit");
  });
});
