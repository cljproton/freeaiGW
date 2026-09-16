# FreeAI Gateway

[English](README.md) | **简体中文**

FreeAI Gateway 是一个聚合免费 AI API 免费额度的高可用网关，可部署在 **Cloudflare Workers**（Hono + D1 + KV）或 **自托管 VPS**（Node + better-sqlite3 + 文件 KV，Docker Compose 一键启动）。

自动在多条上游渠道间调度，提供统一的 `sk-xxx` 网关 Token、分级配额、熔断重试、信誉分惩罚、贡献激励与预算保护，全部自动化、无需人工干预。全站中英双语（`?to=zh`/`?to=en` 切换）。

## 功能特性

- **统一账号**：匿名注册/登录（仅用户名 + 密码），每人一个网关 Token
- **OpenAI 兼容**：`POST /v1/chat/completions`，Bearer Token 认证
- **双语界面**：中英 i18n，`ln` cookie 持久化，语言前缀 URL（`/en`、`/zh`）
- **上游调度**：模型匹配 + 权重轮询 + 失败重试 + 自动健康统计（成功率、熔断）
- **配额分层**：按信誉分 / 新用户动态分级（正常 100 次/日 + 300k token）
- **反滥用（自研，无第三方依赖）**：Proof-of-Work（难度 4）+ 蜜罐 + 提交时序 + KV 一次性防重放 + IP 注册限流
- **熔断与自动恢复**：成功率阈值熔断、30 分钟冷却、自动探测复用
- **信誉分系统**：宽松惩罚、永不封禁，行为恢复自动回升
- **贡献激励**：提交渠道获 CR 分档 + 新手加成，贡献与使用配额联动
- **预算保护**：采样统计、超阈值暂停上游调用（静态页保留）
- **每日 Cron**：配额重置、日志清理、健康恢复、预算放闸
- **加密存储**：上游 `api_key` 使用 `ENCRYPTION_KEY` 加密入库，Token 仅存 SHA-256 哈希
- **双运行时**：同一套 `src/` 同时跑在 Cloudflare Workers 与纯 Node（D1→SQLite、KV→文件）

## 架构

```
                        ┌──────────────────────────────────────┐
  用户 / htmx 页面 ───▶ │          Cloudflare Workers          │
  OpenAI 兼容客户端 ──▶ │   Hono 路由 + 中间件（预算/配额/限流）   │
                        │   ┌────────────────────────────┐     │
                        │   │  调度引擎（模型匹配/重试）    │     │
                        │   └────────────┬───────────────┘     │
                        └────────────┬───────────────────────┘
                                     ▼
                         上游免费 AI 渠道（多厂商）
```

### 路由

| 方法与路径 | 说明 |
|------------|------|
| `GET /` | 首页：接入示例 + 可用模型列表（含健康状态） |
| `GET/POST /auth` | 注册 / 登录 / 提示（PoW 无感校验） |
| `POST /auth/logout` | 登出 |
| `GET /dashboard` | 网关 Token 卡片 + 用量 + 贡献 |
| `GET /submit` | 贡献者提交 / 管理渠道 |
| `GET /api/tokens/*` | Token 生成 / 重置（一次性明文展示） |
| `GET/POST /api/channels/*` | 渠道查看 / 提交 / 重校验 / 删除 / fetch-models |
| `POST /v1/chat/completions` | **核心网关接口**（Bearer `sk-xxx`） |
| `GET /v1/models` | 可用模型列表 |
| `GET /lang` | 语言切换（`?to=zh` / `?to=en`，写 `ln` cookie） |
| `POST /cron/run` | 每日调度任务（header `x-cron-token` 校验） |
| `GET /en`、`GET /zh`、`GET /{en\|zh}/docs`、`GET /{en\|zh}/terms` | 语言前缀页面（canonical 形态，支持 hreflang；无前缀公开页自动 301 规范化） |
| `GET /robots.txt` | 爬虫策略（允许公开页，禁抓后台/API；含 Sitemap 索引） |
| `GET /sitemap.xml` | 双语站点地图（hreflang 互指） |
| `GET /llms.txt`、`GET /llms.md` | GEO：面向 AI 大模型的站点摘要与完整参考 |

## 快速开始（本地开发，Workers 模式）

前置：Node.js ≥ 18、Cloudflare 账号（已开通 D1 与 KV）、wrangler 4.x。

