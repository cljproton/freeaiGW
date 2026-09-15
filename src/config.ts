import type { Env } from "./types";

export const DAY_MS = 24 * 60 * 60 * 1000;

/** 把 env 变量解析为数字（带默认兜底，仅处理字符串型配置） */
export function num(env: Env, key: keyof Env): number {
  const v = env[key] as unknown;
  return typeof v === "string" ? Number(v) : 0;
}

/** 今日日期字符串（UTC YYYY-MM-DD） */
export function todayStr(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function yesterdayStr(): string {
  return todayStr(new Date(Date.now() - DAY_MS));
}

export function minutesAgoStr(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

export function daysAgoStr(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

/** 分级配额（A.5，永不归零） */
export function getQuotaLimit(reputation: number) {
  if (reputation >= 80) return { calls: 100, tokens: 300000 };
  if (reputation >= 60) return { calls: 40, tokens: 150000 };
  if (reputation >= 40) return { calls: 25, tokens: 100000 };
  if (reputation >= 20) return { calls: 10, tokens: 40000 };
  return { calls: 3, tokens: 10000 };
}

/** 新用户判定（注册后 NEW_USER_DAYS 天内，配额减半） */
export function isNewUser(createdAt: string, env: Env): boolean {
  const days = num(env, "NEW_USER_DAYS") || 7;
  return Date.now() - new Date(createdAt).getTime() < days * DAY_MS;
}

/** 新用户配额（A.3：正常减半） */
export function newUserQuota(env: Env) {
  return {
    calls: num(env, "NEW_USER_CALLS_QUOTA") || 50,
    tokens: num(env, "NEW_USER_TOKENS_QUOTA") || 150000,
  };
}

/** CR → 贡献档位 0-4（附录 G） */
export function tierForCr(cr: number, env: Env): number {
  const t4 = num(env, "CONTRIBUTION_TIER_4_CR") || 500;
  const t3 = num(env, "CONTRIBUTION_TIER_3_CR") || 200;
  const t2 = num(env, "CONTRIBUTION_TIER_2_CR") || 50;
  const t1 = num(env, "CONTRIBUTION_TIER_1_CR") || 1;
  if (cr >= t4) return 4;
  if (cr >= t3) return 3;
  if (cr >= t2) return 2;
  if (cr >= t1) return 1;
  return 0;
}

/** 档位加成（次/天） */
export function tierBonus(tier: number, env: Env): number {
  switch (tier) {
    case 4:
      return num(env, "CONTRIBUTION_TIER_4_BONUS") || 100;
    case 3:
      return num(env, "CONTRIBUTION_TIER_3_BONUS") || 60;
    case 2:
      return num(env, "CONTRIBUTION_TIER_2_BONUS") || 30;
    case 1:
      return num(env, "CONTRIBUTION_TIER_1_BONUS") || 10;
    default:
      return 0;
  }
}

/**
 * 用户生效的当日限额 = 分级基础配额（新用户减半）+ 贡献档位加成（仅信誉 >=60，见 E.3）
 * tokens 无贡献加成。章程见 A.5 / A.3 / E.3。
 */
export async function getUserEffectiveLimits(
  env: Env,
  user: { id: number; reputation: number; contribution_tier: number; created_at: string },
): Promise<{ calls: number; tokens: number }> {
  const base = getQuotaLimit(user.reputation);
  const new_ = isNewUser(user.created_at, env);
  const newCall = num(env, "NEW_USER_CALLS_QUOTA") || 50;
  const newToken = num(env, "NEW_USER_TOKENS_QUOTA") || 150000;

  const calls = Math.min(base.calls, new_ ? newCall : base.calls);
  const tokens = Math.min(base.tokens, new_ ? newToken : base.tokens);

  let bonus = 0;
  if (user.reputation >= 60) bonus = tierBonus(user.contribution_tier, env);

  return { calls: calls + bonus, tokens };
}

/** 新手贡献加成（注册 7 天内首次提交且 CR≥50 → +30 次/天，见 G.3） */
export function getNewbieBonus(env: Env): number {
  return num(env, "CONTRIBUTION_NEWBIE_BONUS") || 30;
}

/** 预算保护采样率（1/200） */
export function sampleRate(env: Env): number {
  const s = (env.BUDGET_SAMPLE_RATE || "1/200").split("/");
  const den = Number(s[1]) || 200;
  return 1 / den;
}

/** 预算暂停阈值 */
export function pauseThreshold(env: Env): number {
  return num(env, "BUDGET_PAUSE_THRESHOLD") || 0.9;
}