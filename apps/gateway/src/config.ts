function env(name: string, fallback?: string) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`${name} is not set`);
  return value;
}

const seedServers = JSON.parse(env("SEED_SERVERS", "[]")) as { slug: string; name: string; url: string }[];

export const config = {
  databaseUrl: env("DATABASE_URL"),
  encryptionKey: env("ENCRYPTION_KEY"),
  adminEmail: env("ADMIN_EMAIL"),
  adminPassword: env("ADMIN_PASSWORD"),
  publicUrl: env("PUBLIC_URL"),
  seedServers,
  // The platform's own in-cluster MCP services: the only private hosts an upstream may use
  internalHosts: new Set(seedServers.map((s) => new URL(s.url).hostname)),
  callTimeoutMs: Number(env("CALL_TIMEOUT_MS", "30000")),
  healthIntervalMs: Number(env("HEALTH_INTERVAL_MS", "10000")),
  connectTimeoutMs: 5000,
  llm: {
    baseUrl: env("LLM_BASE_URL"),
    model: env("LLM_MODEL"),
    apiKey: process.env.LLM_API_KEY,
  },
};
