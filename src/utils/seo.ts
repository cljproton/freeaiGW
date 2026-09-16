import type { Context } from "hono";
import type { AppEnv, Env } from "../types";
import type { Lang } from "../i18n";
import { publicBaseUrl } from "../config";

/** 语言 → HTML lang 与 OG locale 双语映射 */
export const LANG_ATTR: Record<Lang, string> = { en: "en", zh: "zh" };
export const OG_LOCALE: Record<Lang, string> = { en: "en_US", zh: "zh_CN" };

/**
 * canonical 基址：PUBLIC_BASE_URL（去尾斜杠）优先，否则按请求 Host 推导。
 * 双运行时（Worker / Node）通用，SSL 均按缺省 https 处理。
 */
export function canonicalBase(c: Context<AppEnv>): string {
  const cfg = publicBaseUrl(c.env);
  if (cfg) return cfg;
  return `https://${c.req.header("host") ?? "localhost"}`;
}

export interface Seo {
  /** 页面路径（不含语言前缀与尾部斜杠），如 "/"、"/docs" */
  path: string;
  /** 页面描述（已按当前语言本地化），可选（noindex 页可省略） */
  description?: string;
  /** OG 类型 */
  ogType?: "website" | "article";
  /** 附加结构化数据（注入为 JSON-LD 数组元素） */
  jsonLd?: object[];
  /** 禁止爬虫索引（如登录页） */
  noindex?: boolean;
}

/** 标准参考站点 JSON-LD（站点级，注入 lang 后的当前 URL） */
export function siteJsonLd(base: string, lang: Lang): object {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "FreeAI Gateway",
    alternateName: lang === "zh" ? "FreeAI 网关" : "FreeAI Gateway",
    url: `${base}/${lang}`,
    inLanguage: LANG_ATTR[lang],
  };
}

/** 软件应用 JSON-LD（文档页，免费、开发者工具类） */
export function softwareJsonLd(base: string, lang: Lang, description: string): object {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "FreeAI Gateway",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "All",
    url: `${base}/${lang}/docs`,
    inLanguage: LANG_ATTR[lang],
    description,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
}