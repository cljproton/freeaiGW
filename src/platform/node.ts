/**
 * Node/VPS 运行时后端：better-sqlite3（D1）+ 文件 KV（SESSIONS/GATE）
 * - 资产：process.env + 可选 .env 文件
 * - 与 Cloudflare 绑定的 API 对齐（prepare/bind/all/first/run、get/put/delete）
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import type { PlatformDb, PlatformKv, PlatformStorage, DbStatement } from "./types";
import type { Env } from "../types";

/** 空实现（避免各模块在未提供存储时抛错） */
export function noopStorage(): PlatformStorage {
  return { db: emptyDb(), sessions: emptyKv(), gate: emptyKv() };
}

/** 数值型配置的默认值（与 wrangler.toml 一致；VPS 未设置时回退） */
export const DEFAULT_VALUES: Record<string, string> = {
  MAX_CALLS_PER_USER_DAY: "100",
  MAX_TOKENS_PER_USER_DAY: "300000",
  NEW_USER_DAYS: "7",
  NEW_USER_CALLS_QUOTA: "50",
  NEW_USER_TOKENS_QUOTA: "150000",
  SESSION_TTL: "604800",
  COOKIE_SECURE: "0",
  CIRCUIT_SUCCESS_RATE_THRESHOLD: "0.5",
  CIRCUIT_MIN_REQUESTS: "10",
  CIRCUIT_MAX_DURATION_MINUTES: "30",
  CIRCUIT_DEACTIVATE_COUNT: "5",
  MAX_PROXY_RETRIES: "2",
  REPUTATION_DECAY_DAILY: "2",
  REPUTATION_DECAY_GOOD: "5",
  REPUTATION_PENALTY_4XX: "3",
  REPUTATION_PENALTY_LIMIT_HIT: "10",
  REPUTATION_PENALTY_BURST: "8",
  REPUTATION_PENALTY_INVALID_KEY: "5",
  REPUTATION_PENALTY_REPEAT_INVALID: "15",
  REPUTATION_PENALTY_MALICIOUS: "30",
  CONTRIBUTION_TIER_1_CR: "1",
  CONTRIBUTION_TIER_2_CR: "50",
  CONTRIBUTION_TIER_3_CR: "200",
  CONTRIBUTION_TIER_4_CR: "500",
  CONTRIBUTION_TIER_1_BONUS: "10",
  CONTRIBUTION_TIER_2_BONUS: "30",
  CONTRIBUTION_TIER_3_BONUS: "60",
  CONTRIBUTION_TIER_4_BONUS: "100",
  CONTRIBUTION_NEWBIE_BONUS: "30",
  CONTRIBUTION_ACTIVE_DAYS: "7",
  BUDGET_PAUSE_THRESHOLD: "0.9",
  BUDGET_SAMPLE_RATE: "1/200",
  ADSENSE_ENABLED: "0",
  ADSENSE_CLIENT: "",
  ADSENSE_SLOT: "",
  PUBLIC_BASE_URL: "",
};

/** 解析进程环境：数值用默认兜底，字符串（KEY/Token）原样 */
export function buildEnvFromProcess(): Partial<Env> {
  const env: Record<string, unknown> = {};
  for (const [k, def] of Object.entries(DEFAULT_VALUES)) {
    const v = process.env[k] ?? def;
    env[k] = v;
  }
  env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "";
  env.CRON_TOKEN = process.env.CRON_TOKEN ?? "";
  if (!env.ENCRYPTION_KEY) {
    throw new Error("服务端未配置 ENCRYPTION_KEY（32 位 hex），无法启动");
  }
  return env as Partial<Env>;
}

/** 建目录（递归） */
function ensureDir(p: string): void {
  mkdirSync(p, { recursive: true });
}

/**
 * 文件 KV：每个 key 一个 JSON 文件
 * 形如 {"v":<序列化值>,"exp":<ms 时间戳|null>}
 */
export function fileKv(dir: string): PlatformKv {
  ensureDir(dir);
  return {
    async get(key, type = "text") {
      const f = join(dir, hash(key));
      if (!existsSync(f)) return null;
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(f, "utf8"));
      } catch {
        return null;
      }
      const rec = raw as { v: unknown; exp: number | null };
      if (rec && typeof rec === "object" && typeof rec.exp === "number" && rec.exp < Date.now()) {
        try {
          rmSync(f, { force: true });
        } catch {
          /* 尽力清理 */
        }
        return null;
      }
      // 与 Workers KV 对齐："json" 读取需把 JSON 字符串解析为对象（如 gate:status）
      if (type === "json") {
        const v = rec?.v;
        if (typeof v !== "string") return v ?? null;
        try {
          return JSON.parse(v);
        } catch {
          return v;
        }
      }
      return typeof rec?.v === "string" ? (rec.v as string) : JSON.stringify(rec?.v ?? null);
    },
    async put(key, value, options) {
      const exp = options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : null;
      writeFileSync(join(dir, hash(key)), JSON.stringify({ v: value, exp }), "utf8");
    },
    async delete(key) {
      const f = join(dir, hash(key));
      if (existsSync(f)) rmSync(f, { force: true });
    },
  };
}

