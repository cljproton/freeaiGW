import { Hono } from "hono";
import type { StatusCode } from "hono/utils/http-status";
import type { AppEnv, Env } from "../types";
import { requireBearerToken } from "../middleware/auth";
import { quotaGuard } from "../middleware/quota";
import { pickChannel } from "../scheduler/pickChannel";
import { t, type Lang } from "../i18n";
import {
  addTokens,
  circuitBreakChannel,
  insertUsageLog,
  listCandidateChannels,
  recordChannelResult,
  touchToken,
} from "../db";
import { decryptSecret } from "../utils/crypto";
import { getUserEffectiveLimits, todayStr } from "../config";

const ROUTER = new Hono<AppEnv>();

const MAX_BODY = 10 * 1024 * 1024; // 10MB

/** 上游地址归一：api_url 已含 /v1 则不重复拼接 */
function upstreamChatUrl(apiUrl: string): string {
  const base = apiUrl.replace(/\/+$/, "");
  return /\/v1$/i.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

/** 熔断评估：成功率低于阈值且请求量达标则熔断（5.3 / B.2） */
async function maybeCircuitBreak(env: Env, channelId: number): Promise<void> {
  const row = await env.DB
    .prepare(`SELECT total_requests, success_rate FROM channels WHERE id = ?`)
    .bind(channelId)
    .first<{ total_requests: number; success_rate: number }>();
  if (!row) return;
  const min = Number(env.CIRCUIT_MIN_REQUESTS) || 10;
  const threshold = Number(env.CIRCUIT_SUCCESS_RATE_THRESHOLD) || 0.5;
  if (row.total_requests >= min && row.success_rate < threshold) {
    await circuitBreakChannel(env, channelId);
  }
}

/**
 * POST /v1/chat/completions（见六章 6 / 5.3）
 * 认证 → 配额扣减 → 调度选渠道 → 故障转移重试链 → 记录审计
 */
ROUTER.post(
  "/chat/completions",
  requireBearerToken,
  quotaGuard,
  async (c) => {
    const { token, user } = c.get("auth");
    const callerIp =
      c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "";

    const raw = await c.req.arrayBuffer();
    if (raw.byteLength > MAX_BODY) return c.json({ error: "payload_too_large" }, 413);

    let json: Record<string, unknown>;
    try {
      json = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>;
    } catch {
      return c.json({ error: "invalid_json", message: "请求体不是合法 JSON" }, 400);
    }
    const model = typeof json.model === "string" && json.model ? json.model : null;
    if (!model) return c.json({ error: "model_required", message: "缺少 model 字段" }, 400);

    const maxRetries = Math.max(0, Number(c.env.MAX_PROXY_RETRIES) || 2);
    const lang: Lang = c.get("lang");
    let lastErr = t(lang, "errors", "pool_none");
    let lastStatus = 503;

    const tokensLimit = (await getUserEffectiveLimits(c.env, user)).tokens;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const candidates = await listCandidateChannels(c.env, model);
      if (!candidates.length) {
        lastErr = t(lang, "errors", "pool_empty");
        break;
      }
      const ch = pickChannel(candidates, model);
      if (!ch) {
        lastErr = t(lang, "errors", "pool_empty");
        break;
      }

      let key: string;
      try {
        key = await decryptSecret(c.env.ENCRYPTION_KEY, ch.api_key_encrypted);
      } catch {
        await recordChannelResult(c.env, ch.id, false, "密钥解密失败");
        continue;
      }

      try {
        const resp = await fetch(upstreamChatUrl(ch.api_url), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: raw,
        });

        const status = resp.status;
        const outBuffer = await resp.arrayBuffer();
        const outText = new TextDecoder().decode(outBuffer);

        if (resp.ok) {
          let tokensIn = 0;
          let tokensOut = 0;
          let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
          try {
            usage = (JSON.parse(outText) as { usage?: typeof usage }).usage;
          } catch {
            /* 非标准响应不解析 */
          }
          if (usage) {
            tokensIn = Number(usage.prompt_tokens) || 0;
            tokensOut = Number(usage.completion_tokens) || 0;
          }
          await addTokens(c.env, user.id, todayStr(), tokensIn + tokensOut, tokensLimit);
          await recordChannelResult(c.env, ch.id, true);
          await insertUsageLog(c.env, {
            token_id: token.id,
            channel_id: ch.id,
            user_id: user.id,
            caller_ip: callerIp,
            model,
            tokens_in: tokensIn,
            tokens_out: tokensOut,
            http_status: status,
            retry_count: attempt,
          });
          await touchToken(c.env, token.id);
          c.status(status as StatusCode);
          const ct = resp.headers.get("content-type") || "application/json";
          c.header("Content-Type", ct);
          return c.body(outBuffer as ArrayBuffer);
        }

        await recordChannelResult(c.env, ch.id, false, `${status}: ${outText.slice(0, 120)}`);
        await insertUsageLog(c.env, {
          token_id: token.id,
          channel_id: ch.id,
          user_id: user.id,
          caller_ip: callerIp,
          model,
          tokens_in: 0,
          tokens_out: 0,
          http_status: status,
          retry_count: attempt,
        });
        await maybeCircuitBreak(c.env, ch.id);

        // 4xx：请求本身问题，不重试
        if (status >= 400 && status < 500) {
          lastStatus = status;
          lastErr = outText.slice(0, 200);
          break;
        }
        lastStatus = status;
        lastErr = outText.slice(0, 200);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await recordChannelResult(c.env, ch.id, false, `网络错误: ${msg}`);
        await maybeCircuitBreak(c.env, ch.id);
        lastErr = msg;
        lastStatus = 502;
      }
    }

    c.status(502);
    return c.json({ error: "upstream_failed", message: lastErr });
  },
);

export default ROUTER;