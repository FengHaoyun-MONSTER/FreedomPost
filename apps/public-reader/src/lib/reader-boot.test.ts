import { describe, expect, it } from "vitest";
import { createReaderBootGuardScript } from "./reader-boot.js";

function guardedClasses(pathname: string, search: string): string[] {
  const classes: string[] = [];
  const runGuard = new Function("window", "document", createReaderBootGuardScript());
  runGuard(
    { location: { pathname, search } },
    { documentElement: { classList: { add: (className: string) => classes.push(className) } } }
  );
  return classes;
}

describe("reader boot guard", () => {
  it("hides the static seed article for iframe query routes", () => {
    expect(guardedClasses("/reader/", "?post=p_Ab3dE6gH&ref=wechat_01")).toEqual(["article-boot-pending"]);
  });

  it("continues to hide it for legacy direct article routes", () => {
    expect(guardedClasses("/p/legacy-slug", "")).toEqual(["article-boot-pending"]);
  });

  it("keeps the seed article visible on the standalone reader route", () => {
    expect(guardedClasses("/reader/", "")).toEqual([]);
    expect(guardedClasses("/reader/", "?post=%20%20")).toEqual([]);
  });
});
