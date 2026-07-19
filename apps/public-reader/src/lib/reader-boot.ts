export function createReaderBootGuardScript(): string {
  return `(() => {
    const querySlug = new URLSearchParams(window.location.search).get("post")?.trim();
    const pathSlug = window.location.pathname.match(/^\\/p\\/[^/]+/);
    if (!querySlug && !pathSlug) return;
    document.documentElement.classList.add("article-boot-pending");
  })();`;
}
