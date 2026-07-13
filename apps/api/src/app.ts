import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import bcrypt from "bcryptjs";
import Fastify, { type FastifyInstance } from "fastify";
import { buildSearchIndex } from "@freedompost/search";
import {
  COMMENT_ATTACHMENT_MAX_BYTES,
  COMMENT_MAX_LENGTH,
  hashVisitorKey,
  newToken,
  sanitizeCommentText,
  sha256
} from "@freedompost/security";
import { UploadRejectedError } from "@freedompost/storage";
import type { Comment } from "@freedompost/shared";
import {
  collectPostDeletionCandidateKeys,
  deleteUnreferencedManagedAssets,
  diffRemovedManagedStorageKeys,
  managedStorageKeyFromUrl
} from "./asset-cleanup.js";
import {
  createContentRepository,
  type AffiliateCommissionStatus,
  type AffiliateOrderStatus,
  type ContentRepository,
  type ProductInput,
  type ToolInput
} from "./repositories/index.js";
import { createStorageAdapter, getLocalUploadStream } from "./storage.js";

const sessions = new Map<string, { username: string; createdAt: string }>();
const affiliateSessions = new Map<string, { affiliateId: string; wechatId: string; createdAt: string }>();
const rateBuckets = new Map<string, number[]>();

function shouldUseSecureCookies() {
  if (process.env.COOKIE_SECURE === "false") {
    return false;
  }
  return process.env.NODE_ENV === "production";
}

const adjectives = ["安静的", "自由的", "清醒的", "温和的", "明亮的", "专注的", "透明的", "从容的"];
const nouns = ["河流", "山影", "晨光", "星火", "纸页", "远帆", "云层", "石径"];

export interface BuildAppOptions {
  repository?: ContentRepository;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const repository = options.repository ?? createContentRepository();
  const storage = createStorageAdapter();
  const app = Fastify({
    bodyLimit: Number(process.env.API_BODY_LIMIT_BYTES ?? 100 * 1024 * 1024),
    logger: {
      level: process.env.LOG_LEVEL ?? "info"
    }
  });

  app.register(cors, {
    origin: true,
    credentials: true
  });
  app.register(cookie, {
    secret: process.env.COOKIE_SECRET ?? "freedompost-dev-cookie-secret"
  });
  app.register(multipart, {
    limits: {
      fileSize: Number(process.env.UPLOAD_MAX_BYTES ?? 500 * 1024 * 1024),
      files: 10
    }
  });

  app.get("/health", async () => ({
    ok: true,
    service: "freedompost-api",
    time: new Date().toISOString()
  }));

  app.get("/api/posts", async () => ({
    items: await repository.listPostSummaries()
  }));

  app.get<{ Querystring: { ref?: string } }>("/api/products", async (request) => {
    const affiliate = normalizeWechatId(request.query.ref);
    if (affiliate) {
      const affiliateRecord = await repository.getAffiliateByWechatId(affiliate);
      if (affiliateRecord?.status === "active") return { items: await repository.listAffiliateProducts(affiliateRecord.id) };
    }
    return { items: await repository.listProducts({ publishedOnly: true }) };
  });

  app.get<{ Params: { slug: string }; Querystring: { ref?: string } }>("/api/products/:slug", async (request, reply) => {
    const product = await repository.getProductBySlug(request.params.slug);
    if (!product || product.status !== "published") {
      return reply.code(404).send(errorBody("PRODUCT_NOT_FOUND", "商品不存在或尚未发布"));
    }
    const affiliate = normalizeWechatId(request.query.ref);
    if (affiliate) {
      const affiliateRecord = await repository.getAffiliateByWechatId(affiliate);
      const priced = affiliateRecord?.status === "active"
        ? (await repository.listAffiliateProducts(affiliateRecord.id)).find((item) => item.id === product.id)
        : null;
      if (priced) return { item: priced };
    }
    return { item: product };
  });

  app.get("/api/tools", async () => ({
    items: await repository.listTools({ publishedOnly: true })
  }));

