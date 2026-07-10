import { createIcons, icons } from "lucide";

type PostListItem = {
  slug: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  viewCount: number;
  commentCount: number;
  excerpt?: string;
};

type SearchDocument = {
  slug: string;
  title: string;
  body: string;
  excerpt: string;
};

const themeKey = "fp_theme_v1";
const root = document.documentElement;
const navToggle = document.querySelector<HTMLButtonElement>("#navToggle");
const primaryNav = document.querySelector<HTMLElement>("#primaryNav");
const themeButton = document.querySelector<HTMLButtonElement>("#portalThemeBtn");
const servicePulse = document.querySelector<HTMLElement>("#servicePulse");
const postGrid = document.querySelector<HTMLElement>("#portalPostGrid");
const searchInput = document.querySelector<HTMLInputElement>("#portalSearchInput");
const searchMeta = document.querySelector<HTMLElement>("#articleSearchMeta");
const emptyState = document.querySelector<HTMLElement>("#emptyArticles");

let posts: PostListItem[] = [];
let searchDocuments: SearchDocument[] = [];

initTheme();
bindNavigation();
bindSearch();
createPortalIcons();
void checkService();
void hydratePosts();

function initTheme() {
  const saved = localStorage.getItem(themeKey);
  root.dataset.theme = saved === "light" ? "light" : "dark";
  updateThemeIcon();

  themeButton?.addEventListener("click", () => {
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem(themeKey, root.dataset.theme);
    updateThemeIcon();
  });
}

function updateThemeIcon() {
  if (!themeButton) return;
  themeButton.innerHTML = `<i data-lucide="${root.dataset.theme === "dark" ? "sun" : "moon"}"></i>`;
  createPortalIcons();
}

function bindNavigation() {
  navToggle?.addEventListener("click", () => {
    const open = primaryNav?.classList.toggle("open") ?? false;
    navToggle.setAttribute("aria-expanded", String(open));
    navToggle.setAttribute("aria-label", open ? "关闭导航" : "打开导航");
    navToggle.innerHTML = `<i data-lucide="${open ? "x" : "menu"}"></i>`;
    createPortalIcons();
  });

  document.addEventListener("click", (event) => {
    if (!primaryNav?.classList.contains("open")) return;
    const target = event.target as Node;
    if (primaryNav.contains(target) || navToggle?.contains(target)) return;
    primaryNav.classList.remove("open");
    navToggle?.setAttribute("aria-expanded", "false");
  });
}

function bindSearch() {
  if (!searchInput) return;

  const requestedQuery = new URLSearchParams(location.search).get("q")?.trim() ?? "";
  searchInput.value = requestedQuery;
  searchInput.addEventListener("input", () => renderPosts(searchInput.value));

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
  });
}

async function checkService() {
  if (!servicePulse) return;
  try {
    const response = await fetch("/health", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("health check failed");
    servicePulse.dataset.status = "online";
    const label = servicePulse.querySelector("b");
    if (label) label.textContent = "服务正常";
  } catch {
    servicePulse.dataset.status = "offline";
    const label = servicePulse.querySelector("b");
    if (label) label.textContent = "服务暂不可用";
  }
}

async function hydratePosts() {
  if (!postGrid) return;

  try {
    const [postResponse, searchResponse] = await Promise.all([
      fetch("/api/posts", { headers: { Accept: "application/json" } }),
      fetch("/api/search-index", { headers: { Accept: "application/json" } })
    ]);
    if (!postResponse.ok) throw new Error("posts unavailable");

    const postPayload = (await postResponse.json()) as { items: PostListItem[] };
    posts = postPayload.items;

    if (searchResponse.ok) {
      const searchPayload = (await searchResponse.json()) as { documents: SearchDocument[] };
      searchDocuments = searchPayload.documents;
    }

    renderPosts(searchInput?.value ?? "");
    updateHomeStats();
  } catch {
    // Static seed cards remain readable when the API is unavailable.
  }
}

function renderPosts(rawQuery: string) {
  if (!postGrid || posts.length === 0) return;
  const query = rawQuery.trim().toLocaleLowerCase("zh-CN");
  const searchBySlug = new Map(searchDocuments.map((document) => [document.slug, document]));
  let filtered = posts.filter((post) => {
    if (!query) return true;
    const document = searchBySlug.get(post.slug);
    return [post.title, post.excerpt, document?.title, document?.excerpt, document?.body]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase("zh-CN").includes(query));
  });

  const limit = Number(postGrid.dataset.limit || 0);
  if (limit > 0) filtered = filtered.slice(0, limit);

  postGrid.innerHTML = filtered.map((post, index) => renderPostCard(post, index, Boolean(limit))).join("");
  emptyState?.toggleAttribute("hidden", filtered.length > 0);
  const count = document.querySelector<HTMLElement>("#articleCount");
  if (count) count.textContent = String(filtered.length);
  if (searchMeta) searchMeta.textContent = query ? `找到 ${filtered.length} 篇匹配内容` : "按最新发布排序";
  createPortalIcons();
}

function renderPostCard(post: PostListItem, index: number, home: boolean) {
  const featured = home && index === 0 ? " featured" : "";
  return `<article class="post-card${featured}">
    <a href="/p/${encodeURIComponent(post.slug)}" aria-label="阅读 ${escapeHtml(post.title)}">
      <div class="post-card-topline"><span>${featured ? "最新文章" : "文章"}</span><time datetime="${escapeHtml(post.createdAt)}">${formatDate(post.createdAt)}</time></div>
      <h${home ? "3" : "2"}>${escapeHtml(post.title)}</h${home ? "3" : "2"}>
      <p>${escapeHtml(post.excerpt || "打开文章，继续阅读完整内容。")}</p>
      <div class="post-card-meta"><span>${post.viewCount} 阅读</span><span>${post.commentCount} 评论</span><i data-lucide="arrow-up-right"></i></div>
    </a>
  </article>`;
}

function updateHomeStats() {
  const postCount = document.querySelector<HTMLElement>("#heroPostCount");
  const viewCount = document.querySelector<HTMLElement>("#heroViewCount");
  const commentCount = document.querySelector<HTMLElement>("#heroCommentCount");
  const latestLink = document.querySelector<HTMLAnchorElement>("#latestArticleLink");
  if (postCount) postCount.textContent = String(posts.length);
  if (viewCount) viewCount.textContent = formatNumber(posts.reduce((sum, post) => sum + post.viewCount, 0));
  if (commentCount) commentCount.textContent = formatNumber(posts.reduce((sum, post) => sum + post.commentCount, 0));
  if (latestLink && posts[0]) latestLink.href = `/p/${encodeURIComponent(posts[0].slug)}`;
}

function createPortalIcons() {
  createIcons({ icons });
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", { notation: value >= 10000 ? "compact" : "standard" }).format(value);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[character] ?? character);
}
