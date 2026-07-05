import type { Comment } from "@freedompost/shared";
import type { StorageAdapter } from "@freedompost/storage";
import type { ContentRepository, StoredPost } from "./repositories/types.js";

export interface CleanupResult {
  deleted: string[];
  skipped: string[];
  failed: Array<{ key: string; message: string }>;
}

export async function deleteUnreferencedManagedAssets(input: {
  candidateKeys: Iterable<string>;
  repository: ContentRepository;
  storage: StorageAdapter;
}): Promise<CleanupResult> {
  const candidates = new Set([...input.candidateKeys].map(normalizeStorageKey).filter(isManagedStorageKey));
  const result: CleanupResult = {
    deleted: [],
    skipped: [],
    failed: []
  };

  if (candidates.size === 0) {
    return result;
  }

  const referenced = await collectReferencedManagedStorageKeys(input.repository);

  for (const key of candidates) {
    if (referenced.has(key)) {
      result.skipped.push(key);
      continue;
    }

    try {
      await input.storage.deleteObject(key);
      result.deleted.push(key);
    } catch (error) {
      result.failed.push({
        key,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return result;
}

export function diffRemovedManagedStorageKeys(previousMarkdown: string, nextMarkdown: string): Set<string> {
  const previous = extractManagedStorageKeys(previousMarkdown);
  const next = extractManagedStorageKeys(nextMarkdown);
  return new Set([...previous].filter((key) => !next.has(key)));
}

export function extractManagedStorageKeys(markdown: string): Set<string> {
  const keys = new Set<string>();

  for (const url of extractAssetUrls(markdown)) {
    const key = managedStorageKeyFromUrl(url);
    if (key) {
      keys.add(key);
    }
  }

  return keys;
}

export function managedStorageKeyFromUrl(rawUrl: string): string | null {
  const url = rawUrl.trim().replace(/^<|>$/g, "");
  if (!url) return null;

  const uploadBase = process.env.PUBLIC_UPLOAD_BASE_URL ?? "/api/uploads";

  if (url.startsWith("/")) {
    const key = storageKeyFromPath(new URL(url, "https://local.freedompost").pathname, uploadBase);
    return key && isManagedStorageKey(key) ? key : null;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (isConfiguredSiteOrigin(parsed.origin)) {
    const key = storageKeyFromPath(parsed.pathname, uploadBase);
    if (key && isManagedStorageKey(key)) return key;
  }

  for (const publicBaseUrl of [process.env.ALIYUN_OSS_PUBLIC_BASE_URL, process.env.R2_PUBLIC_BASE_URL]) {
    if (!publicBaseUrl) continue;
    const key = storageKeyFromPublicBaseUrl(parsed, publicBaseUrl);
    if (key && isManagedStorageKey(key)) return key;
  }

  if (isDefaultOssHost(parsed.hostname)) {
    const key = decodeStorageKey(parsed.pathname.replace(/^\/+/, ""));
    if (key && isManagedStorageKey(key)) return key;
  }

  return null;
}

async function collectReferencedManagedStorageKeys(repository: ContentRepository): Promise<Set<string>> {
  const keys = new Set<string>();
  const posts = await repository.listPosts();

  for (const post of posts) {
    for (const key of extractManagedStorageKeys(post.markdown)) {
      keys.add(key);
    }

    const comments = await repository.listComments(post.slug);
    for (const comment of comments) {
      for (const key of extractCommentAttachmentKeys(comment)) {
        keys.add(key);
      }
    }
  }

  return keys;
}

export function collectPostDeletionCandidateKeys(post: StoredPost, comments: Comment[]): Set<string> {
  const keys = extractManagedStorageKeys(post.markdown);

  for (const comment of comments) {
    for (const key of extractCommentAttachmentKeys(comment)) {
      keys.add(key);
    }
  }

  return keys;
}

function extractCommentAttachmentKeys(comment: Comment): Set<string> {
  const keys = new Set<string>();

  for (const attachment of comment.attachments) {
    const key =
      (attachment.storageKey ? normalizeStorageKey(attachment.storageKey) : null) ??
      managedStorageKeyFromUrl(attachment.url);

    if (key && isManagedStorageKey(key)) {
      keys.add(key);
    }
  }

  return keys;
}

function extractAssetUrls(markdown: string): Set<string> {
  const urls = new Set<string>();
  const markdownLinkPattern = /!?\[[^\]]*]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
  const htmlAssetPattern = /\b(?:src|href)=["']([^"']+)["']/gi;

  for (const match of markdown.matchAll(markdownLinkPattern)) {
    if (match[1]) {
      urls.add(match[1]);
    }
  }

  for (const match of markdown.matchAll(htmlAssetPattern)) {
    if (match[1]) {
      urls.add(match[1]);
    }
  }

  return urls;
}

function storageKeyFromPublicBaseUrl(parsed: URL, publicBaseUrl: string): string | null {
  try {
    const base = new URL(publicBaseUrl);
    if (parsed.origin !== base.origin) return null;
    return storageKeyFromPath(parsed.pathname, base.pathname);
  } catch {
    return null;
  }
}

function storageKeyFromPath(pathname: string, basePath: string): string | null {
  const cleanBase = basePath.replace(/\/+$/, "");

  if (!cleanBase || cleanBase === "/") {
    return decodeStorageKey(pathname.replace(/^\/+/, ""));
  }

  const prefix = `${cleanBase}/`;
  if (!pathname.startsWith(prefix)) {
    return null;
  }

  return decodeStorageKey(pathname.slice(prefix.length));
}

function decodeStorageKey(value: string): string | null {
  try {
    return normalizeStorageKey(
      value
        .split("/")
        .filter(Boolean)
        .map((segment) => decodeURIComponent(segment))
        .join("/")
    );
  } catch {
    return null;
  }
}

function normalizeStorageKey(value: string | null | undefined): string | null {
  const key = value?.trim().replace(/^\/+/, "").replaceAll("\\", "/");
  if (!key || key.includes("..")) return null;
  return key;
}

function isManagedStorageKey(key: string | null): key is string {
  if (!key) return false;

  const storagePrefixes = new Set([
    (process.env.ALIYUN_OSS_PREFIX ?? "freedompost/uploads").replace(/^\/+|\/+$/g, ""),
    (process.env.R2_PREFIX ?? "freedompost/uploads").replace(/^\/+|\/+$/g, "")
  ]);
  const allowedPrefixes = ["admin/", "comments/"];

  for (const prefix of storagePrefixes) {
    if (prefix) {
      allowedPrefixes.push(`${prefix}/admin/`, `${prefix}/comments/`);
    }
  }

  return allowedPrefixes.some((prefix) => key.startsWith(prefix));
}

function isConfiguredSiteOrigin(origin: string): boolean {
  return configuredSiteOrigins().has(origin);
}

function configuredSiteOrigins(): Set<string> {
  const origins = new Set<string>();

  for (const value of [process.env.PUBLIC_SITE_URL, process.env.VITE_PUBLIC_SITE_URL]) {
    if (!value) continue;
    try {
      origins.add(new URL(value).origin);
    } catch {
      // Ignore invalid deployment metadata; it should not enable deletion.
    }
  }

  if (process.env.PREVIEW_DOMAIN) {
    origins.add(`https://${process.env.PREVIEW_DOMAIN}`);
  }

  return origins;
}

function isDefaultOssHost(hostname: string): boolean {
  const bucket = process.env.ALIYUN_OSS_BUCKET;
  const region = process.env.ALIYUN_OSS_REGION;
  return Boolean(bucket && region && hostname === `${bucket}.${region}.aliyuncs.com`);
}
