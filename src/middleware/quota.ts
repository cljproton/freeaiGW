import type { Context, Next } from "hono";
import { getUserEffectiveLimits, getQuotaLimit, todayStr } from "../config";
import { getQuota, spendCall } from "../db";
import { penalize, type PenaltyKind } from "../utils/audit";

/**
 * 用户配额检查（见 4.4 / A.3 / E.3）
 * 前置原子扣减一次调用额度，超限返回 429 并按宽松惩罚第 J.3 节扣信誉分。
 * 新用户（注册 < 7 天）配额减半。
 */
export async function quotaGuard(c: Context, next: Next) {
  const auth = c.get("auth");
  if (!auth) {
    c.status(401);
    return c.json({ error: "unauthorized" });
  }
  const { user } = auth;

  const limit = (await getUserEffectiveLimits(c.env, user)).calls;
  const spent = await spendCall(c.env, user.id, todayStr(), limit);
  if (!spent) {
    const kind: PenaltyKind =
      (await getQuota(c.env, user.id, todayStr())).calls >= getQuotaLimit(user.reputation).calls * 3
        ? "burst"
        : "limit_hit";
    await penalize(c.env, user.id, kind);
    c.status(429);
    return c.json({
      error: "quota_exceeded",
      message: "今日调用额度已用完，请明日再试",
    });
  }
  await next();
}