import type { DBChannel, DBQuota, DBToken, DBUser, DBUsageLog } from "./schema";
import type { Env } from "../types";
import { todayStr } from "../config";

/** ===== 用户 ===== */

export async function getUserByUsername(env: Env, username: string): Promise<DBUser | null> {
  return env.DB.prepare(`SELECT * FROM users WHERE username = ?`).bind(username).first<DBUser>();
}

export async function getUserById(env: Env, id: number): Promise<DBUser | null> {
  return env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<DBUser>();
}

/** 修改密码：仅更新 password_hash */
export async function updatePassword(env: Env, userId: number, passwordHash: string): Promise<void> {
  await env.DB.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).bind(passwordHash, userId).run();
}

export async function createUser(
  env: Env,
  username: string,
  passwordHash: string,
  ip: string,
): Promise<DBUser> {
  const res = await env.DB.prepare(
    `INSERT INTO users (username, password_hash, registered_ip) VALUES (?, ?, ?)`,
  )
    .bind(username, passwordHash, ip)
    .run();
  const id = Number(res.meta.last_row_id);
  return (await getUserById(env, id)) as DBUser;
}

/** 更新信誉分（clamp 0-100） */
export async function updateReputation(env: Env, userId: number, delta: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE users SET reputation = CAST(MAX(0, MIN(100, reputation + ?)) AS INTEGER) WHERE id = ?`,
  )
    .bind(delta, userId)
    .run();
}

export async function getReputation(env: Env, userId: number): Promise<number> {
  const row = await env.DB.prepare(`SELECT reputation FROM users WHERE id = ?`)
    .bind(userId)
    .first<{ reputation: number }>();
  return row?.reputation ?? 100;
}

/** ===== 网关 Token（单 Token 模型，见 F） ===== */

export async function getActiveTokenByHash(env: Env, tokenHash: string): Promise<DBToken | null> {
  return env.DB
    .prepare(`SELECT * FROM user_tokens WHERE token_hash = ? AND is_active = 1`)
    .bind(tokenHash)
    .first<DBToken>();
}

export async function getTokenById(env: Env, id: number): Promise<DBToken | null> {
  return env.DB.prepare(`SELECT * FROM user_tokens WHERE id = ?`).bind(id).first<DBToken>();
}

export async function getActiveTokenByUser(env: Env, userId: number): Promise<DBToken | null> {
  return env.DB
    .prepare(`SELECT * FROM user_tokens WHERE user_id = ? AND is_active = 1 LIMIT 1`)
    .bind(userId)
    .first<DBToken>();
}

/** 单 Token 模型：撤销旧活跃 Token + 插入新 Token（原子 batch，见 F.2） */
export async function issueToken(
  env: Env,
  userId: number,
  tokenHash: string,
  tokenPrefix: string,
  name: string,
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`UPDATE user_tokens SET is_active = 0 WHERE user_id = ? AND is_active = 1`).bind(userId),
    env.DB
      .prepare(`INSERT INTO user_tokens (user_id, token_hash, token_prefix, name) VALUES (?, ?, ?, ?)`)
      .bind(userId, tokenHash, tokenPrefix, name),
  ]);
}

export async function deactivateToken(env: Env, tokenId: number): Promise<void> {
  await env.DB.prepare(`UPDATE user_tokens SET is_active = 0 WHERE id = ?`).bind(tokenId).run();
}

/**, 更新时间戳 */
export async function touchToken(env: Env, tokenId: number): Promise<void> {
  await env.DB
    .prepare(`UPDATE user_tokens SET last_used_at = datetime('now') WHERE id = ?`)
    .bind(tokenId)
    .run();
}

/** ===== Channel ===== */

/** 候选池查询：活跃 + 有效 + 未熔断，按 models LIKE 粗筛（精确匹配见 5.3 A3） */
export async function listCandidateChannels(env: Env, model: string): Promise<DBChannel[]> {
  const r = await env.DB
    .prepare(
      `SELECT * FROM channels
       WHERE is_active = 1 AND is_valid = 1 AND is_circuited = 0
         AND (models LIKE '%"*"%' OR models LIKE ?)
       ORDER BY total_requests ASC`,
    )
    .bind(`%"${model}"%`)
    .all<DBChannel>();
  return r.results;
}

export async function getChannelById(env: Env, id: number): Promise<DBChannel | null> {
  return env.DB.prepare(`SELECT * FROM channels WHERE id = ?`).bind(id).first<DBChannel>();
}

export async function insertChannel(
  env: Env,
  ch: Omit<DBChannel, "id" | "created_at" | "updated_at">,
): Promise<number> {
  const res = await env.DB.prepare(
    `INSERT INTO channels
       (owner_user_id, provider, api_url, api_key_encrypted, key_hint, models, weight,
        is_active, is_valid, is_circuited, circuit_until, circuit_count,
        success_rate, total_requests, failed_requests, last_error, last_success_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      ch.owner_user_id,
      ch.provider,
      ch.api_url,
      ch.api_key_encrypted,
      ch.key_hint,
      ch.models,
      ch.weight,
      ch.is_active,
      ch.is_valid,
      ch.is_circuited,
      ch.circuit_until,
      ch.circuit_count,
      ch.success_rate,
      ch.total_requests,
      ch.failed_requests,
      ch.last_error,
      ch.last_success_at,
    )
    .run();
  return Number(res.meta.last_row_id);
}

