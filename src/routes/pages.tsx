import { Hono } from "hono";
import type { DBUser } from "../db/schema";
import type { AppEnv, Env } from "../types";
import { getAndClearFlash, getSessionSid, requirePageUser } from "../middleware/auth";
import { getActiveTokenByUser, getQuota, listChannelsByOwner } from "../db";
import { getBudgetStatus } from "../middleware/budget";
import { isNewUser, tierBonus, todayStr, getUserEffectiveLimits } from "../config";
import { IndexPage, HealthPanel, type Health } from "../views/index";
import { DashboardPage, type UsageInfo } from "../views/dashboard";
import { SubmitPage } from "../views/submit";
import { DocsPage, TermsPage } from "../views/docs";

const ROUTER = new Hono<AppEnv>();

/** 首页健康数据：可用模型聚合 + 渠道数 + 预算状态 */
async function getHealth(env: Env): Promise<Health> {
  const { results } = await env.DB
    .prepare(`SELECT models FROM channels WHERE is_active = 1 AND is_valid = 1 AND is_circuited = 0`)
    .all<{ models: string }>();
  const count = new Map<string, number>();
  for (const r of results) {
    try {
      const arr = JSON.parse(r.models) as string[];
      for (const m of arr) count.set(m, (count.get(m) ?? 0) + 1);
    } catch {
      /* 忽略损坏模型字段 */
    }
  }
  const models = [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 24)
    .map(([model, n]) => ({ model, count: n }));
  return { models, channels: results.length, budget: await getBudgetStatus(env) };
}

async function loadDashboardData(env: Env, user: DBUser) {
  const limits = await getUserEffectiveLimits(env, user);
  const quota = await getQuota(env, user.id, todayStr());
  const contributions = await listChannelsByOwner(env, user.id);
  const token = await getActiveTokenByUser(env, user.id);
  const usage: UsageInfo = {
    calls: quota.calls,
    tokens: quota.tokens,
    limit: limits.calls,
    tokensLimit: limits.tokens,
    tier: user.contribution_tier,
    tierBonus: tierBonus(user.contribution_tier, env),
    isNew: isNewUser(user.created_at, env),
    reputation: user.reputation,
  };
  return { usage, contributions, tokenPrefix: token?.token_prefix ?? null };
}

ROUTER.get("/", async (c) => {
  const health = await getHealth(c.env);
  return c.html(<IndexPage health={health} />);
});

ROUTER.get("/health", async (c) => {
  const health = await getHealth(c.env);
  return c.html(<HealthPanel health={health} />);
});

ROUTER.get("/dashboard", requirePageUser, async (c) => {
  const user = c.get("user") as DBUser;
  const [data, flash, welcome] = await Promise.all([
    loadDashboardData(c.env, user),
    getAndClearFlash(c.env, getSessionSid(c)),
    Promise.resolve(c.req.query("welcome") === "1"),
  ]);
  return c.html(
    <DashboardPage
      user={user}
      usage={data.usage}
      contributions={data.contributions}
      tokenPrefix={data.tokenPrefix}
      tokenPlain={flash && welcome ? flash : undefined}
    />,
  );
});

ROUTER.get("/submit", requirePageUser, async (c) => {
  const user = c.get("user") as DBUser;
  const contributions = await listChannelsByOwner(c.env, user.id);
  return c.html(<SubmitPage user={user} contributions={contributions} />);
});

ROUTER.get("/docs", (c) => c.html(<DocsPage />));
ROUTER.get("/terms", (c) => c.html(<TermsPage />));

export default ROUTER;