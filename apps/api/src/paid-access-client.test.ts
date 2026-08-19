import { describe, expect, it, vi } from "vitest";
import { createPaidAccessClient, signInternalRequest } from "./paid-access-client.js";

describe("paid access internal client", () => {
  it("uses a stable body-bound HMAC signature", () => {
    expect(signInternalRequest("s".repeat(32), "1724054400", "POST", "/internal/access/check", "{}"))
      .toBe("437ff22c73db19b3e7ace8266acac3c48168aa5cc4c71c4d036fa7003d5bdbef");
  });

  it("does not call the service without a reader session", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = createPaidAccessClient({
      PAID_ARTICLES_ENABLED: "true",
      PAID_ACCESS_INTERNAL_URL: "http://paid-access:8080",
      PAID_ACCESS_INTERNAL_SECRET: "s".repeat(32)
    }, fetchImpl);
    expect(await client?.canRead(undefined, "paid-post")).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
