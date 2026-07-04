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
  storageProvider: "local" | "oss";
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
  storageProvider?: "local" | "oss";
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
