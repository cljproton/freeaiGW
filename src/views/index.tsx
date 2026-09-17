import type { DBUser } from "../db/schema";
import type { Env } from "../types";
import type { Lang } from "../i18n";
import { t } from "../i18n";
import { Layout } from "./layout";
import { AdSlot } from "./ads";
import type { Seo } from "../utils/seo";

export interface Health {
  models: { model: string; count: number }[];
  channels: number;
  budget: { state: string; at?: string | null };
}

/** 资源池统计面板 htmx partial（/health 每 60s 刷新；仅登录后的 dashboard 可见） */
export function HealthPanel(props: { health: Health; lang: Lang }) {
  const { health, lang } = props;
  return (
    <div id="health-panel">
      <div class="card pad">
        <div class="panel-head">
          <h2 class="panel-title">{t(lang, "dashboard", "pool_title")}</h2>
          <span class="panel-sub">
            {t(lang, "dashboard", "pool_hint")} · <b style="color:var(--green)">{health.channels}</b>{" "}
            {t(lang, "dashboard", "pool_channels", { n: health.channels })}
          </span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:9px">
          {health.models.length ? (
            health.models.map((m) => (
              <span key={m.model} class="chip">
                {m.model} <span>×{m.count}</span>
              </span>
            ))
          ) : (
            <p style="margin:0;font-size:13.5px;color:var(--dim)">{t(lang, "dashboard", "pool_empty")}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** 首页接入示例（公开，独立于登录面板） */
export function QuickStartCard(props: { lang: Lang; base?: string }) {
  const { base, lang } = props;
  const exampleBase = base ?? "https://your-worker.workers.dev";
  return (
    <div class="card pad">
      <div class="panel-head">
        <h2 class="panel-title">{t(lang, "home", "example_title")}</h2>
        <span class="panel-sub">{t(lang, "home", "example_hint")}</span>
      </div>
      <div class="codeblock">
        <div class="cb-head">
          <i style="background:#f87171"></i><i style="background:#ffc857"></i><i style="background:#3ddc97"></i>
          <span style="margin-left:6px">curl</span>
        </div>
        <pre dangerouslySetInnerHTML={{ __html: `curl <span class="k">${exampleBase}</span>/v1/chat/completions \\\n  -H "<span class="k">Authorization</span>: Bearer sk-${t(lang, "home", "curl_token")}" \\\n  -H "<span class="k">Content-Type</span>: application/json" \\\n  -d '{"model":"<span class="m">gpt-4o-mini</span>","messages":[{"role":"user","content":"你好"}]}'` }}></pre>
      </div>
    </div>
  );
}

export function IndexPage(props: { user?: DBUser | null; paused: boolean; lang: Lang; env: Env; base?: string; seo?: Seo }) {
  const { user, paused, lang, env, base, seo } = props;
  return (
    <Layout title={t(lang, "home", "title")} user={user} active="home" lang={lang} env={env} base={base} seo={seo}>
      <section class="hero">
        <div class="hero-grid"></div>

        <div class="hero-tag">
          <span class="dot dot-ok"></span>
          {t(lang, "home", "tag_online")}
        </div>

        <h1>
          {t(lang, "home", "h1a")}
          <br />
          <em>{t(lang, "home", "h1b")}</em>
        </h1>

        <p>{t(lang, "home", "p", { sk: "sk-" })}</p>

        <div class="hero-cta">
          <a href="/auth" class="btn btn-primary">{t(lang, "home", "cta_start")}</a>
          <a href="/docs" class="btn btn-ghost">{t(lang, "home", "cta_docs")}</a>
        </div>

        <div class="hero-meta">
          <span>{t(lang, "home", "meta1")}</span>
          <span>{t(lang, "home", "meta2")}</span>
          <span>{t(lang, "home", "meta3")}</span>
          <span>{t(lang, "home", "meta4")}</span>
        </div>

        <div data-2col style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:40px">
          <QuickStartCard lang={lang} base={base} />
        </div>

        {paused ? (
          <div class="flash flash-err" style="margin-top:18px">
            <span class="dot dot-bad"></span>
            <span>{t(lang, "home", "paused")}</span>
          </div>
        ) : null}
      </section>

      <AdSlot env={env} />
    </Layout>
  );
}