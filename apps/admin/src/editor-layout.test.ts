import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("./main.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("article editor viewport layout", () => {
  it("places the article toolbar before the scrollable editing workspace", () => {
    const articlePaneStart = mainSource.indexOf('<section className="editor-pane">');
    const articlePaneEnd = mainSource.indexOf("function ProductWorkspace", articlePaneStart);
    const articlePane = mainSource.slice(articlePaneStart, articlePaneEnd);

    expect(articlePane.indexOf('className="toolbar article-toolbar"')).toBeGreaterThan(-1);
    expect(articlePane.indexOf('className="toolbar article-toolbar"')).toBeLessThan(
      articlePane.indexOf('className="editor-workspace"')
    );
    expect(articlePane).toContain('className="toolbar-tools"');
    expect(articlePane).toContain('className="toolbar-actions"');
  });

  it("uses the dynamic viewport and keeps tools on one horizontally scrollable row", () => {
    expect(styles).toMatch(/\.admin-shell\s*\{[^}]*height:\s*100dvh;/s);
    expect(styles).toMatch(/\.article-toolbar\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto;/s);
    expect(styles).toMatch(/\.toolbar-tools\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*overflow-x:\s*auto;/s);
    expect(styles).toMatch(/\.toolbar-actions\s*\{[^}]*flex:\s*0\s+0\s+auto;/s);
    expect(styles).toMatch(/\.post-rail\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
  });
});
