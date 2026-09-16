/** Storage 访问层接口：让普通 Node/VPS 运行时与 Cloudflare D1 + KV 绑定对齐 */
import type { Env } from "../types";

/** 模拟 D1PreparedStatement（.bind().all() / .first() / .run()） */
export interface DbStatement<Row> {
  bind(...params: unknown[]): DbStatement<Row>;
  all<T = Row>(): Promise<{ results: T[]; success?: boolean }>;
  first<T = Row>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number; last_row_id: number } }>;
  raw?<T = unknown[]>(): Promise<T[]>;
}

/** 模拟 Cloudflare KVNamespace */
export interface PlatformKv {
  get(key: string, type?: "text"): Promise<string | null>;
  get(key: string, type: "json"): Promise<unknown | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

/** 模拟 D1Database */
export interface PlatformDb {
  prepare(query: string): DbStatement<Record<string, unknown>>;
  batch(statements: DbStatement<Record<string, unknown>>[]): Promise<unknown[]>;
}

/** Node/VPS 环境的存储后端：由入口实现并提供给 Env */
export interface PlatformStorage {
  db: PlatformDb;
  sessions: PlatformKv;
  gate: PlatformKv;
}

/** 可挂载到 Node/VPS Env 的扩展字段 */
export interface PlatformEnv extends Env {
  storage: PlatformStorage;
  ready?: () => Promise<void>;
}