import type { DBUser } from "../db/schema";
import type { Env } from "../types";
import type { Lang } from "../i18n";
import { t } from "../i18n";
import { html } from "hono/html";
import { AdSenseHead } from "./ads";
import { OG_LOCALE, siteJsonLd, type Seo } from "../utils/seo";

const ASSETS = html`
<script src="https://unpkg.com/htmx.org@1.9.12"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#070a0d;
  --bg-2:#0a0f14;
  --panel:#0f151d;
  --panel-2:#0b1117;
  --line:#1c2836;
  --line-soft:rgba(140,180,215,.10);
  --amber:#ffc857;
  --amber-d:#b8860b;
  --cyan:#39e6c9;
  --green:#3ddc97;
  --red:#f87171;
  --orange:#fbbf24;
  --text:#e9eef4;
  --muted:#8ea0b4;
  --dim:#5a6b7e;
  --mono:'JetBrains Mono',ui-monospace,monospace;
  --sans:'IBM Plex Sans',system-ui,sans-serif;
  --disp:'Chakra Petch','IBM Plex Sans',sans-serif;
  --radius:14px;
  --shadow:0 20px 50px -20px rgba(0,0,0,.7);
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  background:var(--bg);
  color:var(--text);
  font-family:var(--sans);
  font-size:15px;
  line-height:1.6;
  min-height:100vh;
  -webkit-font-smoothing:antialiased;
}
/* 全局氛围：底部光晕 + 噪点 */
body::before{
  content:"";position:fixed;inset:0;z-index:-2;pointer-events:none;
  background:
    radial-gradient(900px 480px at 12% -10%, rgba(57,230,201,.07), transparent 60%),
    radial-gradient(800px 500px at 95% 110%, rgba(255,200,87,.06), transparent 60%),
    var(--bg);
}
body::after{
  content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;opacity:.05;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E");
}
a{color:inherit;text-decoration:none}
::selection{background:rgba(255,200,87,.28)}
:focus-visible{outline:2px solid var(--amber);outline-offset:2px;border-radius:4px}
.wrap{max-width:1080px;margin:0 auto;padding:0 20px}

/* ---------- 顶部导航 ---------- */
.topnav{
  position:sticky;top:0;z-index:50;
  background:rgba(7,10,13,.78);
  backdrop-filter:blur(12px);
  -webkit-backdrop-filter:blur(12px);
  border-bottom:1px solid var(--line);
  box-shadow:0 1px 0 rgba(57,230,201,.06);
}
.topnav::after{
  content:"";display:block;height:1px;
  background:linear-gradient(90deg,transparent,rgba(255,200,87,.4),rgba(57,230,201,.4),transparent);
}
.topnav-inner{display:flex;align-items:center;justify-content:space-between;height:58px}
.brand{
  display:flex;align-items:center;gap:10px;
  font-family:var(--disp);font-weight:700;font-size:19px;letter-spacing:.5px;
}
.brand-mark{
  color:var(--amber);
  transform:rotate(-45deg);
  font-size:16px;
  text-shadow:0 0 14px rgba(255,200,87,.7);
}
.brand em{font-style:normal;color:var(--amber)}
.nav-links{display:flex;align-items:center;gap:22px;font-size:14px}
.nav-links a{color:var(--muted);transition:color .15s}
.nav-links a:hover{color:var(--text)}
.nav-links a.active{color:var(--amber)}
.nav-links a.active::after{content:"";display:block;height:2px;background:var(--amber);border-radius:2px;margin-top:2px}
.btn-login{
  border:1px solid var(--line);border-radius:8px;padding:6px 14px;color:var(--text);
  transition:border-color .15s,color .15s;
}
.btn-login:hover{border-color:var(--amber);color:var(--amber)}

/* ---------- 按钮 ---------- */
.btn{
  display:inline-flex;align-items:center;justify-content:center;gap:8px;
  border-radius:10px;border:1px solid transparent;cursor:pointer;
  font-family:var(--sans);font-size:14px;font-weight:600;line-height:1;
  padding:12px 22px;transition:transform .12s,box-shadow .15s,background .15s,border-color .15s,color .15s;
}
.btn-primary{
  background:linear-gradient(180deg,#ffd26b,#f5a623);
  color:#231a04;
  box-shadow:0 8px 24px -8px rgba(255,200,87,.5);
}
.btn-primary:hover{transform:translateY(-1px);box-shadow:0 12px 30px -8px rgba(255,200,87,.6)}
.btn-primary:active{transform:translateY(0)}
.btn-ghost{
  border-color:var(--line);color:var(--text);background:transparent;
}
.btn-ghost:hover{border-color:var(--amber);color:var(--amber);transform:translateY(-1px)}
.btn-danger{border-color:rgba(248,113,113,.4);color:var(--red);background:transparent}
.btn-danger:hover{border-color:var(--red);background:rgba(248,113,113,.08)}
.btn-ok{border-color:rgba(61,220,151,.35);color:var(--green);background:transparent}
.btn-ok:hover{border-color:var(--green);background:rgba(61,220,151,.08)}
.btn-sm{padding:7px 13px;font-size:12.5px;border-radius:8px}
.btn-block{width:100%}

/* ---------- 卡片 / 面板 ---------- */
.card{
  position:relative;
  background:linear-gradient(180deg,var(--panel),var(--panel-2));
  border:1px solid var(--line);
  border-radius:var(--radius);
  box-shadow:var(--shadow);
  overflow:hidden;
}
.card::before{
  content:"";position:absolute;left:0;top:0;bottom:0;width:3px;
  background:linear-gradient(180deg,var(--amber),transparent);
  opacity:.55;
}
.card.pad{padding:24px}
.panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}
.panel-title{font-family:var(--disp);font-weight:600;font-size:17px;letter-spacing:.3px;margin:0}
.panel-sub{font-size:12.5px;color:var(--dim)}

/* ---------- 状态点 / 徽章 ---------- */
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;flex:none}
.dot-ok{background:var(--green);box-shadow:0 0 0 0 rgba(61,220,151,.5);animation:pulse 2.4s infinite}
.dot-warn{background:var(--orange)}
.dot-bad{background:var(--red)}
@keyframes pulse{
  0%{box-shadow:0 0 0 0 rgba(61,220,151,.45)}
  70%{box-shadow:0 0 0 7px rgba(61,220,151,0)}
  100%{box-shadow:0 0 0 0 rgba(61,220,151,0)}
}
.badge{
  display:inline-block;font-size:11px;font-family:var(--mono);letter-spacing:.4px;
  border-radius:6px;padding:2px 8px;white-space:nowrap;
}
.badge-ok{background:rgba(61,220,151,.12);color:var(--green);border:1px solid rgba(61,220,151,.28)}
.badge-warn{background:rgba(255,200,87,.1);color:var(--amber);border:1px solid rgba(255,200,87,.3)}
.badge-bad{background:rgba(248,113,113,.1);color:var(--red);border:1px solid rgba(248,113,113,.3)}
.badge-muted{background:rgba(142,160,180,.08);color:var(--muted);border:1px solid var(--line)}

/* ---------- 输入 ---------- */
.field{display:block}
.field>label{display:block;font-size:13px;color:var(--muted);margin-bottom:7px}
.input{
  width:100%;padding:11px 14px;border-radius:10px;
  background:var(--bg-2);border:1px solid var(--line);color:var(--text);
  font-family:var(--sans);font-size:14px;transition:border-color .15s,box-shadow .15s;
}
.input::placeholder{color:var(--dim)}
.input:focus{outline:none;border-color:var(--amber);box-shadow:0 0 0 3px rgba(255,200,87,.12)}
.check-card{
  display:flex;align-items:flex-start;gap:12px;
  background:var(--bg-2);border:1px solid var(--line);border-radius:10px;padding:13px 14px;
  cursor:pointer;transition:border-color .15s;
}
.check-card:hover{border-color:rgba(255,200,87,.4)}
.check-card input{margin-top:4px;accent-color:var(--amber)}
.check-card input:focus-visible{outline:2px solid var(--amber);outline-offset:2px}

/* ---------- Flash ---------- */
.flash{
  display:flex;gap:10px;align-items:flex-start;
  border-radius:10px;padding:13px 16px;font-size:14px;margin-bottom:18px;
  border:1px solid;word-break:break-all;
}
.flash-ok{border-color:rgba(61,220,151,.35);background:rgba(61,220,151,.08);color:var(--green)}
.flash-err{border-color:rgba(248,113,113,.35);background:rgba(248,113,113,.08);color:var(--red)}

/* ---------- 行 / 列表 ---------- */
.row{
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:16px 4px;border-bottom:1px solid var(--line-soft);
}
.row:last-child{border-bottom:none}
.row-main{min-width:0}
.row-title{display:flex;align-items:center;gap:9px;font-weight:600}
.row-sub{font-size:12.5px;color:var(--dim);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--mono)}
.row-err{font-size:12.5px;color:var(--red);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row-actions{display:flex;gap:8px;flex:none;flex-wrap:wrap;justify-content:flex-end}

/* ---------- 统计 ---------- */
.stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.stat{
  background:var(--bg-2);border:1px solid var(--line);border-radius:12px;padding:16px 18px;
  position:relative;overflow:hidden;
}
.stat::after{
  content:"";position:absolute;right:-18px;top:-18px;width:70px;height:70px;border-radius:50%;
  background:radial-gradient(circle,rgba(255,200,87,.09),transparent 70%);
}
.stat-label{font-size:12px;color:var(--dim);letter-spacing:.4px}
.stat-num{font-family:var(--mono);font-weight:700;font-size:22px;margin-top:5px;color:var(--text);word-break:break-all}
.meter{height:5px;border-radius:4px;background:#1a2430;margin-top:11px;overflow:hidden}
.meter-fill{height:100%;border-radius:4px;background:linear-gradient(90deg,var(--cyan),var(--green))}
.stat.warn .meter-fill{background:linear-gradient(90deg,var(--orange),var(--amber))}

/* ---------- 代码块 ---------- */
.codeblock{
  border-radius:12px;background:#0a1014;border:1px solid var(--line);
  overflow-x:auto;font-family:var(--mono);font-size:12.5px;line-height:1.7;
  position:relative;
}
.codeblock .cb-head{
  display:flex;align-items:center;gap:6px;padding:9px 14px;border-bottom:1px solid var(--line-soft);
  font-family:var(--mono);font-size:11px;color:var(--dim);letter-spacing:1px;text-transform:uppercase;
}
.codeblock .cb-head i{width:9px;height:9px;border-radius:50%;display:inline-block}
.codeblock pre{margin:0;padding:16px 18px;color:var(--cyan);white-space:pre}
.codeblock pre .k{color:var(--amber)}
.codeblock pre .m{color:var(--muted)}

/* ---------- Chip 模型标签 ---------- */
.chip{
  font-family:var(--mono);font-size:12px;color:var(--text);
  background:var(--bg-2);border:1px solid var(--line);border-radius:8px;
  padding:6px 11px;transition:border-color .15s,color .15s;
}
.chip:hover{border-color:var(--cyan);color:var(--cyan)}
.chip span{color:var(--dim)}

/* ---------- 首页 Hero ---------- */
.hero{position:relative;padding:64px 0 40px}
.hero-grid{
  position:absolute;inset:-40px 0 auto 0;height:420px;pointer-events:none;z-index:-1;
  background:
    linear-gradient(rgba(140,180,215,.045) 1px,transparent 1px),
    linear-gradient(90deg,rgba(140,180,215,.045) 1px,transparent 1px),
    radial-gradient(700px 300px at 70% 8%,rgba(57,230,201,.05),transparent 60%);
  background-size:42px 42px,42px 42px,100% 100%;
  -webkit-mask-image:linear-gradient(180deg,#000 35%,transparent);
  mask-image:linear-gradient(180deg,#000 35%,transparent);
}
.hero-tag{
  display:inline-flex;align-items:center;gap:9px;
  font-family:var(--mono);font-size:12px;letter-spacing:2px;color:var(--muted);
  border:1px solid var(--line);border-radius:999px;padding:7px 15px;margin-bottom:26px;
  background:rgba(10,15,20,.6);
}
.hero-tag b{color:var(--green);font-weight:600}
.hero h1{
  font-family:var(--disp);font-weight:700;font-size:clamp(34px,6vw,58px);
  line-height:1.08;letter-spacing:.5px;margin:0;
}
.hero h1 em{
  font-style:normal;
  background:linear-gradient(92deg,var(--amber) 10%,var(--cyan) 90%);
  -webkit-background-clip:text;background-clip:text;color:transparent;
}
.hero p{max-width:560px;color:var(--muted);margin:18px 0 0;font-size:16px}
.hero-cta{display:flex;flex-wrap:wrap;gap:12px;margin-top:30px}
.hero-meta{
  display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:24px;
  font-size:12.5px;color:var(--dim);font-family:var(--mono);letter-spacing:.3px;
}
.hero-meta span::before{content:"▪";color:var(--amber);margin-right:7px;font-size:9px;vertical-align:1px}

/* 加载入场 */
@keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.hero>*{animation:fadeUp .6s both}
.hero>*:nth-child(1){animation-delay:.05s}
.hero>*:nth-child(2){animation-delay:.14s}
.hero>*:nth-child(3){animation-delay:.22s}
.hero>*:nth-child(4){animation-delay:.3s}
.hero>*:nth-child(5){animation-delay:.38s}
.hero>*:nth-child(6){animation-delay:.46s}

/* ---------- 页面标题 ---------- */
.page-head{display:flex;align-items:baseline;gap:14px;margin:34px 0 24px}
.page-head h1{font-family:var(--disp);font-weight:700;font-size:28px;margin:0;letter-spacing:.4px}
.page-head .ph-sub{color:var(--dim);font-size:13.5px}

/* ---------- Token 展示 ---------- */
.token-box{
  display:flex;align-items:center;gap:12px;
  background:var(--bg-2);border:1px solid var(--line);border-radius:11px;padding:8px 8px 8px 16px;
}
.token-code{
  flex:1;min-width:0;font-family:var(--mono);font-size:15px;font-weight:600;color:var(--amber);
  overflow-x:auto;white-space:nowrap;text-shadow:0 0 16px rgba(255,200,87,.25);
}
.token-code.empty{color:var(--dim);font-weight:400}

/* ---------- 文档表格/列表 ---------- */
.doc-list{margin:0;padding-left:20px;color:var(--muted)}
.doc-list li{margin:7px 0}
.doc-list code,.doc-inline{font-family:var(--mono);font-size:12.5px;color:var(--amber);background:rgba(255,200,87,.08);border:1px solid rgba(255,200,87,.18);border-radius:5px;padding:1px 6px}
.doc-prose{color:var(--muted);font-size:14.5px}
.doc-prose p{margin:0 0 6px}
.doc-prose a{color:var(--amber)}

/* ---------- 页脚 ---------- */
.footer{
  border-top:1px solid var(--line);padding:26px 0 34px;margin-top:64px;
  text-align:center;font-size:12.5px;color:var(--dim);
}
.footer .foot-logo{font-family:var(--disp);font-weight:700;letter-spacing:1px;color:var(--muted);margin-bottom:6px}
.footer a{color:var(--muted);text-decoration:underline;text-underline-offset:3px}
.footer a:hover{color:var(--amber)}

/* ---------- 模型选择器 ---------- */
.model-picker{background:var(--bg-2);border:1px solid var(--line);border-radius:10px;padding:12px 14px;font-size:13.5px;min-height:54px}
.mp-hint{margin:0;color:var(--dim);font-size:12.5px}
.mp-warn{margin:0;color:var(--amber);font-size:12.5px}
.mp-err{margin:0;color:var(--red);font-size:12.5px}
.pick-chip{display:inline-flex;align-items:center;gap:7px;padding:6px 11px;background:var(--panel);border:1px solid var(--line);border-radius:8px;cursor:pointer;transition:border-color .15s}
.pick-chip:hover{border-color:var(--cyan)}
.pick-chip span{font-family:var(--mono);font-size:12px}
.pick-chip input{accent-color:var(--cyan);margin:0}

/* ---------- 空状态 ---------- */
.empty{
  border:1px dashed var(--line);border-radius:var(--radius);
  padding:34px;text-align:center;color:var(--muted);font-size:14px;
}
.empty a{color:var(--amber)}

@media (max-width:820px){
  .stat-grid{grid-template-columns:repeat(2,1fr)}
  .nav-links{gap:14px;font-size:13px}
  .brand{font-size:17px}
  [data-2col]{grid-template-columns:1fr!important}
}
@media (max-width:520px){
  .nav-links .hide-s{display:none}
  .hero{padding-top:40px}
}
@media (prefers-reduced-motion:reduce){
  *{animation:none!important;transition:none!important}
}
</style>
`;

