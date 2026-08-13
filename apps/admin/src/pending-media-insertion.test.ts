import { describe, expect, it } from "vitest";
import { startPendingMediaInsertion } from "./pending-media-insertion.js";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

describe("startPendingMediaInsertion", () => {
  it("preserves all ten consecutive paste positions when uploads finish out of order", async () => {
    const slots: Array<string | null> = [];
    const uploads = Array.from({ length: 10 }, () => deferred<string>());
    const insertions = uploads.map((upload) =>
      startPendingMediaInsertion(() => upload.promise, {
        insertPlaceholder: () => {
          slots.push(null);
          return slots.length - 1;
        },
        replacePlaceholder: (slot, content) => {
          slots[slot] = content;
        },
        removePlaceholder: (slot) => {
          slots.splice(slot, 1);
        }
      })
    );

    expect(slots).toHaveLength(10);

    for (const index of [7, 2, 9, 0, 5, 1, 8, 4, 6, 3]) {
      uploads[index]?.resolve(`图片 ${index + 1}`);
    }

    await Promise.all(insertions);
    expect(slots).toEqual(Array.from({ length: 10 }, (_, index) => `图片 ${index + 1}`));
  });

  it("removes only the failed upload's placeholder", async () => {
    const slots: Array<string | null> = [];
    const upload = deferred<string>();
    const insertion = startPendingMediaInsertion(() => upload.promise, {
      insertPlaceholder: () => {
        slots.push(null);
        return 0;
      },
      replacePlaceholder: (slot, content) => {
        slots[slot] = content;
      },
      removePlaceholder: (slot) => {
        slots.splice(slot, 1);
      }
    });

    upload.reject(new Error("upload failed"));
    await expect(insertion).rejects.toThrow("upload failed");
    expect(slots).toEqual([]);
  });
});

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
