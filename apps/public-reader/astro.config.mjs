import { defineConfig } from "astro/config";

const site = (process.env.PUBLIC_SITE_URL ?? process.env.SITE_URL ?? "https://example.com").replace(/\/$/, "");

export default defineConfig({
  output: "static",
  site,
  vite: {
    server: {
      proxy: {
        "/api": "http://127.0.0.1:3000",
        "/health": "http://127.0.0.1:3000"
      }
    }
  }
});
