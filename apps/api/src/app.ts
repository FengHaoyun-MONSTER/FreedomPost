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
import { createContentRepository, type ContentRepository } from "./repositories/index.js";
import { createStorageAdapter, getLocalUploadStream } from "./storage.js";

const sessions = new Map<string, { username: string; createdAt: string }>();
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

  app.get<{ Params: { slug: string } }>("/api/posts/:slug", async (request, reply) => {
    const post = await repository.getPostBySlug(request.params.slug);
    if (!post) {
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
    return reply.send(file.stream);
  });

  app.post<{
    Params: { slug: string };
    Body: { fingerprint?: string; localId?: string };
  }>("/api/posts/:slug/view", async (request, reply) => {
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

  app.get<{ Params: { slug: string } }>("/api/posts/:slug/comments", async (request) => ({
    items: await repository.listComments(request.params.slug),
    nextCursor: null
  }));

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
    if (!post) {
      return reply.code(404).send(errorBody("POST_NOT_FOUND", "文章不存在"));
    }

    const rawContent = request.body?.content ?? "";
    const attachments = request.body?.attachments ?? [];
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
          storageKey: stored.storageKey
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
    Body: { title?: string; markdown?: string };
  }>("/api/admin/posts", async (request, reply) => {
    if (!getSession(request.cookies.fp_session)) {
      return reply.code(401).send(errorBody("UNAUTHENTICATED", "未登录"));
    }

    const post = await repository.createPost({
      title: request.body?.title?.trim() || "未命名文章",
      markdown: request.body?.markdown ?? ""
    });

    return reply.code(201).send(post);
  });

  app.put<{
    Params: { id: string };
    Body: { title?: string; markdown?: string };
  }>("/api/admin/posts/:id", async (request, reply) => {
    if (!getSession(request.cookies.fp_session)) {
      return reply.code(401).send(errorBody("UNAUTHENTICATED", "未登录"));
    }

    const existing = await repository.getPostById(request.params.id);
    if (!existing) {
      return reply.code(404).send(errorBody("POST_NOT_FOUND", "文章不存在"));
    }

    const updated = await repository.updatePost({
      id: request.params.id,
      title: request.body?.title?.trim() || existing.title,
      markdown: request.body?.markdown ?? existing.markdown
    });

    if (!updated) {
      return reply.code(404).send(errorBody("POST_NOT_FOUND", "文章不存在"));
    }

    return updated;
  });

  app.delete<{ Params: { id: string } }>("/api/admin/posts/:id", async (request, reply) => {
    if (!getSession(request.cookies.fp_session)) {
      return reply.code(401).send(errorBody("UNAUTHENTICATED", "未登录"));
    }

    const deleted = await repository.deletePost(request.params.id);
    if (!deleted) {
      return reply.code(404).send(errorBody("POST_NOT_FOUND", "文章不存在"));
    }

    return { ok: true };
  });

  return app;
}

function getSession(token: string | undefined) {
  if (!token) return null;
  return sessions.get(sha256(token)) ?? null;
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
