import type { Comment } from "@freedompost/shared";
import {
  makeSlug,
  padPath,
  renderStoredPost,
  toPostListItem,
  toSearchDocument
} from "./post-utils.js";
import type {
  AffiliateCommissionStatus,
  AffiliateDashboard,
  AffiliateOrderStatus,
  AffiliateStatus,
  ContentRepository,
  CreateCommentInput,
  CreatePostInput,
  ProductInput,
  RecordViewInput,
  RecordViewResult,
  StoredPost,
  StoredTool,
  ToolInput,
  AffiliateProductView,
  StoredAffiliate,
  StoredAffiliateOrder,
  StoredProduct,
  UpdatePostInput
} from "./types.js";

const now = "2026-07-02T08:30:00.000Z";

export function createSeedPosts(): StoredPost[] {
  return [
    renderStoredPost({
      id: "post-welcome",
      slug: "welcome",
      title: "FreedomPost 第一篇：把阅读体验放在正中间",
      markdown:
        "# FreedomPost 第一篇：把阅读体验放在正中间\n\n这里是 API 的示例文章。真实数据会在接入 PostgreSQL 后从 posts 表读取。\n\n```ts\nconsole.log('FreedomPost')\n```",
      createdAt: now,
      updatedAt: now,
      visibility: "public",
      viewCount: 128,
      commentCount: 0,
      attachmentCount: 0
    })
  ];
}

export class MemoryContentRepository implements ContentRepository {
  private readonly posts = new Map<string, StoredPost>();
  private readonly products = new Map<string, StoredProduct>();
  private readonly tools = new Map<string, StoredTool>();
  private readonly affiliates = new Map<string, StoredAffiliate>();
  private readonly affiliateProductMarkups = new Map<string, number>();
  private readonly affiliateClicks: Array<{ affiliateId: string; visitorKey: string; clickedAt: string; isUnique: boolean }> = [];
  private readonly affiliateOrders = new Map<string, StoredAffiliateOrder>();
  private readonly commentsBySlug = new Map<string, Comment[]>();
  private readonly views = new Set<string>();

  constructor(seedPosts = createSeedPosts()) {
    for (const post of seedPosts) {
      this.posts.set(post.id, post);
    }
  }

