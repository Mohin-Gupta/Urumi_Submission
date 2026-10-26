const buckets = new Map<string, { tokens: number; updatedAt: number }>();

export function takeToken(key: string, perMinute: number) {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: perMinute, updatedAt: now };
  bucket.tokens = Math.min(perMinute, bucket.tokens + ((now - bucket.updatedAt) / 60_000) * perMinute);
  bucket.updatedAt = now;
  buckets.set(key, bucket);
  if (bucket.tokens < 1) return Math.ceil(((1 - bucket.tokens) / perMinute) * 60);
  bucket.tokens -= 1;
  return 0;
}
