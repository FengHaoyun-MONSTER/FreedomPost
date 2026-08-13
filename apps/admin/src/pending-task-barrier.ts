export interface PendingTaskDrainResult {
  failureCount: number;
}

/**
 * Keeps save operations behind asynchronous editor mutations such as image uploads.
 * Tasks added while a drain is already in progress are included in the same drain.
 */
export class PendingTaskBarrier {
  private readonly tasks = new Set<Promise<unknown>>();
  private failureCount = 0;

  get size(): number {
    return this.tasks.size;
  }

  track<T>(task: Promise<T>): Promise<T> {
    let tracked: Promise<T>;
    tracked = task.then(
      (value) => {
        this.tasks.delete(tracked);
        return value;
      },
      (error: unknown) => {
        this.tasks.delete(tracked);
        this.failureCount += 1;
        throw error;
      }
    );
    this.tasks.add(tracked);
    return tracked;
  }

  async waitForIdle(): Promise<PendingTaskDrainResult> {
    while (this.tasks.size > 0) {
      await Promise.allSettled([...this.tasks]);
    }

    const result = { failureCount: this.failureCount };
    this.failureCount = 0;
    return result;
  }
}
