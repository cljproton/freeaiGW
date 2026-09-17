# FreeAI Gateway — 聚合 AI API 网关平台 方案文档

> 版本：v2.0
> 日期：2026-09-14
> 部署目标：Cloudflare Workers 免费计划（严格受限）
> 参考项目：[new-api](https://github.com/QuantumNous/new-api) (48k★)、[one-api](https://github.com/songquanpeng/one-api) (37k★)

---

## 一、项目概述

**FreeAI Gateway** 是一个匿名 AI API Key 聚合网关。

### 核心定位

- **贡献者**自愿提交自己的免费 API Key（作为 Channel/渠道）
- **使用者**注册后获得**独立的网关 Token**（`sk-xxx` 格式，仅用于认证），通过网关调用 AI 服务
- 网关内置调度引擎，自动从资源池中选择最优 Channel 进行请求转发
- 使用者的 Key **永不暴露**，所有请求由网关代为转发

### 架构示意

```
用户 ──→ 网关 Token (sk-xxx) ──→ 聚合网关 ──→ 选 Channel ──→ 厂商 API
  ↑                          ↑                ↑
  仅身份标识              配额+认证         Key永不暴露给用户
```

### 与参考项目的关系

| 参考项目 | 借鉴的设计 | 本项目的调整（适配 CF Workers 免费计划） |
|----------|-----------|----------------------------------------|
| **new-api** | Channel 概念、加权随机路由、用户 Token 管理、自动重试 | Channel 简化为轻量结构，去掉倍率/余额等计费功能 |
| **one-api** | 渠道健康监测、自动禁用、负载均衡、失败重试、用户配额 | 去掉多机部署/Redis/MySQL，用 D1+KV 替代 |
| **两者共有** | 统一网关格式（OpenAI 兼容）、Token 鉴权、失败重试链 | 仅保留核心功能，极致精简 |

---

## 二、技术栈

| 模块 | 技术 | 选择理由 |
|------|------|---------|
| 框架 | **Hono** | 轻量框架，原生支持 Cloudflare Workers，启动快 |
| 数据库 | **Cloudflare D1** (SQLite) | 免费 5GB/5M 读/10w 写，与 Workers 原生集成 |
| 缓存/会话 | **Cloudflare KV** | 全局低延迟，存会话 token 和用户额度缓存 |
| 前端 | **htmx + Tailwind CSS** | 轻量无框架，适合 Workers 场景 |
| 密码哈希 | **Web Crypto API PBKDF2** | Workers 内置，无需额外依赖 |
| 加解密 | **Web Crypto API AES-256-GCM** | Workers 内置，安全存储 Channel Key |
| 定时任务 | **Cron Triggers** | 免费计划支持，每天 1 次 |
| 部署 | **wrangler CLI** | 一键部署到 Cloudflare Workers |

### 免费计划约束与应对策略

| 资源 | 免费上限 | 项目预估 | 应对策略 |
|------|---------|---------|---------|
| **CPU 时间** | 10ms/请求 | 仅登录/注册重 | PBKDF2 低迭代，其余极轻量 |
| **Subrequests** | 50/请求 | 单次选1个+重试2次 ≈ 3次 | 充足 |
| **Cron Triggers** | 1 个/Worker | 1 个 | 所有任务合并到 `scheduled` handler |
| **KV 读取** | 100,000/天 | ~50k | 充足 |
| **KV 写入** | 1,000/天 | ~200（会话+缓存） | ⚠️ 限流计数走 D1，不走 KV |
| **KV 删除** | 1,000/天 | ~100（过期会话） | 充足 |
| **D1 读取** | 5,000,000 行/天 | ~100k | 充足 |
| **D1 写入** | 100,000 次/天 | ~5k-10k | ⚠️ 配额更新+日志，但远低于上限 |
| **D1 存储** | 5 GB | < 100 MB | 充足 |
| **Workers 请求** | 100,000/天 | < 50k | 充足 |

---

## 三、系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                  Cloudflare Workers (Hono)                    │
│                                                                   │
│  ┌──────────┐  ┌───────────┐  ┌───────────┐  ┌──────────┐ │
│  │ 认证模块  │  │ 网关API   │  │ 调度引擎   │  │ Cron     │ │
│  │ 注册/登录 │  │ /v1/...  │  │ 选Channel │  │ 校验/重置│ │
│  │ Token生成 │  │ 请求转发  │  │ 健康检查  │  │ 预算恢复 │ │
│  └──────────┘  └───────────┘  └───────────┘  └──────────┘ │
│       │             │              │                  │        │
│       ▼             ▼              ▼                  ▼        │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │     D1 SQLite: users / channels / user_tokens /          │ │
│  │             user_quotas / usage_logs                     │ │
│  │     KV: SESSIONS (登录会话, TTL 7天)                    │ │
│  │     KV: GATE (预算保护全局开关 + 采样计数器, 见附录 I)   │ │
│  └──────────────────────────────────────────────────────────┘ │
│  ▲ 入口中间件: budget gate 检查（动态页拦截, 静态页放行）     │
└─────────────────────────────────────────────────────────────┘
```

### 核心调用流程

```
1. 用户注册 → 获得网关 Token (sk-xxxx 格式，仅身份标识)
2. 用户请求:
   POST /v1/chat/completions
   Authorization: Bearer <网关Token>
   { "model": "gpt-4o", "messages": [...] }

3. 网关处理:
   a. 验证 Token → 查 KV → 获取 userId
   b. 配额检查（用户今日 calls < 上限 && tokens < 上限）
   c. 调度引擎选 Channel（健康 + 支持模型 + 未超限 + 未熔断 + 最高权重）
   d. 失败时：记录失败 → 熔断检查 → 选下一个 Channel → 重试（最多 2 次）
   e. 解密 Channel Key → 转发到厂商 API
   f. 解析响应 Token 用量 → 更新配额 → 记录审计日志
   g. 返回结果给用户

4. 全部 Channel 失败 → 返回 502/503 + 提示稍后重试
```

---

## 四、数据库设计（D1 SQLite）

### 4.1 用户表

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  reputation INTEGER DEFAULT 100,             -- 信誉分（0-100，分级限流依据，见附录 A.5）
  contribution_tier INTEGER DEFAULT 0,        -- 贡献激励档位 0-4（Cron 每日预计算缓存，见附录 G）
  cr_cache_date TEXT,                          -- contribution_tier 缓存日期（YYYY-MM-DD）
  registered_ip TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### 4.2 用户 Token 表（每个用户一个网关 Token）

> **单 Token 模型**：每个用户只有 **1 个**活跃网关 Token，数据库层面强制约束。

```sql
CREATE TABLE user_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL,           -- SHA-256(token) 用于校验（不存明文）
  token_prefix TEXT,                   -- 前8位，用于展示和辨识
  name TEXT DEFAULT 'Default',
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  last_used_at TEXT
);

-- 部分唯一索引: 数据库层面保证同一用户最多 1 个活跃 Token（并发/异常下也成立）
CREATE UNIQUE INDEX idx_user_tokens_one_active
  ON user_tokens(user_id) WHERE is_active = 1;
```

**设计说明**
- 用户 Token **仅用于认证**（验证身份+配额），不绑定任何 Channel，不含任何 API Key 信息
- 每用户仅 1 个活跃 Token；创建/重置 = 撤销旧的 + 插入新的（见附录 F）
- Token 明文**无法找回**（只存 hash，含管理员），但可**自助重置**（旧 Token 立即失效）
- Token 明文仅返回给用户一次，之后只存 hash + 前缀

### 4.3 Channel 表（贡献者的 Key + 健康元数据）

```sql
CREATE TABLE channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,                  -- 厂商名（OpenAI, Groq, Google 等）
  api_url TEXT NOT NULL,                    -- 厂商 API 端点
  api_key_encrypted TEXT NOT NULL,         -- AES-256-GCM 加密
  key_hint TEXT,                             -- Key 前4位，用于辨识
  models TEXT NOT NULL,                       -- JSON 数组: ["gpt-4o"] 或 ["*"]
  weight REAL DEFAULT 1.0,                    -- 调度权重
  is_active INTEGER DEFAULT 1,               -- 是否在资源池中
  is_valid INTEGER DEFAULT 1,                -- 最近校验是否通过
  is_circuited INTEGER DEFAULT 0,            -- 是否熔断（1=熔断中）
  circuit_until TEXT,                         -- 熔断到期时间
  circuit_count INTEGER DEFAULT 0,           -- 熔断印记，>=5 自动下架
  success_rate REAL DEFAULT 1.0,             -- 近期成功率（0-1）
  total_requests INTEGER DEFAULT 0,          -- 近期总请求数
  failed_requests INTEGER DEFAULT 0,         -- 近期失败数
  last_error TEXT,                            -- 最近错误信息
  last_success_at TEXT,                       -- 最近成功调用时间（展示/统计用，不再驱动激励）
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

**设计说明**
- **贡献者的 API 无限使用，不设任何用量限制**（无 `daily_limit` / `total_limit`）
- 不保存 `used_today` / `used_total` 统计（无需向贡献者展示统计，需要时从 `usage_logs` 聚合）
- 健康保障只靠熔断 + 下架（`circuit_count` >= 5 自动 `is_active=0`）

### 4.4 用户日配额表

```sql
CREATE TABLE user_quotas (
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  calls INTEGER DEFAULT 0,
  tokens INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, date)
);
```

