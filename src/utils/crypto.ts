import type { DBToken, DBUser } from "../db/schema";

/** WebCrypto 封装的全局工具：PBKDF2 密码哈希（CPU 是大头，迭代数保守，见十二章风险1） + AES-256-GCM Key 加密 + 随机 Token */

const encoder = new TextEncoder();
const PBKDF2_ITERATIONS = 60000;

export function randomHex(n = 8): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function toB64(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) {
    s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/** ===== 密码（PBKDF2-SHA256，格式 iter:salt:hash） ===== */

export async function pbkdf2Hash(password: string): Promise<string> {
  const salt = randomHex(16);
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: encoder.encode(salt), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  return `${PBKDF2_ITERATIONS}:${salt}:${toB64(bits)}`;
}

export async function pbkdf2Verify(password: string, stored: string): Promise<boolean> {
  const [iterStr, salt, hash] = stored.split(":");
  if (!iterStr || !salt || !hash) return false;
  const iterations = Number(iterStr);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: encoder.encode(salt), iterations, hash: "SHA-256" },
    key,
    256,
  );
  return toB64(bits) === hash;
}

/** ===== Key 加密（AES-256-GCM，格式 iv:cipher，见十一合规） ===== */

async function importAesKey(keyHex: string): Promise<CryptoKey> {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(keyHex.slice(i * 2, i * 2 + 2), 16) || 0;
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(keyHex: string, plain: string): Promise<string> {
  const key = await importAesKey(keyHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plain));
  return `${toB64(iv)}:${toB64(cipher)}`;
}

export async function decryptSecret(keyHex: string, enc: string): Promise<string> {
  const parts = enc.split(":");
  const iv = parts[0];
  const ct = parts[1];
  if (!iv || !ct) throw new Error("bad cipher format");
  const key = await importAesKey(keyHex);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, key, fromB64(ct));
  return new TextDecoder().decode(plain);
}

/** ===== 网关 Token（见 F） ===== */

/** 生成 sk-{64hex} 网关 Token（仅展示一次） */
export function generateGatewayToken(): string {
  return `sk-${randomHex(32)}`;
}

/** SHA-256 → token 只存哈希 */
export async function sha256Hex(s: string): Promise<string> {
  const bits = await crypto.subtle.digest("SHA-256", encoder.encode(s));
  return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 常量时间比较（不变量） */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** ===== Hono Context 变量（贯穿中间件/路由） ===== */

export interface AuthContext {
  token: DBToken;
  user: DBUser;
}

export type Variables = {
  user: DBUser;
  auth: AuthContext;
};