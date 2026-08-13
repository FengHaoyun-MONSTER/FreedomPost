export interface PendingMediaInsertionCallbacks<TPlaceholder, TContent> {
  insertPlaceholder: () => TPlaceholder;
  replacePlaceholder: (placeholder: TPlaceholder, content: TContent) => void;
  removePlaceholder: (placeholder: TPlaceholder) => void;
}

/**
 * Reserves the insertion position synchronously, before an upload can yield.
 * Each completion then targets its own placeholder instead of the browser's
 * mutable selection, which may have moved after later paste events.
 */
export function startPendingMediaInsertion<TPlaceholder, TContent>(
  createContent: () => Promise<TContent>,
  callbacks: PendingMediaInsertionCallbacks<TPlaceholder, TContent>
): Promise<void> {
  const placeholder = callbacks.insertPlaceholder();

  let content: Promise<TContent>;
  try {
    content = createContent();
  } catch (error) {
    callbacks.removePlaceholder(placeholder);
    return Promise.reject(error);
  }

  return content.then(
    (value) => callbacks.replacePlaceholder(placeholder, value),
    (error: unknown) => {
      callbacks.removePlaceholder(placeholder);
      throw error;
    }
  );
}
