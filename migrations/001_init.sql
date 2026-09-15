-- FreeAI Gateway 初始化迁移
-- Cloudflare D1 SQLite

-- 用户表（合一账号：使用者 + 贡献者）
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  reputation INTEGER DEFAULT 100,             -- 信誉分 0-100（分级限流 / 惩罚，见 A.5 / 附录 J）
  contribution_tier INTEGER DEFAULT 0,        -- 贡献激励档位 0-4（Cron 每日预计算，见 4.1 / 附录 G）
  cr_cache_date TEXT,                          -- contribution_tier 缓存日期（YYYY-MM-DD）
  registered_ip TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 用户网关 Token（单 Token 模型，见 4.2 / 附录 F）
CREATE TABLE user_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL,                   -- SHA-256(token) 用于校验（不存明文）
  token_prefix TEXT,                           -- 前 8 位，用于展示和辨识
  name TEXT DEFAULT 'Default',
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  last_used_at TEXT
);

-- Channel 表（贡献者的 Key + 健康元数据，无限量，见 4.3）
CREATE TABLE channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,                     -- 厂商名（OpenAI, Groq, Google 等）
  api_url TEXT NOT NULL,                       -- 厂商 API 端点（base URL）
  api_key_encrypted TEXT NOT NULL,            -- AES-256-GCM 加密
  key_hint TEXT,                               -- Key 前 4 位，用于辨识
  models TEXT NOT NULL,                        -- JSON 数组: ["gpt-4o"] 或 ["*"]
  weight REAL DEFAULT 1.0,                     -- 调度权重
  is_active INTEGER DEFAULT 1,                 -- 是否在资源池中
  is_valid INTEGER DEFAULT 1,                  -- 最近校验是否通过
  is_circuited INTEGER DEFAULT 0,              -- 是否熔断（1=熔断中）
  circuit_until TEXT,                          -- 熔断到期时间
  circuit_count INTEGER DEFAULT 0,             -- 熔断印记，>=5 自动下架
  success_rate REAL DEFAULT 1.0,               -- 近期成功率（0-1）
  total_requests INTEGER DEFAULT 0,            -- 近期总请求数
  failed_requests INTEGER DEFAULT 0,           -- 近期失败数
  last_error TEXT,                             -- 最近错误信息
  last_success_at TEXT,                        -- 最近成功调用时间（展示/统计用）
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 用户日配额表（见 4.4，原子扣减）
CREATE TABLE user_quotas (
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  calls INTEGER DEFAULT 0,
  tokens INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, date)
);

-- 调用审计日志（见 4.5）
CREATE TABLE usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id INTEGER NOT NULL,
  channel_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  caller_ip TEXT,
  model TEXT,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  http_status INTEGER DEFAULT 0,
  retry_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- IP 注册日志（见 A.2）
CREATE TABLE ip_register_log (
  ip TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 索引
CREATE INDEX idx_channels_active ON channels(is_active, is_valid, is_circuited);
CREATE INDEX idx_channels_models ON channels(models);
CREATE INDEX idx_user_tokens_hash ON user_tokens(token_hash);
CREATE INDEX idx_usage_logs_user ON usage_logs(user_id, created_at);
CREATE INDEX idx_usage_logs_channel ON usage_logs(channel_id, created_at);
CREATE INDEX idx_usage_logs_time ON usage_logs(created_at);
CREATE INDEX idx_ip_register ON ip_register_log(ip, created_at);

-- 单活跃 Token 部分唯一索引（见 4.2）：数据库层面保证每用户最多 1 个活跃 Token
CREATE UNIQUE INDEX idx_user_tokens_one_active ON user_tokens(user_id) WHERE is_active = 1;