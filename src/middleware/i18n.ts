import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";
import { langFromReq } from "../i18n";

/** 每请求解析语言：cookie `ln` → Accept-Language 嗅探 → 默认英文 */
export const i18nMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const lang = langFromReq(c.req.header("cookie"), c.req.header("accept-language"));
  c.set("lang", lang);
  await next();
};