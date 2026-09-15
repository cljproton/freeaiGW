import type { Env } from "../types";
import { updateReputation } from "../db";

/** 信誉分变化集中入口（宽松惩罚机制，见 A.5 / 附录 J） */

export type PenaltyKind =
  | "4xx"                 // 连续 4xx/5xx（>5次/小时）-> -3
  | "limit_hit"           // 命中全局限流仍持续调用 -> -10
  | "burst"               // 单日调用异常爆发（>=3倍上限）-> -8
  | "invalid_key"         // 无效 Key 提交 -> -5
  | "repeat_invalid"      // 反复无效提交（>=3次/天）-> -15
  | "malicious";          // 疑似恶意域名 -> -30

const PENALTY_ENV_MAP: Record<PenaltyKind, keyof Env> = {
  "4xx": "REPUTATION_PENALTY_4XX",
  limit_hit: "REPUTATION_PENALTY_LIMIT_HIT",
  burst: "REPUTATION_PENALTY_BURST",
  invalid_key: "REPUTATION_PENALTY_INVALID_KEY",
  repeat_invalid: "REPUTATION_PENALTY_REPEAT_INVALID",
  malicious: "REPUTATION_PENALTY_MALICIOUS",
};

export function penaltyValue(env: Env, kind: PenaltyKind): number {
  return Number(env[PENALTY_ENV_MAP[kind]]) || 5;
}

/** 扣分并记录审计（惩罚不撤已入池 Channel，只影响信誉->当日配额，见 J.1） */
export async function penalize(env: Env, userId: number, kind: PenaltyKind): Promise<void> {
  const delta = -Math.abs(penaltyValue(env, kind));
  await updateReputation(env, userId, delta);
  await env.DB.prepare(
    `INSERT INTO usage_logs (token_id, channel_id, user_id, caller_ip, model, http_status, retry_count)
     VALUES (0, 0, ?, '', ?, ?, 0)`,
  )
    .bind(userId, `惩罚:${kind}`, delta)
    .run();
}

/** 每日保底回升 +2（Cron；上限 100，见 J.4） */
export async function dailyReputationReward(env: Env, userId: number): Promise<void> {
  const delta = Number(env.REPUTATION_DECAY_DAILY) || 2;
  await updateReputation(env, userId, delta);
}

/** 连续 3 天无扣分 → 加速 +5/天 直至 80 回正（见 J.4 / env REPUTATION_DECAY_GOOD） */
export async function goodStandingReward(env: Env, userId: number): Promise<void> {
  const delta = Number(env.REPUTATION_DECAY_GOOD) || 5;
  await env.DB
    .prepare(
      `UPDATE users SET reputation = CAST(MIN(100, reputation + ?) AS INTEGER)
       WHERE id = ? AND reputation < 80`,
    )
    .bind(delta, userId)
    .run();
}