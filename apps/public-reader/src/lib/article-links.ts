export const referralStorageKey = "fp_ref_v1";

export function normalizeReferral(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim();
  return /^[A-Za-z][A-Za-z0-9_-]{5,31}$/.test(normalized) ? normalized : null;
}

export function readArticleSlugFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/p\/([^/]+)/);
  if (!match?.[1]) return null;

  try {
    return decodeURIComponent(match[1]).trim() || null;
  } catch {
    return null;
  }
}

export function isCanonicalArticleSlug(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{6,32}$/.test(value);
}

export function articlePermalinkPath(slug: string, referral?: string | null): string {
  const path = `/p/${encodeURIComponent(slug)}`;
  const normalizedReferral = normalizeReferral(referral);
  return normalizedReferral ? `${path}?ref=${encodeURIComponent(normalizedReferral)}` : path;
}

export function articleReaderPath(
  slug?: string | null,
  referral?: string | null,
  options: { embedded?: boolean } = {}
): string {
  const params = new URLSearchParams();
  if (slug) params.set("post", slug);
  const normalizedReferral = normalizeReferral(referral);
  if (normalizedReferral) params.set("ref", normalizedReferral);
  if (options.embedded) params.set("embed", "portal");
  const query = params.toString();
  return query ? `/reader/?${query}` : "/reader/";
}
