import { describe, expect, it, vi } from "vitest";
import { renderSubscriptionQr } from "./benefit-qr.js";

describe("local subscription QR rendering", () => {
  it("passes the subscription directly to a local canvas encoder", async () => {
    const canvas = {} as HTMLCanvasElement;
    const toCanvas = vi.fn().mockResolvedValue(undefined);
    const subscriptionUrl = "https://sub.example.test/sub/private-token";

    await renderSubscriptionQr(canvas, subscriptionUrl, { toCanvas });

    expect(toCanvas).toHaveBeenCalledOnce();
    expect(toCanvas).toHaveBeenCalledWith(canvas, subscriptionUrl, expect.objectContaining({
      errorCorrectionLevel: "M",
      width: 300
    }));
  });
});
