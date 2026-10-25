import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { config } from "./config.js";
import { encrypt, hashPassword, randomToken, sha256, verifyPassword } from "./crypto.js";
import { db, type User } from "./db.js";
import { HttpError, parse } from "./http.js";
import { reload, serverStatus } from "./upstreams.js";

declare global {
  namespace Express {
    interface Request {
      user: User;
    }
  }
}

const SESSION_DAYS = 7;

async function startSession(res: Response, userId: number) {
  const token = randomToken();
  await db.query(
    `insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + interval '${SESSION_DAYS} days')`,
    [sha256(token), userId],
  );
  res.cookie("session", token, {
    httpOnly: true,
    sameSite: "strict",
    secure: config.publicUrl.startsWith("https"),
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  });
}

const sessionToken = (req: Request) => req.headers.cookie?.match(/(?:^|;\s*)session=([^;]+)/)?.[1];

async function requireUser(req: Request, _res: Response, next: NextFunction) {
  const token = sessionToken(req);
  const { rows } = await db.query<User>(
    `select u.id, u.email, u.name, u.role from sessions s join users u on u.id = s.user_id
     where s.token_hash = $1 and s.expires_at > now()`,
    [sha256(token ?? "")],
  );
  if (!rows[0]) throw new HttpError(401, "Not logged in");
  req.user = rows[0];
  next();
}

function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.user.role !== "admin") throw new HttpError(403, "Only admins can do that");
  next();
}

// Admins see everyone's records, members only their own
const ownerFilter = (req: Request) => (req.user.role === "admin" ? null : req.user.id);
const idParam = (req: Request) => parse(z.coerce.number().int(), req.params.id);

export const api = Router();

api.post("/login", async (req, res) => {
  const { email, password } = parse(z.object({ email: z.string(), password: z.string() }), req.body);
  const { rows } = await db.query("select id, password_hash from users where email = $1", [email.toLowerCase()]);
  if (!rows[0]?.password_hash || !(await verifyPassword(password, rows[0].password_hash))) {
    throw new HttpError(401, "Wrong email or password");
  }
  await startSession(res, rows[0].id);
  res.json({ ok: true });
});

api.post("/invites/accept", async (req, res) => {
  const { token, password } = parse(z.object({ token: z.string(), password: z.string().min(8) }), req.body);
  const { rows } = await db.query(
    "update users set password_hash = $2, invite_token_hash = null where invite_token_hash = $1 returning id",
    [sha256(token), await hashPassword(password)],
  );
  if (!rows[0]) throw new HttpError(404, "This invite link is invalid or was already used");
  await startSession(res, rows[0].id);
  res.json({ ok: true });
});

api.use(requireUser);

api.post("/logout", async (req, res) => {
  await db.query("delete from sessions where token_hash = $1", [sha256(sessionToken(req) ?? "")]);
  res.clearCookie("session").json({ ok: true });
});

api.get("/me", (req, res) => {
  res.json(req.user);
});

// Team

api.get("/users", requireAdmin, async (_req, res) => {
  const { rows } = await db.query(
    "select id, email, name, role, password_hash is null as invited, created_at from users order by id",
  );
  res.json(rows);
});

api.post("/users", requireAdmin, async (req, res) => {
  const { email, name, role } = parse(
    z.object({ email: z.email(), name: z.string().min(1), role: z.enum(["admin", "member"]) }),
    req.body,
  );
  const token = randomToken();
  await db.query("insert into users (email, name, role, invite_token_hash) values ($1, $2, $3, $4)", [
    email.toLowerCase(),
    name,
    role,
    sha256(token),
  ]);
  res.status(201).json({ inviteUrl: `${config.publicUrl}/invite/${token}` });
});

api.delete("/users/:id", requireAdmin, async (req, res) => {
  const id = idParam(req);
  if (id === req.user.id) throw new HttpError(400, "You can't remove yourself");
  await db.query("delete from users where id = $1", [id]);
  res.status(204).end();
});

// API keys