**原子扣减（防并发超发）**：配额判定使用条件更新，`changes=0` 即超限拒绝，杜绝并发下读-改-写竞态导致超发。

```typescript
// 调用前扣减调用次数（原子）
const res = await env.DB.prepare(`
  UPDATE user_quotas SET calls = calls + 1
  WHERE user_id = ? AND date = ? AND calls < ?
`).bind(userId, today, dailyCallsLimit).run();
if (res.meta.changes === 0) return { exceeded: true };  // 已超额
```

### 4.5 调用审计日志

```sql
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
```

### 4.6 索引设计

```sql
CREATE INDEX idx_channels_active ON channels(is_active, is_valid, is_circuited);
CREATE INDEX idx_channels_models ON channels(models);      -- 仅作粗筛/统计，模型匹配以内存精确匹配为准（见 5.3 A3）
CREATE INDEX idx_user_tokens_hash ON user_tokens(token_hash);
CREATE INDEX idx_usage_logs_user ON usage_logs(user_id, created_at);
CREATE INDEX idx_usage_logs_channel ON usage_logs(channel_id, created_at);
CREATE INDEX idx_usage_logs_time ON usage_logs(created_at);  -- 支撑 CR 近 7 天聚合（附录 G）

-- 单活跃 Token 部分唯一索引见 4.2
CREATE UNIQUE INDEX idx_user_tokens_one_active ON user_tokens(user_id) WHERE is_active = 1;
```


---

## 五、核心模块设计（续）

### 5.1 认证与会话

- **注册/登录**：纯用户名+密码（匿名），PBKDF2 低迭代（~30k-60k，控制在 10ms CPU 内）
- **会话**：登录后生成随机 session token，存 KV（TTL 7 天），Cookie 携带
- **自研反滥用（无第三方）**：注册/登录页前端 PoW（SHA-256 前缀零 ≥ 4）+ 蜜罐 + 提交时序（见附录 A）
- **IP 注册限流**：同一 IP 24h 最多 3 个账号（`ip_register_log`，见附录 A）
- **网关 Token 认证**：调用网关接口用 `Authorization: Bearer sk-xxx`，校验 SHA-256 hash（见 4.2 / 附录 F）

### 5.2 Channel 提交与管理流程（贡献者）

#### 提交流程

```
提交(登录态) → 填写表单 → 勾选授权声明
  → 即时轻量校验 GET {api_url}/v1/models
  → 通过 → 加密入库 → is_active=1 立即入池
  → 失败 → is_active=0 不入池 → 提示 + [重新校验]
```

**提交表单**

| 字段 | 必填 | 说明 |
|------|------|------|
| 厂商名 `provider` | ✅ | 如 Groq / Google AI Studio / OpenRouter |
| API 端点 `api_url` | ✅ | 厂商 base URL |
| API Key 明文 | ✅ | 仅本次传输，入库前 AES-256-GCM 加密 |
| 支持模型 `models` | ✅ | 见"模型选择" |
| 授权声明 | ✅ | 强制勾选，不可跳过 |

**说明**：无 `daily_limit` 字段（Channel 无限使用）；无人工审核，提交即入池。

#### 即时轻量校验（必须通过才入池）

```typescript
// POST /api/channels/fetch-models
async function fetchModels(apiUrl: string, apiKey: string, env: Env): Promise<string[]> {
  const resp = await fetch(`${apiUrl}/v1/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: timeout(10_000),
    cf: { cacheTtl: 3600 },        // 边沿缓存同 URL，减少重复调用
  });
  if (!resp.ok) throw new ApiError(resp.status, await resp.text()); // 401→"Key 无效"
  const body = await resp.json();
  return body.data?.map((m: any) => m.id) ?? [];
}
```

- 校验**必须通过**才入池：`is_valid=1` 且 `is_active=1`
- 失败：`is_active=0`，提示具体错误（401→Key 无效；404→厂商不支持 /models，转为手动输入模型），提供 **[重新校验]** 按钮
- 失败后允许**修复 Key 并重试**，重新校验通过 → **自动入池**（无需重新提交表单）
- 安全：需登录会话 + 限流（每用户每分钟 ≤ 3 次拉取，防刷厂商接口）
- 若临时厂商故障导致误报，贡献者可稍后点"重新校验"恢复

#### 模型选择（拉取成功搜索筛选 / 失败手动输入）

| 场景 | 交互 |
|------|------|
| 拉取成功 | 展示真实模型列表 → 搜索 + 分类筛选(owned_by) + 勾选，或一键"支持所有 *" |
| 拉取失败 | **手动输入**模型名（非预设库），逗号/换行分隔，支持 `*` |

- 搜索：前端模糊匹配模型 id（.pick-chip 过滤）；按 `owned_by` 分组筛选**暂缓**（探针至今只取 `data[].id`，需先扩展响应字段）
- 全选/清空/“支持所有 `*`”已实现；勾选上限 50 与校验器一致，超出即时拦截提示（复用 `v_models_too_many`）
- 已选实时预览（数量），命中项自动同步到下方「模型」输入框；全选受 50 上限约束
- 手动输入：trim、去重、非空校验；提示"模型名有误将导致调度失败"（由熔断兜底）
- 模型名白名单（`validateModelsList`）：`[A-Za-z0-9 _\-.:/@*+]`（≤80 字符）——`/` 支持 `作者/模型` 路由格式（OpenRouter 等聚合 API）、`*` 支持"支持所有模型"通配、`@`/`+` 为 compatible 变体预留；超限/非法字符 → `v_models_bad`（"模型名称格式不正确"）

#### 管理操作（我的 Channel）

| 操作 | 效果 |
|------|------|
| 查看 | provider、models、key_hint、状态（绿=健康/黄=熔断/红=下线） |
| 撤回 | `is_active=0`，立即移出资源池 |
| 重新校验 | 重新发起 GET /models，通过自动入池（修复后重试） |
| 重新激活 | 重置 `circuit_count=0` + `is_active=1` |
| 永久删除 | **弹窗确认**；删除后立即退出贡献激励活跃统计（回收加成，实时重算） |

### 5.3 调度引擎（核心）

#### 选 Channel 算法（参考 new-api 加权随机）

```typescript
async function pickChannel(model: string, excludeIds: number[] = [], env: Env): Promise<Channel | null> {
  // 1. LIKE 粗筛（减少候选集）——远端避免子串误匹配，需二次精确过滤
  let where = `is_active = 1 AND is_valid = 1 AND is_circuited = 0`;
  let params: string[] = [];
  
  if (excludeIds.length > 0) {
    where += ` AND id NOT IN (${excludeIds.join(',')})`;
  }
  
  const { results } = await env.DB.prepare(`SELECT * FROM channels WHERE ${where}`).bind(...params).all();
  if (!results.length) return null;
  
  // 2. 精确匹配：JSON 解析 models 后精确比较 + 通配 "*"（杜绝 LIKE %x% 子串误匹配）
  function modelsMatch(m: string, models: string[]): boolean {
    return models.includes(m) || models.includes("*");
  }
  const matched = results.filter(c => {
    try {
      return Array.isArray(c.models) ? modelsMatch(model, c.models) : modelsMatch(model, JSON.parse(c.models));
    } catch {
      return false; // 非法 models 忽略
    }
  });
  if (!matched.length) return null;
  
  // 3. 计算动态权重: weight * success_rate（Channel 无限量，无 daily_limit 因子）
  const candidates = matched.map(c => ({
    ...c,
    dynamicWeight: c.weight * c.success_rate
  }));
  
  // 4. 加权随机
  const total = candidates.reduce((sum, c) => sum + c.dynamicWeight, 0);
  let rand = Math.random() * total;
  for (const c of candidates) {
    rand -= c.dynamicWeight;
    if (rand <= 0) return c;
  }
  return candidates[candidates.length - 1];
}
```

#### 故障转移链（失败重试）

```typescript
async function proxyWithFailover(request: Request, env: Env, userId: number, model: string) {
  const excludeIds: number[] = [];
  const maxRetries = 2; // 最多重试 2 次（共 3 次尝试）
  
  // 转发前先把请求体读入内存（≤10MB），重试用同一 buffer（stream 模式下 body 只能读一次）
  const bodyBuffer = await request.arrayBuffer();
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const channel = await pickChannel(model, excludeIds, env);
    if (!channel) break;
    
    // 用 buffer + headers 重建请求（原 request 的 body 已被消费）
    const retryRequest = new Request(request.url, { method: request.method, body: bodyBuffer, headers: request.headers });
    const result = await tryProxy(channel, retryRequest, env);
    if (result.ok) {
      // 成功：记录成功，更新成功率
      await recordSuccess(channel.id, env, attempt);
      return result.response;
    }
    
    // 失败：记录失败，加入排除列表
    excludeIds.push(channel.id);
    await recordFailure(channel.id, env, result.error);
    
    // 检查是否需要熔断
    await checkAndCircuitBreaker(channel.id, env);
  }
  
  // 全部失败
  return new Response(JSON.stringify({ error: "All channels failed, try later" }), { 
    status: 502, 
    headers: { "Content-Type": "application/json" } 
  });
}
```

### 5.4 Channel 健康与熔断机制

#### 成功/失败记录（实时更新成功率）

```typescript
async function recordSuccess(channelId: number, env: Env, retryCount: number) {
  await env.DB.prepare(`
    UPDATE channels SET 
      total_requests = total_requests + 1,
      success_rate = (success_rate * total_requests + 1) / (total_requests + 1),
      last_success_at = ?,
      last_error = NULL
    WHERE id = ?
  `).bind(new Date().toISOString(), channelId).run();
  
  // 用户配额 + 日志
  await updateUserQuotaAndLog(channelId, env, /* success */ true, retryCount);
}

