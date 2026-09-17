import type { Context, Next } from "hono";
import type { Env } from "../types";
import type { DBUser } from "../db/schema";
import { getActiveTokenByHash, getUserById } from "../db";
import { clientIp, badTokenBlocked, badTokenIncrease } from "./rate-limit";
import { randomHex, sha256Hex } from "../utils/crypto";
import { t, type Lang } from "../i18n";

const SESSION_COOKIE = "sid";
const SESSION_KEY = (sid: string) => `session:${sid}`;

/** 密码版本指纹：会话校验用，密码变更后旧会话自动失效 */
const PWV_LEN = 16;

export function sessionTtlSec(env: Env): number {
  return Number(env.SESSION_TTL) || 604800; // 默认 7 天
}

/** Cookie 是否带 Secure（HTTPS 限定，COOKIE_SECURE=1 启用，防止本地 http 开发失效） */
function cookieSecure(env: Env): boolean {
  return String(env.COOKIE_SECURE) === "1";
}

export async function createSession(env: Env, userId: number): Promise<string> {
  const sid = randomHex(24);
  const ttl = sessionTtlSec(env);
  const user = await getUserById(env, userId);
  const pwv = user?.password_hash?.slice(0, PWV_LEN) ?? "";
  await env.SESSIONS.put(SESSION_KEY(sid), JSON.stringify({ user_id: userId, pwv }), {
    expirationTtl: ttl,
  });
  return sid;
}

export function setSessionCookie(c: Context, sid: string): void {
  const secure = cookieSecure(c.env) ? "; Secure" : "";
  c.header(
    "Set-Cookie",
    `${SESSION_COOKIE}=${sid}; HttpOnly; Path=/; SameSite=Lax${secure}; Max-Age=${sessionTtlSec(c.env)}`,
  );
}

export function clearSessionCookie(c: Context): void {
  const secure = cookieSecure(c.env) ? "; Secure" : "";
  c.header(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax${secure}; Max-Age=0`,
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

/** 密码变更后刷新当前会话的 pwv 指纹：当前端保持登录，其它端因指纹不匹配自动失效 */
export async function refreshSessionPassword(
  env: Env,
  sid: string | null,
  userId: number,
  passwordHash: string,
): Promise<void> {
  if (!sid) return;
  const ttl = sessionTtlSec(env);
  await env.SESSIONS.put(
    SESSION_KEY(sid),
    JSON.stringify({ user_id: userId, pwv: passwordHash.slice(0, PWV_LEN) }),
    { expirationTtl: ttl },
  );
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
  let parsed: { user_id: number; pwv?: string };
  try {
    parsed = JSON.parse(raw) as { user_id: number; pwv?: string };
  } catch {
    return null;
  }
  const user = await getUserById(env, parsed.user_id);
  if (!user) return null;
  // 密码版本指纹：变更后旧会话失效；历史会话（无 pwv 字段）视为通过（平滑迁移）
  if (parsed.pwv && parsed.pwv !== user.password_hash.slice(0, PWV_LEN)) return null;
  return user;
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

/** /v1/* Bearer sk-xxx 校验（见 F：只存哈希）+ 无效 Token IP 级限流（防探测/DoS） */
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
    const ip = clientIp(c);
    if (await badTokenBlocked(c.env, ip)) {
      c.status(429);
      const lang = (c.get("lang") as Lang | undefined) ?? "en";
      return c.json({ error: "rate_limited", message: t(lang, "errors", "rate_limited") });
    }
    await badTokenIncrease(c.env, ip);
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