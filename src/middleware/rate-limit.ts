import type { Context, Next } from "hono";
import { DAY_MS } from "../config";

/**
 * 登录失败限流（简介：详见路由 auth.ts）
 * - 同一 IP 或 同一账户，10 分钟内失败 >= 10 次 → 临时锁定（双维度任一命中即锁）
 * - 无效网关 Token 探测限流：同一 IP 10 分钟内 >= 10 次 → 429（badex）
 */
const IP_KEY = (ip: string) => `loginfail:ip:${ip}`;
const USER_KEY = (username: string) => `loginfail:user:${username}`;
const BADTOKEN_KEY = (ip: string) => `badex:${ip}`;
const WINDOW_SEC = 600;
const MAX_FAILS = 10;
const BADTOKEN_WINDOW_SEC = 600;
const BADTOKEN_MAX = 10;
/** 锁定态存储：`lock@<截止 epoch ms>`（Workers KV 无读 TTL API，余量由时间戳计算） */
const LOCK_PREFIX = "lock@";
const LOCK_MS = WINDOW_SEC * 1000;

export function clientIp(c: Context): string {
  return (
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/** 解析计数存储：普通计数 n，或锁定态 `lock@until` */
function parseCount(raw: string | null): { n: number; lockedUntil: number } {
  if (raw && raw.startsWith(LOCK_PREFIX)) {
    return { n: MAX_FAILS, lockedUntil: Number(raw.slice(LOCK_PREFIX.length)) || 0 };
  }
  const n = Number(raw);
  return { n: Number.isFinite(n) && n > 0 ? n : 0, lockedUntil: 0 };
}

/** 读取并处理锁定到期自动恢复（删除后视为解锁） */
async function readCount(env: any, key: string): Promise<{ n: number; lockedUntil: number }> {
  const raw = await env.SESSIONS.get(key);
  const { n, lockedUntil } = parseCount(raw);
  if (n >= MAX_FAILS && lockedUntil > 0 && lockedUntil <= Date.now()) {
    await env.SESSIONS.delete(key);
    return { n: 0, lockedUntil: 0 };
  }
  return { n, lockedUntil };
}

/** 锁定剩余毫秒（0 = 未锁定/已到期） */
export async function loginLockRemainingMs(env: any, ip: string): Promise<number> {
  const { lockedUntil } = await readCount(env, IP_KEY(ip));
  return lockedUntil > 0 ? Math.max(0, lockedUntil - Date.now()) : 0;
}

/** 账户维度锁定剩余毫秒 */
export async function loginLockRemainingMsUser(env: any, username: string): Promise<number> {
  const { lockedUntil } = await readCount(env, USER_KEY(username));
  return lockedUntil > 0 ? Math.max(0, lockedUntil - Date.now()) : 0;
}

/** ==== IP 维度 ==== */

export async function loginFailCount(env: any, ip: string): Promise<number> {
  const { n } = await readCount(env, IP_KEY(ip));
  return n;
}

export async function loginFailIncrease(env: any, ip: string): Promise<void> {
  const n = (await loginFailCount(env, ip)) + 1;
  if (n >= MAX_FAILS) {
    await env.SESSIONS.put(IP_KEY(ip), `${LOCK_PREFIX}${Date.now() + LOCK_MS}`, { expirationTtl: WINDOW_SEC });
  } else {
    await env.SESSIONS.put(IP_KEY(ip), String(n), { expirationTtl: WINDOW_SEC });
  }
}

export async function loginFailReset(env: any, ip: string): Promise<void> {
  await env.SESSIONS.delete(IP_KEY(ip));
}

export async function loginBlocked(env: any, ip: string): Promise<boolean> {
  return (await loginFailCount(env, ip)) >= MAX_FAILS;
}

/** ==== 账户维度 ==== */

export async function loginFailCountUser(env: any, username: string): Promise<number> {
  const { n } = await readCount(env, USER_KEY(username));
  return n;
}

export async function loginFailIncreaseUser(env: any, username: string): Promise<void> {
  const n = (await loginFailCountUser(env, username)) + 1;
  if (n >= MAX_FAILS) {
    await env.SESSIONS.put(USER_KEY(username), `${LOCK_PREFIX}${Date.now() + LOCK_MS}`, { expirationTtl: WINDOW_SEC });
  } else {
    await env.SESSIONS.put(USER_KEY(username), String(n), { expirationTtl: WINDOW_SEC });
  }
}

export async function loginFailResetUser(env: any, username: string): Promise<void> {
  await env.SESSIONS.delete(USER_KEY(username));
}

export async function loginBlockedForUser(env: any, username: string): Promise<boolean> {
  return (await loginFailCountUser(env, username)) >= MAX_FAILS;
}

/** ==== 无效网关 Token 探测限流（/v1 Bearer 校验未命中时） ==== */

export async function badTokenCount(env: any, ip: string): Promise<number> {
  return Number(await env.SESSIONS.get(BADTOKEN_KEY(ip))) || 0;
}

export async function badTokenIncrease(env: any, ip: string): Promise<void> {
  const n = (await badTokenCount(env, ip)) + 1;
  await env.SESSIONS.put(BADTOKEN_KEY(ip), String(n), { expirationTtl: BADTOKEN_WINDOW_SEC });
}

export async function badTokenReset(env: any, ip: string): Promise<void> {
  await env.SESSIONS.delete(BADTOKEN_KEY(ip));
}

export async function badTokenBlocked(env: any, ip: string): Promise<boolean> {
  return (await badTokenCount(env, ip)) >= BADTOKEN_MAX;
}

/** 保留 DAY_MS 以对齐 config 导出风格（IP 注册隔离 24h 判断在路由中直接使用） */
export function ipWindowMs(): number {
  return DAY_MS;
}