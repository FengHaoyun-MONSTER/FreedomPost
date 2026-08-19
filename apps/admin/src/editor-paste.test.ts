// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { sanitizePastedEditorHtml } from "./editor-paste.js";

describe("sanitizePastedEditorHtml", () => {
  it("removes foreign presentation styles so headings look the same before and after publishing", () => {
    const html = sanitizePastedEditorHtml(
      '<h1 class="source-title" style="font-size:17px;font-weight:400">正文外观的标题</h1><p style="font-size:32px">正文</p>',
      "https://admin.example.com/admin/"
    );

    expect(html).toBe("<h1>正文外观的标题</h1><p>正文</p>");
  });

  it("drops executable markup and unsafe link targets while preserving rich-text semantics", () => {
    const html = sanitizePastedEditorHtml(
      '<script>alert(1)</script><p><strong>安全文本</strong> <a href="javascript:alert(1)" onclick="alert(2)">链接</a></p>',
      "https://admin.example.com/admin/"
    );

    expect(html).toBe("<p><strong>安全文本</strong> <a>链接</a></p>");
  });

  it("keeps uploaded editor images but removes unrelated source attributes", () => {
    const html = sanitizePastedEditorHtml(
      '<figure class="editor-image source-card" data-fp-type="image" style="width:10px"><a href="https://pic.example.com/a.png"><img src="https://pic.example.com/a.png" alt="示例" width="10" onerror="alert(1)"></a></figure>',
      "https://admin.example.com/admin/"
    );

    expect(html).toBe(
      '<figure class="editor-image" data-fp-type="image"><a href="https://pic.example.com/a.png" target="_blank" rel="noreferrer noopener"><img src="https://pic.example.com/a.png" alt="示例"></a></figure>'
    );
  });
});
