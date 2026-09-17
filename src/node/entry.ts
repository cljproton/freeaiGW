/**
 * Node/VPS 入口：node:http + better-sqlite3(D1) + 文件 KV + node-cron
 * 与 Cloudflare 入口共用 createApp 路由 / runDailyTasks。存储落在 <ROOT>/data/。
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { schedule } from "node-cron";
import { createApp } from "../index";
import { runDailyTasks } from "../routes/cron";
import { buildEnvFromProcess, fileKv, sqliteDb } from "../platform/node";
import type { PlatformStorage } from "../platform/types";
import type { Env } from "../types";

/** 加载 .env（KEY=VALUE，忽略注释/空行；已存在的环境变量优先） */
function loadDotEnv(file?: string): void {
  const path = file ?? join(process.cwd(), ".env");
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

/** node:http → web Request（协议映射到 /v1 路由不需要请求头跟踪） */
function toWebRequest(req: IncomingMessage): Request {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const body =
    req.method === "GET" || req.method === "HEAD"
      ? undefined
      : new ReadableStream({
          start(controller) {
            req.on("data", (c) => controller.enqueue(new Uint8Array(c)));
            req.on("end", () => controller.close());
            req.on("error", (e) => controller.error(e));
          },
        });
  const headers = new Headers();
  if (req.headers) {
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined) continue;
      try {
        headers.set(k, Array.isArray(v) ? v.join(", ") : v);
      } catch {
        /* 忽略非法头 */
      }
    }
  }
  headers.set("x-forwarded-for", req.socket.remoteAddress || "");
  const init: RequestInit = { method: req.method, headers, body };
  // Node undici 要求 body 为流时必须显式 duplex（Web 标准类型未包含该字段）
  (init as { duplex: string }).duplex = "half";
  return new Request(url.toString(), init);
}

/** web Response → node:http */
async function writeResponse(res: ServerResponse, web: Response): Promise<void> {
  res.writeHead(web.status, Object.fromEntries(web.headers.entries()));
  if (web.body) {
    const buf = Buffer.from(await web.arrayBuffer());
    res.end(buf);
  } else {
    res.end();
  }
}

async function main(): Promise<void> {
  loadDotEnv();

  const storeDir = process.env.DATA_DIR || "./data";
  const raw: Partial<Env> = buildEnvFromProcess();
  const storage: PlatformStorage = {
    db: sqliteDb(join(storeDir, "app.db"), "migrations"),
    sessions: fileKv(join(storeDir, "kv", "sessions")),
    gate: fileKv(join(storeDir, "kv", "gate")),
  };
  // Node/VPS：把 SESSIONS/GATE 绑到文件 KV，逻辑与 Cloudflare KV 一致
  const envObj = {
    ...raw,
    SESSIONS: storage.sessions,
    GATE: storage.gate,
    DB: storage.db,
  } as unknown as Env;

  const server = createServer(async (req, res) => {
    try {
      const web = await createApp(envObj).fetch(toWebRequest(req), envObj, {} as ExecutionContext);
      await writeResponse(res, web);
    } catch (err) {
      console.error("[http]", err);
      res.statusCode = 500;
      res.end("internal error");
    }
  });

  const port = Number(process.env.PORT || 8787);
  server.listen(port, process.env.HOST || "0.0.0.0", () => {
    console.log(`freeai-gateway (node) listening on http://${process.env.HOST || "0.0.0.0"}:${port}`);
  });

  // 每日定时任务（CRON_TZ 偏置），启动即跑一次，方便观察日志
  const cronExpr = process.env.CRON_SCHEDULE || "10 3 * * *";
  schedule(cronExpr, () => {
    runDailyTasks(envObj).catch((e) => console.error("[cron]", e));
  });
  try {
    await runDailyTasks(envObj);
  } catch (e) {
    console.error("[cron-boot]", e);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// 兜底：async 未捕获异常不允许静默吞掉，至少落日志便于排障（不直接退进程，
// 由 Docker/反代的健康与重启策略兜底）
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});