import { describe, expect, it } from "vitest";
import {
  articlePermalinkPath,
  articleReaderPath,
  isCanonicalArticleSlug,
  normalizeReferral,
  readArticleSlugFromPath
} from "./article-links.js";

describe("article link helpers", () => {
  it("builds a short permalink with a validated referral", () => {
    expect(articlePermalinkPath("Ab3dE6gH8_", "wechat_01")).toBe("/p/Ab3dE6gH8_?ref=wechat_01");
    expect(articleReaderPath("Ab3dE6gH8_", "wechat_01")).toBe("/reader/?post=Ab3dE6gH8_&ref=wechat_01");
    expect(articleReaderPath("Ab3dE6gH8_", "wechat_01", { embedded: true })).toBe(
      "/reader/?post=Ab3dE6gH8_&ref=wechat_01&embed=portal"
    );
  });

  it("marks an embedded article index even when no post was selected", () => {
    expect(articleReaderPath(null, "wechat_01", { embedded: true })).toBe("/reader/?ref=wechat_01&embed=portal");
  });

  it("does not propagate an invalid referral", () => {
    expect(articlePermalinkPath("Ab3dE6gH8_", "bad value")).toBe("/p/Ab3dE6gH8_");
    expect(articleReaderPath("Ab3dE6gH8_", "bad value")).toBe("/reader/?post=Ab3dE6gH8_");
  });

  it("decodes legacy Unicode slugs without accepting them as canonical IDs", () => {
    expect(readArticleSlugFromPath("/p/%E6%9C%AA%E5%91%BD%E5%90%8D%E6%96%87%E7%AB%A0-old")).toBe("未命名文章-old");
    expect(isCanonicalArticleSlug("未命名文章-old")).toBe(false);
    expect(isCanonicalArticleSlug("Ab3dE6gH8_")).toBe(true);
    expect(isCanonicalArticleSlug("welcome")).toBe(true);
  });

  it("uses the existing affiliate identifier validation", () => {
    expect(normalizeReferral(" wechat_01 ")).toBe("wechat_01");
    expect(normalizeReferral("1invalid")).toBeNull();
  });
});
