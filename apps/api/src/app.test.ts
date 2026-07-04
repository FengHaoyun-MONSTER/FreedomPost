import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { MemoryContentRepository } from "./repositories/index.js";

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
});