  app.post<{ Body: unknown }>("/api/affiliate/access", async (request, reply) => {
    if (!allowRequest(`affiliate-access:${request.ip}`, 12, 60_000)) {
      return reply.code(429).send(errorBody("RATE_LIMITED", "尝试次数过多，请稍后再试"));
    }
    const body = request.body as Record<string, unknown> | null;
    const wechatId = normalizeWechatId(body?.wechatId);
    const password = typeof body?.password === "string" ? body.password : "";
    if (!wechatId) return reply.code(400).send(errorBody("INVALID_WECHAT_ID", "微信号格式不正确"));

    let affiliate = await repository.getAffiliateByWechatId(wechatId);
    let generatedPassword: string | undefined;
    if (!affiliate) {
      generatedPassword = generateQueryPassword();
      affiliate = await repository.createAffiliate(wechatId, await bcrypt.hash(generatedPassword, 12));
    } else {
      if (affiliate.status !== "active") return reply.code(403).send(errorBody("AFFILIATE_DISABLED", "该推广账号已停用"));
      if (!password) return reply.code(401).send(errorBody("PASSWORD_REQUIRED", "请输入查询密码"));
      if (!(await bcrypt.compare(password, affiliate.passwordHash))) {
        return reply.code(401).send(errorBody("INVALID_PASSWORD", "微信号或查询密码不正确"));
      }
    }

    const token = newToken();
    affiliateSessions.set(sha256(token), { affiliateId: affiliate.id, wechatId: affiliate.wechatId, createdAt: new Date().toISOString() });
    reply.setCookie("fp_affiliate_session", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: shouldUseSecureCookies(),
      path: "/",
      maxAge: 60 * 60 * 24 * 30
    });
    return {
      created: Boolean(generatedPassword),
      generatedPassword,
      shareUrl: affiliateShareUrl(affiliate.wechatId),
      dashboard: await repository.getAffiliateDashboard(affiliate.id)
    };
  });

  app.get("/api/affiliate/dashboard", async (request, reply) => {
    const session = getAffiliateSession(request.cookies.fp_affiliate_session);
    if (!session) return reply.code(401).send(errorBody("UNAUTHENTICATED", "请使用微信号和查询密码进入"));
    const dashboard = await repository.getAffiliateDashboard(session.affiliateId);
    if (!dashboard || dashboard.affiliate.status !== "active") {
      return reply.code(403).send(errorBody("AFFILIATE_DISABLED", "该推广账号已停用"));
    }
    return { shareUrl: affiliateShareUrl(session.wechatId), dashboard };
  });

  app.get("/api/affiliate/catalog", async (request, reply) => {
    const session = getAffiliateSession(request.cookies.fp_affiliate_session);
    if (!session) return reply.code(401).send(errorBody("UNAUTHENTICATED", "请使用微信号和查询密码进入"));
    return { items: await repository.listAffiliateProducts(session.affiliateId) };
  });

  app.patch<{ Body: unknown }>("/api/affiliate/markups", async (request, reply) => {
    const session = getAffiliateSession(request.cookies.fp_affiliate_session);
    if (!session) return reply.code(401).send(errorBody("UNAUTHENTICATED", "请使用微信号和查询密码进入"));
    const body = request.body as Record<string, unknown> | null;
    const markupPercent = readInteger(body?.markupPercent, 0, 1000);
    const rawProductIds = body?.productIds;
    const productIds = rawProductIds === undefined || rawProductIds === null
      ? null
      : Array.isArray(rawProductIds) && rawProductIds.every((value) => typeof value === "string")
        ? rawProductIds.slice(0, 100) as string[]
        : undefined;
    if (markupPercent === null || productIds === undefined) return reply.code(400).send(errorBody("INVALID_MARKUP", "加价比例或商品选择不正确"));
    await repository.setAffiliateMarkup(session.affiliateId, productIds, markupPercent);
    return { items: await repository.listAffiliateProducts(session.affiliateId) };
  });

  app.post("/api/affiliate/logout", async (request, reply) => {
    const token = request.cookies.fp_affiliate_session;
    if (token) affiliateSessions.delete(sha256(token));
    reply.clearCookie("fp_affiliate_session", { path: "/" });
    return { ok: true };
  });

  app.post<{ Body: unknown }>("/api/affiliate/clicks", async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    const wechatId = normalizeWechatId(body?.ref);
    const localId = readText(body?.localId, 128);
    const path = readText(body?.path, 500) || "/market/";
    if (!wechatId || !localId || !path.startsWith("/")) {
      return reply.code(400).send(errorBody("INVALID_REFERRAL", "推广链接无效"));
    }
    const visitorKey = sha256([localId, request.ip, request.headers["user-agent"] ?? ""].join(":"));
    const result = await repository.recordAffiliateClick(wechatId, visitorKey, path);
    if (!result.accepted) return reply.code(404).send(errorBody("AFFILIATE_NOT_FOUND", "推广链接无效或已停用"));
    return { ...result, ref: wechatId };
  });

  app.post<{ Body: unknown }>("/api/orders", async (request, reply) => {
    if (!allowRequest(`affiliate-order:${request.ip}`, 20, 60 * 60_000)) {
      return reply.code(429).send(errorBody("RATE_LIMITED", "下单次数过多，请稍后再试"));
    }
    const body = request.body as Record<string, unknown> | null;
    const productSlug = readText(body?.productSlug, 64);
    const recommenderWechatId = normalizeWechatId(body?.recommenderWechatId);
    if (!productSlug || !recommenderWechatId) {
      return reply.code(400).send(errorBody("INVALID_ORDER", "商品或推荐人微信号格式不正确"));
    }
    const [product, affiliate] = await Promise.all([
      repository.getProductBySlug(productSlug),
      repository.getAffiliateByWechatId(recommenderWechatId)
    ]);
    if (!product || product.status !== "published" || product.stock === 0) {
      return reply.code(404).send(errorBody("PRODUCT_UNAVAILABLE", "商品不存在或暂时无法下单"));
    }
    if (!affiliate || affiliate.status !== "active") {
      return reply.code(400).send(errorBody("INVALID_RECOMMENDER", "推荐人微信号不存在或已停用"));
    }
    const pricing = (await repository.listAffiliateProducts(affiliate.id)).find((item) => item.id === product.id);
    if (!pricing) return reply.code(404).send(errorBody("PRODUCT_UNAVAILABLE", "商品不存在或暂时无法下单"));
    const order = await repository.createAffiliateOrder(affiliate.id, product, pricing.customerPriceCents, pricing.commissionCents);
    return reply.code(201).send({ order });
  });

  app.get<{ Params: { slug: string } }>("/api/posts/:slug", async (request, reply) => {
    const post = await repository.getPostBySlug(request.params.slug);
    if (!post || post.visibility !== "public") {
      return reply.code(404).send(errorBody("POST_NOT_FOUND", "文章不存在"));
    }

    return {
      item: {
        slug: post.slug,
        title: post.title,
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
        viewCount: post.viewCount,
        commentCount: post.commentCount,
        excerpt: post.excerpt,
        contentHtml: post.html,
        markdown: post.markdown,
        attachmentCount: post.attachmentCount
      }
    };
  });

  app.get("/api/search-index", async () => buildSearchIndex(await repository.getSearchDocuments()));

  app.get<{ Params: { "*": string } }>("/api/uploads/*", async (request, reply) => {
    const file = await getLocalUploadStream(request.params["*"]);
    if (!file) {
      return reply.code(404).send(errorBody("UPLOAD_NOT_FOUND", "文件不存在"));
    }

    reply.header("Content-Type", file.contentType);
    reply.header("Content-Length", String(file.size));
    reply.header("X-Content-Type-Options", "nosniff");
    if (!file.contentType.startsWith("image/")) {
      const filename = encodeURIComponent(request.params["*"].split("/").pop() ?? "download");
      reply.header("Content-Disposition", `attachment; filename*=UTF-8''${filename}`);
    }
    return reply.send(file.stream);
  });

  app.post<{
    Params: { slug: string };
    Body: { fingerprint?: string; localId?: string };
  }>("/api/posts/:slug/view", async (request, reply) => {
    const post = await repository.getPostBySlug(request.params.slug);
    if (!post || post.visibility !== "public") {
      return reply.code(404).send(errorBody("POST_NOT_FOUND", "文章不存在"));
    }
    const date = new Date().toISOString().slice(0, 10);
    const visitorKey = hashVisitorKey({
      ip: request.ip,
      fingerprint: request.body?.fingerprint ?? null,
      localId: request.body?.localId ?? null,
      date,
      salt: process.env.VISITOR_HASH_SALT ?? "freedompost-dev"
    });
    const result = await repository.recordView({
      postSlug: request.params.slug,
      viewDate: date,
      visitorKey,
      ipHash: sha256(request.ip),
      fingerprintHash: request.body?.fingerprint ? sha256(request.body.fingerprint) : null,
      localIdHash: request.body?.localId ? sha256(request.body.localId) : null
    });

    if (!result) {
      return reply.code(404).send(errorBody("POST_NOT_FOUND", "文章不存在"));
    }

    return result;
  });

  app.get<{ Params: { slug: string } }>("/api/posts/:slug/comments", async (request, reply) => {
    const post = await repository.getPostBySlug(request.params.slug);
    if (!post || post.visibility !== "public") {
      return reply.code(404).send(errorBody("POST_NOT_FOUND", "文章不存在"));
    }
    return { items: await repository.listComments(request.params.slug), nextCursor: null };
  });

  app.post<{ Params: { slug: string } }>("/api/posts/:slug/comment-attachments", async (request, reply) => {
    const post = await repository.getPostBySlug(request.params.slug);
    if (!post || post.visibility !== "public") {
      return reply.code(404).send(errorBody("POST_NOT_FOUND", "文章不存在"));
    }

    const file = await request.file();
    if (!file) {
      return reply.code(400).send(errorBody("NO_FILE", "请选择要上传的文件"));
    }

    try {
      const buffer = await file.toBuffer();
      if (buffer.byteLength > COMMENT_ATTACHMENT_MAX_BYTES) {
        return reply.code(413).send(errorBody("ATTACHMENT_TOO_LARGE", "附件不能超过 500MB"));
      }

      const stored = await storage.putObject({
        buffer,
        originalFilename: file.filename,
        mimeType: file.mimetype || "application/octet-stream",
        namespace: "comments"
      });

      return {
        file: {
          id: stored.sha256,
          name: stored.originalFilename,
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
          url: stored.publicUrl,
          storageProvider: stored.storageProvider,
          storageKey: stored.storageKey,
          storedFilename: stored.storedFilename,
          sha256: stored.sha256
        }
      };
    } catch (error) {
      if (error instanceof UploadRejectedError) {
        return reply.code(400).send(errorBody("UNSUPPORTED_UPLOAD", "不支持的文件类型"));
      }
      request.log.error(error);
      return reply.code(500).send(errorBody("UPLOAD_FAILED", "附件上传失败"));
    }
  });

  app.post<{
    Params: { slug: string };
    Body: {
      parentId?: string | null;
      content?: string;
      attachmentIds?: string[];
      attachments?: Comment["attachments"];
      fingerprint?: string;
      localId?: string;
      captchaToken?: string | null;
    };
  }>("/api/posts/:slug/comments", async (request, reply) => {
    const post = await repository.getPostBySlug(request.params.slug);
    if (!post || post.visibility !== "public") {
      return reply.code(404).send(errorBody("POST_NOT_FOUND", "文章不存在"));
    }

    const rawContent = request.body?.content ?? "";
    const attachments = normalizeCommentAttachments(request.body?.attachments);
    const attachmentBytes = attachments.reduce((sum, item) => sum + item.sizeBytes, 0);

    if (!rawContent.trim() && attachments.length === 0) {
      return reply.code(400).send(errorBody("EMPTY_COMMENT", "评论内容或附件至少需要一项"));
    }

    if (rawContent.length > COMMENT_MAX_LENGTH) {
      return reply.code(400).send(errorBody("COMMENT_TOO_LONG", "评论不能超过 10000 字"));
    }

    if (attachmentBytes > COMMENT_ATTACHMENT_MAX_BYTES) {
      return reply.code(413).send(errorBody("ATTACHMENTS_TOO_LARGE", "单条评论附件总量不能超过 500MB"));
    }

    const rateResult = checkCommentRate({
      postId: post.id,
      ip: request.ip,
      ...(request.body?.fingerprint ? { fingerprint: request.body.fingerprint } : {}),
      ...(request.body?.localId ? { localId: request.body.localId } : {})
    });

    if (rateResult === "daily-limit") {
      return reply.code(429).send(errorBody("DAILY_LIMIT", "该文章今日评论次数已达上限"));
    }

    if (rateResult === "captcha-required" && !request.body?.captchaToken) {
      return reply.code(429).send(errorBody("CAPTCHA_REQUIRED", "评论频率异常，需要验证码"));
    }

    const comment = await repository.createComment({
      postSlug: post.slug,
      parentId: request.body?.parentId ?? null,
      username: randomUsername(request.body?.localId ?? request.ip),
      content: sanitizeCommentText(rawContent),
      attachments,
      fingerprintHash: request.body?.fingerprint ? sha256(request.body.fingerprint) : null,
      localIdHash: request.body?.localId ? sha256(request.body.localId) : null,
      ipHash: sha256(request.ip)
    });

    if (!comment) {
      return reply.code(404).send(errorBody("POST_NOT_FOUND", "文章不存在"));
    }

    return reply.code(201).send(comment);
  });

  app.post<{
    Body: { username?: string; password?: string };
  }>("/api/admin/login", async (request, reply) => {
    const username = request.body?.username ?? "";
    const password = request.body?.password ?? "";
    const expectedUser = process.env.ADMIN_USERNAME ?? "admin";
    const expectedHash = process.env.ADMIN_PASSWORD_HASH;
    const expectedPlain = process.env.ADMIN_PASSWORD ?? "freedompost-dev";
    const passwordOk = expectedHash ? await bcrypt.compare(password, expectedHash) : password === expectedPlain;

    if (username !== expectedUser || !passwordOk) {
      return reply.code(401).send(errorBody("BAD_CREDENTIALS", "账号或密码错误"));
    }

    const token = newToken();
    sessions.set(sha256(token), {
      username,
      createdAt: new Date().toISOString()
    });

    reply.setCookie("fp_session", token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: shouldUseSecureCookies(),
      maxAge: 60 * 60 * 24 * 365
    });

    return { ok: true };
  });

  app.post("/api/admin/logout", async (request, reply) => {
    const token = request.cookies.fp_session;
    if (token) sessions.delete(sha256(token));
    reply.clearCookie("fp_session", { path: "/" });
    return { ok: true };
  });

  app.get("/api/admin/session", async (request, reply) => {
    const session = getSession(request.cookies.fp_session);
    if (!session) {
      return reply.code(401).send(errorBody("UNAUTHENTICATED", "未登录"));
    }
    return { admin: session };
  });

  app.get("/api/admin/posts", async (request, reply) => {
    if (!getSession(request.cookies.fp_session)) {
      return reply.code(401).send(errorBody("UNAUTHENTICATED", "未登录"));
    }
    return {
      items: await repository.listPosts()
    };
  });

  app.get("/api/admin/products", async (request, reply) => {
    if (!getSession(request.cookies.fp_session)) {
      return reply.code(401).send(errorBody("UNAUTHENTICATED", "未登录"));
    }
    return { items: await repository.listProducts() };
  });

  app.get("/api/admin/tools", async (request, reply) => {
    if (!getSession(request.cookies.fp_session)) return reply.code(401).send(errorBody("UNAUTHENTICATED", "未登录"));
    return { items: await repository.listTools() };
  });

  app.post<{ Body: unknown }>("/api/admin/tools", async (request, reply) => {
    if (!getSession(request.cookies.fp_session)) return reply.code(401).send(errorBody("UNAUTHENTICATED", "未登录"));
    const input = normalizeToolInput(request.body);
    if (!input) return reply.code(400).send(errorBody("INVALID_TOOL", "工具信息不完整或格式不正确"));
    return reply.code(201).send(await repository.createTool(input));
  });

  app.put<{ Params: { id: string }; Body: unknown }>("/api/admin/tools/:id", async (request, reply) => {
    if (!getSession(request.cookies.fp_session)) return reply.code(401).send(errorBody("UNAUTHENTICATED", "未登录"));
    const input = normalizeToolInput(request.body);
    if (!input) return reply.code(400).send(errorBody("INVALID_TOOL", "工具信息不完整或格式不正确"));
    const existing = await repository.getToolById(request.params.id);
    if (!existing) return reply.code(404).send(errorBody("TOOL_NOT_FOUND", "工具不存在"));
    const removedCoverKey = existing.coverUrl !== input.coverUrl && existing.coverUrl ? managedStorageKeyFromUrl(existing.coverUrl) : null;
    const updated = await repository.updateTool(request.params.id, input);
    if (!updated) return reply.code(404).send(errorBody("TOOL_NOT_FOUND", "工具不存在"));
    if (removedCoverKey) await deleteUnreferencedManagedAssets({ candidateKeys: [removedCoverKey], repository, storage }).catch((error) => request.log.warn({ error }, "Removed tool cover cleanup failed"));
    return updated;
  });

  app.delete<{ Params: { id: string } }>("/api/admin/tools/:id", async (request, reply) => {
    if (!getSession(request.cookies.fp_session)) return reply.code(401).send(errorBody("UNAUTHENTICATED", "未登录"));
    const existing = await repository.getToolById(request.params.id);
    if (!existing) return reply.code(404).send(errorBody("TOOL_NOT_FOUND", "工具不存在"));
    const deleted = await repository.deleteTool(request.params.id);
    if (!deleted) return reply.code(404).send(errorBody("TOOL_NOT_FOUND", "工具不存在"));
    const coverKey = existing.coverUrl ? managedStorageKeyFromUrl(existing.coverUrl) : null;
    if (coverKey) await deleteUnreferencedManagedAssets({ candidateKeys: [coverKey], repository, storage }).catch((error) => request.log.warn({ error }, "Deleted tool cover cleanup failed"));
    return { ok: true };
  });

  app.get("/api/admin/affiliates", async (request, reply) => {
    if (!getSession(request.cookies.fp_session)) return reply.code(401).send(errorBody("UNAUTHENTICATED", "未登录"));
    return { items: await repository.listAffiliates() };
  });

  app.patch<{ Params: { id: string }; Body: unknown }>("/api/admin/affiliates/:id", async (request, reply) => {
    if (!getSession(request.cookies.fp_session)) return reply.code(401).send(errorBody("UNAUTHENTICATED", "未登录"));
    const status = (request.body as Record<string, unknown> | null)?.status;
    if (status !== "active" && status !== "disabled") return reply.code(400).send(errorBody("INVALID_STATUS", "推广者状态不正确"));
    const updated = await repository.updateAffiliateStatus(request.params.id, status);
    return updated ? { ok: true } : reply.code(404).send(errorBody("AFFILIATE_NOT_FOUND", "推广者不存在"));
  });

  app.post<{ Params: { id: string } }>("/api/admin/affiliates/:id/reset-password", async (request, reply) => {
    if (!getSession(request.cookies.fp_session)) return reply.code(401).send(errorBody("UNAUTHENTICATED", "未登录"));
    const queryPassword = generateQueryPassword();
    const updated = await repository.updateAffiliatePassword(request.params.id, await bcrypt.hash(queryPassword, 12));
    return updated ? { queryPassword } : reply.code(404).send(errorBody("AFFILIATE_NOT_FOUND", "推广者不存在"));
  });

  app.get("/api/admin/affiliate-orders", async (request, reply) => {
    if (!getSession(request.cookies.fp_session)) return reply.code(401).send(errorBody("UNAUTHENTICATED", "未登录"));
    return { items: await repository.listAffiliateOrders() };
  });

  app.patch<{ Params: { id: string }; Body: unknown }>("/api/admin/affiliate-orders/:id", async (request, reply) => {
    if (!getSession(request.cookies.fp_session)) return reply.code(401).send(errorBody("UNAUTHENTICATED", "未登录"));
    const body = request.body as Record<string, unknown> | null;
    const orderStatus = normalizeOrderStatus(body?.orderStatus);
    let commissionStatus = normalizeCommissionStatus(body?.commissionStatus);
    if (!orderStatus || !commissionStatus) return reply.code(400).send(errorBody("INVALID_STATUS", "订单或佣金状态不正确"));
    if (orderStatus !== "completed") commissionStatus = "not_due";
    if (orderStatus === "completed" && commissionStatus === "not_due") commissionStatus = "pending";
    const updated = await repository.updateAffiliateOrder(request.params.id, orderStatus, commissionStatus);
    return updated ?? reply.code(404).send(errorBody("ORDER_NOT_FOUND", "订单不存在"));
  });

  app.post<{ Body: unknown }>("/api/admin/products", async (request, reply) => {
    if (!getSession(request.cookies.fp_session)) {
      return reply.code(401).send(errorBody("UNAUTHENTICATED", "未登录"));
    }
    const input = normalizeProductInput(request.body);
    if (!input) return reply.code(400).send(errorBody("INVALID_PRODUCT", "商品信息不完整或格式不正确"));
    return reply.code(201).send(await repository.createProduct(input));
  });

  app.put<{ Params: { id: string }; Body: unknown }>("/api/admin/products/:id", async (request, reply) => {
    if (!getSession(request.cookies.fp_session)) {
      return reply.code(401).send(errorBody("UNAUTHENTICATED", "未登录"));
    }
    const input = normalizeProductInput(request.body);
    if (!input) return reply.code(400).send(errorBody("INVALID_PRODUCT", "商品信息不完整或格式不正确"));
    const existing = await repository.getProductById(request.params.id);
    if (!existing) return reply.code(404).send(errorBody("PRODUCT_NOT_FOUND", "商品不存在"));
    const removedCoverKey = existing.coverUrl !== input.coverUrl && existing.coverUrl
      ? managedStorageKeyFromUrl(existing.coverUrl)
      : null;
    const updated = await repository.updateProduct(request.params.id, input);
    if (!updated) return reply.code(404).send(errorBody("PRODUCT_NOT_FOUND", "商品不存在"));
    if (removedCoverKey) {
      await deleteUnreferencedManagedAssets({ candidateKeys: [removedCoverKey], repository, storage }).catch((error) => {
        request.log.warn({ error }, "Removed product cover cleanup failed");
      });
    }
    return updated;
  });

  app.delete<{ Params: { id: string } }>("/api/admin/products/:id", async (request, reply) => {
    if (!getSession(request.cookies.fp_session)) {
      return reply.code(401).send(errorBody("UNAUTHENTICATED", "未登录"));
    }
    const existing = await repository.getProductById(request.params.id);
    if (!existing) return reply.code(404).send(errorBody("PRODUCT_NOT_FOUND", "商品不存在"));
    const coverKey = existing.coverUrl ? managedStorageKeyFromUrl(existing.coverUrl) : null;
    const deleted = await repository.deleteProduct(request.params.id);
    if (!deleted) return reply.code(404).send(errorBody("PRODUCT_NOT_FOUND", "商品不存在"));
    if (coverKey) {
      await deleteUnreferencedManagedAssets({ candidateKeys: [coverKey], repository, storage }).catch((error) => {
        request.log.warn({ error }, "Deleted product cover cleanup failed");
      });
    }
    return { ok: true };
  });

  app.post("/api/admin/attachments", async (request, reply) => {
    if (!getSession(request.cookies.fp_session)) {
      return reply.code(401).send(errorBody("UNAUTHENTICATED", "未登录"));
    }

    const file = await request.file();
    if (!file) {
      return reply.code(400).send(errorBody("NO_FILE", "请选择要上传的文件"));
    }

    try {
      const buffer = await file.toBuffer();
      const stored = await storage.putObject({
        buffer,
        originalFilename: file.filename,
        mimeType: file.mimetype,
        namespace: "admin"
      });

      return {
        file: {
          id: stored.sha256,
          name: stored.originalFilename,
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
          url: stored.publicUrl,
          storageProvider: stored.storageProvider,
          storageKey: stored.storageKey,
          storedFilename: stored.storedFilename
        }
      };
    } catch (error) {
      if (error instanceof UploadRejectedError) {
        return reply.code(400).send(errorBody("UNSUPPORTED_UPLOAD", "不支持的文件类型"));
      }
      request.log.error(error);
      return reply.code(500).send(errorBody("UPLOAD_FAILED", "文件上传失败"));
    }
  });

  app.post<{
    Body: { title?: string; markdown?: string; visibility?: string };
  }>("/api/admin/posts", async (request, reply) => {
    if (!getSession(request.cookies.fp_session)) {
      return reply.code(401).send(errorBody("UNAUTHENTICATED", "未登录"));
    }

    const post = await repository.createPost({
      title: request.body?.title?.trim() || "未命名文章",
      markdown: request.body?.markdown ?? "",
      visibility: request.body?.visibility === "private" ? "private" : "public"
    });

    return reply.code(201).send(post);
  });

  app.put<{
    Params: { id: string };
    Body: { title?: string; markdown?: string; visibility?: string };
  }>("/api/admin/posts/:id", async (request, reply) => {
    if (!getSession(request.cookies.fp_session)) {
      return reply.code(401).send(errorBody("UNAUTHENTICATED", "未登录"));
    }

    const existing = await repository.getPostById(request.params.id);
    if (!existing) {
      return reply.code(404).send(errorBody("POST_NOT_FOUND", "文章不存在"));
    }

    const nextMarkdown = request.body?.markdown ?? existing.markdown;
    const removedAssetKeys = diffRemovedManagedStorageKeys(existing.markdown, nextMarkdown);
    const updated = await repository.updatePost({
      id: request.params.id,
      title: request.body?.title?.trim() || existing.title,
      markdown: nextMarkdown,
      visibility: request.body?.visibility === "private" ? "private" : request.body?.visibility === "public" ? "public" : existing.visibility
    });

    if (!updated) {
      return reply.code(404).send(errorBody("POST_NOT_FOUND", "文章不存在"));
    }

    await deleteUnreferencedManagedAssets({
      candidateKeys: removedAssetKeys,
      repository,
      storage
    })
      .then((result) => {
        if (result.failed.length > 0) {
          request.log.warn({ failed: result.failed }, "Some removed post assets could not be deleted");
        }
      })
      .catch((error) => {
        request.log.warn({ error }, "Removed post asset cleanup failed");
      });

    return updated;
  });

  app.delete<{ Params: { id: string } }>("/api/admin/posts/:id", async (request, reply) => {
    if (!getSession(request.cookies.fp_session)) {
      return reply.code(401).send(errorBody("UNAUTHENTICATED", "未登录"));
    }

    const existing = await repository.getPostById(request.params.id);
    if (!existing) {
      return reply.code(404).send(errorBody("POST_NOT_FOUND", "文章不存在"));
    }

    const comments = await repository.listComments(existing.slug);
    const deletionCandidateKeys = collectPostDeletionCandidateKeys(existing, comments);
    const deletionAttachmentIds = comments.flatMap((comment) =>
      comment.attachments.map((attachment) => attachment.id).filter(Boolean)
    );
    const deleted = await repository.deletePost(request.params.id);
    if (!deleted) {
      return reply.code(404).send(errorBody("POST_NOT_FOUND", "文章不存在"));
    }

    await deleteUnreferencedManagedAssets({
      candidateKeys: deletionCandidateKeys,
      repository,
      storage
    })
      .then((result) => {
        if (result.failed.length > 0) {
          request.log.warn({ failed: result.failed }, "Some deleted post assets could not be deleted");
        }
      })
      .catch((error) => {
        request.log.warn({ error }, "Deleted post asset cleanup failed");
      });

    await repository.deleteAttachmentsByIds(deletionAttachmentIds).catch((error) => {
      request.log.warn({ error }, "Deleted post attachment metadata cleanup failed");
    });

    return { ok: true };
  });

  return app;
}

