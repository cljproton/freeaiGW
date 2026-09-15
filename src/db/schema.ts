/** D1 行类型定义（对应 migrations/001_init.sql） */

export interface DBUser {
  id: number;
  username: string;
  password_hash: string;
  reputation: number;
  contribution_tier: number;
  cr_cache_date: string | null;
  registered_ip: string | null;
  created_at: string;
}

export interface DBToken {
  id: number;
  user_id: number;
  token_hash: string;
  token_prefix: string | null;
  name: string;
  is_active: number;
  created_at: string;
  last_used_at: string | null;
}

export interface DBChannel {
  id: number;
  owner_user_id: number;
  provider: string;
  api_url: string;
  api_key_encrypted: string;
  key_hint: string | null;
  models: string; // JSON 数组字符串
  weight: number;
  is_active: number;
  is_valid: number;
  is_circuited: number;
  circuit_until: string | null;
  circuit_count: number;
  success_rate: number;
  total_requests: number;
  failed_requests: number;
  last_error: string | null;
  last_success_at: string | null;
  created_at: string;
  updated_at: string;
}

/** 解析 Channel.models 为数组 */
export function parseModels(ch: Pick<DBChannel, "models">): string[] {
  try {
    return JSON.parse(ch.models) as string[];
  } catch {
    return [];
  }
}

/** models 精确匹配（含 * 通配），见 5.3 A3 */
export function modelsMatch(model: string, models: string[]): boolean {
  return models.includes(model) || models.includes("*");
}

export interface DBQuota {
  user_id: number;
  date: string;
  calls: number;
  tokens: number;
}

export interface DBUsageLog {
  id: number;
  token_id: number;
  channel_id: number;
  user_id: number;
  caller_ip: string | null;
  model: string | null;
  tokens_in: number;
  tokens_out: number;
  http_status: number;
  retry_count: number;
  created_at: string;
}

export interface Bank {
  daily: number;
  daily_tokens: number;
  calls_left: number;
  tokens_left: number;
}