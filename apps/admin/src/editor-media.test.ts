import { describe, expect, it } from "vitest";
import {
  editorImageHtml,
  editorImagesMarkdown,
  editorYouTubeHtml,
  normalizeEditorImageAlt
} from "./editor-media.js";

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

  it("serializes every image when the browser nests consecutive pasted figures", () => {
    const markdown = editorImagesMarkdown(
      Array.from({ length: 10 }, (_, index) => ({
        src: `https://pic.example.com/${index + 1}.webp`,
        alt: `图片 ${index + 1}`
      }))
    );

    expect(markdown.match(/!\[/g)).toHaveLength(10);
    expect(markdown).toContain("https://pic.example.com/10.webp");
  });
});

describe("editor YouTube markup", () => {
  it("uses the privacy-enhanced YouTube player", () => {
    const html = editorYouTubeHtml({ videoId: "dQw4w9WgXcQ", startSeconds: 62 });

    expect(html).toContain('class="editor-youtube"');
    expect(html).toContain('data-video-id="dQw4w9WgXcQ"');
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=62"');
    expect(html).toContain("allowfullscreen");
  });
});
