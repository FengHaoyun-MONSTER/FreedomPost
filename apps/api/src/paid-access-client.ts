import crypto from "node:crypto";

export type ArticleOrderStatus = "pending" | "completed" | "canceled";

export interface PaidAccessClient {
  canRead(sessionToken: string | undefined, postSlug: string): Promise<boolean>;
  listOrders(admin: string): Promise<unknown>;
  updateOrder(admin: string, orderId: string, status: ArticleOrderStatus): Promise<unknown>;
  listAccounts(admin: string): Promise<unknown>;
  resetPassword(admin: string, accountId: string): Promise<unknown>;
}

interface PaidAccessEnvironment {
  PAID_ARTICLES_ENABLED?: string;
  PAID_ACCESS_INTERNAL_URL?: string;
  PAID_ACCESS_INTERNAL_SECRET?: string;
}

export function createPaidAccessClient(
  environment: PaidAccessEnvironment = process.env,
  fetchImpl: typeof fetch = fetch
): PaidAccessClient | null {
  if (environment.PAID_ARTICLES_ENABLED !== "true") return null;
  const baseURL = environment.PAID_ACCESS_INTERNAL_URL?.replace(/\/$/, "") ?? "";
  const secret = environment.PAID_ACCESS_INTERNAL_SECRET ?? "";
  if (!/^https?:\/\/[A-Za-z0-9._:-]+$/.test(baseURL)) {
    throw new Error("PAID_ACCESS_INTERNAL_URL must be an HTTP origin without a path");
  }
  if (secret.length < 32) {
    throw new Error("PAID_ACCESS_INTERNAL_SECRET must contain at least 32 characters");
  }

  async function request(path: string, method: "GET" | "POST" | "PATCH", admin: string, payload?: unknown) {
    const body = payload === undefined ? "" : JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = signInternalRequest(secret, timestamp, method, path, body);
    const response = await fetchImpl(`${baseURL}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-freedompost-timestamp": timestamp,
        "x-freedompost-signature": signature,
        "x-freedompost-admin": admin.slice(0, 128)
      },
      ...(body ? { body } : {}),
      signal: AbortSignal.timeout(3_000)
    });
    const responseBody = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(`Paid access service returned ${response.status}`);
      Object.assign(error, { statusCode: response.status, responseBody });
      throw error;
    }
    return responseBody;
  }

  return {
    async canRead(sessionToken, postSlug) {
      if (!sessionToken) return false;
      const result = await request("/internal/access/check", "POST", "api", { sessionToken, postSlug }) as { allowed?: boolean };
      return result.allowed === true;
    },
    listOrders: (admin) => request("/internal/article-orders", "GET", admin),
    updateOrder: (admin, orderId, status) => request(`/internal/article-orders/${encodeURIComponent(orderId)}`, "PATCH", admin, { status }),
    listAccounts: (admin) => request("/internal/reader-accounts", "GET", admin),
    resetPassword: (admin, accountId) => request(`/internal/reader-accounts/${encodeURIComponent(accountId)}/reset-password`, "POST", admin, {})
  };
}

export function signInternalRequest(secret: string, timestamp: string, method: string, path: string, body: string): string {
  const bodyHash = crypto.createHash("sha256").update(body).digest("hex");
  return crypto.createHmac("sha256", secret).update(`${timestamp}\n${method}\n${path}\n${bodyHash}`).digest("hex");
}
