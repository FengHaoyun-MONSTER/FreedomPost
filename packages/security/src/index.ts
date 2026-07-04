import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import sanitizeHtml from "sanitize-html";

export const COMMENT_MAX_LENGTH = 10_000;
export const COMMENT_ATTACHMENT_MAX_BYTES = 500 * 1024 * 1024;

export const allowedUploadExtensions = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "svg",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "zip",
  "rar",
  "7z",
  "txt",
  "md",
  "json",
  "csv",
  "mp3",
  "wav",
  "mp4",
  "mov",
  "js",
  "ts",
  "py",
  "java",
  "go",
  "rs",
  "cpp",
  "html",
  "css"
]);

export const executableUploadExtensions = new Set(["exe", "msi"]);

export const inlineSafeImageMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp"
]);

export const allowedUploadMimePrefixes = [
  "image/",
  "application/pdf",
  "application/msword",
  "application/vnd.",
  "application/zip",
  "application/x-7z-compressed",
  "application/x-rar-compressed",
  "text/",
  "audio/",
  "video/"
];

export const allowedExecutableUploadMimeTypes = new Set([
  "application/octet-stream",
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/x-msi",
  "application/vnd.microsoft.portable-executable"
]);

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function hashVisitorKey(input: {
  ip?: string | null;
  fingerprint?: string | null;
  localId?: string | null;
  date: string;
  salt: string;
}): string {
  const source = [
    input.ip ?? "no-ip",
    input.fingerprint ?? "no-fingerprint",
    input.localId ?? "no-local-id",
    input.date,
    input.salt
  ].join(":");

  return sha256(source);
}

export function sanitizeCommentText(content: string): string {
  const trimmed = content.slice(0, COMMENT_MAX_LENGTH);
  return sanitizeHtml(trimmed, {
    allowedTags: [],
    allowedAttributes: {}
  });
}

export function sanitizeArticleHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "a",
      "article",
      "blockquote",
      "br",
      "caption",
      "code",
      "del",
      "details",
      "div",
      "em",
      "figcaption",
      "figure",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "hr",
      "img",
      "input",
      "kbd",
      "li",
      "mark",
      "ol",
      "p",
      "pre",
      "section",
      "span",
      "strong",
      "sub",
      "summary",
      "sup",
      "table",
      "tbody",
      "td",
      "tfoot",
      "th",
      "thead",
      "tr",
      "ul"
    ],
    allowedAttributes: {
      a: ["href", "name", "target", "rel", "class"],
      "*": ["id", "class", "data-lang", "aria-hidden"],
      img: ["src", "alt", "title", "width", "height", "loading"],
      input: ["type", "checked", "disabled"],
      code: ["class"],
      pre: ["class"],
      th: ["align"],
      td: ["align"]
    },
    allowedSchemes: ["http", "https", "mailto", "tel", "data"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        rel: "noreferrer noopener"
      }),
      img: sanitizeHtml.simpleTransform("img", {
        loading: "lazy"
      })
    }
  });
}

export function fileExtension(filename: string): string {
  const raw = filename.split(".").pop();
  return raw ? raw.toLowerCase() : "";
}

export function isAllowedUpload(filename: string, mimeType: string): boolean {
  const extension = fileExtension(filename);
  const normalizedMime = mimeType.toLowerCase().split(";")[0]?.trim() || "application/octet-stream";
  const knownMime = allowedUploadMimePrefixes.some((prefix) => normalizedMime.startsWith(prefix));

  if (allowedUploadExtensions.has(extension)) {
    return knownMime;
  }

  return executableUploadExtensions.has(extension) && allowedExecutableUploadMimeTypes.has(normalizedMime);
}

export function isInlineSafeCommentImage(input: {
  mimeType: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
}): boolean {
  const withinSize = input.sizeBytes <= 2 * 1024 * 1024;
  const width = input.width ?? 0;
  const height = input.height ?? 0;
  const withinDimensions = (!width || width <= 1600) && (!height || height <= 1600);
  return inlineSafeImageMimeTypes.has(input.mimeType) && withinSize && withinDimensions;
}
