export interface ReaderAccount {
  id: string;
  loginName: string;
  status: string;
  createdAt: string;
}

export interface ReaderOrder {
  id: string;
  orderCode: string;
  postSlug: string;
  postTitle: string;
  priceCents: number;
  currency: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

export function orderStatusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "待付款确认";
    case "completed":
      return "已开通";
    case "cancelled":
    case "canceled":
      return "已取消";
    default:
      return "处理中";
  }
}

export function sortOrdersNewestFirst(orders: readonly ReaderOrder[]): ReaderOrder[] {
  return [...orders].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function purchasedArticles(orders: readonly ReaderOrder[]): ReaderOrder[] {
  const unique = new Map<string, ReaderOrder>();
  for (const order of sortOrdersNewestFirst(orders)) {
    if (order.status === "completed" && !unique.has(order.postSlug)) {
      unique.set(order.postSlug, order);
    }
  }
  return [...unique.values()];
}
