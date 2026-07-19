export const readerBootPendingClass = "article-boot-pending";
export const readerBootHiddenStyle = "visibility: hidden;";

type ClassListRoot = {
  classList: Pick<DOMTokenList, "remove">;
};

type StyleBody = {
  style: Pick<CSSStyleDeclaration, "removeProperty">;
};

export function finishReaderBootGuard(root: ClassListRoot, body: StyleBody): void {
  root.classList.remove(readerBootPendingClass);
  body.style.removeProperty("visibility");
}

export function releaseReaderBootGuardIfUnrequested(
  root: ClassListRoot,
  body: StyleBody,
  requestedSlug: string | null,
  embedded = false
): void {
  if (!requestedSlug && !embedded) finishReaderBootGuard(root, body);
}
