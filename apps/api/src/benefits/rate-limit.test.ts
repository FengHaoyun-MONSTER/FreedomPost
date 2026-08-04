import { describe, expect, it } from "vitest";
import {
  MemoryRateLimitBackend,
  RedisRateLimitBackend,
  createBenefitRateLimiter
} from "./rate-limit.js";
import { loadBenefitRedisConfig } from "./redis.js";

const subjectHash = "a".repeat(64);

describe("benefit rate limiter", () => {
  it("uses one atomic Redis operation and never places a raw address in its key", async () => {
    const calls: Array<{ script: string; keys: string[]; arguments: string[] }> = [];
    const redis = {
      async eval(script: string, options: { keys: string[]; arguments: string[] }) {
        calls.push({ script, ...options });
        return [1, 60_000];
      }
    };
    const limiter = createBenefitRateLimiter({
      primary: new RedisRateLimitBackend(redis),
      fallback: new MemoryRateLimitBackend(() => 1_000),
      prefix: "fp:benefit"
    });

    await expect(limiter.consume("claim-minute", subjectHash, 4, 60_000)).resolves.toMatchObject({
      allowed: true,
      remaining: 3,
      source: "redis"
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.keys).toEqual([`fp:benefit:claim-minute:${subjectHash}`]);
    expect(calls[0]?.keys.join("")).not.toContain("203.0.113.9");
    expect(calls[0]?.script).toContain("INCR");
    expect(calls[0]?.script).toContain("PEXPIRE");
  });

  it("shadows successful Redis requests and degrades to a stricter process limit", async () => {
    let redisCalls = 0;
    const primary = {
      async consume() {
        redisCalls += 1;
        if (redisCalls > 1) throw new Error("redis unavailable");
        return { count: 1, resetAfterMs: 60_000 };
      }
    };
    const limiter = createBenefitRateLimiter({
      primary,
      fallback: new MemoryRateLimitBackend(() => 5_000),
      prefix: "fp:benefit"
    });

    await expect(limiter.consume("claim-minute", subjectHash, 4, 60_000)).resolves.toMatchObject({
      allowed: true,
      source: "redis"
    });
    await expect(limiter.consume("claim-minute", subjectHash, 4, 60_000)).resolves.toMatchObject({
      allowed: true,
      remaining: 0,
      source: "fallback"
    });
    await expect(limiter.consume("claim-minute", subjectHash, 4, 60_000)).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
      source: "fallback"
    });
  });

  it("rejects unsafe scopes and unhashed subjects", async () => {
    const limiter = createBenefitRateLimiter({
      fallback: new MemoryRateLimitBackend()
    });

    await expect(limiter.consume("../claim", subjectHash, 4, 60_000)).rejects.toThrow("scope");
    await expect(limiter.consume("claim", "203.0.113.9", 4, 60_000)).rejects.toThrow("hash");
  });

  it("accepts only Redis connection URLs", () => {
    expect(loadBenefitRedisConfig({ REDIS_URL: "redis://redis:6379" })).toEqual({
      url: "redis://redis:6379"
    });
    expect(loadBenefitRedisConfig({ REDIS_URL: "rediss://user:secret@redis.example.test:6380/1" })).toEqual({
      url: "rediss://user:secret@redis.example.test:6380/1"
    });
    expect(() => loadBenefitRedisConfig({ REDIS_URL: "https://redis.example.test" })).toThrow("redis://");
  });
});