api.get("/keys", async (req, res) => {
  const { rows } = await db.query(
    `select k.id, k.name, k.prefix, k.created_at, k.last_used_at, k.revoked_at, u.email as user_email
     from api_keys k join users u on u.id = k.user_id
     where $1::int is null or k.user_id = $1 order by k.id desc`,
    [ownerFilter(req)],
  );
  res.json(rows);
});

api.post("/keys", async (req, res) => {
  const body = parse(z.object({ name: z.string().min(1), userId: z.number().int().optional() }), req.body);
  if (body.userId && body.userId !== req.user.id && req.user.role !== "admin") {
    throw new HttpError(403, "Only admins can issue keys for other people");
  }
  const key = randomToken("urumi_");
  const { rows } = await db.query(
    "insert into api_keys (user_id, name, prefix, key_hash) values ($1, $2, $3, $4) returning id, name, prefix, created_at",
    [body.userId ?? req.user.id, body.name, key.slice(0, 12), sha256(key)],
  );
  // The only time the full key is ever shown
  res.status(201).json({ ...rows[0], key });
});

api.delete("/keys/:id", async (req, res) => {
  const { rowCount } = await db.query(
    "update api_keys set revoked_at = now() where id = $1 and ($2::int is null or user_id = $2) and revoked_at is null",
    [idParam(req), ownerFilter(req)],
  );
  if (!rowCount) throw new HttpError(404, "Key not found");
  res.status(204).end();
});

// Upstream MCP servers

const serverFields = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,20}$/, "Use 1-20 lowercase letters, digits or dashes"),
  name: z.string().min(1),
  url: z.url({ protocol: /^https?$/ }),
  enabled: z.boolean(),
  auth: z.discriminatedUnion("type", [
    z.object({ type: z.literal("none") }),
    z.object({ type: z.literal("bearer"), token: z.string().min(1) }),
    z.object({ type: z.literal("header"), name: z.string().min(1), value: z.string().min(1) }),
  ]),
});

function credentialColumns(auth: z.infer<typeof serverFields>["auth"]) {
  if (auth.type === "none") return { header_name: null, header_value_enc: null };
  if (auth.type === "bearer") return { header_name: "Authorization", header_value_enc: encrypt(`Bearer ${auth.token}`) };
  return { header_name: auth.name, header_value_enc: encrypt(auth.value) };
}

api.get("/servers", (_req, res) => {
  res.json(serverStatus());
});

api.post("/servers", requireAdmin, async (req, res) => {
  const { auth, ...s } = parse(serverFields.partial({ enabled: true, auth: true }), req.body);
  const creds = credentialColumns(auth ?? { type: "none" });
  const { rows } = await db.query(
    `insert into servers (slug, name, url, enabled, header_name, header_value_enc)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [s.slug, s.name, s.url, s.enabled ?? true, creds.header_name, creds.header_value_enc],
  );
  await reload(rows[0].id);
  res.status(201).json(serverStatus().find((u) => u.id === rows[0].id));
});

api.patch("/servers/:id", requireAdmin, async (req, res) => {
  const id = idParam(req);
  const { auth, ...fields } = parse(serverFields.partial(), req.body);
  // Leaving auth out keeps the stored credential, since the dashboard never sees it
  const changes = Object.entries({ ...fields, ...(auth && credentialColumns(auth)) });
  if (changes.length) {
    const { rowCount } = await db.query(
      `update servers set ${changes.map(([column], i) => `${column} = $${i + 2}`).join(", ")} where id = $1`,
      [id, ...changes.map(([, value]) => value)],
    );
    if (!rowCount) throw new HttpError(404, "Server not found");
  }
  await reload(id);
  res.json(serverStatus().find((u) => u.id === id));
});

api.delete("/servers/:id", requireAdmin, async (req, res) => {
  const id = idParam(req);
  await db.query("delete from servers where id = $1", [id]);
  await reload(id);
  res.status(204).end();
});

// Audit log

api.get("/audit", async (req, res) => {
  const { rows } = await db.query(
    `select id, at, user_email, server_slug, tool, duration_ms, ok, error, source from audit_log
     where $1::int is null or user_id = $1 order by id desc limit 500`,
    [ownerFilter(req)],
  );
  res.json(rows);
});
