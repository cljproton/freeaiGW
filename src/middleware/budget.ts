import type { Context, Next } from "hono";
import { pauseThreshold, sampleRate, todayStr, yesterdayStr } from "../config";

/**
 * 免费计划预算保护（见附录 I）：
 * - gate:status = "active" | "paused" 存 KV GATE
 * - counters:{date} 采样递增（1/200），估算用量
 * - 估算 >= 90% 阈值 → 暂停动态服务（静态页 /、/docs、/terms、/auth 始终放行）
 * - Cron budgetDailyRecovery 每日 00:00 自动恢复
 */

const GATE_STATUS_KEY = "gate:status";
const COUNTER_KEY = (d: string) => `counters:${d}`;

export async function getBudgetStatus(env: any): Promise<{ state: string; at?: string | null }> {
  const raw = await env.GATE.get(GATE_STATUS_KEY, "json").catch(() => null);
  return (raw as { state?: string; at?: string })?.state === "paused"
    ? { state: "paused", at: (raw as { at?: string }).at }
    : { state: "active", at: null };
}

/** 采样并评估是否需要暂停（对一个请求调用一次，概率写 KV） */
async function maybeSample(env: any): Promise<void> {
  const rate = sampleRate(env);
  if (Math.random() > rate) return;
  const key = COUNTER_KEY(todayStr());
  const prev = Number((await env.GATE.get(key).catch(() => "0")) || "0");
  const n = prev + 1;
  await env.GATE.put(key, String(n), { expirationTtl: 172800 });
  // 估算：请求量 = 采样 / 采样率；调用占比约 30%，每调用 ~3 行 D1 写
  const reqEst = n / rate;
  const d1Est = reqEst * 0.3 * 3;
  const ratio = Math.max(reqEst / 100000, d1Est / 100000);
  if (ratio >= pauseThreshold(env)) {
    await env.GATE.put(
      GATE_STATUS_KEY,
      JSON.stringify({ state: "paused", at: new Date().toISOString() }),
      { expirationTtl: 172800 },
    );
  }
}

const STATIC_PAGES = new Set(["/", "/docs", "/terms", "/auth", "/auth/", "/robots.txt", "/sitemap.xml", "/llms.txt", "/llms.md"]);
// 语言前缀公开页：/en /en/ /zh/ /en/docs /zh/terms 等
const LANG_PUBLIC_RE = /^\/(?:en|zh)(?:\/(?:docs|terms)?)?\/?$/;
const STATIC_ASSETS = /\.(css|js|png|jpg|svg|ico|woff2?)$/;

function isStaticPage(path: string): boolean {
  return STATIC_PAGES.has(path) || LANG_PUBLIC_RE.test(path) || STATIC_ASSETS.test(path);
}

/** 预算守卫：动态路由（非静态页）暂停时返回 503 页面 */
export async function budgetGuard(c: Context, next: Next) {
  const path = c.req.path;
  if (isStaticPage(path)) {
    await next();
    return;
  }
  const status = await getBudgetStatus(c.env);
  if (status.state === "paused") {
    const raw = await c.env.GATE.get("gate:status", "json").catch(() => null);
    const at = (raw as { at?: string })?.at;
    c.status(503);
    return c.html(`<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>服务预算保护中</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#0f172a;color:#e2e8f0;text-align:center}
.card{max-width:420px;padding:2rem}h1{font-size:1.4rem}code{background:#1e293b;padding:.2em .4em;border-radius:6px}
.small{color:#94a3b8;font-size:.85rem}</style></head><body><div class="card">
<h1>服务预算保护中</h1>
<p>请求量已达到今日免费预算阈值，动态服务已暂停以保护账户不被计费。</p>
<p>预计 <code>UTC 00:00</code> 自动恢复，首页、使用帮助与协议页可正常访问。</p>
${at ? `<p class="small">保护始于 ${at}</p>` : ""}
</div></body></html>`);
  }
  await maybeSample(c.env);
  await next();
}

/** Cron 预算恢复：新一天解除暂停 + 清理昨日计数器（见 I.4） */
export async function budgetDailyRecovery(env: any): Promise<void> {
  await env.GATE.delete(COUNTER_KEY(yesterdayStr())).catch(() => {});
  const status = await getBudgetStatus(env);
  if (status.state === "paused") {
    await env.GATE.put(GATE_STATUS_KEY, JSON.stringify({ state: "active", at: new Date().toISOString() }), {
      expirationTtl: 172800,
    });
  }
}