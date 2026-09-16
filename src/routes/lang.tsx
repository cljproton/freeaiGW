import { Hono } from "hono";
import type { AppEnv } from "../types";
import { COOKIE, LANGS, resolveLang } from "../i18n";

/**
 * GET /lang?to=zh|en：切换语言，写 cookie 后按 Referer 回跳（无则回首页）
 */
const ROUTER = new Hono<AppEnv>();

const MAX_AGE = 60 * 60 * 24 * 365;

ROUTER.get("/", (c) => {
  const to = resolveLang(c.req.query("to"));
  const valid = LANGS.includes(to);
  const referer = c.req.header("referer") || "/";
  // 仅允许站内回跳，防开放重定向
  let back = "/";
  try {
    const u = new URL(referer);
    if (u.origin === new URL(c.req.url).origin) back = u.pathname + u.search + u.hash;
  } catch {
    /* 非法 referer 回首页 */
  }
  const safe = valid ? to : "en";
  c.header(
    "Set-Cookie",
    `${COOKIE}=${safe}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${MAX_AGE}`,
  );
  return c.redirect(back);
});

export default ROUTER;