function getSession(token: string | undefined) {
  if (!token) return null;
  return sessions.get(sha256(token)) ?? null;
}

function normalizeProductInput(value: unknown): ProductInput | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const title = readText(input.title, 120);
  const summary = readText(input.summary, 500);
  const description = readText(input.description, 12_000);
  const category = readText(input.category, 32) || "other";
  const currency = (readText(input.currency, 8) || "CNY").toUpperCase();
  const coverUrl = readOptionalUrl(input.coverUrl);
  const status = input.status === "published" ? "published" : input.status === "draft" ? "draft" : null;
  const priceCents = readInteger(input.priceCents, 0, 100_000_000);
  const commissionCents = readInteger(input.commissionCents ?? 0, 0, 100_000_000);
  const compareAtCents = input.compareAtCents === null || input.compareAtCents === "" ? null : readInteger(input.compareAtCents, 0, 100_000_000);
  const stock = readInteger(input.stock, -1, 1_000_000);
  const soldCount = readInteger(input.soldCount ?? 0, 0, 1_000_000);
  const sortOrder = readInteger(input.sortOrder, -100_000, 100_000);

  if (!title || !summary || !description || !status || priceCents === null || commissionCents === null || stock === null || soldCount === null || sortOrder === null) return null;
  if (compareAtCents === undefined || (compareAtCents !== null && compareAtCents < priceCents)) return null;

  return { title, summary, description, category, priceCents, commissionCents, compareAtCents, currency, stock, soldCount, coverUrl, status, sortOrder };
}

