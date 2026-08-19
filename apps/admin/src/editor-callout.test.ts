import { describe, expect, it } from "vitest";
import { CALLOUT_DEFAULT_EMOJI, CALLOUT_EMOJI_OPTIONS } from "@freedompost/shared";
import { editorCalloutHtml } from "./editor-callout.js";

describe("editorCalloutHtml", () => {
  it("creates an editable content area and a non-editable accessible emoji picker", () => {
    const html = editorCalloutHtml("<p>Hello</p>", "💡");

    expect(html).toContain('data-fp-type="callout"');
    expect(html).toContain('data-emoji="💡"');
    expect(html).toContain('class="editor-callout-content"');
    expect(html).toContain("<p>Hello</p>");
    expect(html).toContain('contenteditable="false"');
    expect(html).toContain('aria-label="更换高亮块图标"');
    expect(html.match(/data-callout-emoji-option=/g)).toHaveLength(CALLOUT_EMOJI_OPTIONS.length);
  });

  it("falls back to the default emoji and an empty paragraph", () => {
    const html = editorCalloutHtml("", "<script>");

    expect(html).toContain(`data-emoji="${CALLOUT_DEFAULT_EMOJI}"`);
    expect(html).toContain("<p><br></p>");
    expect(html).not.toContain("<script>");
  });
});