/** KV key 哈希文件名（避免非法字符/路径穿越） */
function hash(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

/** 空 KV（未配置存储时占位；写入直接丢弃） */
function emptyKv(): PlatformKv {
  return {
    async get() {
      return null;
    },
    async put() {},
    async delete() {},
  };
}

/** 空 DB（未配置存储时占位；prepare 返回空结果） */
function emptyDb(): PlatformDb {
  return {
    prepare() {
      return emptyStatement();
    },
    async batch() {
      return [];
    },
  };
}

/** 空语句：prepare().all() 返回空数组、first() 返回 null、run() 返回空 meta */
function emptyStatement(): DbStatement<Record<string, unknown>> {
  const stmt: DbStatement<Record<string, unknown>> = {
    bind() {
      return this;
    },
    all<T>() {
      return Promise.resolve({ results: [] as T[], success: true });
    },
    async first() {
      return null;
    },
    async run() {
      return { meta: { changes: 0, last_row_id: 0 } };
    },
  };
  return stmt;
}

import { EMBEDDED_MIGRATIONS } from "./migrations";

/** SQLite 迁移：优先内嵌快照（esbuild 单文件可用），本地开发可传磁盘目录兜底 */
async function runMigrations(db: Database.Database, diskDir?: string): Promise<void> {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    );
  `);
  const applied = new Set(
    (db.prepare(`SELECT name FROM _migrations`).all() as { name: string }[]).map((r) => r.name),
  );
  let list: { name: string; sql: string }[] = Object.entries(EMBEDDED_MIGRATIONS).map(
    ([name, sql]) => ({ name, sql }),
  );
  if (diskDir) {
    const disk: { name: string; sql: string }[] = [];
    for (const name of readdirSorted(diskDir)) {
      if (!name.endsWith(".sql")) continue;
      disk.push({ name, sql: readFileSync(join(diskDir, name), "utf8") });
    }
    if (disk.length > 0) list = disk;
  }
  list.sort((a, b) => a.name.localeCompare(b.name));
  for (const { name, sql } of list) {
    if (applied.has(name)) continue;
    db.exec(sql);
    db.prepare(`INSERT INTO _migrations (name) VALUES (?)`).run(name);
  }
}

/** 读取并排序迁移文件（按文件名数字前缀） */
function readdirSorted(dir: string): string[] {
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    names = [];
  }
  return names.sort((a, b) => a.localeCompare(b));
}

/** 最小结构类型：只用到 all/get/run/bind（bind 由 DbStatement 链覆盖） */
interface SqliteStatement {
  all<T>(...params: unknown[]): T[];
  get<T>(...params: unknown[]): T | undefined;
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
}

/** 已绑定参数的语句执行器：同步跑 better-sqlite3，供 batch 事务调用 */
interface Executor<Row> {
  readonly stmt: SqliteStatement;
  readonly params: unknown[];
  all<T>(): T[];
  first<T>(): T | undefined;
  run(): { meta: { changes: number; last_row_id: number } };
}

/** 构造执行器：方法是闭包于参数的纯函数；bind 复制后用新参数 */
function makeExecutor(stmt: SqliteStatement, params: unknown[]): Executor<Record<string, unknown>> {
  return {
    stmt,
    params,
    all<T>() {
      return stmt.all<T>(...params);
    },
    first<T>() {
      return stmt.get<T>(...params);
    },
    run() {
      const info = stmt.run(...params);
      return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
    },
  };
}

/** DbStatement 对象 → 其底层同步执行器 */
const execMap = new WeakMap<object, Executor<Record<string, unknown>>>();

/** 异步壳：与 D1 对齐的 prepare/bind/all/first/run（sync 执行 + async 包装） */
function asyncStatement(exec: Executor<Record<string, unknown>>): DbStatement<Record<string, unknown>> {
  const spec: DbStatement<Record<string, unknown>> = {
    bind(...params) {
      return asyncStatement(makeExecutor(exec.stmt, [...exec.params, ...params]));
    },
    async all<T>() {
      const rows = exec.all<T>();
      return { results: rows, success: true };
    },
    async first<T>() {
      const row = exec.first<T>();
      return row ?? null;
    },
    async run() {
      return exec.run();
    },
  };
  execMap.set(spec, exec);
  return spec;
}

/** batch 内同步执行（Statement.run() 由事务保证串行/原子） */
function syncRun(s: DbStatement<Record<string, unknown>>): { meta: { changes: number; last_row_id: number } } {
  const exec = execMap.get(s);
  if (!exec) throw new Error("batch: 语句无法映射到同步执行器");
  return exec.run();
}

/** better-sqlite3 → PlatformDb（异步壳，API 与 D1 对齐） */
export function sqliteDb(dbPath: string, migrationsDir?: string): PlatformDb {
  const dir = dirname(dbPath);
  ensureDir(dir);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  // 迁移以内嵌快照为准；本地开发可传磁盘 migrations 目录覆盖（须保持同名同 SQL）
  runMigrations(db, migrationsDir);

  return {
    prepare(query) {
      const stmt = db.prepare(query) as unknown as SqliteStatement;
      return asyncStatement(makeExecutor(stmt, []));
    },
    async batch(statements) {
      // 语义等价 D1 批量：单事务原子提交
      const results: unknown[] = [];
      db.transaction(() => {
        for (const s of statements) {
          results.push(syncRun(s));
        }
      })();
      return results;
    },
  };
}

function dirname(p: string): string {
  return p.slice(0, Math.max(0, p.lastIndexOf("/"))) || ".";
}