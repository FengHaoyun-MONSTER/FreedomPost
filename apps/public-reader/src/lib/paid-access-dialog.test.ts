// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { bindReaderAuthDismiss } from "../scripts/paid-access.js";

describe("bindReaderAuthDismiss", () => {
  it("closes without submitting or validating required login fields", () => {
    const dialog = document.createElement("dialog");
    dialog.innerHTML =
      '<form method="dialog"><button class="reader-auth-close" value="cancel">×</button><input required></form>';
    document.body.append(dialog);
    const form = dialog.querySelector("form")!;
    const close = dialog.querySelector<HTMLButtonElement>(".reader-auth-close")!;
    const submit = vi.fn((event: SubmitEvent) => event.preventDefault());
    const closeDialog = vi.spyOn(dialog, "close").mockImplementation(() => undefined);
    form.addEventListener("submit", submit);

    bindReaderAuthDismiss(dialog);
    close.click();

    expect(close.type).toBe("button");
    expect(submit).not.toHaveBeenCalled();
    expect(closeDialog).toHaveBeenCalledWith("cancel");
  });
});
