import { Hono } from "hono";
import type { AppEnv } from "../types";
import { canonicalBase } from "../utils/seo";

/**
 * SEO/GEO 静态路由（附录 L）：
 * - /robots.txt       爬虫放行策略（公开页全放行，后台/API 禁抓）
 * - /sitemap.xml      双语 URL + hreflang
 * - /llms.txt         面向 AI 大模型的站点摘要（RFC 9249 / llmstxt.org 约定）
 * - /llms.md          人/模型可读的完整参考 Markdown
 * 全部走 Hono 路由，Workers 与 Node 双运行时一致；不参与语言前缀跳转。
 */

const ROUTER = new Hono<AppEnv>();
const CACHE = "public, max-age=3600";

const LAST_MOD = "2026-09-16";

const DISALLOWED = ["/auth", "/dashboard", "/submit", "/api", "/v1", "/cron", "/lang"];

function robotsTxt(base: string): string {
  const groups = ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended", "*"];
  const disallow = DISALLOWED.map((p) => `Disallow: ${p}`).join("\n");
  return `${groups
    .map(
      (ua) =>
        `User-agent: ${ua}\nAllow: /\nDisallow: /auth\nDisallow: /dashboard\nDisallow: /submit\nDisallow: /api\nDisallow: /v1\nDisallow: /cron\nDisallow: /lang\n`,
    )
    .join("\n")}Sitemap: ${base}/sitemap.xml\n`;
}

interface SitemapUrl {
  lang: "en" | "zh";
  path: string;
}

function sitemapXml(base: string): string {
  const urls: SitemapUrl[] = [
    { lang: "en", path: "/" },
    { lang: "zh", path: "/" },
    { lang: "en", path: "/docs" },
    { lang: "zh", path: "/docs" },
    { lang: "en", path: "/terms" },
    { lang: "zh", path: "/terms" },
  ];
  const blocks = urls
    .map((u) => {
      const suffix = u.path === "/" ? "" : u.path;
      const loc = `${base}/${u.lang}${suffix}`;
      const alt = (["en", "zh"] as const)
        .map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${base}/${l}${suffix}" />`)
        .join("\n    ");
      return `  <url>
    <loc>${loc}</loc>
    <lastmod>${LAST_MOD}</lastmod>
    ${alt}
  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${blocks}
</urlset>\n`;
}

function llmsTxt(base: string): string {
  return `# FreeAI Gateway

> Community-aggregated free AI API aggregation proxy. 社区聚合的免费 AI API 代理网关（仅供学习与测试）。

FreeAI Gateway aggregates community-contributed free AI API keys behind one OpenAI-compatible endpoint and one gateway token. It requires no vendor accounts; a single key drives many models with automatic failover and circuit breaking.

## Key facts
- OpenAI-compatible REST API: ${base}/v1/chat/completions (and other /v1/* endpoints)
- Authentication: HTTP Bearer header, a gateway token shaped like \`sk-<64 hex>\`, issued once after sign-up (one-time display, not recoverable)
- Free tier quotas separate daily call count and token budget; never zeroed, tiered by reputation
- Contributors who shared a channel key receive a daily call bonus
- Requests automatically fail over to healthy upstreams; unhealthy channels are circuit-broken
- Keys are stored encrypted (AES-256-GCM); tokens are stored as SHA-256 hashes only
- No content is stored or inspected by the gateway
- Sharing API keys may violate upstream vendors' ToS; contributors act on their own responsibility

## Targeted audience
- Developers who want free LLM access for learning, testing, and prototyping. Not for production or high-volume use.

## Docs / 文档
- [llms.md - full reference (EN/中文)](${base}/llms.md)
- [Usage docs (English)](${base}/en/docs)
- [使用帮助 (中文)](${base}/zh/docs)
- [Terms / 用户协议](${base}/en/terms)
`;
}

function llmsMd(base: string): string {
  return `# FreeAI Gateway — Reference

FreeAI Gateway is a community-driven, free AI API aggregation proxy. It aggregates free API keys shared voluntarily by community members behind one OpenAI-compatible endpoint. You do not need vendor accounts: one gateway token drives many models.

> 一个社区驱动的免费 AI 代理网关：把社区成员自愿共享的免费密钥聚合到统一的 OpenAI 兼容端点，一次获取网关 Token 即可调用多个模型。

## 1. Get a token / 获取 Token

Register an account at ${base}/auth, then open your dashboard and generate a gateway token (\`sk-<64 hex>\`). The token is shown exactly once and cannot be recovered; keep it safe.

## 2. Endpoint / 调用地址

Base URL: \`${base}/v1\`

Any OpenAI-compatible client can point its base_url here:

\`\`\`bash
curl ${base}/v1/chat/completions \\
  -H "Authorization: Bearer sk-your-gateway-token" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}]}'
\`\`\`

\`\`\`python
from openai import OpenAI
client = OpenAI(base_url="${base}/v1", api_key="sk-your-gateway-token")
resp = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "hello"}],
)
print(resp.choices[0].message.content)
\`\`\`

\`\`\`js
const resp = await fetch("${base}/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: "Bearer sk-your-gateway-token",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: "hello" }],
  }),
});
const data = await resp.json();
console.log(data.choices[0].message.content);
\`\`\`

## 3. Errors / 错误码

- \`401\` — invalid or reset token; regenerate one from the dashboard.
- \`429\` — daily quota exceeded; resets automatically at 00:00 UTC.
- \`502 upstream_failed\` — no healthy channel currently supports the requested model; try later or contribute a channel.
- \`503\` — global budget protection is active; dynamic services resume at 00:00 UTC.

## 4. Quotas & reliability / 配额与可靠性

- Daily call and token quotas are tiered by reputation and never zeroed (lowest tier: 3 calls/day).
- New users (first 7 days) receive halved quotas.
- Contributors who submit a working channel key earn a daily +10 ~ +100 call bonus.
- Requests fail over automatically and unhealthy channels are circuit-broken.

## 5. Contribution / 贡献渠道

Free API key holders can submit their keys at ${base}/submit. Keys are encrypted with AES-256-GCM and used only for proxying; deletion removes the channel immediately. Sharing keys may violate upstream vendors' terms — contributors act on their own responsibility.

Full terms: ${base}/en/terms
`;
}

ROUTER.get("/robots.txt", (c) => {
  const base = canonicalBase(c);
  return c.text(robotsTxt(base), 200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": CACHE });
});

ROUTER.get("/sitemap.xml", (c) => {
  const base = canonicalBase(c);
  return c.text(sitemapXml(base), 200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": CACHE });
});

ROUTER.get("/llms.txt", (c) => {
  const base = canonicalBase(c);
  return c.text(llmsTxt(base), 200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": CACHE });
});

ROUTER.get("/llms.md", (c) => {
  const base = canonicalBase(c);
  return c.text(llmsMd(base), 200, { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": CACHE });
});

export default ROUTER;