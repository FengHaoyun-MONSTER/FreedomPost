export type ContentFormat = "tiptap" | "markdown" | "html";

export interface PostListItem {
  slug: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  viewCount: number;
  commentCount: number;
  excerpt?: string;
}

export interface ArticleMeta extends PostListItem {
  id?: string;
  attachmentCount: number;
  seoTitle?: string;
  seoDescription?: string;
  canonicalPath: string;
}

export interface SearchDocument {
  id: string;
  slug: string;
  title: string;
  body: string;
  excerpt: string;
  updatedAt: string;
}

export interface SearchIndexPayload {
  version: string;
  engine: "local-weighted";
  documents: SearchDocument[];
}

export interface TocItem {
  id: string;
  text: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  children?: TocItem[];
}

export interface Attachment {
  id: string;
  ownerType: "post" | "comment";
  ownerId?: string;
  originalFilename: string;
  storedFilename: string;
  storageProvider: "local" | "oss" | "r2";
  storageKey: string;
  publicUrl: string;
  mimeType: string;
  detectedMimeType?: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  sha256?: string;
  createdAt: string;
}

export interface CommentAttachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  storageProvider?: "local" | "oss" | "r2";
  storageKey?: string;
  storedFilename?: string;
  sha256?: string;
}

export interface Comment {
  id: string;
  postSlug: string;
  parentId: string | null;
  rootId: string | null;
  depth: number;
  path: string;
  username: string;
  content: string;
  attachments: CommentAttachment[];
  createdAt: string;
}

export interface AdminSession {
  adminId: string;
  username: string;
  createdAt: string;
}

export interface ApiEnvelope<T> {
  data: T;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export interface YouTubeVideo {
  videoId: string;
  startSeconds: number;
}

const youtubeVideoIdPattern = /^[A-Za-z0-9_-]{11}$/;
const youtubeDirectivePattern = /^::youtube\[([A-Za-z0-9_-]{11})(?:\?start=(\d+))?]$/;

export function parseYouTubeVideoInput(value: string): YouTubeVideo | null {
  const input = value.trim();
  if (youtubeVideoIdPattern.test(input)) {
    return { videoId: input, startSeconds: 0 };
  }

  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`;

  try {
    const url = new URL(withProtocol);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    let videoId = "";

    if (hostname === "youtu.be") {
      videoId = url.pathname.split("/").filter(Boolean)[0] ?? "";
    } else if (
      hostname === "youtube.com" ||
      hostname === "m.youtube.com" ||
      hostname === "music.youtube.com" ||
      hostname === "youtube-nocookie.com"
    ) {
      const pathParts = url.pathname.split("/").filter(Boolean);
      if (pathParts[0] === "watch") {
        videoId = url.searchParams.get("v") ?? "";
      } else if (["embed", "shorts", "live"].includes(pathParts[0] ?? "")) {
        videoId = pathParts[1] ?? "";
      }
    }

    if (!youtubeVideoIdPattern.test(videoId)) return null;

    const timeValue = url.searchParams.get("start") ?? url.searchParams.get("t") ?? readHashTime(url.hash);
    return {
      videoId,
      startSeconds: parseYouTubeTime(timeValue)
    };
  } catch {
    return null;
  }
}

export function parseYouTubeDirective(value: string): YouTubeVideo | null {
  const match = value.trim().match(youtubeDirectivePattern);
  if (!match) return null;

  return {
    videoId: match[1] ?? "",
    startSeconds: Number.parseInt(match[2] ?? "0", 10)
  };
}

export function youtubeDirective(video: YouTubeVideo): string {
  const start = normalizeStartSeconds(video.startSeconds);
  return `::youtube[${video.videoId}${start ? `?start=${start}` : ""}]`;
}

export function youtubeEmbedUrl(video: YouTubeVideo): string {
  const start = normalizeStartSeconds(video.startSeconds);
  return `https://www.youtube-nocookie.com/embed/${video.videoId}${start ? `?start=${start}` : ""}`;
}

export function youtubeWatchUrl(video: YouTubeVideo): string {
  const start = normalizeStartSeconds(video.startSeconds);
  return `https://www.youtube.com/watch?v=${video.videoId}${start ? `&t=${start}s` : ""}`;
}

function readHashTime(hash: string): string | null {
  const match = hash.match(/(?:^#|[&#])t=([^&]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function parseYouTubeTime(value: string | null): number {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return normalizeStartSeconds(Number.parseInt(value, 10));

  const match = value.toLowerCase().match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!match) return 0;

  return normalizeStartSeconds(
    Number.parseInt(match[1] ?? "0", 10) * 3600 +
      Number.parseInt(match[2] ?? "0", 10) * 60 +
      Number.parseInt(match[3] ?? "0", 10)
  );
}

function normalizeStartSeconds(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), 86_400);
}