function normalizeToolInput(value: unknown): ToolInput | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const title = readText(input.title, 120);
  const summary = readText(input.summary, 500);
  const description = readText(input.description, 12_000);
  const category = readText(input.category, 32) || "other";
  const url = readRequiredUrl(input.url);
  const coverUrl = readOptionalUrl(input.coverUrl);
  const status = input.status === "published" ? "published" : input.status === "draft" ? "draft" : null;
  const sortOrder = readInteger(input.sortOrder, -100_000, 100_000);
  if (!title || !summary || !description || !url || !status || sortOrder === null) return null;
  return { title, summary, description, category, url, coverUrl, status, sortOrder };
}

function getAffiliateSession(token: string | undefined) {
  if (!token) return null;
  return affiliateSessions.get(sha256(token)) ?? null;
}

function normalizeWechatId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^[A-Za-z][A-Za-z0-9_-]{5,31}$/.test(normalized) ? normalized : null;
}

function normalizeOrderStatus(value: unknown): AffiliateOrderStatus | null {
  return value === "pending" || value === "completed" || value === "canceled" ? value : null;
}

function normalizeCommissionStatus(value: unknown): AffiliateCommissionStatus | null {
  return value === "not_due" || value === "pending" || value === "paid" ? value : null;
}

function generateQueryPassword(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
}

