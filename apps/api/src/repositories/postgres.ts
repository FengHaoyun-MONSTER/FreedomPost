import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  attachments as attachmentsTable,
  comments as commentsTable,
  postViews as postViewsTable,
  posts as postsTable
} from "@freedompost/db";
import type { Comment } from "@freedompost/shared";
import {
  makeSlug,
  padPath,
  renderStoredPost,
  toPostListItem,
  toSearchDocument
} from "./post-utils.js";
import type {
  ContentRepository,
  CreateCommentInput,
  CreatePostInput,
  RecordViewInput,
  RecordViewResult,
  StoredPost,
  UpdatePostInput
} from "./types.js";

type Db = NodePgDatabase;
type PostRow = typeof postsTable.$inferSelect;
type CommentRow = typeof commentsTable.$inferSelect;
type AttachmentRow = typeof attachmentsTable.$inferSelect;

export class PostgresContentRepository implements ContentRepository {
  private readonly pool: Pool;
  private readonly db: Db;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
    this.db = drizzle(this.pool);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async listPosts(): Promise<StoredPost[]> {
    const rows = await this.db.select().from(postsTable).orderBy(desc(postsTable.createdAt));
    return rows.map(mapPostRow);
  }

  async listPostSummaries() {
    return (await this.listPosts()).map(toPostListItem);
  }

  async getPostBySlug(slug: string): Promise<StoredPost | null> {
    const [row] = await this.db.select().from(postsTable).where(eq(postsTable.slug, slug)).limit(1);
    return row ? mapPostRow(row) : null;
  }

  async getPostById(id: string): Promise<StoredPost | null> {
    const [row] = await this.db.select().from(postsTable).where(eq(postsTable.id, id)).limit(1);
    return row ? mapPostRow(row) : null;
  }

  async getSearchDocuments() {
    return (await this.listPosts()).map(toSearchDocument);
  }

  async createPost(input: CreatePostInput): Promise<StoredPost> {
    const createdAt = new Date().toISOString();
    const slug = await this.uniqueSlug(input.title);
    const rendered = renderStoredPost({
      id: crypto.randomUUID(),
      slug,
      title: input.title.trim() || "未命名文章",
      markdown: input.markdown,
      createdAt,
      updatedAt: createdAt,
      viewCount: 0,
      commentCount: 0,
      attachmentCount: 0
    });

    const [row] = await this.db
      .insert(postsTable)
      .values({
        id: rendered.id,
        slug: rendered.slug,
        title: rendered.title,
        contentJson: { type: "markdown", version: 1 },
        contentMarkdown: rendered.markdown,
        contentHtml: rendered.html,
        searchText: rendered.searchText,
        excerpt: rendered.excerpt,
        seoTitle: rendered.title,
        seoDescription: rendered.excerpt,
        createdAt: new Date(rendered.createdAt),
        updatedAt: new Date(rendered.updatedAt)
      })
      .returning();

    if (!row) {
      throw new Error("Failed to insert post");
    }

    return mapPostRow(row);
  }

  async updatePost(input: UpdatePostInput): Promise<StoredPost | null> {
    const post = await this.getPostById(input.id);
    if (!post) return null;

    const rendered = renderStoredPost({
      ...post,
      title: input.title.trim() || post.title,
      markdown: input.markdown,
      updatedAt: new Date().toISOString()
    });

    const [row] = await this.db
      .update(postsTable)
      .set({
        title: rendered.title,
        contentJson: { type: "markdown", version: 1 },
        contentMarkdown: rendered.markdown,
        contentHtml: rendered.html,
        searchText: rendered.searchText,
        excerpt: rendered.excerpt,
        seoTitle: rendered.title,
        seoDescription: rendered.excerpt,
        updatedAt: new Date(rendered.updatedAt)
      })
      .where(eq(postsTable.id, input.id))
      .returning();

    return row ? mapPostRow(row) : null;
  }

  async deletePost(id: string): Promise<boolean> {
    const deleted = await this.db.delete(postsTable).where(eq(postsTable.id, id)).returning({ id: postsTable.id });
    return deleted.length > 0;
  }

  async recordView(input: RecordViewInput): Promise<RecordViewResult | null> {
    const post = await this.getPostBySlug(input.postSlug);
    if (!post) return null;

    const inserted = await this.db
      .insert(postViewsTable)
      .values({
        postId: post.id,
        viewDate: input.viewDate,
        visitorKey: input.visitorKey,
        ipHash: input.ipHash ?? null,
        fingerprintHash: input.fingerprintHash ?? null,
        localIdHash: input.localIdHash ?? null
      })
      .onConflictDoNothing()
      .returning({ id: postViewsTable.id });

    if (inserted.length > 0) {
      const [updated] = await this.db
        .update(postsTable)
        .set({ viewCount: sql`${postsTable.viewCount} + 1` })
        .where(eq(postsTable.id, post.id))
        .returning({ viewCount: postsTable.viewCount });

      return {
        counted: true,
        viewCount: updated?.viewCount ?? post.viewCount + 1
      };
    }

    return {
      counted: false,
      viewCount: post.viewCount
    };
  }

