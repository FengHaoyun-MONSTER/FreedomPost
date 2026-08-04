export const WEBMASTER_BENEFIT_POLICY = Object.freeze({
  campaignId: "webmaster-benefit-v1" as const,
  trafficBytes: 30 * 1024 * 1024 * 1024,
  durationDays: 15,
  hwidRequired: true as const,
  ipLimit: 2
});
