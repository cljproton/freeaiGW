import { Hono } from "hono";
import type { AppEnv, Env } from "./types";
import type { Variables } from "./utils/crypto";
import { budgetGuard } from "./middleware/budget";
import { i18nMiddleware } from "./middleware/i18n";
import { seoMiddleware } from "./middleware/seo";
import pages from "./routes/pages";
import seoRoutes from "./routes/seo";
import auth from "./routes/auth";
import tokens from "./routes/tokens";
import account from "./routes/account";
import channels from "./routes/channels";
import proxy from "./routes/proxy";
import cron, { runDailyTasks } from "./routes/cron";
import lang from "./routes/lang";
import { t, type Lang } from "./i18n";

/**
 * 应用工厂：Clouflare Workers 与 Node/VPS 两种运行时共用同一套路由。
 * env 需要包含全部 Bindings（D1/KV/secret/vars）。
 */
export function createApp(env: Env): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  // 预算保护（附录 I）：全局门，静态页放行
  app.use("*", budgetGuard);
  // i18n：解析每请求语言（cookie → Accept-Language）
  app.use("*", i18nMiddleware);
  // 语言前缀路由：/en /zh 解析与公开页 301 规范化（附录 L）
  app.use("*", seoMiddleware);

  // SEO/GEO 静态路由（robots/sitemap/llms，附录 L）
  app.route("/", seoRoutes);
  // 页面路由：无前缀（公开页被 seoMiddleware 301，其余如 /health 保留）与语言前缀双重挂载
  app.route("/", pages);
  app.route("/en", pages);
  app.route("/zh", pages);
  app.route("/auth", auth);
  app.route("/api/tokens", tokens);
  app.route("/api/account", account);
  app.route("/api/channels", channels);
  app.route("/v1", proxy);
  app.route("/cron", cron);
  app.route("/lang", lang);

  // 全局兜底：任何路由/中间件未捕获异常 → 记日志 + JSON 500（避免被前置反代吞成裸 502）
  app.onError((err, c) => {
    console.error(`[error] ${c.req.method} ${c.req.path}`, err);
    const lang: Lang = (c.get("lang") as Lang | undefined) ?? "en";
    return c.json({ error: "internal_error", message: t(lang, "errors", "internal") }, 500);
  });
  app.notFound((c) => c.json({ error: "not_found" }, 404));

  return app;
}

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => {
    return createApp(env).fetch(request, env, ctx);
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runDailyTasks(env));
  },
} satisfies ExportedHandler<Env>;