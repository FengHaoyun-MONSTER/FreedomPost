import { describe, expect, it } from "vitest";
import {
  legacyPortalRedirects,
  portalActivePath,
  portalMobileActivePath,
  portalMobileNavItems,
  portalNavItems,
  portalSitemapPaths
} from "./portal-routes.js";

describe("portal routes", () => {
  it("defines the lifetime earnings tagline for the earn navigation entry", () => {
    expect(portalNavItems.find((item) => item.id === "earn")).toMatchObject({
      href: "/earn/",
      label: "分享赚钱",
      tagline: "一次分享终身收益"
    });
  });

  it("defines the focused five-item mobile navigation", () => {
    expect(portalMobileNavItems).toEqual([
      { id: "home", href: "/", label: "首页", icon: "house" },
      { id: "articles", href: "/articles/", label: "干货", icon: "book-open" },
      { id: "market", href: "/market/", label: "商城", icon: "shopping-bag" },
      { id: "earn", href: "/earn/", label: "赚钱", icon: "share-2" },
      { id: "account", href: "/account/", label: "我的", icon: "user-round" }
    ]);
  });

  it("replaces the topics navigation entry with webmaster benefit", () => {
    expect(portalNavItems).toContainEqual({
      id: "benefit",
      href: "/benefit/",
      label: "站长福利"
    });
    const navigation: ReadonlyArray<{ id: string; href: string }> = portalNavItems;
    expect(navigation.some((item) => item.id === "topics" || item.href === "/topics/")).toBe(false);
  });

  it("keeps the historical topics route as a permanent compatibility redirect", () => {
    expect(legacyPortalRedirects["/topics/"]).toEqual({
      status: 301,
      destination: "/benefit/"
    });
    expect(portalActivePath("/topics/")).toBe("/benefit/");
    expect(portalActivePath("/topics")).toBe("/benefit/");
  });

  it("maps article permalinks back to the articles navigation entry", () => {
    expect(portalActivePath("/p/a-post-slug")).toBe("/articles/");
  });

  it("groups secondary service routes under the mobile account navigation", () => {
    for (const path of ["/tools/", "/benefit/", "/guide/", "/about/"]) {
      expect(portalMobileActivePath(path)).toBe("/account/");
    }
    expect(portalMobileActivePath("/market/")).toBe("/market/");
  });

  it("publishes only the canonical benefit route in the sitemap", () => {
    expect(portalSitemapPaths).toContain("/benefit/");
    expect(portalSitemapPaths).not.toContain("/topics/");
    expect(new Set(portalSitemapPaths).size).toBe(portalSitemapPaths.length);
  });
});
