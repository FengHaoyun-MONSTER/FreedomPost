import type { APIRoute } from "astro";
import { articles } from "../lib/articles";

export const GET: APIRoute = ({ site }) => {
  const origin = site?.toString().replace(/\/$/, "") ?? "https://example.com";
  const urls = [
    `${origin}/`,
    `${origin}/articles/`,
    `${origin}/tools/`,
    `${origin}/topics/`,
    `${origin}/market/`,
    `${origin}/earn/`,
    `${origin}/guide/`,
    `${origin}/about/`,
    ...articles.map((article) => `${origin}/p/${encodeURIComponent(article.slug)}`)
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${url}</loc></url>`).join("\n")}
</urlset>`;

  return new Response(body, {
    headers: {
      "content-type": "application/xml; charset=utf-8"
    }
  });
};