/** 客户端一次性文案（JS 触发动作，如按钮态），页面加载时按 lang 替换 */
function ClientI18nMap(lang: Lang): Record<string, string> {
  const cp = t(lang, "dashboard", "codeblob_copied");
  return { __copied: cp };
}

export const I18N_MAP_ATTR = "data-i18n";

export function Layout(props: {
  title: string;
  user?: DBUser | null;
  children: any;
  active?: string;
  lang: Lang;
  env: Env;
  adsInFoot?: boolean;
  /** canonical/OG 基址（PUBLIC_BASE_URL 或请求 Host 推导），空则跳过 SEO 标签 */
  base?: string;
  /** 页面级 SEO 信息 */
  seo?: Seo;
}) {
  const { title, user, children, active, lang, env, adsInFoot, base, seo } = props;
  const L = (k: any) => t(lang, "layout", k);
  const client = ClientI18nMap(lang);
  const pagePath = seo?.path === "/" ? "" : seo?.path ?? "";
  const canonical = base && seo ? `${base}/${lang}${pagePath}` : null;
  const robots = seo?.noindex ? "noindex, nofollow" : "index, follow";
  const jsonLd = base ? [siteJsonLd(base, lang), ...(seo?.jsonLd ?? [])] : [];
  // 公开页同页切换语言；后台/登录页走 /lang?to=（写 cookie + 回跳当前页）
  const switchHref = seo?.noindex
    ? `/lang?to=${lang === "zh" ? "en" : "zh"}`
    : `/${lang === "zh" ? "en" : "zh"}${pagePath}`;
  return (
    <html lang={lang}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        {seo?.description ? <meta name="description" content={seo.description} /> : null}
        <meta name="robots" content={robots} />
        {canonical ? <link rel="canonical" href={canonical} /> : null}
        {base && seo ? (
          <>
            {(["en", "zh"] as Lang[]).map((l) => (
              <link key={l} rel="alternate" hreflang={l} href={`${base}/${l}${pagePath}`} />
            ))}
          </>
        ) : null}
        <meta property="og:site_name" content="FreeAI Gateway" />
        <meta property="og:type" content={seo?.ogType ?? "website"} />
        <meta property="og:title" content={title} />
        {seo?.description ? <meta property="og:description" content={seo.description} /> : null}
        {canonical ? <meta property="og:url" content={canonical} /> : null}
        <meta property="og:locale" content={OG_LOCALE[lang]} />
        <meta property="og:locale:alternate" content={OG_LOCALE[lang === "en" ? "zh" : "en"]} />
        <meta name="twitter:card" content="summary" />
        {jsonLd.length ? (
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        ) : null}
        <AdSenseHead env={env} />
        {ASSETS}
      </head>
      <body>
        <nav class="topnav">
          <div class="wrap topnav-inner">
            <a href={`/${lang}`} class="brand">
              <span class="brand-mark">◆</span>freeai<em>GW</em>
            </a>
            <div class="nav-links">
              <a href={`/${lang}/docs`} class={active === "docs" ? "active" : ""}>{L("nav_help")}</a>
              <a href={`/${lang}/terms`} class={active === "terms" ? "active" : ""}>{L("nav_terms")}</a>
              {user ? (
                <>
                  <a href="/dashboard" class={active === "dashboard" ? "active" : ""}>{L("nav_dashboard")}</a>
                  <a href="/submit" class={active === "submit" ? "active" : ""}>{L("nav_submit")}</a>
                  <form method="post" action="/auth/logout" class="inline" style="">
                    <button class="btn btn-ghost btn-sm">{L("nav_logout")}</button>
                  </form>
                </>
              ) : (
                <a href="/auth" class="btn-login">{L("nav_login")}</a>
              )}
              <a href={switchHref} class="btn btn-ghost btn-sm" title="Switch language">
                {L("switch_to")}
              </a>
            </div>
          </div>
        </nav>
        <main class="wrap">{children}</main>
        <footer class="footer">
          <div class="foot-logo">FREEAIGW</div>
          <div>
            {L("footer_text")
              .split("{terms}")
              .join("")
              .split("{docs}")
              .join("")}
            <a href={`/${lang}/terms`}>{L("footer_terms")}</a> · <a href={`/${lang}/docs`}>{L("footer_docs")}</a>
          </div>
          {adsInFoot ? <AdSenseFootnote lang={lang} /> : null}
        </footer>
        <script dangerouslySetInnerHTML={{ __html: `(function(){
var m = ${JSON.stringify(client)};
document.querySelectorAll('[${I18N_MAP_ATTR}]').forEach(function(el){
  var k = el.getAttribute('${I18N_MAP_ATTR}');
  if (m[k]) el.textContent = m[k];
});
})();` }} />
      </body>
    </html>
  );
}

function AdSenseFootnote(props: { lang: Lang }) {
  const { lang } = props;
  const text =
    lang === "zh"
      ? "本站展示广告以支持运营；广告由 Google AdSense 提供。"
      : "Ads shown support operations. Ads are served by Google AdSense.";
  return <div style="margin-top:10px;font-size:11px;opacity:.6">{text}</div>;
}

export function Flash(props: { msg: string; ok?: boolean }) {
  return (
    <div class={`flash ${props.ok ? "flash-ok" : "flash-err"}`}>
      <span class={`dot ${props.ok ? "dot-ok" : "dot-bad"}`}></span>
      <span>{props.msg}</span>
    </div>
  );
}