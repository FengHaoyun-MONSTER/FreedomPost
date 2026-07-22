import { describe, expect, it } from "vitest";
import { editorImageHtml, normalizeEditorImageAlt } from "./editor-media.js";

describe("editor image markup", () => {
  it("does not insert an uploaded image filename as visible article content", () => {
    const html = editorImageHtml("https://pic.example.com/upload.png", "Screenshot_20260722_155921.jpg");

    expect(html).not.toContain("figcaption");
    expect(html).not.toContain("Screenshot_20260722_155921.jpg");
    expect(html).toContain('alt="图片"');
  });

  it("preserves descriptive alternative text without rendering a caption", () => {
    const html = editorImageHtml("https://pic.example.com/upload.png", "安装完成界面");

    expect(html).toContain('alt="安装完成界面"');
    expect(html).not.toContain("figcaption");
  });

  it("recognizes common image filename extensions", () => {
    expect(normalizeEditorImageAlt(" photo.WEBP ")).toBe("图片");
    expect(normalizeEditorImageAlt("screenshots/result.heic")).toBe("图片");
  });
});
