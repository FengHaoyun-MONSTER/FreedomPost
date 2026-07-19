import { describe, expect, it } from "vitest";
import {
  finishReaderBootGuard,
  readerBootHiddenStyle,
  readerBootPendingClass,
  releaseReaderBootGuardIfUnrequested
} from "./reader-boot.js";

function releasedState(requestedSlug: string | null, embedded = false): { classes: string[]; styles: string[] } {
  const removed: string[] = [];
  const styles: string[] = [];
  releaseReaderBootGuardIfUnrequested(
    { classList: { remove: (className: string) => removed.push(className) } },
    {
      style: {
        removeProperty: (propertyName: string) => {
          styles.push(propertyName);
          return "";
        }
      }
    },
    requestedSlug,
    embedded
  );
  return { classes: removed, styles };
}

describe("reader boot guard", () => {
  it("provides CSP-safe static guards for the pre-CSS and post-CSS phases", () => {
    expect(readerBootPendingClass).toBe("article-boot-pending");
    expect(readerBootHiddenStyle).toBe("visibility: hidden;");
  });

  it("keeps the static seed article hidden while a requested article loads", () => {
    expect(releasedState("p_Ab3dE6gH")).toEqual({ classes: [], styles: [] });
  });

  it("keeps it hidden while an embedded article index selects the latest post", () => {
    expect(releasedState(null, true)).toEqual({ classes: [], styles: [] });
  });

  it("reveals the seed article only when no article was requested", () => {
    expect(releasedState(null)).toEqual({ classes: [readerBootPendingClass], styles: ["visibility"] });
    expect(releasedState("")).toEqual({ classes: [readerBootPendingClass], styles: ["visibility"] });
  });

  it("reveals content atomically after the requested article is rendered", () => {
    const classes: string[] = [];
    const styles: string[] = [];
    finishReaderBootGuard(
      { classList: { remove: (className: string) => classes.push(className) } },
      {
        style: {
          removeProperty: (propertyName: string) => {
            styles.push(propertyName);
            return "";
          }
        }
      }
    );
    expect(classes).toEqual([readerBootPendingClass]);
    expect(styles).toEqual(["visibility"]);
  });
});
