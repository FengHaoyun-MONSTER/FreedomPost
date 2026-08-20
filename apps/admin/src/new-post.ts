export function createNewPostPayload() {
  return {
    title: "未命名文章",
    markdown: "",
    visibility: "public" as const
  };
}
