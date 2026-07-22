const defaultImageAlt = "图片";
const imageFilenamePattern = /(?:^|[/\\])[^/\\]+\.(?:avif|bmp|gif|heic|heif|ico|jfif|jpe?g|png|svg|tiff?|webp)$/i;

export function normalizeEditorImageAlt(value: string): string {
  const normalized = value.trim();
  if (!normalized || imageFilenamePattern.test(normalized)) return defaultImageAlt;
  return normalized;
}

export function editorImageHtml(url: string, alt: string): string {
  const safeUrl = escapeAttribute(url);
  const safeAlt = escapeAttribute(normalizeEditorImageAlt(alt));
  return `<figure class="editor-image" data-fp-type="image"><a href="${safeUrl}" target="_blank" rel="noreferrer noopener"><img src="${safeUrl}" alt="${safeAlt}" /></a></figure>`;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
    .replaceAll("\n", "&#10;");
}
