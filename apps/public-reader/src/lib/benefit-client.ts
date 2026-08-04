const campaignEndpoint = "/api/benefits/webmaster";
const claimEndpoint = "/api/benefits/webmaster/claim";
const maxResponseBytes = 16 * 1024;

export interface BenefitCampaign {
  id: string;
  enabled: boolean;
  trafficBytes: number;
  durationDays: number;
  hwidRequired: boolean;
  ipLimit: number;
  turnstileSiteKey: string | null;
}

export interface ReadyBenefitClaim {
  status: "ready";
  subscriptionUrl: string;
  expiresAt: string;
  trafficBytes: number;
  durationDays: number;
  hwidRequired: boolean;
  ipLimit: number;
}

export interface ProvisioningBenefitClaim {
  status: "provisioning";
  retryAfterSeconds: number;
}

export type BenefitClaimResult = ReadyBenefitClaim | ProvisioningBenefitClaim;

export interface BenefitErrorDescription {
  title: string;
  message: string;
  retryable: boolean;
}

export class BenefitApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryAfterSeconds?: number
  ) {
    super(code);
    this.name = "BenefitApiError";
  }
}

export function createWebmasterBenefitClient(fetchImpl: typeof fetch = fetch) {
  return {
    async getCampaign(signal?: AbortSignal): Promise<BenefitCampaign> {
      const response = await request(fetchImpl, campaignEndpoint, { method: "GET", signal });
      return parseCampaign(await readPayload(response));
    },

    async restoreClaim(signal?: AbortSignal): Promise<BenefitClaimResult | null> {
      const response = await request(fetchImpl, claimEndpoint, { method: "GET", signal }, [404]);
      if (response.status === 404) return null;
      return parseClaim(await readPayload(response));
    },

    async claim(turnstileToken: string, signal?: AbortSignal): Promise<BenefitClaimResult> {
      if (!turnstileToken || turnstileToken.length > 2_048) {
        throw new BenefitApiError(400, "TURNSTILE_REJECTED");
      }
      const response = await request(fetchImpl, claimEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal,
        body: JSON.stringify({ turnstileToken })
      });
      return parseClaim(await readPayload(response));
    }
  };
}

export function describeBenefitError(error: unknown): BenefitErrorDescription {
  const code = error instanceof BenefitApiError ? error.code : "REQUEST_FAILED";
  const descriptions: Record<string, BenefitErrorDescription> = {
    BENEFIT_DISABLED: {
      title: "活动暂未开放",
      message: "当前活动尚未开始或已经结束。",
      retryable: false
    },
    BENEFIT_CLAIM_UNAVAILABLE: {
      title: "当前领取记录不可用",
      message: "这份福利已过期或被撤销。",
      retryable: false
    },
    NETWORK_DAILY_LIMIT: {
      title: "今日领取次数已达上限",
      message: "当前网络今天已领取过多，请明天再试。",
      retryable: false
    },
    RATE_LIMITED: {
      title: "请求过于频繁",
      message: "请稍候再试，不要连续点击领取按钮。",
      retryable: true
    },
    TURNSTILE_REJECTED: {
      title: "人机验证未通过",
      message: "请重新完成人机验证后再领取。",
      retryable: true
    },
    CLAIM_CREDENTIAL_REQUIRED: {
      title: "领取凭证需要刷新",
      message: "请刷新页面后重新完成人机验证。",
      retryable: true
    }
  };
  return descriptions[code] ?? {
    title: "暂时无法完成领取",
    message: "服务暂时不可用，请稍后重试。",
    retryable: true
  };
}

async function request(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
  acceptedErrorStatuses: number[] = []
): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(input, {
      ...init,
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      headers: {
        accept: "application/json",
        ...init.headers
      }
    });
  } catch {
    throw new BenefitApiError(0, "NETWORK_ERROR");
  }
  if (response.ok || acceptedErrorStatuses.includes(response.status)) return response;

  let code = "REQUEST_FAILED";
  try {
    const payload = await readPayload(response);
    if (
      isRecord(payload)
      && isRecord(payload.error)
      && typeof payload.error.code === "string"
      && /^[A-Z0-9_]{1,64}$/.test(payload.error.code)
    ) {
      code = payload.error.code;
    }
  } catch {
    code = "INVALID_RESPONSE";
  }
  throw new BenefitApiError(response.status, code, readRetryAfter(response));
}

async function readPayload(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > maxResponseBytes) throw new BenefitApiError(response.status, "INVALID_RESPONSE");
  const text = await response.text();
  if (text.length > maxResponseBytes) throw new BenefitApiError(response.status, "INVALID_RESPONSE");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BenefitApiError(response.status, "INVALID_RESPONSE");
  }
}

function parseCampaign(payload: unknown): BenefitCampaign {
  if (
    !isRecord(payload)
    || typeof payload.id !== "string"
    || !/^[a-z0-9_-]{1,64}$/.test(payload.id)
    || typeof payload.enabled !== "boolean"
    || !positiveInteger(payload.trafficBytes)
    || !positiveInteger(payload.durationDays)
    || typeof payload.hwidRequired !== "boolean"
    || !positiveInteger(payload.ipLimit)
    || !validSiteKey(payload.turnstileSiteKey)
  ) {
    throw new BenefitApiError(200, "INVALID_RESPONSE");
  }
  return {
    id: payload.id,
    enabled: payload.enabled,
    trafficBytes: payload.trafficBytes,
    durationDays: payload.durationDays,
    hwidRequired: payload.hwidRequired,
    ipLimit: payload.ipLimit,
    turnstileSiteKey: payload.turnstileSiteKey
  };
}

function parseClaim(payload: unknown): BenefitClaimResult {
  if (!isRecord(payload) || typeof payload.status !== "string") {
    throw new BenefitApiError(200, "INVALID_RESPONSE");
  }
  if (payload.status === "provisioning") {
    if (!positiveInteger(payload.retryAfterSeconds) || payload.retryAfterSeconds > 60) {
      throw new BenefitApiError(202, "INVALID_RESPONSE");
    }
    return { status: "provisioning", retryAfterSeconds: payload.retryAfterSeconds };
  }
  if (
    payload.status !== "ready"
    || typeof payload.subscriptionUrl !== "string"
    || !safeSubscriptionUrl(payload.subscriptionUrl)
    || typeof payload.expiresAt !== "string"
    || !Number.isFinite(Date.parse(payload.expiresAt))
    || !positiveInteger(payload.trafficBytes)
    || !positiveInteger(payload.durationDays)
    || typeof payload.hwidRequired !== "boolean"
    || !positiveInteger(payload.ipLimit)
  ) {
    throw new BenefitApiError(200, "INVALID_RESPONSE");
  }
  return {
    status: "ready",
    subscriptionUrl: payload.subscriptionUrl,
    expiresAt: payload.expiresAt,
    trafficBytes: payload.trafficBytes,
    durationDays: payload.durationDays,
    hwidRequired: payload.hwidRequired,
    ipLimit: payload.ipLimit
  };
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validSiteKey(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && /^[A-Za-z0-9_-]{10,256}$/.test(value));
}

function safeSubscriptionUrl(value: string): boolean {
  if (value.length < 1 || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function readRetryAfter(response: Response): number | undefined {
  const value = Number(response.headers.get("retry-after"));
  return Number.isInteger(value) && value > 0 && value <= 86_400 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
