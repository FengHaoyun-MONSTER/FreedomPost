// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { focusEditorStart, insertBlockPlaceholderAtSelection } from "./editor-selection.js";

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

describe("insertBlockPlaceholderAtSelection", () => {
  it("inserts beside the selected paragraph inside nested pasted markup", () => {
    const editor = document.createElement("div");
    editor.innerHTML =
      '<div data-source="wechat"><div><p>第一步</p><p>第二步：点击</p><p>第三步</p></div></div>';
    document.body.append(editor);

    const secondStep = editor.querySelectorAll("p")[1]!;
    const range = document.createRange();
    range.selectNodeContents(secondStep);
    range.collapse(false);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const placeholder = document.createElement("div");
    placeholder.dataset.fpType = "pending-media";
    insertBlockPlaceholderAtSelection(editor, placeholder, selection);

    expect(placeholder.previousElementSibling).toBe(secondStep);
    expect(placeholder.nextElementSibling?.textContent).toBe("第三步");
  });

  it("splits a paragraph when the caret is in the middle of its text", () => {
    const editor = document.createElement("div");
    editor.innerHTML = "<div><p>第二步：点击这里继续</p></div>";
    document.body.append(editor);

    const paragraph = editor.querySelector("p")!;
    const range = document.createRange();
    range.setStart(paragraph.firstChild!, "第二步：点击".length);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const placeholder = document.createElement("div");
    insertBlockPlaceholderAtSelection(editor, placeholder, selection);

    expect(placeholder.previousElementSibling?.textContent).toBe("第二步：点击");
    expect(placeholder.nextElementSibling?.textContent).toBe("这里继续");
  });

  it("replaces an empty caret paragraph without adding an extra blank line", () => {
    const editor = document.createElement("div");
    editor.innerHTML = "<div><p>第二步：点击</p><p><br></p><p>第三步</p></div>";
    document.body.append(editor);

    const emptyParagraph = editor.querySelectorAll("p")[1]!;
    const range = document.createRange();
    range.selectNodeContents(emptyParagraph);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const placeholder = document.createElement("div");
    insertBlockPlaceholderAtSelection(editor, placeholder, selection);

    expect(emptyParagraph.isConnected).toBe(false);
    expect(placeholder.previousElementSibling?.textContent).toBe("第二步：点击");
    expect(placeholder.nextElementSibling?.textContent).toBe("第三步");
  });

  it("keeps an insertion inside a callout block", () => {
    const editor = document.createElement("div");
    editor.innerHTML =
      '<div data-fp-type="callout"><div class="editor-callout-content"><p>提示正文</p></div></div>';
    document.body.append(editor);

    const paragraph = editor.querySelector("p")!;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const placeholder = document.createElement("div");
    insertBlockPlaceholderAtSelection(editor, placeholder, selection);

    expect(placeholder.parentElement).toBe(editor.querySelector(".editor-callout-content"));
  });
});

describe("focusEditorStart", () => {
  it("places the caret at the beginning of an empty editor paragraph", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.innerHTML = "<p><br></p>";
    document.body.append(editor);

    focusEditorStart(editor);

    const range = window.getSelection()!.getRangeAt(0);
    expect(document.activeElement).toBe(editor);
    expect(range.startContainer).toBe(editor.firstElementChild);
    expect(range.startOffset).toBe(0);
    expect(range.collapsed).toBe(true);
  });
});