  async listPosts(): Promise<StoredPost[]> {
    return [...this.posts.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async listPostSummaries() {
    const posts = (await this.listPosts()).filter((post) => post.visibility === "public");
    return posts.map((post) =>
      toPostListItem({
        ...post,
        commentCount: this.commentsBySlug.get(post.slug)?.length ?? post.commentCount
      })
    );
  }

  async getPostBySlug(slug: string): Promise<StoredPost | null> {
    return (await this.listPosts()).find((post) => post.slug === slug) ?? null;
  }

  async getPostById(id: string): Promise<StoredPost | null> {
    return this.posts.get(id) ?? null;
  }

  async getSearchDocuments() {
    return (await this.listPosts()).filter((post) => post.visibility === "public").map(toSearchDocument);
  }

  async createPost(input: CreatePostInput): Promise<StoredPost> {
    const createdAt = new Date().toISOString();
    const post = renderStoredPost({
      id: crypto.randomUUID(),
      slug: makeSlug(input.title),
      title: input.title.trim() || "未命名文章",
      markdown: input.markdown,
      visibility: input.visibility ?? "public",
      createdAt,
      updatedAt: createdAt,
      viewCount: 0,
      commentCount: 0,
      attachmentCount: 0
    });

    this.posts.set(post.id, post);
    return post;
  }

  async updatePost(input: UpdatePostInput): Promise<StoredPost | null> {
    const post = this.posts.get(input.id);
    if (!post) return null;

    const updated = renderStoredPost({
      ...post,
      title: input.title.trim() || post.title,
      markdown: input.markdown,
      visibility: input.visibility ?? post.visibility,
      updatedAt: new Date().toISOString()
    });

    this.posts.set(post.id, updated);
    return updated;
  }

  async deletePost(id: string): Promise<boolean> {
    const post = this.posts.get(id);
    if (!post) return false;

    this.posts.delete(id);
    this.commentsBySlug.delete(post.slug);
    return true;
  }

  async recordView(input: RecordViewInput): Promise<RecordViewResult | null> {
    const post = await this.getPostBySlug(input.postSlug);
    if (!post) return null;

    const key = `${post.id}:${input.viewDate}:${input.visitorKey}`;
    const counted = !this.views.has(key);
    if (counted) {
      this.views.add(key);
      post.viewCount += 1;
      this.posts.set(post.id, post);
    }

    return {
      counted,
      viewCount: post.viewCount
    };
  }

  async listComments(postSlug: string): Promise<Comment[]> {
    return this.commentsBySlug.get(postSlug) ?? [];
  }

  async createComment(input: CreateCommentInput): Promise<Comment | null> {
    const post = await this.getPostBySlug(input.postSlug);
    if (!post) return null;

    const existing = this.commentsBySlug.get(post.slug) ?? [];
    const parent = input.parentId ? existing.find((comment) => comment.id === input.parentId) : undefined;
    const rootId = parent?.rootId ?? parent?.id ?? null;
    const depth = parent ? parent.depth + 1 : 0;
    const siblingCount = existing.filter((comment) => comment.parentId === (parent?.id ?? null)).length;
    const path = parent
      ? `${parent.path}.${padPath(siblingCount + 1)}`
      : padPath(existing.filter((comment) => !comment.parentId).length + 1);

    const comment: Comment = {
      id: crypto.randomUUID(),
      postSlug: post.slug,
      parentId: parent?.id ?? null,
      rootId,
      depth,
      path,
      username: input.username,
      content: input.content,
      attachments: input.attachments,
      createdAt: new Date().toISOString()
    };

    this.commentsBySlug.set(post.slug, [...existing, comment]);
    post.commentCount = this.commentsBySlug.get(post.slug)?.length ?? post.commentCount;
    this.posts.set(post.id, post);
    return comment;
  }

  async deleteAttachmentsByIds(_ids: string[]): Promise<void> {
    // Memory comments own attachment metadata directly, so deleting comments removes it.
  }

  async listProducts(options: { publishedOnly?: boolean } = {}): Promise<StoredProduct[]> {
    return [...this.products.values()]
      .filter((product) => !options.publishedOnly || product.status === "published")
      .sort((left, right) => right.sortOrder - left.sortOrder || right.createdAt.localeCompare(left.createdAt));
  }

  async getProductBySlug(slug: string): Promise<StoredProduct | null> {
    return (await this.listProducts()).find((product) => product.slug === slug) ?? null;
  }

  async getProductById(id: string): Promise<StoredProduct | null> {
    return this.products.get(id) ?? null;
  }

  async createProduct(input: ProductInput): Promise<StoredProduct> {
    const createdAt = new Date().toISOString();
    const product: StoredProduct = {
      id: crypto.randomUUID(),
      slug: await this.uniqueProductSlug(input.title),
      ...input,
      title: input.title.trim() || "未命名商品",
      createdAt,
      updatedAt: createdAt
    };
    this.products.set(product.id, product);
    return product;
  }

  async updateProduct(id: string, input: ProductInput): Promise<StoredProduct | null> {
    const existing = this.products.get(id);
    if (!existing) return null;
    const updated: StoredProduct = {
      ...existing,
      ...input,
      title: input.title.trim() || existing.title,
      updatedAt: new Date().toISOString()
    };
    this.products.set(id, updated);
    return updated;
  }

  async deleteProduct(id: string): Promise<boolean> {
    return this.products.delete(id);
  }

  async listTools(options: { publishedOnly?: boolean } = {}): Promise<StoredTool[]> {
    return [...this.tools.values()]
      .filter((tool) => !options.publishedOnly || tool.status === "published")
      .sort((left, right) => right.sortOrder - left.sortOrder || right.createdAt.localeCompare(left.createdAt));
  }

  async getToolById(id: string): Promise<StoredTool | null> {
    return this.tools.get(id) ?? null;
  }

  async createTool(input: ToolInput): Promise<StoredTool> {
    const createdAt = new Date().toISOString();
    const tool: StoredTool = {
      id: crypto.randomUUID(),
      slug: await this.uniqueToolSlug(input.title),
      ...input,
      title: input.title.trim() || "未命名工具",
      createdAt,
      updatedAt: createdAt
    };
    this.tools.set(tool.id, tool);
    return tool;
  }

  async updateTool(id: string, input: ToolInput): Promise<StoredTool | null> {
    const existing = this.tools.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...input, title: input.title.trim() || existing.title, updatedAt: new Date().toISOString() };
    this.tools.set(id, updated);
    return updated;
  }

  async deleteTool(id: string): Promise<boolean> {
    return this.tools.delete(id);
  }

  async getAffiliateByWechatId(wechatId: string): Promise<StoredAffiliate | null> {
    return [...this.affiliates.values()].find((affiliate) => affiliate.wechatId === wechatId) ?? null;
  }

  async createAffiliate(wechatId: string, passwordHash: string): Promise<StoredAffiliate> {
    const now = new Date().toISOString();
    const affiliate: StoredAffiliate = { id: crypto.randomUUID(), wechatId, passwordHash, defaultMarkupPercent: 0, status: "active", createdAt: now, updatedAt: now };
    this.affiliates.set(affiliate.id, affiliate);
    return affiliate;
  }

  async listAffiliates() {
    return [...this.affiliates.values()].map((affiliate) => ({
      ...publicAffiliate(affiliate),
      totalClicks: this.affiliateClicks.filter((click) => click.affiliateId === affiliate.id).length,
      uniqueClicks: this.affiliateClicks.filter((click) => click.affiliateId === affiliate.id && click.isUnique).length,
      orderCount: [...this.affiliateOrders.values()].filter((order) => order.affiliateId === affiliate.id).length
    }));
  }

  async updateAffiliateStatus(id: string, status: AffiliateStatus): Promise<boolean> {
    const affiliate = this.affiliates.get(id);
    if (!affiliate) return false;
    this.affiliates.set(id, { ...affiliate, status, updatedAt: new Date().toISOString() });
    return true;
  }

  async updateAffiliatePassword(id: string, passwordHash: string): Promise<boolean> {
    const affiliate = this.affiliates.get(id);
    if (!affiliate) return false;
    this.affiliates.set(id, { ...affiliate, passwordHash, updatedAt: new Date().toISOString() });
    return true;
  }

  async listAffiliateProducts(affiliateId: string): Promise<AffiliateProductView[]> {
    const affiliate = this.affiliates.get(affiliateId);
    if (!affiliate) return [];
    return (await this.listProducts({ publishedOnly: true })).map((product) => {
      const markupPercent = this.affiliateProductMarkups.get(`${affiliateId}:${product.id}`) ?? affiliate.defaultMarkupPercent;
      const customerPriceCents = Math.round(product.priceCents * (100 + markupPercent) / 100);
      return { ...product, markupPercent, customerPriceCents, commissionCents: customerPriceCents - product.priceCents };
    });
  }

  async setAffiliateMarkup(affiliateId: string, productIds: string[] | null, markupPercent: number): Promise<void> {
    const affiliate = this.affiliates.get(affiliateId);
    if (!affiliate) return;
    if (productIds === null) {
      for (const key of this.affiliateProductMarkups.keys()) if (key.startsWith(`${affiliateId}:`)) this.affiliateProductMarkups.delete(key);
      this.affiliates.set(affiliateId, { ...affiliate, defaultMarkupPercent: markupPercent, updatedAt: new Date().toISOString() });
      return;
    }
    productIds.forEach((productId) => this.affiliateProductMarkups.set(`${affiliateId}:${productId}`, markupPercent));
  }

  async recordAffiliateClick(wechatId: string, visitorKey: string, _path: string) {
    const affiliate = await this.getAffiliateByWechatId(wechatId);
    if (!affiliate || affiliate.status !== "active") return { accepted: false, isUnique: false };
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const isUnique = !this.affiliateClicks.some((click) => click.affiliateId === affiliate.id && click.visitorKey === visitorKey && Date.parse(click.clickedAt) > cutoff);
    this.affiliateClicks.push({ affiliateId: affiliate.id, visitorKey, clickedAt: new Date().toISOString(), isUnique });
    return { accepted: true, isUnique };
  }

  async getAffiliateDashboard(affiliateId: string): Promise<AffiliateDashboard | null> {
    const affiliate = this.affiliates.get(affiliateId);
    if (!affiliate) return null;
    const clicks = this.affiliateClicks.filter((click) => click.affiliateId === affiliateId);
    const orders = [...this.affiliateOrders.values()].filter((order) => order.affiliateId === affiliateId);
    const completed = orders.filter((order) => order.orderStatus === "completed");
    return {
      affiliate: publicAffiliate(affiliate),
      totalClicks: clicks.length,
      uniqueClicks: clicks.filter((click) => click.isUnique).length,
      completedOrders: completed.length,
      pendingCommissionCents: completed.filter((order) => order.commissionStatus === "pending").reduce((sum, order) => sum + order.commissionCents, 0),
      paidCommissionCents: completed.filter((order) => order.commissionStatus === "paid").reduce((sum, order) => sum + order.commissionCents, 0),
      orders
    };
  }

  async createAffiliateOrder(affiliateId: string, product: StoredProduct, priceCents: number, commissionCents: number): Promise<StoredAffiliateOrder> {
    const affiliate = this.affiliates.get(affiliateId);
    if (!affiliate) throw new Error("Affiliate not found");
    const now = new Date().toISOString();
    const order: StoredAffiliateOrder = {
      id: crypto.randomUUID(),
      orderCode: `FP${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`,
      affiliateId,
      affiliateWechatId: affiliate.wechatId,
      productId: product.id,
      productTitle: product.title,
      priceCents,
      commissionCents,
      currency: product.currency,
      orderStatus: "pending",
      commissionStatus: "not_due",
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      commissionPaidAt: null
    };
    this.affiliateOrders.set(order.id, order);
    return order;
  }

  async listAffiliateOrders(): Promise<StoredAffiliateOrder[]> {
    return [...this.affiliateOrders.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async updateAffiliateOrder(id: string, orderStatus: AffiliateOrderStatus, commissionStatus: AffiliateCommissionStatus): Promise<StoredAffiliateOrder | null> {
    const existing = this.affiliateOrders.get(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const updated = {
      ...existing,
      orderStatus,
      commissionStatus,
      updatedAt: now,
      completedAt: orderStatus === "completed" ? (existing.completedAt ?? now) : null,
      commissionPaidAt: commissionStatus === "paid" ? (existing.commissionPaidAt ?? now) : null
    };
    this.affiliateOrders.set(id, updated);
    return updated;
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
      if (![...this.tools.values()].some((tool) => tool.slug === slug)) return slug;
    }
    return `${base}-${crypto.randomUUID().slice(0, 8)}`;
  }
}

function publicAffiliate(affiliate: StoredAffiliate): Omit<StoredAffiliate, "passwordHash"> {
  const { passwordHash: _passwordHash, ...publicValue } = affiliate;
  return publicValue;
}
