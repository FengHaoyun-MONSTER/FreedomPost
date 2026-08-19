export const portalNavItems = [
  { id: "home", href: "/", label: "首页" },
  { id: "market", href: "/market/", label: "商城" },
  {
    id: "earn",
    href: "/earn/",
    label: "分享赚钱",
    tagline: "一次分享终身收益",
    className: "earn-nav-link"
  },
  { id: "articles", href: "/articles/", label: "文章" },
  { id: "tools", href: "/tools/", label: "常用工具" },
  { id: "benefit", href: "/benefit/", label: "站长福利" },
  { id: "guide", href: "/guide/", label: "使用指南" },
  { id: "about", href: "/about/", label: "关于" }
] as const;

export type PortalPageId = (typeof portalNavItems)[number]["id"];

export const legacyPortalRedirects = {
  "/topics/": {
    status: 301,
    destination: "/benefit/"
  }
} as const;

export const portalSitemapPaths = portalNavItems.map((item) => item.href);

export function portalActivePath(pathname: string): string {
  const normalizedPath = normalizeDirectoryPath(pathname);
  if (normalizedPath.startsWith("/p/")) return "/articles/";
  return legacyPortalRedirects[normalizedPath as keyof typeof legacyPortalRedirects]?.destination ?? normalizedPath;
}

function normalizeDirectoryPath(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  const withoutTrailingSlash = pathname.replace(/\/+$/, "");
  return `${withoutTrailingSlash || "/"}/`.replace(/^\/\//, "/");
}
