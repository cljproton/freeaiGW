import type { Env } from "../types";
import { randomHex, sha256Hex } from "./crypto";

/** Proof-of-Work 人机校验（无第三方）：前端算哈希前缀零，后端一次性验证 */

export type PowChallenge = { id: string; salt: string; difficulty: number };

const KV_PREFIX = "pow:";
const POW_TTL_SECONDS = 600;
export const POW_DIFFICULTY = 4;
const NONCE_RE = /^[0-9a-f]{1,64}$/;
const ID_RE = /^[0-9a-f]{16}$/;

/** 签发一次性挑战并写入 KV（TTL 10 分钟） */
export async function powIssue(env: Env, difficulty = POW_DIFFICULTY): Promise<PowChallenge> {
  const id = randomHex(8);
  const salt = randomHex(8);
  await env.GATE.put(`${KV_PREFIX}${id}`, JSON.stringify({ salt, difficulty }), {
    expirationTtl: POW_TTL_SECONDS,
  });
  return { id, salt, difficulty };
}

/** 校验 nonce：id/salt 匹配、非重放（取后即删）、哈希前缀零 ≥ 难度 */
export async function powVerify(
  env: Env,
  id: string,
  salt: string,
  nonce: string,
  difficulty = POW_DIFFICULTY,
): Promise<boolean> {
  if (!ID_RE.test(id) || !ID_RE.test(salt) || !NONCE_RE.test(nonce)) return false;
  const key = `${KV_PREFIX}${id}`;
  const raw = await env.GATE.get(key).catch(() => null);
  if (!raw) return false;
  await env.GATE.delete(key);
  let stored: { salt: string; difficulty: number } | null = null;
  try {
    stored = JSON.parse(raw) as { salt: string; difficulty: number };
  } catch {
    return false;
  }
  if (!stored || stored.salt !== salt || stored.difficulty !== difficulty) return false;
  const hex = await sha256Hex(`${salt}:${nonce}`);
  let zeros = 0;
  for (const ch of hex) {
    if (ch === "0") zeros++;
    else break;
  }
  return zeros >= difficulty;
}