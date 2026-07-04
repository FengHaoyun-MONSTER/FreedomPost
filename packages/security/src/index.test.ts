import { describe, expect, it } from "vitest";
import { isAllowedUpload, sanitizeCommentText } from "./index.js";

describe("security helpers", () => {
  it("strips comment HTML", () => {
    expect(sanitizeCommentText("<img src=x onerror=alert(1)>hello")).toBe("hello");
  });

  it("requires both extension and MIME family for uploads", () => {
    expect(isAllowedUpload("note.md", "text/markdown")).toBe(true);
    expect(isAllowedUpload("note.exe", "text/plain")).toBe(false);
    expect(isAllowedUpload("Windows电脑_Koala.Clash_x64-setup.exe", "application/x-msdownload")).toBe(true);
    expect(isAllowedUpload("setup.exe", "application/octet-stream")).toBe(true);
    expect(isAllowedUpload("script.sh", "application/octet-stream")).toBe(false);
  });
});
