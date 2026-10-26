import { config } from "./config.js";

// A token bucket per user: short bursts are fine, the steady rate is capped.
// Per user rather than per key, so making more keys doesn't raise the limit.
const buckets = new Map<number, { tokens: number; updatedAt: number }>();

// Returns 0 when the call may go ahead, otherwise the seconds to wait
export function takeToken(userId: number) {
  const perMinute = config.rateLimitPerMinute;
  const now = Date.now();
  const bucket = buckets.get(userId) ?? { tokens: perMinute, updatedAt: now };
  bucket.tokens = Math.min(perMinute, bucket.tokens + ((now - bucket.updatedAt) / 60_000) * perMinute);
  bucket.updatedAt = now;
  buckets.set(userId, bucket);
  if (bucket.tokens < 1) return Math.ceil(((1 - bucket.tokens) / perMinute) * 60);
  bucket.tokens -= 1;
  return 0;
}
