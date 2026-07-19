export const readerBootPendingClass = "article-boot-pending";

type ClassListRoot = {
  classList: Pick<DOMTokenList, "remove">;
};

export function releaseReaderBootGuardIfUnrequested(root: ClassListRoot, requestedSlug: string | null): void {
  if (!requestedSlug) root.classList.remove(readerBootPendingClass);
}
