import { describe, expect, it } from "vitest";
import { readerBootPendingClass, releaseReaderBootGuardIfUnrequested } from "./reader-boot.js";

function removedClasses(requestedSlug: string | null): string[] {
  const removed: string[] = [];
  releaseReaderBootGuardIfUnrequested(
    { classList: { remove: (className: string) => removed.push(className) } },
    requestedSlug
  );
  return removed;
}

describe("reader boot guard", () => {
  it("uses a stable class that can be rendered before CSP blocks inline scripts", () => {
    expect(readerBootPendingClass).toBe("article-boot-pending");
  });

  it("keeps the static seed article hidden while a requested article loads", () => {
    expect(removedClasses("p_Ab3dE6gH")).toEqual([]);
  });

  it("reveals the seed article only when no article was requested", () => {
    expect(removedClasses(null)).toEqual([readerBootPendingClass]);
    expect(removedClasses("")).toEqual([readerBootPendingClass]);
  });
});
