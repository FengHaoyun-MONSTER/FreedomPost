import { describe, expect, it } from "vitest";
import {
  orderStatusLabel,
  purchasedArticles,
  sortOrdersNewestFirst,
  type ReaderOrder
} from "./reader-account.js";

const order = (overrides: Partial<ReaderOrder>): ReaderOrder => ({
  id: "order-1",
  orderCode: "FP-001",
  postSlug: "article-one",
  postTitle: "第一篇文章",
  priceCents: 990,
  currency: "CNY",
  status: "pending",
  createdAt: "2026-08-19T08:00:00.000Z",
  updatedAt: "2026-08-19T08:00:00.000Z",
  ...overrides
});

describe("reader account order presentation", () => {
  it("maps order states to reader-facing labels", () => {
    expect(orderStatusLabel("pending")).toBe("待付款确认");
    expect(orderStatusLabel("completed")).toBe("已开通");
    expect(orderStatusLabel("cancelled")).toBe("已取消");
    expect(orderStatusLabel("unknown")).toBe("处理中");
  });

  it("sorts orders newest first without mutating the API response", () => {
    const original = [
      order({ id: "older", createdAt: "2026-08-18T08:00:00.000Z" }),
      order({ id: "newer", createdAt: "2026-08-19T08:00:00.000Z" })
    ];

    expect(sortOrdersNewestFirst(original).map((item) => item.id)).toEqual(["newer", "older"]);
    expect(original.map((item) => item.id)).toEqual(["older", "newer"]);
  });

  it("returns one purchased article per slug and ignores pending orders", () => {
    const result = purchasedArticles([
      order({ id: "pending", status: "pending" }),
      order({ id: "old-purchase", status: "completed", createdAt: "2026-08-18T08:00:00.000Z" }),
      order({ id: "latest-purchase", status: "completed", createdAt: "2026-08-19T08:00:00.000Z" }),
      order({ id: "second-article", postSlug: "article-two", postTitle: "第二篇文章", status: "completed" })
    ]);

    expect(result.map((item) => item.id)).toEqual(["latest-purchase", "second-article"]);
  });
});
