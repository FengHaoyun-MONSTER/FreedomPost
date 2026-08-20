import { describe, expect, it } from "vitest";
import { createNewPostPayload } from "./new-post.js";

describe("createNewPostPayload", () => {
  it("keeps the management title but creates an empty article body", () => {
    expect(createNewPostPayload()).toEqual({
      title: "未命名文章",
      markdown: "",
      visibility: "public"
    });
  });
});
