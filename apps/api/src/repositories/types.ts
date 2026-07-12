import type { Comment, PostListItem, SearchDocument } from "@freedompost/shared";

export interface StoredPost {
  id: string;
  slug: string;
  title: string;
  markdown: string;
  html: string;
  searchText: string;
  excerpt: string;
  createdAt: string;
  updatedAt: string;
  viewCount: number;
  commentCount: number;
  attachmentCount: number;
}

export type ProductStatus = "draft" | "published";

export interface StoredProduct {
  id: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  category: string;
  priceCents: number;
  commissionCents: number;
  compareAtCents: number | null;
  currency: string;
  stock: number;
  soldCount: number;
  coverUrl: string | null;
  status: ProductStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductInput {
  title: string;
  summary: string;
  description: string;
  category: string;
  priceCents: number;
  commissionCents: number;
  compareAtCents: number | null;
  currency: string;
  stock: number;
  soldCount: number;
  coverUrl: string | null;
  status: ProductStatus;
  sortOrder: number;
}

export type ToolStatus = "draft" | "published";

export interface StoredTool {
  id: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  category: string;
  url: string;
  coverUrl: string | null;
  status: ToolStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ToolInput {
  title: string;
  summary: string;
  description: string;
  category: string;
  url: string;
  coverUrl: string | null;
  status: ToolStatus;
  sortOrder: number;
}

export type AffiliateStatus = "active" | "disabled";
export type AffiliateOrderStatus = "pending" | "completed" | "canceled";
export type AffiliateCommissionStatus = "not_due" | "pending" | "paid";

export interface StoredAffiliate {
  id: string;
  wechatId: string;
  passwordHash: string;
  status: AffiliateStatus;
  createdAt: string;
  updatedAt: string;
}

export interface StoredAffiliateOrder {
  id: string;
  orderCode: string;
  affiliateId: string;
  affiliateWechatId: string;
  productId: string | null;
  productTitle: string;
  priceCents: number;
  commissionCents: number;
  currency: string;
  orderStatus: AffiliateOrderStatus;
  commissionStatus: AffiliateCommissionStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  commissionPaidAt: string | null;
}

export interface AffiliateDashboard {
  affiliate: Omit<StoredAffiliate, "passwordHash">;
  totalClicks: number;
  uniqueClicks: number;
  completedOrders: number;
  pendingCommissionCents: number;
  paidCommissionCents: number;
  orders: StoredAffiliateOrder[];
}

export interface CreatePostInput {
  title: string;
  markdown: string;
}

export interface UpdatePostInput {
  id: string;
  title: string;
  markdown: string;
}

export interface CreateCommentInput {
  postSlug: string;
  parentId: string | null;
  username: string;
  content: string;
  attachments: Comment["attachments"];
  fingerprintHash?: string | null;
  localIdHash?: string | null;
  ipHash: string;
}

export interface RecordViewInput {
  postSlug: string;
  viewDate: string;
  visitorKey: string;
  fingerprintHash?: string | null;
  localIdHash?: string | null;
  ipHash?: string | null;
}

export interface RecordViewResult {
  counted: boolean;
  viewCount: number;
}

export interface ContentRepository {
  listPosts(): Promise<StoredPost[]>;
  listPostSummaries(): Promise<PostListItem[]>;
  getPostBySlug(slug: string): Promise<StoredPost | null>;
  getPostById(id: string): Promise<StoredPost | null>;
  getSearchDocuments(): Promise<SearchDocument[]>;
  createPost(input: CreatePostInput): Promise<StoredPost>;
  updatePost(input: UpdatePostInput): Promise<StoredPost | null>;
  deletePost(id: string): Promise<boolean>;
  recordView(input: RecordViewInput): Promise<RecordViewResult | null>;
  listComments(postSlug: string): Promise<Comment[]>;
  createComment(input: CreateCommentInput): Promise<Comment | null>;
  deleteAttachmentsByIds(ids: string[]): Promise<void>;
  listProducts(options?: { publishedOnly?: boolean }): Promise<StoredProduct[]>;
  getProductBySlug(slug: string): Promise<StoredProduct | null>;
  getProductById(id: string): Promise<StoredProduct | null>;
  createProduct(input: ProductInput): Promise<StoredProduct>;
  updateProduct(id: string, input: ProductInput): Promise<StoredProduct | null>;
  deleteProduct(id: string): Promise<boolean>;
  listTools(options?: { publishedOnly?: boolean }): Promise<StoredTool[]>;
  getToolById(id: string): Promise<StoredTool | null>;
  createTool(input: ToolInput): Promise<StoredTool>;
  updateTool(id: string, input: ToolInput): Promise<StoredTool | null>;
  deleteTool(id: string): Promise<boolean>;
  getAffiliateByWechatId(wechatId: string): Promise<StoredAffiliate | null>;
  createAffiliate(wechatId: string, passwordHash: string): Promise<StoredAffiliate>;
  listAffiliates(): Promise<Array<Omit<StoredAffiliate, "passwordHash"> & { totalClicks: number; uniqueClicks: number; orderCount: number }>>;
  updateAffiliateStatus(id: string, status: AffiliateStatus): Promise<boolean>;
  updateAffiliatePassword(id: string, passwordHash: string): Promise<boolean>;
  recordAffiliateClick(wechatId: string, visitorKey: string, path: string): Promise<{ accepted: boolean; isUnique: boolean }>;
  getAffiliateDashboard(affiliateId: string): Promise<AffiliateDashboard | null>;
  createAffiliateOrder(affiliateId: string, product: StoredProduct): Promise<StoredAffiliateOrder>;
  listAffiliateOrders(): Promise<StoredAffiliateOrder[]>;
  updateAffiliateOrder(id: string, orderStatus: AffiliateOrderStatus, commissionStatus: AffiliateCommissionStatus): Promise<StoredAffiliateOrder | null>;
}
