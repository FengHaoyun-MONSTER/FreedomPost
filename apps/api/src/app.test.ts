import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractManagedStorageKeys } from "./asset-cleanup.js";
import { buildApp } from "./app.js";
import { MemoryContentRepository } from "./repositories/index.js";
import { renderStoredPost } from "./repositories/post-utils.js";

describe("api app", () => {
  it("serves health checks", async () => {
    const app = buildApp({ repository: new MemoryContentRepository() });
    const response = await app.inject({ method: "GET", url: "/health" });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, service: "freedompost-api" });
  });

  it("records one view per visitor key per day", async () => {
    const app = buildApp({ repository: new MemoryContentRepository() });

    const first = await app.inject({
      method: "POST",
      url: "/api/posts/welcome/view",
      payload: { localId: "device-a" }
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/posts/welcome/view",
      payload: { localId: "device-a" }
    });
    await app.close();

    expect(first.statusCode).toBe(200);
    expect(first.json().counted).toBe(true);
    expect(second.json().counted).toBe(false);
  });

  it("returns saved comment attachment metadata", async () => {
    const app = buildApp({ repository: new MemoryContentRepository() });
    const attachment = {
      id: "attachment-a",
      name: "image.png",
      mimeType: "image/png",
      sizeBytes: 128,
      url: "https://cdn.example.test/image.png"
    };

    const created = await app.inject({
      method: "POST",
      url: "/api/posts/welcome/comments",
      payload: {
        content: "with attachment",
        attachments: [attachment],
        localId: "device-attachment"
      }
    });
    const listed = await app.inject({ method: "GET", url: "/api/posts/welcome/comments" });
    await app.close();

    expect(created.statusCode).toBe(201);
    expect(created.json().attachments).toMatchObject([attachment]);
    expect(listed.json().items[0].attachments).toMatchObject([attachment]);
  });

  it("uploads comment attachments", async () => {
    const previousRoot = process.env.LOCAL_STORAGE_ROOT;
    const root = await mkdtemp(path.join(tmpdir(), "freedompost-upload-test-"));
    process.env.LOCAL_STORAGE_ROOT = root;
    const app = buildApp({ repository: new MemoryContentRepository() });
    const boundary = "----freedompost-test-boundary";
    const payload = Buffer.from(
      [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="note.txt"',
        "Content-Type: text/plain",
        "",
        "hello attachment",
        `--${boundary}--`,
        ""
      ].join("\r\n")
    );

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/posts/welcome/comment-attachments",
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`
        },
        payload
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().file).toMatchObject({
        name: "note.txt",
        mimeType: "text/plain",
        sizeBytes: 16
      });
      expect(response.json().file.url).toContain("/api/uploads/comments/");
    } finally {
      await app.close();
      if (previousRoot === undefined) {
        delete process.env.LOCAL_STORAGE_ROOT;
      } else {
        process.env.LOCAL_STORAGE_ROOT = previousRoot;
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it("extracts managed OSS asset keys without touching external links", () => {
    const previousBaseUrl = process.env.ALIYUN_OSS_PUBLIC_BASE_URL;
    const previousR2BaseUrl = process.env.R2_PUBLIC_BASE_URL;
    const previousPrefix = process.env.ALIYUN_OSS_PREFIX;
    const previousR2Prefix = process.env.R2_PREFIX;
    process.env.ALIYUN_OSS_PUBLIC_BASE_URL = "https://pic.openal.uk";
    process.env.R2_PUBLIC_BASE_URL = "https://r2pic.openal.uk";
    process.env.ALIYUN_OSS_PREFIX = "freedompost/uploads";
    process.env.R2_PREFIX = "freedompost/uploads";

    try {
      expect(
        [...extractManagedStorageKeys(
          [
            "![managed](https://pic.openal.uk/freedompost/uploads/admin/2026/07/05/a.png)",
            "![r2](https://r2pic.openal.uk/freedompost/uploads/comments/2026/07/05/c.png)",
            "![external](https://example.com/freedompost/uploads/admin/2026/07/05/b.png)"
          ].join("\n\n")
        )]
      ).toEqual([
        "freedompost/uploads/admin/2026/07/05/a.png",
        "freedompost/uploads/comments/2026/07/05/c.png"
      ]);
    } finally {
      if (previousBaseUrl === undefined) {
        delete process.env.ALIYUN_OSS_PUBLIC_BASE_URL;
      } else {
        process.env.ALIYUN_OSS_PUBLIC_BASE_URL = previousBaseUrl;
      }

      if (previousR2BaseUrl === undefined) {
        delete process.env.R2_PUBLIC_BASE_URL;
      } else {
        process.env.R2_PUBLIC_BASE_URL = previousR2BaseUrl;
      }

      if (previousPrefix === undefined) {
        delete process.env.ALIYUN_OSS_PREFIX;
      } else {
        process.env.ALIYUN_OSS_PREFIX = previousPrefix;
      }

      if (previousR2Prefix === undefined) {
        delete process.env.R2_PREFIX;
      } else {
        process.env.R2_PREFIX = previousR2Prefix;
      }
    }
  });

  it("deletes removed post assets after saving", async () => {
    await withLocalStorageRoot(async (root) => {
      const removedKey = "admin/2026/07/05/removed.png";
      const keptKey = "admin/2026/07/05/kept.png";
      await writeStoredFile(root, removedKey, "removed");
      await writeStoredFile(root, keptKey, "kept");

      const repository = new MemoryContentRepository([
        testPost({
          id: "post-cleanup",
          slug: "cleanup",
          title: "Cleanup",
          markdown: `![removed](/api/uploads/${removedKey})\n\n![kept](/api/uploads/${keptKey})`
        })
      ]);
      const app = buildApp({ repository });
      const cookie = await adminCookie(app);

      const response = await app.inject({
        method: "PUT",
        url: "/api/admin/posts/post-cleanup",
        headers: { cookie },
        payload: {
          title: "Cleanup",
          markdown: `![kept](/api/uploads/${keptKey})`
        }
      });
      await app.close();

      expect(response.statusCode).toBe(200);
      expect(await fileExists(path.join(root, removedKey))).toBe(false);
      expect(await fileExists(path.join(root, keptKey))).toBe(true);
    });
  });

  it("keeps removed post assets when another post still references them", async () => {
    await withLocalStorageRoot(async (root) => {
      const sharedKey = "admin/2026/07/05/shared.png";
      await writeStoredFile(root, sharedKey, "shared");

      const repository = new MemoryContentRepository([
        testPost({
          id: "post-cleanup",
          slug: "cleanup",
          title: "Cleanup",
          markdown: `![shared](/api/uploads/${sharedKey})`
        }),
        testPost({
          id: "post-other",
          slug: "other",
          title: "Other",
          markdown: `![shared](/api/uploads/${sharedKey})`
        })
      ]);
      const app = buildApp({ repository });
      const cookie = await adminCookie(app);

      const response = await app.inject({
        method: "PUT",
        url: "/api/admin/posts/post-cleanup",
        headers: { cookie },
        payload: {
          title: "Cleanup",
          markdown: "No assets now"
        }
      });
      await app.close();

      expect(response.statusCode).toBe(200);
      expect(await fileExists(path.join(root, sharedKey))).toBe(true);
    });
  });

  it("deletes post and comment assets after deleting a post", async () => {
    await withLocalStorageRoot(async (root) => {
      const postKey = "admin/2026/07/05/post.png";
      const commentKey = "comments/2026/07/05/comment.txt";
      await writeStoredFile(root, postKey, "post");
      await writeStoredFile(root, commentKey, "comment");

      const repository = new MemoryContentRepository([
        testPost({
          id: "post-cleanup",
          slug: "cleanup",
          title: "Cleanup",
          markdown: `![post](/api/uploads/${postKey})`
        })
      ]);
      const app = buildApp({ repository });

      const comment = await app.inject({
        method: "POST",
        url: "/api/posts/cleanup/comments",
        payload: {
          content: "comment with attachment",
          localId: "device-delete-cleanup",
          attachments: [
            {
              id: "comment-attachment",
              name: "comment.txt",
              mimeType: "text/plain",
              sizeBytes: 7,
              url: `/api/uploads/${commentKey}`,
              storageProvider: "local",
              storageKey: commentKey
            }
          ]
        }
      });
      const cookie = await adminCookie(app);
      const deleted = await app.inject({
        method: "DELETE",
        url: "/api/admin/posts/post-cleanup",
        headers: { cookie }
      });
      await app.close();

      expect(comment.statusCode).toBe(201);
      expect(deleted.statusCode).toBe(200);
      expect(await fileExists(path.join(root, postKey))).toBe(false);
      expect(await fileExists(path.join(root, commentKey))).toBe(false);
    });
  });
});

async function adminCookie(app: ReturnType<typeof buildApp>): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/admin/login",
    payload: {
      username: "admin",
      password: "freedompost-dev"
    }
  });
  const cookie = response.headers["set-cookie"];
  return Array.isArray(cookie) ? cookie[0] ?? "" : cookie ?? "";
}

async function withLocalStorageRoot(run: (root: string) => Promise<void>): Promise<void> {
  const previousRoot = process.env.LOCAL_STORAGE_ROOT;
  const previousDriver = process.env.STORAGE_DRIVER;
  const root = await mkdtemp(path.join(tmpdir(), "freedompost-cleanup-test-"));
  process.env.LOCAL_STORAGE_ROOT = root;
  delete process.env.STORAGE_DRIVER;

  try {
    await run(root);
  } finally {
    if (previousRoot === undefined) {
      delete process.env.LOCAL_STORAGE_ROOT;
    } else {
      process.env.LOCAL_STORAGE_ROOT = previousRoot;
    }

    if (previousDriver === undefined) {
      delete process.env.STORAGE_DRIVER;
    } else {
      process.env.STORAGE_DRIVER = previousDriver;
    }

    await rm(root, { recursive: true, force: true });
  }
}

async function writeStoredFile(root: string, key: string, content: string): Promise<void> {
  const target = path.join(root, key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function fileExists(target: string): Promise<boolean> {
  return access(target)
    .then(() => true)
    .catch(() => false);
}

function testPost(input: { id: string; slug: string; title: string; markdown: string }) {
  return renderStoredPost({
    ...input,
    createdAt: "2026-07-05T00:00:00.000Z",
    updatedAt: "2026-07-05T00:00:00.000Z",
    viewCount: 0,
    commentCount: 0,
    attachmentCount: 0
  });
}
