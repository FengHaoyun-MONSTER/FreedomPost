import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const layoutSource = readFileSync(
  fileURLToPath(new URL("../layouts/ReaderShell.astro", import.meta.url)),
  "utf8"
);
const styleSource = readFileSync(
  fileURLToPath(new URL("../styles/global.css", import.meta.url)),
  "utf8"
);

describe("mobile reader shell", () => {
  it("exposes mobile article, directory, comment and share actions", () => {
    expect(layoutSource).toContain('id="mobilePostsBtn"');
    expect(layoutSource).toContain('id="mobileTocBtn"');
    expect(layoutSource).toContain('id="mobileCommentsBtn"');
    expect(layoutSource).toContain('id="mobileShareBtn"');
    expect(layoutSource).toContain('id="mobilePostsClose"');
    expect(layoutSource).toContain('id="mobileReaderBackdrop"');
  });

  it("uses dynamic viewport and safe-area-aware controls", () => {
    expect(styleSource).toContain("height: 100dvh");
    expect(styleSource).toContain("env(safe-area-inset-bottom)");
    expect(styleSource).toMatch(/\.reader-mobile-action[\s\S]*min-height:\s*44px/);
  });
});