async function recordFailure(channelId: number, env: Env, error: string) {
  await env.DB.prepare(`
    UPDATE channels SET 
      total_requests = total_requests + 1,
      failed_requests = failed_requests + 1,
      success_rate = (success_rate * (total_requests - 1)) / total_requests,
      last_error = ?
    WHERE id = ?
  `).bind(error, channelId).run();
  
  // 用户配额 + 日志
  await updateUserQuotaAndLog(channelId, env, /* success */ false, 0);
}
```

#### 自动熔断策略（参考 one-api）

| 条件 | 动作 |
|------|------|
| `success_rate < 0.5` 且 `total_requests >= 10` | 触发熔断 |
| 熔断时长 | `min(30 分钟, failed_requests * 1 分钟)` |
| 恢复条件 | 熔断到期自动恢复 `is_circuited = 0` |
| 手动恢复 | 贡献者可在管理页手动恢复 |
| EMA 防迟钝 | Cron 每日对 `total_requests > 100` 的 Channel 将 total/failed **各折半**，弱化旧数据权重 |

```typescript
async function checkAndCircuitBreaker(channelId: number, env: Env) {
  const ch = await env.DB.prepare(`SELECT * FROM channels WHERE id = ?`).bind(channelId).first();
  if (!ch || ch.is_circuited) return;
  
  if (ch.success_rate < 0.5 && ch.total_requests >= 10) {
    const minutes = Math.min(30, ch.failed_requests);
    const until = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    await env.DB.prepare(`
      UPDATE channels SET is_circuited = 1, circuit_until = ? WHERE id = ?
    `).bind(until, channelId).run();
  }
}

// Cron 每次运行时检查熔断恢复
async function recoverCircuited(env: Env) {
  const now = new Date().toISOString();
  await env.DB.prepare(`
    UPDATE channels SET is_circuited = 0, circuit_until = NULL 
    WHERE is_circuited = 1 AND circuit_until IS NOT NULL AND circuit_until < ?
  `).bind(now).run();
}
```

### 5.5 配额分层（使用者限额 vs Channel 无限量）

| 角色 | 限额 |
|------|------|
| **使用者**（调用方） | 分级动态限额生效（信誉 100/30万次 → 3/1万），新用户 7 天减半，贡献激励加成 |
| **贡献者提供的 API**（Channel） | **无限量**，不设任何使用上限，仅受健康约束（熔断 + 下架兜底） |

> Channel 只做**健康控制**，不做**用量控制**。

---

## 六、Cron 任务（每天 UTC 00:00，合并为单一 handler）

```typescript
export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    switch (controller.cron) {
      case "0 0 * * *":
        ctx.waitUntil(runDailyTasks(env));
        break;
    }
  }
};

async function runDailyTasks(env: Env) {
  // 1. Channel 健康检测（分批，每批 ≤ 50 个 subrequest）
  await validateChannelsBatch(env);
  
  // 2. 清理过期用量记录（保留近 7 天）
  await env.DB.prepare(`DELETE FROM user_quotas WHERE date < ?`).bind(todayMinusDays(7)).run();
  
  // 3. 熔断恢复 + EMA 衰减（total_requests > 100 时 total/failed 折半，弱化旧数据权重）
  await recoverCircuited(env);
  await env.DB.prepare(`UPDATE channels SET total_requests = total_requests / 2, failed_requests = failed_requests / 2 WHERE total_requests > 100`).run();
  
  // 4. 贡献激励档位预计算（缓存 contribution_tier，避免实时聚合读放大，见附录 G）
  await refreshContributionTiers(env);

  // 5. 预算保护恢复（paused → 新一天 → active）+ 清理过期计数器（见附录 I）
  await budgetDailyRecovery(env);

  // 6. 记录校验日志
  await logScrapeResult(env, { checked, valid, invalid });
}

// 每日预计算 CR 档位（users.contribution_tier 缓存）
async function refreshContributionTiers(env: Env) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const today = todayStr();
  // 对每个贡献者聚合近 7 天成功调用（排除自调用），写入档位缓存
  const { results } = await env.DB.prepare(`
    SELECT c.owner_user_id as uid, COUNT(*) as cr
    FROM usage_logs l JOIN channels c ON c.id = l.channel_id
    WHERE l.user_id != c.owner_user_id
      AND l.http_status BETWEEN 200 AND 299
      AND l.created_at > ?
    GROUP BY c.owner_user_id
  `).bind(weekAgo).all();
  for (const r of results) {
    const tier = tierForCr(r.cr as number); // 0/1/2/3/4 对应 无/10/30/60/100
    await env.DB.prepare(`UPDATE users SET contribution_tier = ?, cr_cache_date = ? WHERE id = ?`)
      .bind(tier, today, r.uid).run();
  }
}

// 预算恢复：新一天解除暂停 + 清理昨日计数器（见附录 I）
async function budgetDailyRecovery(env: Env) {
  await env.GATE.delete("counters:" + yesterdayStr()).catch(() => {});
  const status = await env.GATE.get("gate:status", "json");
  if (status?.state === "paused") {
    await env.GATE.put("gate:status", JSON.stringify({ state: "active", at: new Date().toISOString() }));
  }
}

async function validateChannelsBatch(env: Env) {
  const BATCH = 50;
  let offset = 0;
  
  while (true) {
    const { results } = await env.DB.prepare(`
      SELECT id, api_url, api_key_encrypted FROM channels 
      WHERE is_active = 1 AND is_valid = 1 LIMIT ? OFFSET ?
    `).bind(BATCH, offset).all();
    
    if (!results.length) break;
    
    // 并发校验（利用 waitUntil 不阻塞主流程）
    for (const ch of results) {
      ctx.waitUntil(validateSingleChannel(ch, env));
    }
    
    offset += BATCH;
  }
}
```

---

## 七、前端页面设计（htmx + Tailwind）

| 页面 | 路径 | 功能 |
|------|------|------|
| 首页 | `/` | Hero + 接入示例（渠道数与可用模型移入登录后的使用面板） |
| 注册/登录 | `/auth` | 合并一页，Tab 切换（用户名+密码 + 自研 PoW 无感校验） |
| 使用面板 | `/dashboard` | 单 Token 卡片 + 用量 + 我的贡献 + 资源池统计（渠道数/模型） |
| 提交 Channel | `/submit` | 即时校验 + 模型拉取/手动输入 + 授权声明 |
| 使用帮助 | `/docs` | curl + Python/JS SDK 示例 |
| 协议 | `/terms` | 用户协议 + 免责声明 |

### 关键交互
- 所有交互用 htmx 局部刷新（无页面跳转）
- **单 Token 卡片**：唯一 Token（sk-xxx 前缀显示）+ [复制完整Token] [重置]；明文仅展示一次、无法找回
- **拉取模型**：不做截断（原 30 条上限已移除），可滚动容器 `.mp-list` + 搜索框 + 全选/清空/“支持所有 *”工具栏 + 已选计数（上限 50）；勾选项自动同步到下方模型输入框；htmx 换入响应由页面级事件委托脚本驱动（Worker/Node 双运行时一致）
- 删除 Channel：弹窗确认，明确提示"删除后贡献加成立即失效"
- 注册/登录页明确提示："密码与网关 Token 一样仅存哈希、**无法找回**，请妥善保存"（匿名无邮箱，无找回机制）

---

## 八、项目结构

```
freeaiapikey/
├── wrangler.toml                    # Worker 配置（D1 + KV + Cron + 环境变量）
├── package.json
├── tsconfig.json
├── .dev.vars                        # 本地环境变量
├── docs/
│   └── PLAN.md                      # 本方案文档
├── migrations/
│   └── 001_init.sql                 # D1 建表语句（含索引）
└── src/
    ├── index.ts                     # Hono 入口 + 路由挂载 + scheduled handler
    ├── config.ts                    # 常量配置（限额、熔断阈值等）
    ├── middleware/
    │   ├── auth.ts                  # Token 验证中间件
    │   ├── rate-limit.ts            # 登录失败限流
    │   ├── quota.ts                 # 用户配额检查（条件更新原子扣减）
    │   └── budget.ts                # 免费计划预算保护（KV GATE 采样估算 + 暂停）
    ├── routes/
    │   ├── auth.ts                  # 注册 / 登录 / 登出（+ PoW/蜜罐/时序 / IP 限流）
    │   ├── tokens.ts                # 网关 Token（唯一 Token 生成/重置）
    │   ├── channels.ts              # Channel 提交/查看/重校验/删除 + fetch-models
    │   ├── proxy.ts                 # POST /v1/chat/completions 转发+故障转移
    │   ├── quota.ts                 # 用量查询
    │   └── pages.ts                 # htmx 页面路由
    ├── scheduler/
    │   └── pickChannel.ts           # 调度引擎（选 Channel + 熔断检查）
    ├── db/
    │   ├── schema.ts                # D1 类型定义
    │   └── index.ts                 # D1 查询封装
    ├── validators/
    │   └── index.ts                 # Cron Channel 校验
    ├── utils/
    │   ├── crypto.ts                # PBKDF2 + AES-256-GCM + SHA-256
    │   └── audit.ts                 # 审计日志记录
    └── views/                       # htmx 前端页面模板
        ├── layout.tsx               # 公共布局
        ├── index.tsx                # 首页（Hero + 接入示例；资源池统计面板在 dashboard）
        ├── auth.tsx                 # 注册/登录（Tab 合并）
        ├── dashboard.tsx            # 使用面板（单 Token + 用量 + 我的贡献 + 资源池统计）
        ├── submit.tsx               # 提交 Channel 页
        ├── docs.tsx                 # 使用帮助
        └── terms.tsx                # 协议页