function affiliateShareUrl(wechatId: string): string {
  const publicSite = (process.env.PUBLIC_SITE_URL ?? "https://freedompost.thinderbox.uk").replace(/\/$/, "");
  return `${publicSite}/market/?ref=${encodeURIComponent(wechatId)}`;
}

function allowRequest(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (rateBuckets.get(key) ?? []).filter((value) => value > now - windowMs);
  if (recent.length >= limit) {
    rateBuckets.set(key, recent);
    return false;
  }
  recent.push(now);
  rateBuckets.set(key, recent);
  return true;
}

function readText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function readInteger(value: unknown, min: number, max: number): number | null {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isInteger(numberValue) && numberValue >= min && numberValue <= max ? numberValue : null;
}

function readOptionalUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 2_000) return null;
  try {
    const url = new URL(value, "http://freedompost.local");
    return url.protocol === "http:" || url.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

function readRequiredUrl(value: unknown): string | null {
  const url = readOptionalUrl(value);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function checkCommentRate(input: {
  postId: string;
  ip: string;
  fingerprint?: string;
  localId?: string;
}): "ok" | "daily-limit" | "captcha-required" {
  const subject = sha256([input.ip, input.fingerprint ?? "", input.localId ?? ""].join(":"));
  const today = new Date().toISOString().slice(0, 10);
  const now = Date.now();
  const dayKey = `${input.postId}:day:${today}:${subject}`;
  const fiveMinKey = `${input.postId}:5min:${subject}`;
  const dayItems = rateBuckets.get(dayKey) ?? [];
  const fiveMinItems = (rateBuckets.get(fiveMinKey) ?? []).filter((time) => now - time < 5 * 60 * 1000);

  if (dayItems.length >= 5) return "daily-limit";
  if (fiveMinItems.length >= 3) return "captcha-required";

  rateBuckets.set(dayKey, [...dayItems, now]);
  rateBuckets.set(fiveMinKey, [...fiveMinItems, now]);
  return "ok";
}

function randomUsername(seed: string): string {
  const hash = sha256(seed || "anonymous");
  const left = Number.parseInt(hash.slice(0, 4), 16);
  const right = Number.parseInt(hash.slice(4, 8), 16);
  return `${adjectives[left % adjectives.length]}${nouns[right % nouns.length]}`;
}

function errorBody(code: string, message: string) {
  return {
    error: {
      code,
      message
    }
  };
}

function normalizeCommentAttachments(value: unknown): Comment["attachments"] {
  if (!Array.isArray(value)) return [];

  return value.slice(0, 10).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const source = item as Partial<Comment["attachments"][number]>;
    const name = String(source.name ?? "").trim().slice(0, 240);
    const mimeType = String(source.mimeType ?? "").trim().slice(0, 255) || "application/octet-stream";
    const sizeBytes = Number(source.sizeBytes);
    const url = String(source.url ?? "").trim();

    if (!name || !Number.isFinite(sizeBytes) || sizeBytes < 0 || !isSafeAttachmentUrl(url)) {
      return [];
    }

    return [
      {
        id: String(source.id ?? crypto.randomUUID()).slice(0, 128),
        name,
        mimeType,
        sizeBytes,
        url,
        ...(isStorageProvider(source.storageProvider)
          ? { storageProvider: source.storageProvider }
          : {}),
        ...(source.storageKey ? { storageKey: String(source.storageKey).slice(0, 1024) } : {}),
        ...(source.storedFilename ? { storedFilename: String(source.storedFilename).slice(0, 255) } : {}),
        ...(source.sha256 ? { sha256: String(source.sha256).slice(0, 128) } : {})
      }
    ];
  });
}

function isSafeAttachmentUrl(url: string): boolean {
  if (url.startsWith("/api/uploads/")) return true;

  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isStorageProvider(value: unknown): value is "local" | "oss" | "r2" {
  return value === "local" || value === "oss" || value === "r2";
}