```bash
npm install

# 1. 本地资源：创建 D1 数据库与两个 KV namespace，将真实 ID 填入 wrangler.toml
#    （参考 wrangler.toml.example，控制台资源页可查 ID）
cp wrangler.toml.example wrangler.toml

# 2. 本地密钥（仅为本地开发；生产用 wrangler secret 配置同名密钥）
cat > .dev.vars <<'EOF'
ENCRYPTION_KEY=<32位随机hex>
CRON_TOKEN=<随机字符串>
EOF

# 3. 初始化本地数据库并启动开发服务器
npm run db:migrate:local
npm run dev            # → http://127.0.0.1:8787
```

## 快速开始（自托管 VPS，Node 模式）

无需 Cloudflare 账号 / D1 / KV，纯 Node 运行同一套代码（better-sqlite3 + 文件 KV）：

```bash
npm install
cp .env.example .env    # 编辑 ENCRYPTION_KEY / CRON_TOKEN / PORT / DATA_DIR 等
npm run start:node      # → http://127.0.0.1:8791（首次启动自动建表迁移）
```

本地手动触发每日 Cron：`POST /cron/run` + header `x-cron-token`。

## 部署（Cloudflare Workers）

```bash
npm run publish                 # 类型检查 → 跳过远程 D1 迁移 → 部署
npm run publish -- --migrate    # 首次部署：先应用远程 D1 迁移再部署
```

生产密钥请在部署前配置：

```bash
npx wrangler secret put ENCRYPTION_KEY
npx wrangler secret put CRON_TOKEN
```

## 部署（自托管 VPS，Docker Compose）

Compose 默认**直接拉取 GHCR 预构建镜像** —— 无需本地构建：

```bash
cp .env.example .env            # 可选配置；ENCRYPTION_KEY 与 CRON_TOKEN 首次启动自动生成
docker compose up -d            # 拉取 + 启动，数据持久化于 ./data 卷
docker compose logs -f          # 查看日志
```

- `ENCRYPTION_KEY` 与 `CRON_TOKEN` **首次启动自动生成**（`openssl rand -hex 16`）；无需手动填写。
- 可通过 `GHCR_REPO` 与 `IMAGE_TAG` 自定义镜像源/标签；默认 `ghcr.io/cljproton/freeaigw:latest`。

单容器运行（无 Compose）：

```bash
docker pull ghcr.io/cljproton/freeaigw:latest
docker run -d --name freeai -p 8791:8791 -v ./data:/app/data \
  ghcr.io/cljproton/freeaigw:latest
```

## GitHub Actions：构建并发布镜像

`.github/workflows/docker-publish.yml` **仅支持手动触发**（`workflow_dispatch`，可选输入 `image_tag`）：
typecheck 门禁 → 多架构构建 → 推送 GHCR（`GITHUB_TOKEN`，无需额外 secret）。

## 配置项

| 分组 | 变量 | 默认 | 说明 |
|------|------|------|------|
| 配额 | `MAX_CALLS_PER_USER_DAY` | `100` | 正常用户每日调用次数上限 |
| 配额 | `MAX_TOKENS_PER_USER_DAY` | `300000` | 正常用户每日 token 上限 |
| 新用户 | `NEW_USER_DAYS` | `7` | 新用户判定天数 |
| 新用户 | `NEW_USER_CALLS_QUOTA` | `50` | 新用户每日调用上限 |
| 新用户 | `NEW_USER_TOKENS_QUOTA` | `150000` | 新用户每日 token 上限 |
| 会话 | `SESSION_TTL` | `604800` | 会话 KV TTL（秒） |
| 反滥用 | `MAX_REGISTER_PER_IP_PER_DAY` | `20` | 同 IP 每日注册账号上限 |
| 熔断 | `CIRCUIT_*` | - | 成功率阈值 / 最少请求数 / 冷却时长 / 下架次数 |
| 重试 | `MAX_PROXY_RETRIES` | `2` | 单次调用最多切换上游次数 |
| 信誉分 | `REPUTATION_*` | - | 加分 / 各类扣分权重（见附录 J） |
| 贡献 | `CONTRIBUTION_*` | - | CR 分档与加成（见附录 G） |
| 预算 | `BUDGET_PAUSE_THRESHOLD` | `0.9` | 超出暂停阈值 |
| 预算 | `BUDGET_SAMPLE_RATE` | `1/200` | 采样计数频率 |
| SEO | `PUBLIC_BASE_URL` | `""` | canonical/OG/sitemap 统一基址（空则按请求 Host） |

