import Redis from "ioredis";

export function createRedis(url?: string) {
  if (!url) return undefined;
  const redis = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 2000,
    commandTimeout: 2000,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  // Health checks report failures; never emit an unhandled error event.
  redis.on("error", () => {});
  return redis;
}