export async function updateChannel(env: Env, id: number, patch: Partial<DBChannel>): Promise<void> {
  const cols: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    cols.push(`${k} = ?`);
    vals.push(v);
  }
  if (!cols.length) return;
  vals.push(id);
  await env.DB.prepare(`UPDATE channels SET ${cols.join(", ")}, updated_at = datetime('now') WHERE id = ?`)
    .bind(...vals)
    .run();
}

export async function listChannelsByOwner(env: Env, userId: number): Promise<DBChannel[]> {
  const r = await env.DB
    .prepare(`SELECT * FROM channels WHERE owner_user_id = ? ORDER BY created_at DESC`)
    .bind(userId)
    .all<DBChannel>();
  return r.results;
}

export async function countActiveChannels(env: Env): Promise<number> {
  const row = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM channels WHERE is_active = 1 AND is_valid = 1`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** 调用后更新 Channel 统计（EMA 折半前的滚动计数，见 5.4） */
export async function recordChannelResult(
  env: Env,
  id: number,
  ok: boolean,
  err?: string,
): Promise<void> {
  if (ok) {
    await env.DB
      .prepare(
        `UPDATE channels
         SET total_requests = total_requests + 1, success_rate = (total_requests * success_rate + 1) / (total_requests + 1),
             last_error = NULL, last_success_at = datetime('now')
         WHERE id = ?`,
      )
      .bind(id)
      .run();
  } else {
    await env.DB
      .prepare(
        `UPDATE channels
         SET total_requests = total_requests + 1, failed_requests = failed_requests + 1,
             success_rate = (total_requests * success_rate) / (total_requests + 1),
             last_error = ?
         WHERE id = ?`,
      )
      .bind(err, id)
      .run();
  }
}

/** 熔断：置 is_circuited=1，累积印记，印记>=5 自动下架（B.2） */
export async function circuitBreakChannel(env: Env, id: number): Promise<void> {
  const { CIRCUIT_MAX_DURATION_MINUTES = "30" } = env;
  const minutes = Number(CIRCUIT_MAX_DURATION_MINUTES) || 30;
  const until = new Date(Date.now() + minutes * 60 * 1000).toISOString();
  const row = await env.DB
    .prepare(
      `UPDATE channels
       SET is_circuited = 1, circuit_until = ?, circuit_count = circuit_count + 1,
           is_active = CASE WHEN circuit_count + 1 >= ? THEN 0 ELSE is_active END
       WHERE id = ? RETURNING circuit_count, is_active`,
    )
    .bind(until, Number(env.CIRCUIT_DEACTIVATE_COUNT) || 5, id)
    .first<{ circuit_count: number; is_active: number }>();
  if (row && row.is_active === 0) {
    // 记录下架原因到 last_error（供贡献者查看）
    await env.DB
      .prepare(`UPDATE channels SET last_error = '自动下架：反复熔断超过 5 次，请重新激活' WHERE id = ?`)
      .bind(id)
      .run();
  }
}

/** 熔断到期恢复（Cron，见 5.4） */
export async function recoverExpiredCircuits(env: Env): Promise<{ n: number }> {
  const now = new Date().toISOString();
  const res = await env.DB
    .prepare(
      `UPDATE channels SET is_circuited = 0, circuit_until = NULL
       WHERE is_circuited = 1 AND circuit_until IS NOT NULL AND circuit_until < ?
         AND circuit_count < ?`,
    )
    .bind(now, Number(env.CIRCUIT_DEACTIVATE_COUNT) || 5)
    .run();
  return { n: res.meta.changes };
}

/** 贡献者重新激活（重置熔断印记，B.2） */
export async function reactivateChannel(env: Env, id: number, ownerUserId: number): Promise<boolean> {
  const res = await env.DB
    .prepare(
      `UPDATE channels SET is_active = 1, is_circuited = 0, circuit_until = NULL, circuit_count = 0, updated_at = datetime('now')
       WHERE id = ? AND owner_user_id = ?`,
    )
    .bind(id, ownerUserId)
    .run();
  return res.meta.changes > 0;
}

/** 删除 Channel（reclaim 加成由使用者侧每日任务处理，见 4.3） */
export async function deleteChannel(env: Env, id: number, ownerUserId: number): Promise<boolean> {
  const res = await env.DB
    .prepare(`DELETE FROM channels WHERE id = ? AND owner_user_id = ?`)
    .bind(id, ownerUserId)
    .run();
  return res.meta.changes > 0;
}

/** ===== 配额（4.4 原子扣减） ===== */

export async function getQuota(env: Env, userId: number, date: string): Promise<DBQuota> {
  const row = await env.DB
    .prepare(`SELECT * FROM user_quotas WHERE user_id = ? AND date = ?`)
    .bind(userId, date)
    .first<DBQuota>();
  if (row) return row;
  return { user_id: userId, date, calls: 0, tokens: 0 };
}

/**
 * 原子扣减一次调用额度（4.4 A1）：
 * 先 INSERT OR IGNORE 保证行存在，再条件 UPDATE；返回是否扣减成功。
 */
export async function spendCall(env: Env, userId: number, date: string, limit: number): Promise<boolean> {
  await env.DB
    .prepare(`INSERT OR IGNORE INTO user_quotas (user_id, date, calls, tokens) VALUES (?, ?, 0, 0)`)
    .bind(userId, date)
    .run();
  const res = await env.DB
    .prepare(`UPDATE user_quotas SET calls = calls + 1 WHERE user_id = ? AND date = ? AND calls < ?`)
    .bind(userId, date, limit)
    .run();
  return res.meta.changes > 0;
}

/** 原子累加 token 用量（超过上限则拒绝返回 false，见 4.4） */
export async function addTokens(env: Env, userId: number, date: string, n: number, limit: number): Promise<boolean> {
  const res = await env.DB
    .prepare(
      `UPDATE user_quotas SET tokens = tokens + ? WHERE user_id = ? AND date = ? AND tokens + ? <= ?`,
    )
    .bind(n, userId, date, n, limit)
    .run();
  return res.meta.changes > 0;
}

/** 清理旧配额（Cron，仅保留近 N 天，见 4.4） */
export async function purgeOldQuotas(env: Env, keepDays: number): Promise<number> {
  const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const res = await env.DB.prepare(`DELETE FROM user_quotas WHERE date < ?`).bind(cutoff).run();
  return res.meta.changes;
}

/** ===== 审计日志（4.5） ===== */

export async function insertUsageLog(env: Env, log: Omit<DBUsageLog, "id" | "created_at">): Promise<void> {
  await env.DB
    .prepare(
      `INSERT INTO usage_logs (token_id, channel_id, user_id, caller_ip, model, tokens_in, tokens_out, http_status, retry_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      log.token_id,
      log.channel_id,
      log.user_id,
      log.caller_ip,
      log.model,
      log.tokens_in,
      log.tokens_out,
      log.http_status,
      log.retry_count,
    )
    .run();
}

