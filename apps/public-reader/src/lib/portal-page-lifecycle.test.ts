import { describe, expect, it, vi } from "vitest";
import {
  createPortalPageLifecycle,
  eventPathIncludes,
  type PortalPageCleanup
} from "./portal-page-lifecycle.js";

describe("Portal partial-page lifecycle", () => {
  it("recognizes a navigation toggle from the stable composed event path", () => {
    const toggle = {} as EventTarget;
    const replacedIcon = {} as EventTarget;

    expect(eventPathIncludes({ composedPath: () => [replacedIcon, toggle] }, toggle)).toBe(true);
    expect(eventPathIncludes({ composedPath: () => [replacedIcon] }, toggle)).toBe(false);
  });

  it("disposes the previous page before mounting the next page", async () => {
    const events: string[] = [];
    const lifecycle = createPortalPageLifecycle([
      (root) => {
        events.push(`mount:${String(root)}`);
        return () => events.push(`cleanup:${String(root)}`);
      }
    ]);

    await lifecycle.mount("first" as unknown as ParentNode);
    await lifecycle.mount("second" as unknown as ParentNode);
    lifecycle.unmount();

    expect(events).toEqual([
      "mount:first",
      "cleanup:first",
      "mount:second",
      "cleanup:second"
    ]);
  });

  it("cleans up a lazy initializer that resolves after navigation already left", async () => {
    let resolveInitializer!: (cleanup: PortalPageCleanup) => void;
    const cleanup = vi.fn();
    const lifecycle = createPortalPageLifecycle([
      () => new Promise<PortalPageCleanup>((resolve) => {
        resolveInitializer = resolve;
      })
    ]);

    const mounting = lifecycle.mount("benefit" as unknown as ParentNode);
    lifecycle.unmount();
    resolveInitializer(cleanup);
    await mounting;

    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("runs multiple page cleanups in reverse registration order", async () => {
    const events: string[] = [];
    const lifecycle = createPortalPageLifecycle([
      () => () => events.push("first"),
      () => () => events.push("second")
    ]);

    await lifecycle.mount("page" as unknown as ParentNode);
    lifecycle.unmount();

    expect(events).toEqual(["second", "first"]);
  });

  it("continues cleanup when one page disposer fails", async () => {
    const cleanup = vi.fn();
    const lifecycle = createPortalPageLifecycle([
      () => cleanup,
      () => () => {
        throw new Error("cleanup failed");
      }
    ]);

    await lifecycle.mount("page" as unknown as ParentNode);
    expect(() => lifecycle.unmount()).not.toThrow();

    expect(cleanup).toHaveBeenCalledOnce();
  });
});
