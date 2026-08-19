import { renderMarkdownArticle } from "@freedompost/renderer";
import { newToken } from "@freedompost/security";
import type { PostListItem, SearchDocument } from "@freedompost/shared";
import type { StoredPost } from "./types.js";

export function renderStoredPost(post: Omit<StoredPost, "html" | "searchText" | "excerpt">): StoredPost {
  const rendered = renderMarkdownArticle({
    slug: post.slug,
    title: post.title,
    markdown: post.markdown,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    viewCount: post.viewCount,
    commentCount: post.commentCount,
    attachmentCount: post.attachmentCount
  });

  return {
    ...post,
    html: rendered.html,
    searchText: rendered.searchText,
    excerpt: rendered.excerpt
  };
}

export function toPostListItem(post: StoredPost): PostListItem {
  return {
    slug: post.slug,
    title: post.title,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    viewCount: post.viewCount,
    commentCount: post.commentCount,
    excerpt: post.excerpt,
    visibility: post.visibility === "paid" ? "paid" : "public",
    priceCents: post.visibility === "paid" ? post.priceCents : 0,
    currency: post.currency
  };
}

export function toSearchDocument(post: StoredPost): SearchDocument {
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    body: post.visibility === "paid" ? post.excerpt : post.searchText,
    excerpt: post.excerpt,
    updatedAt: post.updatedAt
  };
}

export function makeSlug(title: string): string {
  const base =
    title
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, "-")
      .replace(/[^\p{Letter}\p{Number}-]+/gu, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 24) || "post";
  return `${base}-${newToken(4).slice(0, 6)}`;
}

export function makePostSlug(): string {
  return `p_${newToken(6)}`;
}

export function padPath(value: number): string {
  return String(value).padStart(6, "0");
}
