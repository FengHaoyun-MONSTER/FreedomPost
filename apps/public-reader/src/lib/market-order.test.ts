// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { renderOrderReferralField } from "./market-order.js";

describe("market order referral field", () => {
  it("hides the recommender field while retaining a locked referral for submission", () => {
    const form = document.createElement("form");
    form.innerHTML = renderOrderReferralField("ChasingDream_2021");

    expect(form.querySelector("label")).toBeNull();
    const hidden = form.querySelector<HTMLInputElement>('input[type="hidden"]');
    expect(hidden?.name).toBe("recommenderWechatId");
    expect(hidden?.value).toBe("ChasingDream_2021");
    expect(new FormData(form).get("recommenderWechatId")).toBe("ChasingDream_2021");
  });

  it("keeps the original required input when no referral can be obtained", () => {
    const container = document.createElement("div");
    container.innerHTML = renderOrderReferralField(null);

    const input = container.querySelector<HTMLInputElement>('[data-referral-entry="manual"] input');
    expect(input?.type).toBe("text");
    expect(input?.required).toBe(true);
    expect(input?.name).toBe("recommenderWechatId");
  });

  it("escapes a referral before placing it in HTML", () => {
    const container = document.createElement("div");
    container.innerHTML = renderOrderReferralField('valid_ref\"><script>bad()</script>');

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelectorAll("input")).toHaveLength(1);
    expect(container.querySelector<HTMLInputElement>("input")?.value).toBe('valid_ref\"><script>bad()</script>');
  });
});
