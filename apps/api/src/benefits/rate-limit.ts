export interface RateLimitBackendResult {
  count: number;
  resetAfterMs: number;
}

export interface RateLimitBackend {
  consume(key: string, windowMs: number): Promise<RateLimitBackendResult>;
}

export interface RedisEvalClient {
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] }
  ): Promise<unknown>;
}

export interface BenefitRateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  source: "redis" | "fallback";
}

export interface BenefitRateLimiter {
  consume(
    scope: string,
    subjectHash: string,
    limit: number,
    windowMs: number
  ): Promise<BenefitRateLimitResult>;
}

interface BenefitRateLimiterConfig {
  primary?: RateLimitBackend;
  fallback: RateLimitBackend;
  prefix?: string;
}

const REDIS_FIXED_WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`.trim();

export class RedisRateLimitBackend implements RateLimitBackend {
  constructor(private readonly client: RedisEvalClient) {}

  async consume(key: string, windowMs: number): Promise<RateLimitBackendResult> {
    const response = await this.client.eval(REDIS_FIXED_WINDOW_SCRIPT, {
      keys: [key],
      arguments: [String(windowMs)]
    });
    if (!Array.isArray(response) || response.length !== 2) {
      throw new Error("Redis rate limit response is invalid");
    }
    const count = toSafeInteger(response[0]);
    const ttl = toSafeInteger(response[1]);
    if (count < 1) throw new Error("Redis rate limit count is invalid");
    return {
      count,
      resetAfterMs: ttl > 0 ? ttl : windowMs
    };
  }
}

export class MemoryRateLimitBackend implements RateLimitBackend {
  private readonly buckets = new Map<string, { count: number; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async consume(key: string, windowMs: number): Promise<RateLimitBackendResult> {
    const currentTime = this.now();
    const previous = this.buckets.get(key);
    const bucket = !previous || previous.expiresAt <= currentTime
      ? { count: 0, expiresAt: currentTime + windowMs }
      : previous;
    bucket.count += 1;
    this.buckets.set(key, bucket);
    return {
      count: bucket.count,
      resetAfterMs: Math.max(1, bucket.expiresAt - currentTime)
    };
  }
}

export function createBenefitRateLimiter(
  config: BenefitRateLimiterConfig
): BenefitRateLimiter {
  const prefix = config.prefix ?? "freedompost:benefit";
  if (!/^[A-Za-z0-9:_-]{1,64}$/.test(prefix)) {
    throw new Error("Benefit rate limit prefix is invalid");
  }

  return {
    async consume(scope, subjectHash, limit, windowMs) {
      if (!/^[A-Za-z0-9_-]{1,48}$/.test(scope)) {
        throw new Error("Benefit rate limit scope is invalid");
      }
      if (!/^[0-9a-f]{64}$/.test(subjectHash)) {
        throw new Error("Benefit rate limit subject hash is invalid");
      }
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000_000) {
        throw new Error("Benefit rate limit is invalid");
      }
      if (!Number.isSafeInteger(windowMs) || windowMs < 1_000 || windowMs > 31 * 24 * 60 * 60 * 1000) {
        throw new Error("Benefit rate limit window is invalid");
      }

      const key = `${prefix}:${scope}:${subjectHash}`;
      const fallbackLimit = Math.max(1, Math.floor(limit / 2));
      const fallbackResult = await config.fallback.consume(key, windowMs);

      if (config.primary) {
        try {
          const primaryResult = await config.primary.consume(key, windowMs);
          return formatResult(primaryResult, limit, "redis");
        } catch {
          // The shadow counter above preserves a stricter process-local limit.
        }
      }

      return formatResult(fallbackResult, fallbackLimit, "fallback");
    }
  };
}

function formatResult(
  result: RateLimitBackendResult,
  limit: number,
  source: BenefitRateLimitResult["source"]
): BenefitRateLimitResult {
  return {
    allowed: result.count <= limit,
    remaining: Math.max(0, limit - result.count),
    retryAfterMs: result.count <= limit ? 0 : Math.max(1, result.resetAfterMs),
    source
  };
}

function toSafeInteger(value: unknown): number {
  const numberValue = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(numberValue)) {
    throw new Error("Redis returned an invalid integer");
  }
  return numberValue;
}
