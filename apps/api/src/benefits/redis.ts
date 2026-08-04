import { createClient } from "redis";
import { RedisRateLimitBackend, type RateLimitBackend } from "./rate-limit.js";

interface BenefitRedisEnvironment {
  REDIS_URL?: string;
}

export interface BenefitRedisConfig {
  url: string;
}

export interface BenefitRedisConnection {
  backend: RateLimitBackend;
  connect(): Promise<boolean>;
  close(): Promise<void>;
  isReady(): boolean;
}

export function loadBenefitRedisConfig(
  environment: BenefitRedisEnvironment = process.env
): BenefitRedisConfig {
  const rawUrl = environment.REDIS_URL ?? "";
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("REDIS_URL must be a valid absolute URL");
  }
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use redis:// or rediss://");
  }
  if (!url.hostname) throw new Error("REDIS_URL must include a hostname");
  return { url: url.toString() };
}

export function createBenefitRedisConnection(
  config: BenefitRedisConfig,
  onError: (error: Error) => void = () => undefined
): BenefitRedisConnection {
  const { url } = loadBenefitRedisConfig({ REDIS_URL: config.url });
  const client = createClient({
    url,
    socket: {
      connectTimeout: 2_000,
      reconnectStrategy(retries) {
        return retries > 3 ? false : Math.min(100 * 2 ** retries, 1_000);
      }
    }
  });
  client.on("error", (error) => onError(error));
  const backend = new RedisRateLimitBackend({
    eval: (script, options) => client.eval(script, options)
  });

  return {
    backend,
    async connect() {
      if (client.isReady) return true;
      try {
        if (!client.isOpen) await client.connect();
        return client.isReady;
      } catch {
        return false;
      }
    },
    async close() {
      if (!client.isOpen) return;
      try {
        await client.close();
      } catch {
        client.destroy();
      }
    },
    isReady() {
      return client.isReady;
    }
  };
}
