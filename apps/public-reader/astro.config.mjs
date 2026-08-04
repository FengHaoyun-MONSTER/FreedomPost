import { defineConfig } from "astro/config";
import { legacyPortalRedirects } from "./src/lib/portal-routes.ts";

const site = (process.env.PUBLIC_SITE_URL ?? process.env.SITE_URL ?? "https://example.com").replace(/\/$/, "");

export default defineConfig({
  output: "static",
  site,
  redirects: legacyPortalRedirects,
  vite: {
    server: {
      proxy: {
        "/api": "http://127.0.0.1:3000",
        "/health": "http://127.0.0.1:3000"
      }
    }
  }
});
