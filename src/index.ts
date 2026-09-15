import { Hono } from "hono";
import type { Env } from "./types";
import type { Variables } from "./utils/crypto";
import { budgetGuard } from "./middleware/budget";
import pages from "./routes/pages";
import auth from "./routes/auth";
import tokens from "./routes/tokens";
import channels from "./routes/channels";
import proxy from "./routes/proxy";
import cron, { runDailyTasks } from "./routes/cron";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// 预算保护（附录 I）：全局门，静态页放行
app.use("*", budgetGuard);

app.route("/", pages);
app.route("/auth", auth);
app.route("/api/tokens", tokens);
app.route("/api/channels", channels);
app.route("/v1", proxy);
app.route("/cron", cron);

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runDailyTasks(env));
  },
} satisfies ExportedHandler<Env>;