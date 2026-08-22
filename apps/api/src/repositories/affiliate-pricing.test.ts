import { describe, expect, it } from "vitest";
import { buildAffiliateProductView } from "./affiliate-pricing.js";
import type { StoredProduct } from "./types.js";

describe("buildAffiliateProductView", () => {
  it("preserves the configured commission when markup is zero", () => {
    expect(buildAffiliateProductView(product({ commissionCents: 1000 }), 0)).toMatchObject({
      customerPriceCents: 15000,
      baseCommissionCents: 1000,
      markupCommissionCents: 0,
      commissionCents: 1000
    });
  });

  it("adds configured commission and markup earnings", () => {
    expect(buildAffiliateProductView(product({ commissionCents: 1000 }), 10)).toMatchObject({
      customerPriceCents: 16500,
      baseCommissionCents: 1000,
      markupCommissionCents: 1500,
      commissionCents: 2500
    });
  });

  it("keeps markup earnings when configured commission is zero", () => {
    expect(buildAffiliateProductView(product({ commissionCents: 0 }), 10)).toMatchObject({
      customerPriceCents: 16500,
      baseCommissionCents: 0,
      markupCommissionCents: 1500,
      commissionCents: 1500
    });
  });

  it("derives earnings from the rounded customer price", () => {
    expect(buildAffiliateProductView(product({ priceCents: 1, commissionCents: 2 }), 50)).toMatchObject({
      customerPriceCents: 2,
      baseCommissionCents: 2,
      markupCommissionCents: 1,
      commissionCents: 3
    });
  });
});

function product(overrides: Partial<StoredProduct> = {}): StoredProduct {
  return {
    id: "product-1",
    slug: "product-1",
    title: "测试商品",
    summary: "商品简介",
    description: "商品详情",
    category: "service",
    priceCents: 15000,
    commissionCents: 0,
    compareAtCents: null,
    currency: "CNY",
    stock: 10,
    soldCount: 0,
    coverUrl: null,
    status: "published",
    sortOrder: 0,
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    ...overrides
  };
}
