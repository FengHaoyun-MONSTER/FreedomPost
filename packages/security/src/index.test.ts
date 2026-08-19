import { describe, expect, it } from "vitest";
import { isAllowedUpload, sanitizeArticleHtml, sanitizeCommentText } from "./index.js";

describe("security helpers", () => {
  it("strips comment HTML", () => {
    expect(sanitizeCommentText("<img src=x onerror=alert(1)>hello")).toBe("hello");
  });

  it("requires both extension and MIME family for uploads", () => {
    expect(isAllowedUpload("note.md", "text/markdown")).toBe(true);
    expect(isAllowedUpload("note.exe", "text/plain")).toBe(false);
    expect(isAllowedUpload("Windows电脑_Koala.Clash_x64-setup.exe", "application/x-msdownload")).toBe(true);
    expect(isAllowedUpload("setup.exe", "application/octet-stream")).toBe(true);
    expect(isAllowedUpload("script.sh", "application/octet-stream")).toBe(false);
  });

  it("allows callout structure while removing executable attributes and unknown classes", () => {
    const html = sanitizeArticleHtml(
      '<aside class="fp-callout bad" role="note" onclick="alert(1)"><span class="fp-callout-emoji" aria-hidden="true">💡</span><div class="fp-callout-content"><script>alert(1)</script>Safe</div></aside>'
    );

    expect(html).toContain('<aside class="fp-callout" role="note">');
    expect(html).toContain('class="fp-callout-emoji"');
    expect(html).toContain('class="fp-callout-content"');
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("bad");
    expect(html).not.toContain("script");
  });
});
