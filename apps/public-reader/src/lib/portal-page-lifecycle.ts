export type PortalPageCleanup = () => void;
export type PortalPageInitializer = (
  root: ParentNode
) => void | PortalPageCleanup | Promise<void | PortalPageCleanup>;

export interface PortalPageLifecycle {
  mount(root: ParentNode): Promise<void>;
  unmount(): void;
}

export function createPortalPageLifecycle(
  initializers: readonly PortalPageInitializer[]
): PortalPageLifecycle {
  let generation = 0;
  let activeCleanups: PortalPageCleanup[] = [];

  const disposeActive = () => {
    const cleanups = activeCleanups;
    activeCleanups = [];
    for (const cleanup of cleanups.reverse()) {
      try {
        cleanup();
      } catch {
        // A stale page must not prevent the remaining resources from being released.
      }
    }
  };

  return {
    async mount(root) {
      generation += 1;
      const mountGeneration = generation;
      disposeActive();
      const results = await Promise.allSettled(initializers.map((initializer) => initializer(root)));
      const cleanups = results
        .filter((result): result is PromiseFulfilledResult<void | PortalPageCleanup> => result.status === "fulfilled")
        .map((result) => result.value)
        .filter((cleanup): cleanup is PortalPageCleanup => typeof cleanup === "function");

      if (generation !== mountGeneration) {
        dispose(cleanups);
        return;
      }
      const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (rejected) {
        dispose(cleanups);
        throw rejected.reason;
      }
      activeCleanups = cleanups;
    },

    unmount() {
      generation += 1;
      disposeActive();
    }
  };
}

function dispose(cleanups: PortalPageCleanup[]): void {
  for (const cleanup of cleanups.reverse()) {
    try {
      cleanup();
    } catch {
      // Cleanup is best-effort and must continue for the remaining resources.
    }
  }
}
