# AGENTS.md

聚合免费 AI API 免费计划的聚合网关，部署于 **Cloudflare Workers（Hono + D1 + KV）或自托管 VPS（Node + better-sqlite3 + 文件 KV，Docker 可选）**，前端为 htmx + Tailwind（CDN），全站中英双语。参考 README.md 与权威设计文档 `docs/PLAN.md`（含调度/配额/反滥用/激励/惩罚各章附录，i18n/AdSense/Node 运行时见**附录 K**，代码注释里的"见附录 X"均指向它）。

## 文档同步（强制约定）

所有代码修改后，必须同步更新 `docs/PLAN.md` 中对应章节/附录，保持一致。这是仓库的硬性约定，README 描述已过时或简略时以 PLAN.md 为准。

## 开发命令

```bash
npm install                       # 运行时依赖 hono + better-sqlite3 + node-cron，dev 依赖 wrangler/typescript/tsx/esbuild
npm run db:migrate:local          # 必须先于 npm run dev（初始化本地 D1）
npm run dev                       # Workers 模式 → http://127.0.0.1:8787
npm run dev:node                  # Node 模式（tsx，热更）→ http://127.0.0.1:8791，读 .env
npm run build:node                # esbuild → dist-node/index.cjs（Node 模式产物，external better-sqlite3/node-cron）
npm run start:node                # node dist-node/index.cjs
npm run typecheck                 # tsc --noEmit —— 唯一验证手段，无测试/lint
npm run build                     # wrangler deploy --dry-run --outdir dist（Worker 模式，不受 Node 文件影响）
npm run publish                   # typecheck → 跳过远程迁移 → 部署
npm run publish -- --migrate      # 首次部署/改表：先 wrangler d1 migrations apply DB --remote
```

本地手动触发每日 Cron（绕过 scheduled）：`POST /cron/run`，Header `x-cron-token`。Node 模式值在 `.env` 的 `CRON_TOKEN`，Workers 在 `.dev.vars`。注意 README 路由表写的 `/cron/<token>` 已过时。

## 关键陷阱

- `wrangler.toml` 被 gitignore：真实 Cloudflare 资源 ID（D1/KV）只存在于本地，模板是 `wrangler.toml.example`。改配置需自行补全 ID。
- `.dev.vars`（Workers）与 `.env`（Node）均被 gitignore：本地密钥 `ENCRYPTION_KEY`（32 位 hex）+ `CRON_TOKEN`；生产 `npx wrangler secret put` 或环境变量。
- `wrangler.toml` [vars] 与 secret 都会以**字符串**进入 `env`（见 `src/types.ts:Env`）。数值解析统一走 `src/config.ts` 的 `num()`（带默认兜底），新增配置务必沿用。
- 修改 `wrangler.toml` vars 后需**重启** `wrangler dev`，不会热加载。
- `nodejs_compat` 兼容标志已启用，但密码/加密全部走 WebCrypto（`src/utils/crypto.ts`），Node 模式同样不用 Node 专用加密 API。
- `src/config.ts` 的 `getQuotaLimit()` 分级表是硬编码的（非 env 驱动），与 wrangler.toml 里的 vars 存在刻意分歧——改额度别只改 toml。
- Node 模式源码是 ESM 无扩展名导入，**不能**直接 `node src/node/entry.ts`；用 `tsx` 或先 `build:node` 再 `start:node`。
- better-sqlite3 事务函数禁止返回 Promise（会抛 "Transaction function cannot return a promise"）；批量写经 `src/platform/node.ts` 的同步 Executor（`makeExecutor` + `WeakMap` execMap）实现，勿改成 async。
- 文件 KV 的 `get(key, "json")` 已按 Workers 语义解析 JSON（v 为字符串则 parse）；消费方（如 budget `gate:status`）拿到的是对象，勿再自行 parse。
- **API 不暴露上游信息**：proxy 层**严禁向客户端泄露任何上游服务的标识、地址、模型列表、错误详情**等内部信息；错误码仅返回标准 HTTP 状态与统一错误码（见 `src/routes/proxy.ts`）。

## 安全模型（改这层代码要格外小心）

- 网关 Token：`sk-{64hex}` 仅创建/重置时展示一次（入口会话 flash，读后即删，TTL 120s），库中只存 SHA-256 哈希（`sha256Hex`）。
- 上游 Channel Key：`ENCRYPTION_KEY` AES-256-GCM 加密入库（格式 `iv:cipher`），仅在 proxy 解密转发。严禁打印/记录明文 Key 或完整 Token。
- 反滥用（`src/utils/pow.ts` + 路由）：PoW 难度 5（挑战存 KV `GATE`，一次性，TTL 600s）、蜜罐 `website` 字段、提交时序 `<2.5s 拒绝`、每 IP 累计注册 ≤3 个账号（`ip_register_log` 永久计数，见 PLAN A.2）、登录失败 IP+账户双维度 10min/10 次锁定（锁定存 `lock@` 截止戳，页面显示剩余秒、到期自动解）、/v1 无效 Token IP 级限流（`badex`，429）。
- 惩罚日志伪造模型名 `惩罚:...`（见 `src/routes/cron.ts:107` `model LIKE '惩罚:%'`），信誉分日增逻辑依赖它，勿改名。