```

---

## 九、环境变量（wrangler.toml）

```toml
name = "freeai-gateway"
main = "src/index.ts"
compatibility_date = "2026-09-14"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "freeai-gateway"
database_id = "<your-d1-id>"

[[kv_namespaces]]
binding = "SESSIONS"
id = "<your-kv-id>"

[[kv_namespaces]]
binding = "GATE"
id = "<your-gate-kv-id>"

[triggers]
crons = ["0 0 * * *"]

[vars]
ENCRYPTION_KEY = "<32字符随机密钥>"
MAX_CALLS_PER_USER_DAY = "100"
MAX_TOKENS_PER_USER_DAY = "300000"
SESSION_TTL = "604800"
# 熔断参数
CIRCUIT_SUCCESS_RATE_THRESHOLD = "0.5"
CIRCUIT_MIN_REQUESTS = "10"
CIRCUIT_MAX_DURATION_MINUTES = "30"
# 重试参数
MAX_PROXY_RETRIES = "2"
# 预算保护（见附录 I）
BUDGET_PAUSE_THRESHOLD = "0.9"
BUDGET_SAMPLE_RATE = "1/200"
```

---

## 十、开发步骤

| 阶段 | 任务 | 说明 |
|------|------|------|
| **Phase 1** | 项目初始化 | 创建 Worker 项目 + 配置 wrangler.toml + 建表迁移 |
| **Phase 2** | 数据库层 | db/schema.ts + db/index.ts + 应用迁移 |
| **Phase 3** | 认证模块 | 注册/登录/登出 + PBKDF2 + Token 生成+校验 + KV 会话 |
| **Phase 4** | Token/Channel 管理 | 用户 Token 增删查 + Channel 提交/列表/撤回 + 授权声明 |
| **Phase 5** | 调度引擎 | pickChannel（加权随机）+ 熔断检查 + 故障转移重试链 |
| **Phase 6** | 请求转发 | `/v1/chat/completions` 转发 + 解密+转发+Token解析+配额更新 |
| **Phase 7** | 前端页面 | htmx 页面 + Tailwind 样式 + 实时健康状态展示 |
| **Phase 8** | Cron 任务 | 合并 handler + Channel 校验分批 + 重置用量 + 熔断恢复 |
| **Phase 9** | 合规 + 部署 | 用户协议/免责声明/授权声明 + 本地测试 + `wrangler deploy` |

---

## 十一、合规与安全

| 机制 | 实现 |
|------|------|
| **自愿提交** | 贡献者主动提交，非爬取 |
| **授权声明** | 提交 Channel 前强制勾选（不可跳过） |
| **可撤回** | 贡献者一键下架；公开删除申请入口 |
| **Key 隐藏** | 使用者仅见 `sk-xxx` 网关 Token，Channel Key 永不暴露 |
| **加密存储** | Channel Key AES-256-GCM 加密存 D1 |
| **审计日志** | 全量 usage_logs 记录（谁·何时·哪个Channel·成功/失败） |
| **免责声明** | 用户协议 + 隐私政策 + 免责声明页面 |

---

## 十二、风险提示

1. **登录/注册偶尔超时**：免费计划 10ms CPU 限制，PBKDF2 可能超时
2. **Key 共享的法律风险**：即使自愿提交，共享 Key 可能违反厂商 ToS
3. **资源池耗尽**：Channel 额度用完需等贡献者补充
4. **滥用风险**：尽管有配额+熔断+审计，仍需关注异常流量
5. **D1 写入并发**：高并发下配额更新可能有竞争（用原子 UPDATE 缓解）
6. **单点故障**：单 Worker，CF 边缘网络天然高可用，但代码部署错误会全站挂

---

*文档结束*

---

## 附录：反滥用策略（PoW + 蜜罐 + 提交时序 + IP 限流 + 新用户配额减半）

### A.1 自研 Proof-of-Work（无第三方依赖）

不依赖任何外部服务（如 Turnstile），全自研前端工作量证明 + 蜜罐 + 时序三重校验。
注册/登录表单提交在**前端无感完成**约 6.5 万次 SHA-256 计算（现代设备不足 0.5s），
页面加载零阻塞，符合免费计划成本。

**服务端下发挑战**（GET `/auth` 与每次错误回显时，`powIssue`）：
- 生成随机 `pow_id`（16 hex）与随机盐 `pow_salt`（16 hex）
- 以 KV（`GATE` namespace，键前缀 `pow:`）保存挑战，TTL 10 分钟，`difficulty = 4`

**前端计算与提交**（页面内联 WebCrypto 脚本，`views/auth.tsx`）：
- 表单含隐藏字段 `pow_id` / `pow_salt` / `pow_d` / `pow_n` / `got_ts`，及隐藏蜜罐 `website`
- 提交时循环递增 nonce，计算 `SHA-256(salt:nonce_hex)`，直到结果十六进制串前缀零个数 ≥ `pow_d`（4）
- 命中后写入 `pow_n` 再原生提交表单；计算期间按钮禁用并提示「安全校验中…」

**服务端验证**（`utils/pow.ts` `powVerify`，校验链见 5.1）：
1. `pow_id` / `pow_salt` / `pow_n` 格式校验
2. KV 读取挑战并**立即删除（一次性，防重放）**
3. 校验 `pow_d` 一致且 `SHA-256(salt:nonce_hex)` 前缀零 ≥ 4

**蜜罐与时序**（`botcheckError`）：
- `website` 字段被填充（肉眼不可见，aria-hidden / 移出可视区）→ 直接判定可疑提交
- `got_ts` 距提交不足 2.5s（人类不可能完成 PoW）或超过 10 分钟 → 判定校验失败

### A.2 IP 注册限流（D1）

```sql
CREATE TABLE ip_register_log (
  ip TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_ip_register ON ip_register_log(ip, created_at);
```

```typescript
async function checkIpRegisterLimit(ip: string, env: Env): Promise<boolean> {
  const dayAgo = new Date(Date.now() - 24*3600*1000).toISOString();
  const { results } = await env.DB.prepare(`
    SELECT COUNT(*) as cnt FROM ip_register_log WHERE ip = ? AND created_at > ?
  `).bind(ip, dayAgo).first();
  return (results.cnt ?? 0) < 20; // 24h 内最多 20 个账号（阈值经 K.4 由 3 上调）
}

async function logIpRegister(ip: string, env: Env) {
  await env.DB.prepare(`INSERT INTO ip_register_log (ip) VALUES (?)`).bind(ip).run();
}
```

### A.3 新用户配额减半（正常用户放宽）

- 正常用户：每日 100 次调用 + 300k token
- 新用户（注册 < 7 天）：每日 50 次 + 150k token

```typescript
// 配额中间件
async function checkQuota(userId: number, env: Env) {
  const user = await getUser(userId, env);
  const regTime = new Date(user.created_at).getTime();
  const isNewUser = Date.now() - regTime < 7*24*3600*1000;
  
  const quota = await getUserQuota(env, userId, today());
  const maxCalls = isNewUser ? 50 : 100;
  const maxTokens = isNewUser ? 150000 : 300000;
  
  if (quota.calls >= maxCalls || quota.tokens >= maxTokens) {
    throw new Error("Quota exceeded");
  }
}
```

### A.4 环境变量新增

```toml
[vars]
MAX_REGISTER_PER_IP_PER_DAY = "20"
NEW_USER_DAYS = "7"
NEW_USER_CALLS_QUOTA = "50"
NEW_USER_TOKENS_QUOTA = "150000"
MAX_CALLS_PER_USER_DAY = "100"          # 正常用户放宽
MAX_TOKENS_PER_USER_DAY = "300000"
```

### A.5 分级动态限流（替代封禁，对用户友好）

> **设计原则**：**永不封禁**。所有账号永远可用，只是配额随信誉分动态变化。
> 正常用户配额**放宽**（100 次/300k），异常用户**自动降额**，行为恢复后**自动回升**。
> 宽松化：**取消"冷静期"与"贡献加成冻结"**；信誉 0 也不冻结当日额度。
> **兜底：最低档 3 次/天永不归零**（任何信誉下都可用）。
> 无人工干预。详细惩罚机制见附录 J。

#### 分级表

```typescript
function getQuotaLimit(reputation: number) {
  if (reputation >= 80) return { calls: 100, tokens: 300000 }; // 正常（放宽）
  if (reputation >= 60) return { calls: 40,  tokens: 150000 }; // 轻度降权
  if (reputation >= 40) return { calls: 25,  tokens: 100000 }; // 中度降权
  if (reputation >= 20) return { calls: 10,  tokens: 40000 };  // 重度降权
  return { calls: 3, tokens: 10000 };                          // 极限（永不归零，仍可用）
}
```

#### 信誉分动态变化（全自动，宽松）

| 行为 | 信誉分变化 |
|------|-----------|
| 正常调用成功 | 每日 **+2**（上限 100） |
| 连续 3 天无任何扣分 | 加速 **+5/天**（直至 80 回正） |
| 连续 4xx/5xx（>5 次/小时） | 每次 **-3** |
| 命中全局限流仍持续调用 | 每次 **-10** |
| 单日调用异常爆发（≥3 倍上限） | 每次 **-8** |
| 无效 Key 提交（即时校验失败） | 每次 **-5** |
| 反复无效提交（≥3 次/天） | **-15** |
| api_url 疑似恶意域名 | **-30** + 该 Channel 下架 |
| 信誉回升 | 配额自动恢复（即时生效） |

#### 用户体验（友好提示）

> "检测到少量异常请求，额度已临时调整。恢复正常使用几天后将自动恢复。"

---

## 附录 B：自动化设计（尽量少人工干预）

### B.1 Channel 生命周期全自动

```
提交 → 即时轻量校验 GET /v1/models
  → 通过 → 加密入库 → 立即进池
  → 失败 → 不入池(is_active=0) → 修复后重新校验 → 通过自动入池
  → 使用中失败自动熔断 → 到期自动恢复 → 熔断印记累积 ≥ 5 次 → 自动下架(is_active=0)
  → 贡献者可自助重新激活（激活时重置熔断印记）
```

**任何环节无需人工审核**，安全由熔断 + 下架兜底。

### B.2 Channel 自动下架机制

| 机制 | 说明 |
|------|------|
| **熔断印记** `circuit_count` | 每次触发熔断 +1 |
| **下架条件** | `circuit_count >= 5` 时自动 `is_active = 0` |
| **下架原因** | 反复"熔断→恢复→再熔断"说明 Key 已持续失效，留在池中会拖慢所有使用者 |
| **恢复** | 贡献者自助重新激活，激活时重置 `circuit_count = 0` |

```sql
-- channels 表扩展
circuit_count INTEGER DEFAULT 0,  -- 熔断印记，触发熔断 +1，>=5 自动下架
```

### B.3 自动风控（无人工）

- 信誉分自动升降（见 A.5）
- 降权/恢复全自动，无冷却期
- 30 天未登录 + 0 调用 → Cron 自动标记僵尸账号
- 无 Webhook / 无邮件通知（产品设计决定，不引入通知复杂度）

### B.4 数据维护全自动（Cron 每日）

1. Channel 健康校验（分批 ≤50 subrequest）
2. 清理过期用量记录（保留近 7 天）
3. 熔断到期自动恢复 + EMA 衰减（total_requests > 100 折半）
4. Channel 熔断印记 `>= 5` 自动下架
5. 贡献激励档位预计算（users.contribution_tier 缓存，见附录 G）
6. 预算保护恢复 + 过期计数器清理（见附录 I）
7. 清理 >30 天 usage_logs 与僵尸账号

### B.5 用户全自助

注册、登录、Token 生成/撤销、用量查看、Channel 提交/撤回/重新激活 —— 全部自助，无等待、无审核。

---

## 附录 C：页面设计原则（简洁 + 人性友好）

### C.1 首页（公开，一屏讲清楚）

```
┌─────────────────────────────────────┐
│  Logo   FreeAI Gateway          [登录]│
│                                      │
│  🚀 一个 Key，接入所有免费大模型      │
│  平台聚合社区贡献的免费 API，自动调度   │
│                                      │
│  [立即免费使用]  [查看接入文档]      │
│                                      │
│  ── 一行接入 ──                       │
│  base_url = https://gateway.xx/v1    │
│  api_key  = sk-your-own-token        │
│                                      │
│  （渠道数量与可用模型统计仅在登录后    │
│    的「使用面板」可见，不公开聚合信息）│
└─────────────────────────────────────┘
```

### C.2 人性友好细节

| 场景 | 友好做法 |
|------|---------|
| 首次使用 | 注册后引导：生成 Token → 复制示例 → 测试调用 |
| 配额用尽 | "今日额度已用完，明天 00:00 自动恢复"，不甩 429 |
| 无可用渠道 | "当前暂无渠道支持该模型，可提交 Key 或稍后重试" |
| 降权提示 | "检测到异常请求，额度已降低，正常使用会自动恢复" |
| 提交 Channel | 提示"正在自动校验，通过后即可使用" |
| Token 生成 | 只展示一次完整值，提示"请立即保存" |
| 密码保护 | 注册/登录页提示"密码与网关 Token 一样仅存哈希、无法找回，请妥善保存" |
| 健康状态 | 绿色=正常、黄色=熔断中、红色=已下线，登录后使用面板直观可见 |

### C.3 页面清单（精简 7 页）

| 页面 | 路径 | 复杂度 | 说明 |
|------|------|--------|------|
| 首页 | `/` | 公开 | Hero + 接入示例（无聚合统计，隐私优先） |
| 注册/登录 | `/auth` | 公开 | 合并一页，Tab 切换 |
| 使用面板 | `/dashboard` | 登录 | Token 管理 + 用量 + 资源池统计 + 我的贡献 |
| 提交 Channel | `/submit` | 登录 | 单表单 + 授权声明 |
| 使用帮助 | `/docs` | 公开 | curl + Python/JS SDK 示例 |
| 协议 | `/terms` | 公开 | 用户协议 + 免责声明 |

---

## 附录 D：环境变量汇总（完整）

```toml
[vars]
# 基础
ENCRYPTION_KEY = "<32字符随机密钥>"
SESSION_TTL = "604800"

# 使用配额（正常用户放宽）
MAX_CALLS_PER_USER_DAY = "100"
MAX_TOKENS_PER_USER_DAY = "300000"
NEW_USER_DAYS = "7"
NEW_USER_CALLS_QUOTA = "50"
NEW_USER_TOKENS_QUOTA = "150000"

# 反滥用
MAX_REGISTER_PER_IP_PER_DAY = "20"

# 熔断与调度
CIRCUIT_SUCCESS_RATE_THRESHOLD = "0.5"
CIRCUIT_MIN_REQUESTS = "10"
CIRCUIT_MAX_DURATION_MINUTES = "30"
CIRCUIT_DEACTIVATE_COUNT = "5"     # 熔断印记 >= 5 自动下架
MAX_PROXY_RETRIES = "2"

# 信誉分（宽松惩罚机制，见 A.5 / 附录 J）
REPUTATION_DECAY_DAILY = "2"         # 每日回升（保底）
REPUTATION_DECAY_GOOD = "5"          # 连续 3 天无扣分 → 加速回升
REPUTATION_PENALTY_4XX = "3"         # 连续 4xx/5xx 扣分
REPUTATION_PENALTY_LIMIT_HIT = "10"  # 命中全局限流继续调用
REPUTATION_PENALTY_BURST = "8"       # 单日调用异常爆发（≥3 倍上限）
REPUTATION_PENALTY_INVALID_KEY = "5" # 无效 Key 提交
REPUTATION_PENALTY_REPEAT_INVALID = "15" # 反复无效提交（≥3 次/天）
REPUTATION_PENALTY_MALICIOUS = "30"  # 疑似恶意域名 + 下架

# 贡献激励（CR 分档方案，见附录 G）
CONTRIBUTION_TIER_1_CR = "1"         # 档位1 阈值（近7天被成功调用次数）
CONTRIBUTION_TIER_2_CR = "50"
CONTRIBUTION_TIER_3_CR = "200"
CONTRIBUTION_TIER_4_CR = "500"
CONTRIBUTION_TIER_1_BONUS = "10"     # 档位加成（次/天）
CONTRIBUTION_TIER_2_BONUS = "30"
CONTRIBUTION_TIER_3_BONUS = "60"
CONTRIBUTION_TIER_4_BONUS = "100"
CONTRIBUTION_NEWBIE_BONUS = "30"     # 新手贡献加成（注册7天内首次贡献，有效7天）
CONTRIBUTION_ACTIVE_DAYS = "7"       # CR 统计窗口

# 预算保护（见附录 I）
BUDGET_PAUSE_THRESHOLD = "0.9"       # 估算用量 ≥ 90% 暂停动态服务
BUDGET_SAMPLE_RATE = "1/200"         # KV 采样计数率（防 KV 写配额超限）
```

*文档更新完成*

---

## 附录 E：合一账号与贡献激励

### E.1 合一账号模型

> **设计原则**：一个账号同时具备「使用者」和「贡献者」两种身份，天然合一，无需拆分。

```
users（单一账号，无角色区分）
  ├── 作为使用者: 创建 user_tokens (sk-xxx) → 调用资源池 → 配额限制
  └── 作为贡献者: 提交 channels (owner_user_id) → 进入资源池 → 供全体使用
```

- 使用者：任何登录用户可在「使用面板」生成自己的 Token 调用 AI
- 贡献者：任何登录用户可在「提交页」贡献 Key 进入资源池
- 身份自动识别，切换无感，无需切换账号

### E.2 贡献激励（已升级：CR 分档方案，见附录 G）

> **修订**：激励单位由"活跃 Channel 数 × +10"改为 **CR（近 7 天被成功调用次数）分档**。
> 防滥用、新手加成与档位表见 **附录 G**。本文档保留管线说明。

| 档位 | CR 阈值（近 7 天被成功调用，排除自调用） | 每日加成（次） |
|------|------------------------------------------|----------------|
| 0 | < 1 | 0 |
| 1 | ≥ 1 | +10 |
| 2 | ≥ 50 | +30 |
| 3 | ≥ 200 | +60 |
| 4 | ≥ 500 | +100（封顶） |

- Token 额度**不随贡献加成**（仅加成调用次数）
- 信誉 < 60 的降权用户不享受加成
- `last_success_at` 降级为展示/统计字段，**不再驱动激励计算**

### E.3 计算逻辑与数据支持

```typescript
// 每日可用调用次数 = 分级基础配额 + 贡献档位加成（读缓存，避免实时聚合读放大）
async function getDailyCalls(userId: number, reputation: number, env: Env): Promise<number> {
  // 降权用户不享受贡献加成
  if (reputation < 60) return getQuotaLimit(reputation).calls;

  // 读 Cron 每日预计算的档位缓存（见六章 refreshContributionTiers / 附录 G）
  const user = await env.DB.prepare(`SELECT contribution_tier FROM users WHERE id = ?`).bind(userId).first();
  const tier = user?.contribution_tier ?? 0;
  return getQuotaLimit(reputation).calls + TIER_BONUS[tier]; // [0,10,30,60,100]
}
```

```sql
-- users 表贡献缓存字段（E.3 数据支持，见 4.1）
contribution_tier INTEGER DEFAULT 0;  -- 0-4 档，每日 Cron 预计算
cr_cache_date TEXT;                    -- 缓存日期（YYYY-MM-DD）
```

### E.5 防滥用与用户提示

**防滥用**
- 只算**成功调用**（http 2xx），且**排除自调用**（贡献者用自己的 Token 调自己的 Channel 不计入 CR）
- **降权不享受**：信誉 < 60 时加成不生效，反向激励保持良好信誉
- **封顶 +100**：档位上限，防止无限堆砌
- **无法定向**：加权随机调度，使用者不能指定 Channel，无法定向榨干某贡献者的 Key
- **删除即回收**：永久删除的 Channel 立即退出统计（实时重算，已计入的自动失效）

**用户提示（使用面板）**
> "你贡献的渠道本周被调用 320 次，今日额度 +60 次（共 160 次）"

---

## 附录 F：网关 Token 生命周期与安全

### F.1 核心规则

| 规则 | 说明 |
|------|------|
| **单 Token** | 每用户仅 1 个活跃网关 Token（4.2 部分唯一索引强制） |
| **无法找回** | 只存 `SHA-256(token)`，明文丢失后平台（含管理员）也无法找回 |
| **可重置** | 登录态下自助重置：撤销旧的 + 生成新的 |
| **立即失效** | 重置后旧 token_hash 立即失效，使用旧 Token 的请求立即 401 |
| **仅展示一次** | 新 Token 明文只在生成时返回一次 |
| **需登录会话** | 重置是敏感操作，必须在登录态进行（防止他人重置） |

### F.2 生命周期

```
首次注册 → 自动生成唯一 Token（引导页展示一次，提示保存）
  ├── 正常使用（校验 hash 认证 + 配额）
  ├── Token 丢失 → 无法找回 → [重置]（确认弹窗）
  │     → 撤销旧 Token(is_active=0) → 生成新 Token → 仅展示一次 → 旧 Token 立即失效
  └── 不当使用（命中分级限流等） → 不影响 Token，仅影响该账号信誉/额度
```

### F.3 生成与重置逻辑（原子 batch）

```typescript
// 生成或重置：撤销旧的 + 插入新的（D1 batch 原子执行）
async function issueToken(userId: number, env: Env): Promise<string> {
  const newToken = `sk-${randomHex(32)}`;
  await env.DB.batch([
    env.DB.prepare(`UPDATE user_tokens SET is_active = 0 WHERE user_id = ? AND is_active = 1`)
      .bind(userId),
    env.DB.prepare(`INSERT INTO user_tokens (user_id, token_hash, token_prefix, name) VALUES (?, ?, ?, 'Default')`)
      .bind(userId, sha256(newToken), newToken.slice(0, 8)),
  ]);
  return newToken; // 明文仅返回一次
}
```

### F.4 用户提示

> "网关 Token 明文无法找回，请妥善保存。如已丢失可在使用面板重置，旧 Token 将立即失效。"

---

## 附录 G：贡献-使用平衡策略（CR 分档）

### G.1 原则

**贡献回报跟随贡献价值**：激励不按"Channel 数量"，而按"近 7 天被他人成功调用的次数"（CR）分档。
贡献得越多、被用得越多 → 额度越高 → 使用需求越大 → 贡献更多。形成正向飞轮。

```
贡献 Key → 被成功调用越多 → CR 越高 → 贡献者额度大涨
     ↑                                           ↓
继续加 Key / 邀请好友 ──────────────── 使用需求升级
```

### G.2 CR（Contribution Rate）定义

```
CR = 近 7 天（usage_logs 聚合）:
     JOIN channels → owner_user_id = 该用户
     且 l.user_id != c.owner_user_id   ← 排除自调用（防自刷）
     且 l.http_status BETWEEN 200 AND 299 ← 只算成功
```

```sql
SELECT COALESCE(COUNT(*), 0) as cr
FROM usage_logs l JOIN channels c ON c.id = l.channel_id
WHERE c.owner_user_id = ? AND l.user_id != c.owner_user_id
  AND l.http_status BETWEEN 200 AND 299 AND l.created_at > ?;  -- 近 7 天
```

### G.3 分档表 + 新手加成

| 档位 | CR 阈值（近 7 天） | 每日加成 |
|------|-------------------|----------|
| 0 | < 1 | 0 |
| 1 | ≥ 1 | +10 |
| 2 | ≥ 50 | +30 |
| 3 | ≥ 200 | +60 |
| 4 | ≥ 500 | +100（封顶） |

- **新手加成**：注册 7 天内首次提交 Channel 且 CR ≥ 50 → 额外 +30×7 天（一次性）
- 档位由 Cron **每日预计算**写入 `users.contribution_tier`（见 4.1 / 六章），当日配额读缓存，面板展示实时 CR 另查

### G.4 防滥用

| 威胁 | 防护 |
|------|------|
| 贡献者**自刷**（自己 Token 调自己 Key 虚增） | CR **排除自调用**（`l.user_id != c.owner_user_id`） |
| **互助刷分**（两账号互调抬 CR） | 架构天然防护：加权随机调度，**使用者无法指定 Channel**；且需消耗各自每日配额，成本极高 |
| **榨干免费 Key** | 面板透明显示"本周被调用 N 次"；贡献者可随时撤回/下架；厂商限流→自动熔断兜底 |
| 堆量刷档 | 档位**封顶 +100**；死 Key 零成功即零 CR |

### G.5 与既有设计的联动

- 删除 Channel → 立即退出统计（回收加成，实时重算）
- `last_success_at` 降级为展示/统计字段，不再驱动激励
- 使用者配额不受贡献影响（仅调用次数加成，Token 额度不变）

---

## 附录 H：走查记录与优化项

### H.1 正确性问题修复（已采纳）

| 项 | 问题 | 修复位置 |
|----|------|----------|
| A1 | 并发扣配额会超发 | 4.4 条件更新原子扣减（`changes=0` 拒绝） |
| A2 | CR 实时聚合读放大 | 4.1 + 六章：每日预计算 `contribution_tier` 缓存 |
| A3 | `LIKE %model%` 子串误匹配 | 5.3 JSON 解析 + `includes` 精确匹配（含 `*` 通配） |
| A4 | EMA 成功率随样本累积而迟钝 | 5.4 + 六章：`total_requests > 100` 折半衰减 |
| B1 | stream 重试无 body 可发 | 5.3 proxyWithFailover 先读入内存 buffer（≤10MB） |
| B3 | 密码与 Token 一样无法找回 | 七章 + 附录 C：注册/登录页明确提示 |

### H.2 缓做项备忘（规模到达后再做）

| 项 | 内容 |
|----|------|
| A5 | Channel > 50 时 Cron 校验覆盖不全 → 轮转 50/天 或依赖实时熔断为主 |
| B2 | 使用面板模型列表 KV 缓存（TTL 10min，全天全表扫描；移入登录后每天仅按需读取） |
| B4 | 多设备会话（KV key 用 session_id，允许多会话并存） |
| B5 | 调度候选列表 KV 缓存（5min，减少每请求全表 + 密钥列拉取） |

### H.3 免费计划容量边界（备忘，不做改动）

| 维度 | 限额 | 边界说明 |
|------|------|----------|
| D1 写 | 100k 行/天 | 每次调用 ≥2 行写（quota + usage_logs）→ ≈5 万次调用/天，数百活跃用户内安全 |
| D1 读 | 5M 行/天 | A2 已解除 CR 聚合读放大；调度候选全表读在此量级安全 |
| KV 写 | 1k/天 | 登录/登出 + 预算采样（≤800 写/天）安全；登出可不删 KV 靠 TTL 省写 |
| CPU | 10ms/请求 | PBKDF2 ~40k 迭代约占 3-8ms 为最大项，量测后可视情况降至 20-30k |
| Subrequests | 50/请求 | 故障转移 ≤3 次；Cron 健康校验分批 ≤50 |

---

## 附录 I：免费计划预算保护（超出即暂停）

### I.1 目标

Cloudflare 免费计划超限会自动产生超额费用。本机制在**估算用量 ≥ 90% 时主动暂停动态服务**，超限前止损；每日 00:00 限额重置后**自动恢复**。

### I.2 全局开关与采样计数（KV namespace `GATE`）

```
KV GATE:
  gate:status            = { state: "active"|"paused", reason, at }
  counters:{YYYY-MM-DD}  = { requests }   ← 概率采样增量
```

### I.3 入口中间件：采样估算 + 暂停判定（保留静态页）

```typescript
// middleware/budget.ts
export async function budgetGuard(c, next) {
  const req = c.req.raw;
  const path = new URL(req.url).pathname;
  const PUBLIC = ["/", "/docs", "/terms", "/auth"]; // 静态/低风险页放行
  if (PUBLIC.includes(path)) return next();         // 静态页永远可用

  const status = await c.env.GATE.get("gate:status", "json");
  if (status?.state === "paused") {
    return c.text("服务预算保护中，预计 UTC 00:00 自动恢复", 503);
  }

  // 概率采样 1/200（采样率=1/200），KV increment 控制写配额 ≤ 500/天
  if (Math.random() < SAMPLE_RATE) {                // 1/200
    await c.env.GATE.put(`counters:${todayStr()}`, { requests: await c.env.GATE.get... + 1 });
  }

  // 估算: 采样值 × 200
  const sampled = (await c.env.GATE.get(`counters:${todayStr()}`, "json"))?.requests ?? 0;
  const estRequests = sampled * 200;
  const estD1Writes = estRequests * PROXY_RATIO * WRITES_PER_CALL;  // ≈30% × 2-3 行
  if (estRequests >= 0.9 * 100000 || estD1Writes >= 0.9 * 100000) {
    await c.env.GATE.put("gate:status", JSON.stringify({
      state: "paused", reason: "budget-estimate", at: new Date().toISOString(),
    }));
    return c.text("服务预算保护中，预计 UTC 00:00 自动恢复", 503);
  }
  return next();
}
```

### I.4 恢复与清理（Cron 每日 00:00，见六章 budgetDailyRecovery）

- 新一天来到 → 若 `paused` 则恢复 `active`
- 删除昨日 `counters:{date}`（省 KV）

### I.5 覆盖维度与保护方式

| 维度（免费限额） | 保护方式 |
|------------------|----------|
| Workers 请求 100k/天 | 采样估算 ≥ 90% 暂停 |
| D1 写 100k 行/天 | 请求量 × 转发占比 × 每调用写行数 估算 ≥ 90% 暂停 |
| KV 写 1k/天 | 采样率 1/200 本身保障 ≤ 800/天（预算内，无需闸） |
| CPU / Subrequests | 免费计划无超额计费风险，不设闸 |

### I.6 配置（env，见附录 D）

```toml
BUDGET_PAUSE_THRESHOLD = "0.9"
BUDGET_SAMPLE_RATE = "1/200"
```

> **说明**：采用"采样估算 + 90% 保守阈值"而非精确计数——因为精确计数需要逐请求写存储，存储本身即受配额保护的目标维度（KV 1k/天、D1 100k/天），自伤且不可行。90% 阈值为估算误差留足 10% 余量。

---

## 附录 J：惩罚机制（宽松版，永不封禁）

### J.1 原则

- **永不封禁**：所有账号任何时刻均可使用（最低 3 次/天永不归零）
- **宽松扣分**：轻扣分、快恢复、无附加冻结
- **只罚自身**：惩罚仅作用于该账号的信誉 → 当日配额，**不撤其已入池的 Channel**（不能因惩罚某贡献者让他人的配额受损）
- **全自动**：无人工审核、无恢复申请

### J.2 惩罚金字塔（4 层，无冷静期/冻结）

```
层级 0  正常       信誉 80+         100 次/天（放宽）
层级 1  ⚠️ 轻度降权  60-79           40 次/天
层级 2  📉 中度降权  40-59           25 次/天
层级 3  ⛔ 重度降权  <40             10 → 3 次/天（永不归零）
```

### J.3 轻量扣分表（使用侧 + 贡献侧）

| 类别 | 行为 | 扣分 |
|------|------|------|
| 使用侧 | 连续 4xx/5xx（>5 次/小时） | -3/次 |
| 使用侧 | 命中全局限流仍持续调用 | -10/次 |
| 使用侧 | 单日调用异常爆发（≥3 倍上限） | -8/次 |
| 贡献侧 | 无效 Key 提交（即时校验失败） | -5/次 |
| 贡献侧 | 反复无效提交（≥3 次/天） | -15 |
| 贡献侧 | api_url 疑似恶意域名 | -30 + 该 Channel 下架 |

### J.4 恢复规则

| 行为 | 变化 |
|------|------|
| 每天正常使用 | +2/天（保底，上限 100） |
| 连续 3 天无任何扣分 | +5/天 加速回升，直至 80 回正 |
| 从最低档（<20）回升 | 约 2~3 天脱离深度降权，约 1 周回归正常 |

### J.5 与奖励的对称联动

| 域 | 奖励（附录 G） | 惩罚（本附录） |
|----|----------------|----------------|
| 贡献 | CR 分档 +10~+100 | 无效/恶意提交扣分（仅影响信誉 → 当日配额） |
| 使用 | 正常高额配额 | 4 档降额（永不归零） |
| 恢复 | 信誉 +2/+5 全自动 | 无需申请，行为恢复即回升 |

**惩罚与奖励的衔接**：信誉 < 60 时不享受贡献加成（附录 E.2），即被惩罚到降权档位时贡献加成同步失效——但**不冻结已获得的权益**，一旦信誉回升立即恢复。

### J.6 用户可感知（友好提示）

> ⚠️ "检测到少量异常请求，额度已临时调整。恢复正常使用几天后将自动恢复。"
> ℹ️ "你的信誉分正在回升，额度随正常使用自动恢复。"

---

## 附录 K：i18n 国际化 / AdSense / VPS Node 运行时（已落地）

> 本章记录在 Cloudflare Workers 之外新增的实现：全站双语、AdSense 挂载、以及不依赖
> Cloudflare 的自托管 Node 运行时。业务逻辑与 Workers 完全共用同一套 `src/`。

### K.1 国际化（i18n）

- **机制**：`src/i18n.ts` 内置 `en`/`zh` 两套词典（结构化 section.key），`t(lang, section, key, vars?)`
  取值并替换 `{token}` 等占位符。`Lang = "en" | "zh"`，默认英文（开源/全球通用，杜绝硬编码中文）。
- **切换**：`GET /lang?to=zh` 写 `ln` cookie；中间件读 cookie / `Accept-Language` 前缀，挂 `c.get("lang")`；
  htmx 局部刷新请求由前端 JS 带上 `Cookie` 自动维持语言。
- **覆盖范围**：全部页面（首页/登录注册/仪表盘/提交/文档）、各处 flash、配额/限流提示、
  网关返回的 `pool_empty`/`pool_none`/`quota_exceeded` 等关键错误（**错误 `error` code 保持英文常量**，
  仅 message 双语）。API 侧的未授权/无效 token 等 message 刻意保持英文默认，不随 cookie 变化。
- **保留英文原样**：`惩罚:` 模型名前缀（审计与 Cron 恢复依赖 `model LIKE '惩罚:%'`，见六章）。
- **Token 一次性明文**：注册/重置后明文 Token 仅存登录会话 flash（KV/文件，TTL 120s、读后即删），
  仪表盘欢迎页用 `token_flash_prefix` 双语展示后再不出现；库中始终只存 SHA-256 哈希 + 7 位前缀。

### K.2 AdSense（Worker 模式）

- env 变 `ADSENSE_CLIENT` / `ADSENSE_SLOT`（见附录 D；toml `[vars]` 提供，非 secret）。
- 两值均非空时，首页与仪表盘页尾注入 AdSense 异步脚本与本单元 `<ins>`；起空白值的广告位不渲染，
  未满足条件时不加载脚本（避免不必要的第三方依赖）。VPS 模式同样可通过 env 注入（默认为空）。

### K.3 VPS Node 运行时（自托管）

**目标与边界**：不引入 workerd/wrangler 运行时到容器；用纯 Node（Node ≥ 20）跑同一套 Hono 应用。
不使用 Node 专用加密 API，密码/Token/上游 Key 加密一律走 WebCrypto（`src/utils/crypto.ts`）。

- **存储抽象**：`src/platform/types.ts` 定义 `PlatformDb`/`PlatformKv`/`PlatformStorage`/`PlatformEnv`；
  `src/platform/node.ts` 提供文件 KV（每 key 一个 JSON，文件名 = sha256(key)，`v`/`exp` 字段，
  过期惰性删除；`get(key,"json")` 与 Workers KV 对齐：`v` 为字符串时 `JSON.parse` 后返回，保证
  `gate:status` 等对象在两种运行时读取语义一致）+ better-sqlite3（WAL、busy_timeout、启动自动应用 `migrations/*.sql` 并记 `_migrations`）。
  `PlatformDb.batch` 在 better-sqlite3 中实现为**同步事务**（其事务函数禁止返回 Promise），
  语句链经 `makeExecutor` 定参 + `asyncStatement` 包装 + `WeakMap` 把 DbStatement 映射回同步执行器。
- **入口**：`src/node/entry.ts` 用 `node:http` 手写 body 透传（含 `Content-Length`/`x-forwarded-for`，
  流式 body 需 `duplex: "half"`），别名 `SESSIONS/GATE/DB` 到本地存储；启动即 `runDailyTasks()` 一次，
  `node-cron` 按 `CRON_SCHEDULE` 每日执行；`.env` 由 `buildEnvFromProcess` 加载，生产用环境变量。
- **迁移内嵌**：`src/platform/migrations.ts` 维护 `EMBEDDED_MIGRATIONS`（与 `migrations/*.sql` 同源），
  esbuild 单文件 bundle 无法在运行时读磁盘目录，故迁移以**内嵌快照**为准（本地开发仍可传入磁盘目录覆盖）。
  ⚠️ 新增迁移文件时必须同步把 SQL 追加进该常量。
- **构建与运行**：源码为 ESM 且无扩展名导入，纯 Node 无法直接跑 → 用 esbuild 打包
  `dist-node/index.cjs`（`--packages=external`，external：better-sqlite3 / node-cron）。脚本见 AGENTS.md：
  `dev:node`（tsx）/ `build:node`（esbuild）/ `start:node`。
- **回归验证**：每次源码改动跑 `npm run typecheck` + `npm run build:node` + 重新 `node dist-node/index.cjs`
  冒烟（注册→欢迎页见明文 Token→二次访问 flash 已消费→空池 `502 upstream_failed`）。
  Worker 侧 `npm run build`（wrangler dry-run）不受 Node 文件影响（main 仍是 `src/index.ts`）。
  自动注册脚本注意：`MIN_ELAPSED_MS = 2500ms` 时序门（附录 A.3），GET 页面后须 sleep ≥3s 再提交。

### K.4 反滥用参数更新

- `MAX_REGISTER_PER_IP_PER_DAY` 阈值 **3 → 20**（wrangler.toml/example、`src/platform/node.ts` 默认值、
  `src/routes/auth.tsx` fallback 同步）。附录 A.2 的同 IP 每日上限描述以其为准。


### K.5 容器化（Docker / Docker Compose）

- `Dockerfile`：两阶段构建——build 阶段装 python3/make/g++ 编译 better-sqlite3 → 出 `dist-node/` 后
  prune dev 依赖；运行阶段 Node 22 slim、非 root（entrypoint 修复 bind-mount 权限后 `setpriv` 降权到
  node:node，主进程 UID 1000）、`/app/data` 为数据卷。
- `docker-entrypoint.sh`：容器以 root 启动，**首次启动自动生成 `ENCRYPTION_KEY` 与 `CRON_TOKEN`**（`openssl rand -hex 16`，无需手动配置），
  `chown -R node:node /app/data` 修复 bind mount 权限，随后 `setpriv --reuid=1000 --regid=1000` 降权执行主进程。
- `docker-compose.yml`：默认**直接拉取 GHCR 预构建镜像**（`ghcr.io/cljproton/freeaigw:latest`），
  通过环境变量 `GHCR_REPO` 与 `IMAGE_TAG` 可自定义镜像源/标签；`env_file: .env`，
  端口/数据卷/重启策略均由 `.env` 变量控制（`PORT`、`DATA_DIR` 等），无需本地构建。
- `.env.example`：`ENCRYPTION_KEY` 与 `CRON_TOKEN` **由 docker-entrypoint.sh 首次启动自动生成**，无需手动填写；
  新增可选变量 `GHCR_REPO`（默认 `ghcr.io/cljproton/freeaigw`）与 `IMAGE_TAG`（默认 `latest`）；
  其余：`PORT=8791`、`HOST=0.0.0.0`、`DATA_DIR=./data`、`CRON_SCHEDULE`、`ADSENSE_CLIENT`、`ADSENSE_SLOT`、`PUBLIC_BASE_URL` 均可选。
- 首次启动自动建表（依赖内嵌迁移，见 K.3）；镜像发布流水线见附录 L.7.
---

## 附录 L：SEO / GEO（搜索引擎与 AI 爬虫，已落地）

目标：公开页可被搜索引擎与 AI 爬虫（GPTBot/ClaudeBot/PerplexityBot/Google-Extended 等）正确发现、
索引与引用；双语言可分别收录；后台/私有路由不被抓取。新增文件：`src/utils/seo.ts`、
`src/middleware/seo.ts`、`src/routes/seo.ts`。全站仍为服务端渲染（无需预渲染）。

### L.1 语言前缀 URL（替代纯 cookie 语言）

- **规范形态**：`/en`、`/zh`（根）、`/en/docs`、`/zh/docs`、`/en/terms`、`/zh/terms`（无尾斜杠——与
  Hono mount 合并后的路由形态一致）。根页面前缀路由通过 `app.route("/en", pages)` /
  `app.route("/zh", pages)` 与无前缀挂载三重注册（`src/index.ts`）。
- **`src/middleware/seo.ts` 规则**（挂在 i18n 中间件之后，语言优先级：前缀 > cookie > Accept-Language）：
  - `/en`(`/zh`) 前缀 → `c.set("lang")` 并写 `ln` cookie（同页切换语言后，无前缀的后台页跟随最新语言）；
  - `/en/`、`/en/docs/` 等尾斜杠形态 → 301 规范；
  - 无前缀公开页（`/`、`/docs`、`/terms`）→ 按 cookie/Accept-Language 301 到对应前缀页，并写 `ln` cookie
    （cookie 用户无感切换）；
  - **带前缀的后台/API 路径**（`/en/dashboard`、`/en/auth` 等）→ 301 回无前缀版本，防 duplicate；
  - 完全不参与：`/auth`、`/dashboard`、`/submit`、`/health`、`/api/*`、`/v1`、`/cron`、`/lang`、
    `/robots.txt`、`/sitemap.xml`、`/llms.txt`、`/llms.md`（避免 htmx 片段、登录态、API 被改写）。
    `/health` 现为登录受限接口（`requirePageUser`，未登录 302 `/auth`），供 dashboard 资源池统计每 60s 刷新。
- `/lang?to=` 路由保留作向后兼容（写 cookie + Referer 回跳）；Layout 语言切换按钮：公开页同页切换
  （`/zh/docs ↔ /en/docs`），登录/后台页走 `/lang?to=`。

### L.2 页面 Meta / canonical / hreflang / OG / JSON-LD

- `Layout` 新增 `base`（canonical 基址）与 `seo` props；`<head>` 输出：description、`robots`
  （auth/dashboard/submit `noindex,nofollow`，公开页 `index,follow`）、canonical、双语
  `hreflang alternate`、Open Graph（site_name/type/title/description/url/locale+alternate）、
  `twitter:card=summary`、JSON-LD。
- JSON-LD：全站 `WebSite`；docs 页附 `SoftwareApplication`（DeveloperApplication、免费 Offer）。
- 基址解析 `canonicalBase()`：`PUBLIC_BASE_URL`（见 L.5）优先，否则请求 Host（Worker/Node 通用）。

### L.3 robots.txt

`GET /robots.txt`（`src/routes/seo.ts`）：GPTBot/ClaudeBot/PerplexityBot/Google-Extended/`*` 全部
Allow 公开页；Disallow：`/auth` `/dashboard` `/submit` `/api` `/v1` `/cron` `/lang`；尾部
`Sitemap: <base>/sitemap.xml`。`Cache-Control: public, max-age=3600`。

### L.4 sitemap.xml

六条 URL（`/en` `/zh` `/en/docs` `/zh/docs` `/en/terms` `/zh/terms`），每条带
`xhtml:link rel=alternate hreflang` 双语互指；`lastmod` 常量。XML 响应，缓存 1h。

### L.5 GEO：llms.txt / llms.md（llmstxt.org 约定）

- `GET /llms.txt`：站点摘要 + Key facts（统一 OpenAI 兼容 `base_url`、一次性 `sk-` Token 语义、
  分级额度永不归零、failover/熔断、AES-256-GCM 存储、自愿共享免责）+ 文档链接。
- `GET /llms.md`：人/模型可读完整参考 Markdown（Token 获取 → curl/Python/JS 示例 → 401/429/502/503
  错误码 → 配额 → 贡献激励 → 协议要点），与页面文案同源。
- 两个文件同样放行预算暂停（`budgetGuard` 静态集合已扩展）。

### L.6 预算保护兼容

`budgetGuard` 静态放行集合扩展为：原有静态页 + 语言前缀公开页正则（`/en` `/zh` 及 `/en/docs` 等）+
`/robots.txt` `/sitemap.xml` `/llms.txt` `/llms.md`（暂停时爬虫文件仍可读）。

### L.7 配置与 CI

- `PUBLIC_BASE_URL`（可选）：canonical/OG/sitemap/llms统一公网基址；空则请求 Host 推导。
  四处同步：`wrangler.toml(.example)` [vars]、`.env.example`、`src/types.ts:Env`、
  `src/platform/node.ts` `DEFAULT_VALUES`；读取 helper：`config.publicBaseUrl()`。
- GitHub Actions `.github/workflows/docker-publish.yml`：
  - 触发：push 到 `main`、`v*` tag、手动 `workflow_dispatch`。
  - Job1 `typecheck`（门禁：`npm ci && npm run typecheck`）→ Job2 `docker`。
  - `docker`：QEMU + Buildx，GHCR 登录（`GITHUB_TOKEN`，`packages: write`），
    `metadata-action` 产 tag（默认分支 `latest`、tag `semver`、`sha`），
    `build-push-action` 多架构 `linux/amd64,linux/arm64` 推送 `ghcr.io/<owner>/<repo>`。

### L.8 验证记录

Node 冒烟全通过：公开页/前缀页 301 与 200、canonical/hreflang/OG/JSON-LD 正确渲染、`/auth` noindex、
`/zh/dashboard` 301 回无前缀、robots/sitemap/llms 内容与 Content-Type/Cache-Control、cookie 语言判定、
`PUBLIC_BASE_URL` 覆盖生效；注册→dashboard flash 全 Token→`/v1` 502 pool_empty 全链路无回归；
`npm run typecheck`、Worker dry-run、sitemap XML 良构校验通过。

---

*文档更新完成*
