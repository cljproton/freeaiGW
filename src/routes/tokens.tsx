import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireApiUser } from "../middleware/auth";
import { issueToken } from "../db";
import { generateGatewayToken, sha256Hex } from "../utils/crypto";
import { TokenBoxPartial } from "../views/dashboard";

const ROUTER = new Hono<AppEnv>();

/** 重置网关 Token（单 Token 模型，见 F）：撤销旧 + 插入新，明文仅此一次 */
ROUTER.post("/reset", requireApiUser, async (c) => {
  const user = c.get("user");
  const plain = generateGatewayToken();
  const tokenHash = await sha256Hex(plain);
  await issueToken(c.env, user.id, tokenHash, plain.slice(0, 7), "Default");
  c.status(200);
  return c.html(<TokenBoxPartial plain={plain} lang={c.get("lang")} />);
});

/** 当前 Token 信息（前缀 + 状态） */
ROUTER.get("/", requireApiUser, async (c) => {
  const user = c.get("user");
  const { getActiveTokenByUser } = await import("../db");
  const token = await getActiveTokenByUser(c.env, user.id);
  return c.json({
    token_prefix: token?.token_prefix ?? null,
    last_used_at: token?.last_used_at ?? null,
  });
});

export default ROUTER;