完整释义见 `docs/PLAN.md` 附录 D；VPS/Node 专用配置见 `docs/PLAN.md` 附录 K（`PORT`、`DATA_DIR`、`CRON_SCHEDULE`，以及 Worker 模式的 `ADSENSE_SLOT` / `ADSENSE_CLIENT`）。

## 数据模型

- **users**：账号、PBKDF2 密码哈希、信誉分、贡献档位、IP
- **user_tokens**：每个用户唯一网关 Token（仅存 SHA-256 哈希 + 前缀提示）
- **channels**：贡献者上游 Key（加密）+ 健康元数据（成功率/熔断/下架）
- **user_quota**：用户日用量（调用次数 / token）
- **usage_log**：调用审计（模型、上游、状态、tokens）
- **ip_register_log**：同 IP 注册计数

## 安全设计

- **密码**：PBKDF2（低迭代，可控在 10ms CPU 内，匿名制轻量防护）
- **网关 Token**：一次性明文展示，库中仅存哈希，重置立即失效
- **上游 Key**：`ENCRYPTION_KEY` 对称加密，`key_hint` 提示脱敏展示
- **注册/登录反滥用**（无第三方依赖）：
  1. **PoW**：服务端下发随机盐，客户端基于
     `SHA-256(salt:nonce)` 前缀零 ≥ 4 计算工作量（约 6.5 万次哈希，现代设备不足 0.5s）
  2. **蜜罐**：隐藏 `website` 字段，被填充即拒绝
  3. **时序**：`got_ts` 距提交不足 2.5s 或超 10 分钟即拒绝
  4. **一次性防重放**：挑战存 KV（TTL 10 分钟），验证后立即删除，重放无效
- **IP 限流**：注册同 IP 每日最多 20 个账号；登录失败过多临时锁定
- **预算保护**：采样估算，超阈值全局暂停上游调用，保留静态页与登录

## 项目结构

```
src/
├── index.ts            # Hono 入口 + Cron scheduled handler
├── types.ts            # Env 类型（wrangler.toml vars）
├── config.ts
├── db/                 # D1 访问层 + 表结构类型
├── platform/           # 存储抽象：Workers 实现 + Node 实现（better-sqlite3/文件 KV）
├── node/entry.ts       # 纯 Node 入口（node:http + .env + node-cron）
├── utils/              # crypto（PBKDF2/密码/token）、pow、audit、i18n、seo（canonical/JSON-LD）
├── middleware/         # auth / budget / quota / rate-limit / seo（语言前缀 + 规范化）
├── routes/             # pages / auth / tokens / channels / proxy / cron / seo（robots/sitemap/llms）
└── views/              # htmx + Tailwind 页面（含内联 PoW 脚本，中英双语）
migrations/             # D1 SQL 迁移（Node 模式自动应用）
scripts/publish.sh      # 一键发布（可选 --migrate）
dist-node/              # Node 模式 esbuild 产物
docs/PLAN.md            # 完整设计文档（架构/调度/预算/激励/惩罚等）
```

## 文档

- `docs/PLAN.md`：详细设计方案，含调度引擎（第五章）、配额分层（5.5）、Cron（第六章）、
  反滥用（附录 A）、贡献激励（附录 G）、预算保护（附录 I）、惩罚机制（附录 J）、
  Node/VPS 运行时与 i18n（附录 K）、SEO/GEO 与镜像发布（附录 L）

## 免责声明

- **仅供学习与测试**：本项目**不提供任何模型服务**，仅聚合社区成员自愿共享的免费 API 凭据；不保证可用性、稳定性或任何 SLA。
- **上游条款风险**：共享 API Key 可能违反相关厂商的服务条款（ToS），由此产生的账号封禁、法律风险与任何直接或间接损失，**由提交者自行承担**。
- **凭据保护尽力而为**：平台对上游 Key 使用 AES-256-GCM 加密存储，Token 仅存 SHA-256 哈希，但**不承担因不可抗力导致的数据丢失或泄露责任**。
- **服务随时可能不可用**：受限于配额、熔断、预算保护、上游厂商限流等机制，服务可能随时暂停或降级。
- **API 不暴露上游信息**：网关**不向客户端泄露任何上游服务的标识、地址、模型列表、错误详情**等内部信息；错误码仅返回标准 HTTP 状态与统一错误码。
- **使用即接受**：使用本服务即视为已阅读、理解并同意上述条款；不同意请勿使用。

## License

[MIT](LICENSE)