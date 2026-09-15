import type { Context, Next } from "hono";
import { DAY_MS } from "../config";

/**
 * 登录失败限流（简介：详见路由 auth.ts）
 * - 同一 IP 10 分钟内失败 >= 10 次 → 临时锁定
 */
const KEY = (ip: string) => `loginfail:${ip}`;
const WINDOW_SEC = 600;
const MAX_FAILS = 10;

export function clientIp(c: Context): string {
  return (
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export async function loginFailCount(env: any, ip: string): Promise<number> {
  return Number(await env.SESSIONS.get(KEY(ip))) || 0;
}

export async function loginFailIncrease(env: any, ip: string): Promise<void> {
  const n = (await loginFailCount(env, ip)) + 1;
  await env.SESSIONS.put(KEY(ip), String(n), { expirationTtl: WINDOW_SEC });
}

export async function loginFailReset(env: any, ip: string): Promise<void> {
  await env.SESSIONS.delete(KEY(ip));
}

export async function loginBlocked(env: any, ip: string): Promise<boolean> {
  return (await loginFailCount(env, ip)) >= MAX_FAILS;
}

/** 保留 DAY_MS 以对齐 config 导出风格（IP 注册隔离 24h 判断在路由中直接使用） */
export function ipWindowMs(): number {
  return DAY_MS;
}