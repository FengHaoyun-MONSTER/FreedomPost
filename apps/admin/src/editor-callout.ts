import {
  CALLOUT_DEFAULT_EMOJI,
  CALLOUT_EMOJI_OPTIONS,
  normalizeCalloutEmoji
} from "@freedompost/shared";

export function editorCalloutHtml(contentHtml: string, emoji: string = CALLOUT_DEFAULT_EMOJI): string {
  const normalizedEmoji = normalizeCalloutEmoji(emoji);
  const options = CALLOUT_EMOJI_OPTIONS.map(
    (option) =>
      `<button type="button" class="editor-callout-emoji-option" data-callout-emoji-option="${option}" role="option" aria-selected="${option === normalizedEmoji}" aria-label="选择 ${option}">${option}</button>`
  ).join("");

  return `<aside class="editor-callout" data-fp-type="callout" data-emoji="${normalizedEmoji}"><div class="editor-callout-emoji-shell" contenteditable="false"><button type="button" class="editor-callout-emoji-trigger" data-callout-emoji-trigger aria-label="更换高亮块图标" aria-expanded="false">${normalizedEmoji}</button><div class="editor-callout-emoji-picker" data-callout-emoji-picker role="listbox" aria-label="高亮块图标" hidden>${options}</div></div><div class="editor-callout-content">${contentHtml || "<p><br></p>"}</div></aside>`;
}
