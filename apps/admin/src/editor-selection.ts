/**
 * Inserts a block placeholder at the current editor selection.
 *
 * Rich HTML copied from sites such as WeChat can wrap the whole article in
 * nested divs. The placeholder must stay next to the nearest editable block,
 * rather than after the editor's outermost wrapper.
 */
export function insertBlockPlaceholderAtSelection(
  editor: HTMLElement,
  placeholder: HTMLElement,
  selection: Selection | null
): void {
  if (selection?.rangeCount) {
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) {
      editor.append(placeholder);
      return;
    }

    const container = closestCalloutContent(range.startContainer, editor) ?? editor;
    range.deleteContents();

    const block = closestSplittableBlock(range.startContainer, container);
    if (block) insertBetweenSplitBlock(range, block, placeholder);
    else range.insertNode(placeholder);
    return;
  }

  editor.append(placeholder);
}

/** Focuses the editor and creates a collapsed caret at its first editable position. */
export function focusEditorStart(editor: HTMLElement, selection: Selection | null = window.getSelection()): Range | null {
  editor.focus();
  if (!selection) return null;

  const range = document.createRange();
  range.selectNodeContents(editor.firstChild ?? editor);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  return range;
}

function closestSplittableBlock(node: Node, container: HTMLElement): HTMLElement | null {
  const element = node instanceof Element ? node : node.parentElement;
  const block = element?.closest<HTMLElement>("p,h1,h2,h3,h4,h5,h6,div,blockquote,pre") ?? null;
  return block && block !== container && container.contains(block) ? block : null;
}

function insertBetweenSplitBlock(range: Range, block: HTMLElement, placeholder: HTMLElement): void {
  const tailRange = document.createRange();
  tailRange.setStart(range.startContainer, range.startOffset);
  tailRange.setEnd(block, block.childNodes.length);

  const trailingBlock = block.cloneNode(false) as HTMLElement;
  trailingBlock.append(tailRange.extractContents());
  block.after(placeholder);

  if (hasMeaningfulContent(trailingBlock)) placeholder.after(trailingBlock);
  if (!hasMeaningfulContent(block)) block.remove();
}

function hasMeaningfulContent(element: HTMLElement): boolean {
  if (element.textContent?.trim()) return true;
  return Boolean(element.querySelector("img,figure,video,iframe,.editor-attachment"));
}

function closestCalloutContent(node: Node | null, editor: HTMLElement): HTMLElement | null {
  const element = node instanceof Element ? node : node?.parentElement;
  const content = element?.closest<HTMLElement>(".editor-callout-content") ?? null;
  return content && editor.contains(content) ? content : null;
}
