import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  attachments as attachmentsTable,
  affiliateClicks as affiliateClicksTable,
  affiliateOrders as affiliateOrdersTable,
  affiliates as affiliatesTable,
  comments as commentsTable,
  postViews as postViewsTable,
  posts as postsTable,
  products as productsTable
  ,tools as toolsTable
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
  AffiliateCommissionStatus,
  AffiliateDashboard,
  AffiliateOrderStatus,
  AffiliateStatus,
  CreateCommentInput,
  CreatePostInput,
  ProductInput,
  StoredTool,
  ToolInput,
  RecordViewInput,
  RecordViewResult,
  StoredPost,
  StoredAffiliate,
  StoredAffiliateOrder,
  StoredProduct,
  UpdatePostInput
} from "./types.js";

type Db = NodePgDatabase;
type PostRow = typeof postsTable.$inferSelect;
type CommentRow = typeof commentsTable.$inferSelect;
type AttachmentRow = typeof attachmentsTable.$inferSelect;
type ProductRow = typeof productsTable.$inferSelect;
type ToolRow = typeof toolsTable.$inferSelect;
type AffiliateRow = typeof affiliatesTable.$inferSelect;

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

  async deleteAttachmentsByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.delete(attachmentsTable).where(inArray(attachmentsTable.id, ids));
  }

  async listProducts(options: { publishedOnly?: boolean } = {}): Promise<StoredProduct[]> {
    const query = this.db.select().from(productsTable);
    const rows = options.publishedOnly
      ? await query.where(eq(productsTable.status, "published"))
      : await query;
    return rows
      .sort((left, right) => right.sortOrder - left.sortOrder || right.createdAt.getTime() - left.createdAt.getTime())
      .map(mapProductRow);
  }

  async getProductBySlug(slug: string): Promise<StoredProduct | null> {
    const [row] = await this.db.select().from(productsTable).where(eq(productsTable.slug, slug)).limit(1);
    return row ? mapProductRow(row) : null;
  }

  async getProductById(id: string): Promise<StoredProduct | null> {
    const [row] = await this.db.select().from(productsTable).where(eq(productsTable.id, id)).limit(1);
    return row ? mapProductRow(row) : null;
  }

  async createProduct(input: ProductInput): Promise<StoredProduct> {
    const now = new Date();
    const [row] = await this.db
      .insert(productsTable)
      .values({
        id: crypto.randomUUID(),
        slug: await this.uniqueProductSlug(input.title),
        ...input,
        title: input.title.trim() || "未命名商品",
        createdAt: now,
        updatedAt: now
      })
      .returning();
    if (!row) throw new Error("Failed to insert product");
    return mapProductRow(row);
  }

  async updateProduct(id: string, input: ProductInput): Promise<StoredProduct | null> {
    const existing = await this.getProductById(id);
    if (!existing) return null;
    const [row] = await this.db
      .update(productsTable)
      .set({
        ...input,
        title: input.title.trim() || existing.title,
        updatedAt: new Date()
      })
      .where(eq(productsTable.id, id))
      .returning();
    return row ? mapProductRow(row) : null;
  }

  async deleteProduct(id: string): Promise<boolean> {
    const deleted = await this.db.delete(productsTable).where(eq(productsTable.id, id)).returning({ id: productsTable.id });
    return deleted.length > 0;
  }

  async listTools(options: { publishedOnly?: boolean } = {}): Promise<StoredTool[]> {
    const query = this.db.select().from(toolsTable);
    const rows = options.publishedOnly
      ? await query.where(eq(toolsTable.status, "published"))
      : await query;
    return rows
      .sort((left, right) => right.sortOrder - left.sortOrder || right.createdAt.getTime() - left.createdAt.getTime())
      .map(mapToolRow);
  }

  async getToolById(id: string): Promise<StoredTool | null> {
    const [row] = await this.db.select().from(toolsTable).where(eq(toolsTable.id, id)).limit(1);
    return row ? mapToolRow(row) : null;
  }

  async createTool(input: ToolInput): Promise<StoredTool> {
    const now = new Date();
    const [row] = await this.db.insert(toolsTable).values({
      id: crypto.randomUUID(),
      slug: await this.uniqueToolSlug(input.title),
      ...input,
      createdAt: now,
      updatedAt: now
    }).returning();
    if (!row) throw new Error("Failed to insert tool");
    return mapToolRow(row);
  }

  async updateTool(id: string, input: ToolInput): Promise<StoredTool | null> {
    const existing = await this.getToolById(id);
    if (!existing) return null;
    const [row] = await this.db.update(toolsTable).set({ ...input, updatedAt: new Date() }).where(eq(toolsTable.id, id)).returning();
    return row ? mapToolRow(row) : null;
  }

  async deleteTool(id: string): Promise<boolean> {
    const rows = await this.db.delete(toolsTable).where(eq(toolsTable.id, id)).returning({ id: toolsTable.id });
    return rows.length > 0;
  }

  async getAffiliateByWechatId(wechatId: string): Promise<StoredAffiliate | null> {
    const [row] = await this.db.select().from(affiliatesTable).where(eq(affiliatesTable.wechatId, wechatId)).limit(1);
    return row ? mapAffiliateRow(row) : null;
  }

  async createAffiliate(wechatId: string, passwordHash: string): Promise<StoredAffiliate> {
    const [row] = await this.db.insert(affiliatesTable).values({ wechatId, passwordHash }).returning();
    if (!row) throw new Error("Failed to create affiliate");
    return mapAffiliateRow(row);
  }

  async listAffiliates() {
    const affiliates = await this.db.select().from(affiliatesTable).orderBy(desc(affiliatesTable.createdAt));
    return Promise.all(affiliates.map(async (affiliate) => {
      const [[clicks], [orders]] = await Promise.all([
        this.db.select({ totalClicks: sql<number>`count(*)::int`, uniqueClicks: sql<number>`coalesce(sum(${affiliateClicksTable.isUnique}), 0)::int` }).from(affiliateClicksTable).where(eq(affiliateClicksTable.affiliateId, affiliate.id)),
        this.db.select({ orderCount: sql<number>`count(*)::int` }).from(affiliateOrdersTable).where(eq(affiliateOrdersTable.affiliateId, affiliate.id))
      ]);
      return { ...publicAffiliate(mapAffiliateRow(affiliate)), totalClicks: clicks?.totalClicks ?? 0, uniqueClicks: clicks?.uniqueClicks ?? 0, orderCount: orders?.orderCount ?? 0 };
    }));
  }

  async updateAffiliateStatus(id: string, status: AffiliateStatus): Promise<boolean> {
    const rows = await this.db.update(affiliatesTable).set({ status, updatedAt: new Date() }).where(eq(affiliatesTable.id, id)).returning({ id: affiliatesTable.id });
    return rows.length > 0;
  }

  async updateAffiliatePassword(id: string, passwordHash: string): Promise<boolean> {
    const rows = await this.db.update(affiliatesTable).set({ passwordHash, updatedAt: new Date() }).where(eq(affiliatesTable.id, id)).returning({ id: affiliatesTable.id });
    return rows.length > 0;
  }

  async recordAffiliateClick(wechatId: string, visitorKey: string, path: string) {
    const affiliate = await this.getAffiliateByWechatId(wechatId);
    if (!affiliate || affiliate.status !== "active") return { accepted: false, isUnique: false };
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [recent] = await this.db
      .select({ id: affiliateClicksTable.id })
      .from(affiliateClicksTable)
      .where(and(
        eq(affiliateClicksTable.affiliateId, affiliate.id),
        eq(affiliateClicksTable.visitorKey, visitorKey),
        gt(affiliateClicksTable.clickedAt, cutoff)
      ))
      .limit(1);
    const isUnique = !recent;
    await this.db.insert(affiliateClicksTable).values({
      affiliateId: affiliate.id,
      visitorKey,
      path,
      isUnique: isUnique ? 1 : 0
    });
    return { accepted: true, isUnique };
  }

  async getAffiliateDashboard(affiliateId: string): Promise<AffiliateDashboard | null> {
    const [affiliateRow] = await this.db.select().from(affiliatesTable).where(eq(affiliatesTable.id, affiliateId)).limit(1);
    if (!affiliateRow) return null;
    const [clicks] = await this.db
      .select({
        totalClicks: sql<number>`count(*)::int`,
        uniqueClicks: sql<number>`coalesce(sum(${affiliateClicksTable.isUnique}), 0)::int`
      })
      .from(affiliateClicksTable)
      .where(eq(affiliateClicksTable.affiliateId, affiliateId));
    const orders = await this.listAffiliateOrdersFor(affiliateId);
    return dashboardFrom(publicAffiliate(mapAffiliateRow(affiliateRow)), clicks ?? { totalClicks: 0, uniqueClicks: 0 }, orders);
  }

  async createAffiliateOrder(affiliateId: string, product: StoredProduct): Promise<StoredAffiliateOrder> {
    const [row] = await this.db.insert(affiliateOrdersTable).values({
      orderCode: await this.uniqueOrderCode(),
      affiliateId,
      productId: product.id,
      productTitle: product.title,
      priceCents: product.priceCents,
      commissionCents: product.commissionCents,
      currency: product.currency
    }).returning();
    if (!row) throw new Error("Failed to create affiliate order");
    const affiliate = await this.db.select({ wechatId: affiliatesTable.wechatId }).from(affiliatesTable).where(eq(affiliatesTable.id, affiliateId)).limit(1);
    return mapAffiliateOrderRow(row, affiliate[0]?.wechatId ?? "");
  }

  async listAffiliateOrders(): Promise<StoredAffiliateOrder[]> {
    return this.listAffiliateOrdersFor();
  }

  async updateAffiliateOrder(id: string, orderStatus: AffiliateOrderStatus, commissionStatus: AffiliateCommissionStatus): Promise<StoredAffiliateOrder | null> {
    const now = new Date();
    const [existing] = await this.db.select().from(affiliateOrdersTable).where(eq(affiliateOrdersTable.id, id)).limit(1);
    if (!existing) return null;
    const [row] = await this.db.update(affiliateOrdersTable).set({
      orderStatus,
      commissionStatus,
      updatedAt: now,
      completedAt: orderStatus === "completed" ? (existing.completedAt ?? now) : null,
      commissionPaidAt: commissionStatus === "paid" ? (existing.commissionPaidAt ?? now) : null
    }).where(eq(affiliateOrdersTable.id, id)).returning();
    if (!row) return null;
    const affiliate = await this.db.select({ wechatId: affiliatesTable.wechatId }).from(affiliatesTable).where(eq(affiliatesTable.id, row.affiliateId)).limit(1);
    return mapAffiliateOrderRow(row, affiliate[0]?.wechatId ?? "");
  }

  private async listAffiliateOrdersFor(affiliateId?: string): Promise<StoredAffiliateOrder[]> {
    const query = this.db
      .select({ order: affiliateOrdersTable, wechatId: affiliatesTable.wechatId })
      .from(affiliateOrdersTable)
      .innerJoin(affiliatesTable, eq(affiliatesTable.id, affiliateOrdersTable.affiliateId));
    const rows = affiliateId
      ? await query.where(eq(affiliateOrdersTable.affiliateId, affiliateId)).orderBy(desc(affiliateOrdersTable.createdAt))
      : await query.orderBy(desc(affiliateOrdersTable.createdAt));
    return rows.map(({ order, wechatId }) => mapAffiliateOrderRow(order, wechatId));
  }

  private async uniqueOrderCode(): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = `FP${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
      const [existing] = await this.db.select({ id: affiliateOrdersTable.id }).from(affiliateOrdersTable).where(eq(affiliateOrdersTable.orderCode, code)).limit(1);
      if (!existing) return code;
    }
    throw new Error("Failed to generate unique order code");
  }

  private async uniqueSlug(title: string): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const slug = makeSlug(title);
      const existing = await this.getPostBySlug(slug);
      if (!existing) return slug;
    }

    return `${makeSlug(title)}-${crypto.randomUUID().slice(0, 8)}`;
  }

  private async uniqueProductSlug(title: string): Promise<string> {
    const base = makeSlug(title || "product");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
      if (!(await this.getProductBySlug(slug))) return slug;
    }
    return `${base}-${crypto.randomUUID().slice(0, 8)}`;
  }

  private async uniqueToolSlug(title: string): Promise<string> {
    const base = makeSlug(title || "tool");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const [existing] = await this.db.select({ id: toolsTable.id }).from(toolsTable).where(eq(toolsTable.slug, slug)).limit(1);
      if (!existing) return slug;
    }
    return `${base}-${crypto.randomUUID().slice(0, 8)}`;
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

function mapProductRow(row: ProductRow): StoredProduct {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    description: row.description,
    category: row.category,
    priceCents: row.priceCents,
    commissionCents: row.commissionCents,
    compareAtCents: row.compareAtCents,
    currency: row.currency,
    stock: row.stock,
    soldCount: row.soldCount,
    coverUrl: row.coverUrl,
    status: row.status === "published" ? "published" : "draft",
    sortOrder: row.sortOrder,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  };
}

function mapToolRow(row: ToolRow): StoredTool {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    description: row.description,
    category: row.category,
    url: row.url,
    coverUrl: row.coverUrl,
    status: row.status === "published" ? "published" : "draft",
    sortOrder: row.sortOrder,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  };
}

function mapAffiliateRow(row: AffiliateRow): StoredAffiliate {
  return {
    id: row.id,
    wechatId: row.wechatId,
    passwordHash: row.passwordHash,
    status: row.status === "disabled" ? "disabled" : "active",
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  };
}

function publicAffiliate(affiliate: StoredAffiliate): Omit<StoredAffiliate, "passwordHash"> {
  const { passwordHash: _passwordHash, ...publicValue } = affiliate;
  return publicValue;
}

function mapAffiliateOrderRow(row: typeof affiliateOrdersTable.$inferSelect, wechatId: string): StoredAffiliateOrder {
  return {
    id: row.id,
    orderCode: row.orderCode,
    affiliateId: row.affiliateId,
    affiliateWechatId: wechatId,
    productId: row.productId,
    productTitle: row.productTitle,
    priceCents: row.priceCents,
    commissionCents: row.commissionCents,
    currency: row.currency,
    orderStatus: row.orderStatus as AffiliateOrderStatus,
    commissionStatus: row.commissionStatus as AffiliateCommissionStatus,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    completedAt: row.completedAt ? toIso(row.completedAt) : null,
    commissionPaidAt: row.commissionPaidAt ? toIso(row.commissionPaidAt) : null
  };
}

function dashboardFrom(
  affiliate: Omit<StoredAffiliate, "passwordHash">,
  clicks: { totalClicks: number; uniqueClicks: number },
  orders: StoredAffiliateOrder[]
): AffiliateDashboard {
  const completed = orders.filter((order) => order.orderStatus === "completed");
  return {
    affiliate,
    totalClicks: clicks.totalClicks,
    uniqueClicks: clicks.uniqueClicks,
    completedOrders: completed.length,
    pendingCommissionCents: completed.filter((order) => order.commissionStatus === "pending").reduce((sum, order) => sum + order.commissionCents, 0),
    paidCommissionCents: completed.filter((order) => order.commissionStatus === "paid").reduce((sum, order) => sum + order.commissionCents, 0),
    orders
  };
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
    ...(isStorageProvider(row.storageProvider) ? { storageProvider: row.storageProvider } : {}),
    ...(row.sha256 ? { sha256: row.sha256 } : {})
  };
}

function inferStorageProvider(url: string): "local" | "oss" | "r2" {
  if (url.startsWith("/")) return "local";

  try {
    const parsed = new URL(url);
    const r2BaseUrl = process.env.R2_PUBLIC_BASE_URL;
    if (r2BaseUrl && parsed.origin === new URL(r2BaseUrl).origin) {
      return "r2";
    }
  } catch {
    // Ignore malformed URLs and keep the legacy external fallback.
  }

  return "oss";
}

function shaFromAttachmentId(id: string): string | null {
  return /^[a-f0-9]{64}$/i.test(id) ? id : null;
}

function isStorageProvider(value: string): value is "local" | "oss" | "r2" {
  return value === "local" || value === "oss" || value === "r2";
}