## 调度与转发（`src/routes/proxy.ts` + `src/scheduler/pickChannel.ts`）

- 选渠道 = SQL LIKE 粗筛（`'"%*%"'` 或 `%"model"`）→ 精确匹配（含 `*` 通配）→ 加权随机（`weight × success_rate`，下限 0.1/0.01）。
- 重试链只对 5xx / 网络错误重试；**4xx 立即短路**返回给客户端。失败记录 EMA 滚动 success_rate（折半衰减在 Cron）。
- 熔断：success_rate 低于 `CIRCUIT_SUCCESS_RATE_THRESHOLD` 且请求数达标 → `is_circuited=1`；`circuit_count ≥ 5` 自动下架。
- 空池：返回 `502 {"error":"upstream_failed"}` + 双语 `pool_empty`（en：资源池暂无可用渠道）。API 错误 code 恒为英文常量，仅 message 随语言。

## 结构速览

- `src/index.ts`：单 Worker 入口（Hono fetch + `scheduled` handler），顶层挂全局 `budgetGuard`，静态页在暂停时放行。
- `src/node/entry.ts`：Node 模式入口（`node:http` 透传 + `.env` + node-cron），启动即 `runDailyTasks()` 一次。
- `src/platform/`：存储抽象——`types.ts`（PlatformDb/PlatformKv/PlatformEnv）+ `node.ts`（better-sqlite3 自动迁移 / 文件 KV / env 兜底）。
- `src/i18n.ts`：en/zh 词典 + `t()`，`Lang` 类型；语言 cookie 名 `ln`，`GET /lang?to=zh|en` 切换；`seo` 分组存页面 description 词条。
- `src/routes/`：`pages/auth/tokens/account/channels/(v1 proxy)/cron/lang/seo`；`src/views/`：hono/jsx 页面（全双语）。`src/routes/seo.ts` 返回 `robots.txt / sitemap.xml / llms.txt / llms.md`。
- `src/middleware/`：`auth`（sid 会话 + Bearer）、`budget`（KV `GATE` 采样估算）、`quota`、`rate-limit`、`seo`（语言前缀 + 公开页 301，见 PLAN 附录 L）。
- `src/utils/seo.ts`：`canonicalBase`（`PUBLIC_BASE_URL` → 请求 Host）、JSON-LD（WebSite/SoftwareApplication）、`Seo` 类型；`Layout` 渲染 canonical/hreflang/OG/JSON-LD。
- `migrations/`：SQL（Workers D1 与 Node 共用），新增表/索引要同时更新 `src/db/schema.ts` 的行类型与 `src/db/index.ts` 访问函数。Node 首次启动自动应用。

## SEO / GEO（PLAN 附录 L）

- 语言前缀路由在 `src/middleware/seo.ts`：规范 URL 为 `/en`、`/zh`、`/{lang}/docs|terms`（**无尾斜杠**——Hono `app.route("/en", pages)` 合并后 index 形态是 `/en`，不是 `/en/`）。改这块务必同步：中间件正则、pages 三重挂载（`/`、`/en`、`/zh`）、sitemap/robots/canonical 形态三处。
- 公开页（`/` `/docs` `/terms`）无前缀访问 301 到语言前缀并写 `ln` cookie；**后台/API（auth/dashboard/submit/api/v1/cron/lang/health）绝不加前缀**（带前缀的会被 301 回无前缀），htmx 片段（`/health`）与表单 action 保持无前缀。
- 新增公开页要同步：`LANG_PUBLIC_PATHS`、`REDIRECT_PAGES`、`budgetGuard` 静态集合、sitemap 六条、layout 导航。
- `PUBLIC_BASE_URL` 影响 canonical/OG/sitemap/llms（四处默认表都要有，空=请求 Host）。
- CI：`.github/workflows/docker-publish.yml`（typecheck 门禁 → buildx 多架构推 GHCR，`GITHUB_TOKEN` 即可）；改 Dockerfile/依赖要同步看该工作流。

## Docker（VPS）

- `docker compose up -d` **直接拉取 GHCR 预构建镜像**（`ghcr.io/cljproton/freeaigw:latest`）启动，无需本地构建；
  如需自定义镜像源/标签，设置 `GHCR_REPO` 与 `IMAGE_TAG` 环境变量。
- 容器内 `ENCRYPTION_KEY` 与 `CRON_TOKEN` **由 docker-entrypoint.sh 首次启动自动生成**（`openssl rand -hex 16`），
  **并持久化到数据卷 `/app/data/.secrets`（600），重建容器自动复用**——不会因 `up -d --pull always` 换 Key 使渠道密文失效；
  无需在 `.env` 中手动填写；`.env` 仅需配置可选项（`GHCR_REPO`、`IMAGE_TAG`、`PORT`、`DATA_DIR` 等）。
- `HOST=0.0.0.0` 才对外可访问；数据持久化于 `./data` 卷，端口默认 8791。
- CI：`.github/workflows/docker-publish.yml` **仅支持手动触发**（`workflow_dispatch`，可选输入 `image_tag`），
  不再自动随 push 构建；本地需镜像时 `docker pull ghcr.io/cljproton/freeaigw:latest` 即可。