  async listComments(postSlug: string): Promise<Comment[]> {
    const post = await this.getPostBySlug(postSlug);
    if (!post) return [];

    const rows = await this.db
      .select()
      .from(commentsTable)
      .where(eq(commentsTable.postId, post.id))
      .orderBy(desc(commentsTable.createdAt), commentsTable.path);

    const commentIds = rows.map((row) => row.id);
    const attachmentRows = commentIds.length
      ? await this.db
          .select()
          .from(attachmentsTable)
          .where(and(eq(attachmentsTable.ownerType, "comment"), inArray(attachmentsTable.ownerId, commentIds)))
          .orderBy(attachmentsTable.createdAt)
      : [];
    const attachmentsByComment = new Map<string, AttachmentRow[]>();

    for (const attachment of attachmentRows) {
      if (!attachment.ownerId) continue;
      attachmentsByComment.set(attachment.ownerId, [
        ...(attachmentsByComment.get(attachment.ownerId) ?? []),
        attachment
      ]);
    }

    return rows.map((row) => mapCommentRow(row, post.slug, attachmentsByComment.get(row.id) ?? []));
  }

  async createComment(input: CreateCommentInput): Promise<Comment | null> {
    const post = await this.getPostBySlug(input.postSlug);
    if (!post) return null;

    const existing = await this.db.select().from(commentsTable).where(eq(commentsTable.postId, post.id));
    const parent = input.parentId ? existing.find((comment) => comment.id === input.parentId) : undefined;
    const parentId = parent?.id ?? null;
    const rootId = parent?.rootId ?? parent?.id ?? null;
    const depth = parent ? parent.depth + 1 : 0;
    const siblingCount = existing.filter((comment) => comment.parentId === parentId).length;
    const path = parent
      ? `${parent.path}.${padPath(siblingCount + 1)}`
      : padPath(existing.filter((comment) => comment.parentId === null).length + 1);

    const [row] = await this.db
      .insert(commentsTable)
      .values({
        id: crypto.randomUUID(),
        postId: post.id,
        parentId,
        rootId,
        depth,
        path,
        username: input.username,
        fingerprintHash: input.fingerprintHash ?? null,
        localIdHash: input.localIdHash ?? null,
        ipHash: input.ipHash,
        content: input.content,
        attachmentCount: input.attachments.length
      })
      .returning();

    if (!row) {
      throw new Error("Failed to insert comment");
    }

    const attachmentRows =
      input.attachments.length > 0
        ? await this.db
            .insert(attachmentsTable)
            .values(
              input.attachments.map((attachment) => ({
                id: crypto.randomUUID(),
                ownerType: "comment",
                ownerId: row.id,
                uploaderType: "public-comment",
                originalFilename: attachment.name,
                storedFilename: attachment.storedFilename ?? attachment.name,
                storageProvider: attachment.storageProvider ?? inferStorageProvider(attachment.url),
                storageKey: attachment.storageKey ?? attachment.url,
                publicUrl: attachment.url,
                mimeType: attachment.mimeType,
                detectedMimeType: attachment.mimeType,
                sizeBytes: attachment.sizeBytes,
                sha256: attachment.sha256 ?? shaFromAttachmentId(attachment.id)
              }))
            )
            .returning()
        : [];

    await this.db
      .update(postsTable)
      .set({ commentCount: sql`${postsTable.commentCount} + 1` })
      .where(eq(postsTable.id, post.id));

    return mapCommentRow(row, post.slug, attachmentRows);
  }

  private async uniqueSlug(title: string): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const slug = makeSlug(title);
      const existing = await this.getPostBySlug(slug);
      if (!existing) return slug;
    }

    return `${makeSlug(title)}-${crypto.randomUUID().slice(0, 8)}`;
  }
}

function mapPostRow(row: PostRow): StoredPost {
  return renderStoredPost({
    id: row.id,
    slug: row.slug,
    title: row.title,
    markdown: row.contentMarkdown ?? "",
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    viewCount: row.viewCount,
    commentCount: row.commentCount,
    attachmentCount: row.attachmentCount
  });
}

function mapCommentRow(row: CommentRow, postSlug: string, attachments: AttachmentRow[] = []): Comment {
  return {
    id: row.id,
    postSlug,
    parentId: row.parentId,
    rootId: row.rootId,
    depth: row.depth,
    path: row.path,
    username: row.username,
    content: row.content ?? "",
    attachments: attachments.map(mapCommentAttachmentRow),
    createdAt: toIso(row.createdAt)
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function mapCommentAttachmentRow(row: AttachmentRow): Comment["attachments"][number] {
  return {
    id: row.id,
    name: row.originalFilename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    url: row.publicUrl,
    storageKey: row.storageKey,
    storedFilename: row.storedFilename,
    ...(row.storageProvider === "local" || row.storageProvider === "oss" ? { storageProvider: row.storageProvider } : {}),
    ...(row.sha256 ? { sha256: row.sha256 } : {})
  };
}

function inferStorageProvider(url: string): "local" | "oss" {
  return url.startsWith("/") ? "local" : "oss";
}

function shaFromAttachmentId(id: string): string | null {
  return /^[a-f0-9]{64}$/i.test(id) ? id : null;
}