/** CR：近 7 天被他人成功调用次数（排除自调用，见 G.1） */
export async function countCr(env: Env, userId: number, withinDays = 7): Promise<number> {
  const since = new Date(Date.now() - withinDays * 24 * 60 * 60 * 1000).toISOString();
  const row = await env.DB
    .prepare(
      `SELECT COUNT(*) AS n FROM usage_logs l
       JOIN channels c ON c.id = l.channel_id
       WHERE c.owner_user_id = ? AND l.user_id != ? AND l.http_status >= 200 AND l.http_status < 300
         AND l.created_at >= ?`,
    )
    .bind(userId, userId, since)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** ===== IP 注册日志（A.2，累计计数：每个 IP 任何时候最多 3 个账号） ===== */

export async function countIpRegsTotal(env: Env, ip: string): Promise<number> {
  const row = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM ip_register_log WHERE ip = ?`)
    .bind(ip)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function insertIpLog(env: Env, ip: string): Promise<void> {
  await env.DB.prepare(`INSERT INTO ip_register_log (ip) VALUES (?)`).bind(ip).run();
}

/** ===== 每日统计（E.3 贡献加成使用侧） ===== */

export async function countCallsToday(env: Env, userId: number): Promise<number> {
  const today = todayStr();
  const row = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM usage_logs l JOIN channels c ON c.id = l.channel_id
              WHERE l.user_id = ? AND c.owner_user_id != ? AND l.created_at >= ?`)
    .bind(userId, userId, `${today}T00:00:00`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}