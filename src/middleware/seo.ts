import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";
import type { Lang } from "../i18n";
import { langFromReq } from "../i18n";

/**
 * 语言前缀路由与公开页规范化（附录 L）：
 * 规范 URL 形态为 /en、/zh（无尾斜杠）、/en/docs、/zh/docs（Hono mount 合并后形态）：
 * - /en、/zh 前缀：设置每请求语言（优先于 cookie/嗅探），交由挂载在 /en、/zh 的页面路由处理
 * - 非规范形态（/en/ 等尾斜杠）→ 301 规范
 * - 公开页（/、/docs、/terms）无前缀 → 301 到对应语言前缀，并写 ln cookie（cookie 用户无缝）
 * - 带前缀的后台页/API（/en/dashboard 等）→ 301 回无前缀版本，防 duplicate
 * - 其余（/auth /dashboard /health /api/* /v1 /cron /lang 及 SEO 静态文件）不参与
 */

const LANG_PREFIX_RE = /^\/(en|zh)(?:\/(.*))?$/;
const REDIRECT_PAGES = new Set(["/", "/docs", "/terms"]);
// 允许带语言前缀的公开页（其余前缀路径 → 301 回无前缀，防后台页/API duplicate）
const LANG_PUBLIC_PATHS = new Set(["/", "/docs", "/terms"]);
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const seoMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const url = new URL(c.req.url);
  const { pathname, search } = url;

  const match = pathname.match(LANG_PREFIX_RE);
  if (match) {
    const prefixLang = match[1] as Lang;
    // restPath: "" | "docs" | "docs/" → 统一去尾斜杠 → "/"、"/docs"
    const restPath = "/" + (match[2] ?? "").replace(/\/+$/, "");
    const canonical = `/${prefixLang}${restPath === "/" ? "" : restPath}`;
    if (!LANG_PUBLIC_PATHS.has(restPath)) {
      // 非公开页（后台/API/静态文件）不参与前缀：301 回无前缀版本
      return c.redirect(`${restPath}${search}`, 301);
    }
    if (pathname !== canonical) {
      // 尾斜杠等非规范形态 → 301 规范（/en/ → /en，/en/docs/ → /en/docs）
      return c.redirect(`${canonical}${search}`, 301);
    }
    c.set("lang", prefixLang);
    // 前缀访问也同步 cookie：同页切换语言后，无前缀的后台页跟随最新语言
    c.header(
      "Set-Cookie",
      `ln=${prefixLang}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`,
    );
    await next();
    return;
  }

  // 公开页规范化：cookie → Accept-Language 判定语言后 301
  const lang = langFromReq(c.req.header("cookie"), c.req.header("accept-language"));
  if (REDIRECT_PAGES.has(pathname)) {
    const to = pathname === "/" ? `/${lang}` : `/${lang}${pathname}`;
    const res = c.redirect(`${to}${search}`, 301);
    res.headers.set(
      "Set-Cookie",
      `ln=${lang}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`,
    );
    return res;
  }

  await next();
};
