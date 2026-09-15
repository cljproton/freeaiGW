import { Hono } from "hono";
import type { AppEnv, Env } from "../types";
import { requireServerToken } from "../middleware/auth";
import { decryptSecret } from "../utils/crypto";
import { recoverExpiredCircuits, updateChannel } from "../db";
import { purgeOldQuotas } from "../db";
import { budgetDailyRecovery } from "../middleware/budget";
import { todayStr, tierForCr } from "../config";
import { probeChannel } from "./channels";

const ROUTER = new Hono<AppEnv>();

/**
 * 每日任务（UTC 00:00，见六章）：
 * 1. Channel 健康校验（每轮 ≤50 subrequest）
 * 2. 清理过期用量记录（保留近 7 天）
 * 3. 熔断恢复 + EMA 衰减
 * 4. 贡献激励档位预计算（users.contribution_tier 缓存）
 * 5. 预算保护自动恢复 + 清理昨日计数器
 * 6. 信誉分每日回升 / 连续良行加速
 */
export async function runDailyTasks(env: Env): Promise<Record<string, unknown>> {
  const health = await validateChannelsBatch(env);
  const purged = await purgeOldQuotas(env, 7);
  await recoverExpiredCircuits(env);
  await emaDecayChannels(env);
  await refreshContributionTiers(env);
  await budgetDailyRecovery(env);
  await refreshReputations(env);
  await purgeOldLogs(env, 30);
  return { health, purged };
}

type ChannelRow = { id: number; api_url: string; api_key_encrypted: string };

async function validateChannelsBatch(env: Env): Promise<{ checked: number; okCount: number; total: number }> {
  const { results } = await env.DB
    .prepare(`SELECT id, api_url, api_key_encrypted FROM channels WHERE is_active = 1`)
    .all<ChannelRow>();
  const batch: ChannelRow[] = results;
  let checked = 0;
  let okCount = 0;
  for (const ch of batch.slice(0, 50)) {
    checked++;
    const key = await decryptSecret(env.ENCRYPTION_KEY, ch.api_key_encrypted).catch(() => "");
    if (!key) continue;
    const res = await probeChannel(ch.api_url, key);
    await updateChannel(env, ch.id, {
      is_valid: res.ok ? 1 : 0,
      last_error: res.ok ? null : (res.error ?? "校验未通过"),
    });
    if (res.ok) okCount++;
  }
  return { checked, okCount, total: batch.length };
}

/** EMA 衰减：近期请求记录折半，弱化旧数据权重（见 5.4） */
async function emaDecayChannels(env: Env): Promise<void> {
  await env.DB
    .prepare(
      `UPDATE channels SET total_requests = total_requests / 2, failed_requests = failed_requests / 2 WHERE total_requests > 100`,
    )
    .run();
}

/** 贡献激励档位预计算（cache contribution_tier，见附录 G） */
async function refreshContributionTiers(env: Env): Promise<void> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { results } = await env.DB
    .prepare(
      `SELECT c.owner_user_id AS uid, COUNT(*) AS cr
       FROM usage_logs l JOIN channels c ON c.id = l.channel_id
       WHERE l.user_id != c.owner_user_id AND l.http_status BETWEEN 200 AND 299 AND l.created_at > ?
       GROUP BY c.owner_user_id`,
    )
    .bind(weekAgo)
    .all<{ uid: number; cr: number }>();
  for (const r of results) {
    const tier = tierForCr(r.cr, env);
    await env.DB
      .prepare(`UPDATE users SET contribution_tier = ?, cr_cache_date = ? WHERE id = ?`)
      .bind(tier, todayStr(), r.uid)
      .run();
  }
  // 未上榜者可归零缓存档位（贡献已过期）
  const today = todayStr();
  if (results.length) {
    await env.DB
      .prepare(
        `UPDATE users SET contribution_tier = 0 WHERE contribution_tier > 0 AND (cr_cache_date IS NULL OR cr_cache_date < ?)`,
      )
      .bind(today)
      .run();
  }
}

/** 信誉分每日回升（J.4）：保底 +2，连续 3 天无扣分（无惩罚日志）再 +5 直至 80 */
async function refreshReputations(env: Env): Promise<void> {
  const daily = Number(env.REPUTATION_DECAY_DAILY) || 2;
  await env.DB.prepare(`UPDATE users SET reputation = CAST(MIN(100, reputation + ?) AS INTEGER)`)
    .bind(daily)
    .run();
  const since = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
  const { results } = await env.DB
    .prepare(
      `SELECT id FROM users WHERE reputation < 80 AND id NOT IN (
         SELECT DISTINCT user_id FROM usage_logs WHERE model LIKE '惩罚:%' AND created_at > ?
       )`,
    )
    .bind(since)
    .all<{ id: number }>();
  for (const r of results) {
    await env.DB
      .prepare(`UPDATE users SET reputation = CAST(MIN(80, reputation + ?) AS INTEGER) WHERE id = ?`)
      .bind(Number(env.REPUTATION_DECAY_GOOD) || 5, r.id)
      .run();
  }
}

/** 清理 30 天前的审计日志（保留近 7 天统计窗口） */
async function purgeOldLogs(env: Env, days: number): Promise<void> {
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  await env.DB.prepare(`DELETE FROM usage_logs WHERE created_at < ?`).bind(cutoff).run();
}

/** 手动触发入口（携带 CRON_TOKEN，便于本地调试） */
ROUTER.post("/run", requireServerToken, async (c) => {
  const result = await runDailyTasks(c.env);
  return c.json(result);
});

export default ROUTER;