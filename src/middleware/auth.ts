import type { Context, Next } from "hono";
import type { Env } from "../types";
import type { DBUser } from "../db/schema";
import { getActiveTokenByHash, getUserById } from "../db";
import { randomHex, sha256Hex } from "../utils/crypto";

const SESSION_COOKIE = "sid";
const SESSION_KEY = (sid: string) => `session:${sid}`;

export function sessionTtlSec(env: Env): number {
  return Number(env.SESSION_TTL) || 604800; // 默认 7 天
}

export async function createSession(env: Env, userId: number): Promise<string> {
  const sid = randomHex(24);
  const ttl = sessionTtlSec(env);
  await env.SESSIONS.put(SESSION_KEY(sid), JSON.stringify({ user_id: userId }), {
    expirationTtl: ttl,
  });
  return sid;
}

export function setSessionCookie(c: Context, sid: string): void {
  c.header(
    "Set-Cookie",
    `${SESSION_COOKIE}=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${sessionTtlSec(c.env)}`,
  );
}

export function clearSessionCookie(c: Context): void {
  c.header(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
  );
}

export function getSessionSid(c: Context): string | null {
  const val = c.req.header("cookie") || "";
  for (const part of val.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === SESSION_COOKIE) return v.join("=");
  }
  return null;
}

export async function destroySession(env: Env, sid: string): Promise<void> {
  await env.SESSIONS.delete(SESSION_KEY(sid));
  await env.SESSIONS.delete(FLASH_KEY(sid));
}

/** 一次性 flash 消息（注册成功展示明文 Token 用，读取即删） */
const FLASH_KEY = (sid: string) => `flash:${sid}`;

export async function setFlash(env: Env, sid: string, message: string): Promise<void> {
  await env.SESSIONS.put(FLASH_KEY(sid), message, { expirationTtl: 120 });
}

export async function getAndClearFlash(env: Env, sid: string | null): Promise<string | null> {
  if (!sid) return null;
  const msg = await env.SESSIONS.get(FLASH_KEY(sid));
  if (msg) await env.SESSIONS.delete(FLASH_KEY(sid));
  return msg;
}

async function userFromSid(env: Env, sid: string | null): Promise<DBUser | null> {
  if (!sid) return null;
  const raw = await env.SESSIONS.get(SESSION_KEY(sid));
  if (!raw) return null;
  try {
    const { user_id } = JSON.parse(raw) as { user_id: number };
    return await getUserById(env, user_id);
  } catch {
    return null;
  }
}

/** 页面守卫：未登录重定向 /auth */
export async function requirePageUser(c: Context<{ Bindings: Env; Variables: { user?: DBUser } }>, next: Next) {
  const user = await userFromSid(c.env, getSessionSid(c));
  if (!user) return c.redirect("/auth");
  c.set("user", user);
  await next();
}

/** JSON API 守卫：未登录 401 */
export async function requireApiUser(c: Context, next: Next) {
  const user = await userFromSid(c.env, getSessionSid(c));
  if (!user) return c.json({ error: "unauthorized", message: "请先登录" }, 401);
  c.set("user", user);
  await next();
}

/** /v1/* Bearer sk-xxx 校验（见 F：只存哈希） */
export async function requireBearerToken(c: Context, next: Next) {
  const auth = c.req.header("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : auth;
  if (!token) {
    c.status(401);
    return c.json({ error: "unauthorized", message: "missing Authorization: Bearer sk-xxx" });
  }
  const tokenHash = await sha256Hex(token);
  const dbToken = await getActiveTokenByHash(c.env, tokenHash);
  if (!dbToken) {
    c.status(401);
    return c.json({ error: "invalid_token", message: "网关 Token 无效或已重置，请重新获取" });
  }
  const user = await getUserById(c.env, dbToken.user_id);
  if (!user) {
    c.status(401);
    return c.json({ error: "user_not_found" });
  }
  c.set("auth", { token: dbToken, user });
  c.set("user", user);
  await next();
}

export async function requireServerToken(c: Context, next: Next) {
  const token = c.req.header("x-cron-token") || c.req.query("token");
  if (token !== c.env.CRON_TOKEN) {
    c.status(403);
    return c.json({ error: "forbidden" });
  }
  await next();
}