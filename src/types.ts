import type { Variables } from "./utils/crypto";
import type { Lang } from "./i18n";

/** Hono app 上下文类型：绑定（D1/KV/env）+ 每请求变量（user/auth/lang） */
export type AppEnv = { Bindings: Env; Variables: Variables & { lang: Lang } };

export interface Env {
  // D1
  DB: D1Database;
  // KV
  SESSIONS: KVNamespace;
  GATE: KVNamespace;
  // 基础
  ENCRYPTION_KEY: string;
  SESSION_TTL: string;
  CRON_TOKEN: string;
  // 会话 Cookie 加 Secure（1=仅 HTTPS 下发；本地 http 开发保持空/0）
  COOKIE_SECURE?: string;
  // 使用配额
  MAX_CALLS_PER_USER_DAY: string;
  MAX_TOKENS_PER_USER_DAY: string;
  NEW_USER_DAYS: string;
  NEW_USER_CALLS_QUOTA: string;
  NEW_USER_TOKENS_QUOTA: string;
  // 熔断与调度
  CIRCUIT_SUCCESS_RATE_THRESHOLD: string;
  CIRCUIT_MIN_REQUESTS: string;
  CIRCUIT_MAX_DURATION_MINUTES: string;
  CIRCUIT_DEACTIVATE_COUNT: string;
  MAX_PROXY_RETRIES: string;
  // 信誉分
  REPUTATION_DECAY_DAILY: string;
  REPUTATION_DECAY_GOOD: string;
  REPUTATION_PENALTY_4XX: string;
  REPUTATION_PENALTY_LIMIT_HIT: string;
  REPUTATION_PENALTY_BURST: string;
  REPUTATION_PENALTY_INVALID_KEY: string;
  REPUTATION_PENALTY_REPEAT_INVALID: string;
  REPUTATION_PENALTY_MALICIOUS: string;
  // 贡献激励
  CONTRIBUTION_TIER_1_CR: string;
  CONTRIBUTION_TIER_2_CR: string;
  CONTRIBUTION_TIER_3_CR: string;
  CONTRIBUTION_TIER_4_CR: string;
  CONTRIBUTION_TIER_1_BONUS: string;
  CONTRIBUTION_TIER_2_BONUS: string;
  CONTRIBUTION_TIER_3_BONUS: string;
  CONTRIBUTION_TIER_4_BONUS: string;
  CONTRIBUTION_NEWBIE_BONUS: string;
  CONTRIBUTION_ACTIVE_DAYS: string;
  // 预算保护
  BUDGET_PAUSE_THRESHOLD: string;
  BUDGET_SAMPLE_RATE: string;
  // Google AdSense（可选，默认关闭；仅公开页渲染）
  ADSENSE_ENABLED?: string;
  ADSENSE_CLIENT?: string;
  ADSENSE_SLOT?: string;
  // SEO：canonical/OG/sitemap 统一基址（可选，空则按请求 Host 推导）
  PUBLIC_BASE_URL?: string;
}