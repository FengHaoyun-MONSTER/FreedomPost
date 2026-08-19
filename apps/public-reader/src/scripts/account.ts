import { createIcons, icons } from "lucide";
import {
  orderStatusLabel,
  purchasedArticles,
  sortOrdersNewestFirst,
  type ReaderAccount,
  type ReaderOrder
} from "../lib/reader-account.js";
import { openReaderAuthDialog, type ReaderAuthMode } from "./paid-access.js";

const root = document.querySelector<HTMLElement>("[data-account-root]");
if (root) void initializeAccountPage(root);

export async function initializeAccountPage(container: HTMLElement): Promise<void> {
  if (container.dataset.accountInitialized === "true") return;
  container.dataset.accountInitialized = "true";
  const loading = required(container, "[data-account-loading]");
  const guest = required(container, "[data-account-guest]");
  const authenticated = required(container, "[data-account-authenticated]");
  const errorState = required(container, "[data-account-error]");

  const showOnly = (state: "loading" | "guest" | "authenticated" | "error") => {
    loading.hidden = state !== "loading";
    guest.hidden = state !== "guest";
    authenticated.hidden = state !== "authenticated";
    errorState.hidden = state !== "error";
  };

  const load = async () => {
    showOnly("loading");
    try {
      const sessionResponse = await fetch("/api/reader/session", { credentials: "include" });
      if (sessionResponse.status === 401) {
        showOnly("guest");
        return;
      }
      const sessionPayload = await readJson<{ account?: ReaderAccount }>(sessionResponse);
      if (!sessionResponse.ok || !sessionPayload.account) throw new Error("账户状态读取失败");
      const ordersResponse = await fetch("/api/reader/orders", { credentials: "include" });
      const ordersPayload = await readJson<{ items?: ReaderOrder[] }>(ordersResponse);
      if (!ordersResponse.ok || !Array.isArray(ordersPayload.items)) throw new Error("订单读取失败");
      renderAccount(container, sessionPayload.account, ordersPayload.items);
      showOnly("authenticated");
      createIcons({ icons });
    } catch (error) {
      required(container, "[data-account-error-message]").textContent =
        error instanceof Error ? error.message : "请稍后重试。";
      showOnly("error");
    }
  };

  const authenticate = async (mode: ReaderAuthMode) => {
    try {
      await openReaderAuthDialog(mode);
      await load();
    } catch (error) {
      if (error instanceof Error && error.message === "已取消登录") return;
      required(container, "[data-account-error-message]").textContent =
        error instanceof Error ? error.message : "登录服务暂不可用";
      showOnly("error");
    }
  };

  container.querySelector("[data-account-login]")?.addEventListener("click", () => void authenticate("login"));
  container.querySelector("[data-account-register]")?.addEventListener("click", () => void authenticate("register"));
  container.querySelector("[data-account-retry]")?.addEventListener("click", () => void load());
  container.querySelector("[data-account-logout]")?.addEventListener("click", async () => {
    await fetch("/api/reader/logout", { method: "POST", credentials: "include" }).catch(() => undefined);
    await load();
  });
  const wechatDialog = document.querySelector<HTMLDialogElement>("[data-account-wechat-dialog]");
  container.querySelector("[data-account-wechat]")?.addEventListener("click", () => wechatDialog?.showModal());
  await load();
}

function renderAccount(container: HTMLElement, account: ReaderAccount, inputOrders: ReaderOrder[]): void {
  const orders = sortOrdersNewestFirst(inputOrders);
  const purchased = purchasedArticles(orders);
  required(container, "[data-account-name]").textContent = account.loginName;
  required(container, "[data-account-purchased-count]").textContent = String(purchased.length);
  required(container, "[data-account-pending-count]").textContent = String(orders.filter((order) => order.status === "pending").length);
  required(container, "[data-account-total-count]").textContent = String(orders.length);
  required(container, "[data-account-purchased-list]").innerHTML = purchased.length
    ? purchased.map((order) => `<a class="account-purchased-item" href="/p/${encodeURIComponent(order.postSlug)}"><span><strong>${escapeHtml(order.postTitle)}</strong><small>${formatDate(order.completedAt || order.updatedAt)}</small></span><i data-lucide="arrow-up-right"></i></a>`).join("")
    : '<p class="account-empty">尚无已购文章。完成订单并由站长确认后会显示在这里。</p>';
  required(container, "[data-account-order-list]").innerHTML = orders.length
    ? orders.map((order) => `<article class="account-order-card"><div><span class="account-order-status status-${escapeHtml(order.status)}">${orderStatusLabel(order.status)}</span><small>${formatDate(order.createdAt)}</small></div><h3>${escapeHtml(order.postTitle)}</h3><p><span>订单号</span><strong>${escapeHtml(order.orderCode)}</strong></p><p><span>金额</span><strong>${formatMoney(order.priceCents, order.currency)}</strong></p><button type="button" data-copy-order="${escapeHtml(order.orderCode)}">复制订单号</button>${order.status === "completed" ? `<a href="/p/${encodeURIComponent(order.postSlug)}">阅读文章</a>` : ""}</article>`).join("")
    : '<p class="account-empty">还没有订单。可在付费文章页面生成购买订单。</p>';
  container.querySelectorAll<HTMLButtonElement>("[data-copy-order]").forEach((button) => {
    button.addEventListener("click", async () => {
      const orderCode = button.dataset.copyOrder;
      if (!orderCode) return;
      await navigator.clipboard.writeText(orderCode).catch(() => undefined);
      button.textContent = "订单号已复制";
      window.setTimeout(() => { button.textContent = "复制订单号"; }, 1600);
    });
  });
}

async function readJson<T>(response: Response): Promise<T> {
  return await response.json().catch(() => ({})) as T;
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: /^[A-Z]{3}$/.test(currency) ? currency : "CNY" }).format(cents / 100);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function required(root: ParentNode, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing account element: ${selector}`);
  return element;
}
