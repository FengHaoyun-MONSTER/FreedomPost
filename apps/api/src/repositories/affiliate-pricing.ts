import type { AffiliateProductView, StoredProduct } from "./types.js";

/**
 * Builds the server-authoritative customer price and affiliate earnings snapshot.
 * The configured product commission and the affiliate's markup are independent
 * earnings sources, so neither may overwrite the other.
 */
export function buildAffiliateProductView(product: StoredProduct, markupPercent: number): AffiliateProductView {
  const customerPriceCents = Math.round(product.priceCents * (100 + markupPercent) / 100);
  const markupCommissionCents = customerPriceCents - product.priceCents;
  const baseCommissionCents = product.commissionCents;

  return {
    ...product,
    markupPercent,
    customerPriceCents,
    baseCommissionCents,
    markupCommissionCents,
    commissionCents: baseCommissionCents + markupCommissionCents
  };
}
