import { describe, expect, it } from "vitest";
import { PendingTaskBarrier } from "./pending-task-barrier.js";

describe("PendingTaskBarrier", () => {
  it("waits for every editor mutation before allowing a save to continue", async () => {
    const barrier = new PendingTaskBarrier();
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    const first = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const second = new Promise<void>((resolve) => {
      finishSecond = resolve;
    });

    void barrier.track(first);
    const drained = barrier.waitForIdle();
    void barrier.track(second);

    finishFirst();
    await Promise.resolve();
    expect(barrier.size).toBe(1);

    finishSecond();
    await expect(drained).resolves.toEqual({ failureCount: 0 });
    expect(barrier.size).toBe(0);
  });

  it("reports a failed image task so a partial article is not saved", async () => {
    const barrier = new PendingTaskBarrier();
    const failed = barrier.track(Promise.reject(new Error("upload failed")));
    void failed.catch(() => undefined);

    await expect(barrier.waitForIdle()).resolves.toEqual({ failureCount: 1 });
    await expect(barrier.waitForIdle()).resolves.toEqual({ failureCount: 0 });
  });
});
