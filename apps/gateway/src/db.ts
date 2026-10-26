import pg from "pg";
import { config } from "./config.js";
import { hashPassword } from "./crypto.js";

export const db = new pg.Pool({ connectionString: config.databaseUrl });

export type User = { id: number; email: string; name: string; role: "admin" | "member" };

const SCHEMA = `
create table if not exists users (
  id serial primary key,
  email text unique not null,
  name text not null,
  role text not null check (role in ('admin', 'member')),
  password_hash text,
  invite_token_hash text unique,
  created_at timestamptz not null default now()
);
create table if not exists sessions (
  token_hash text primary key,
  user_id int not null references users on delete cascade,
  expires_at timestamptz not null
);
create table if not exists api_keys (
  id serial primary key,
  user_id int not null references users on delete cascade,
  name text not null,
  prefix text not null,
  key_hash text unique not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create table if not exists servers (
  id serial primary key,
  slug text unique not null,
  name text not null,
  url text not null,
  header_name text,
  header_value_enc text,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id int references users on delete set null,
  user_email text not null,
  server_slug text,
  tool text not null,
  duration_ms int not null,
  ok boolean not null,
  error text,
  source text not null
);
-- Added after the first release, so existing databases get it too
alter table servers add column if not exists admin_only_tools text[] not null default '{}';
`;

async function count(table: string) {
  const { rows } = await db.query(`select count(*)::int as n from ${table}`);
  return rows[0].n as number;
}

export async function migrate() {
  await db.query(SCHEMA);
  if ((await count("users")) === 0) {
    await db.query("insert into users (email, name, role, password_hash) values ($1, 'Admin', 'admin', $2)", [
      config.adminEmail.toLowerCase(),
      await hashPassword(config.adminPassword),
    ]);
  }
  if ((await count("servers")) === 0) {
    for (const s of config.seedServers) {
      await db.query("insert into servers (slug, name, url, admin_only_tools) values ($1, $2, $3, $4)", [
        s.slug,
        s.name,
        s.url,
        s.adminOnlyTools ?? [],
      ]);
    }
  }
}
