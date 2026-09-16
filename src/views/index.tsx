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

/** 健康面板 htmx partial（/health 每 60s 刷新，含模型与示例） */
export function HealthPanel(props: { health: Health; lang: Lang }) {
  const { health, lang } = props;
  return (
    <div id="health-panel" class="mt-10" data-2col style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <div class="card pad">
        <div class="panel-head">
          <h2 class="panel-title">{t(lang, "home", "models_title")}</h2>
          <span class="panel-sub">{t(lang, "home", "models_hint")}</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:9px">
          {health.models.length ? (
            health.models.map((m) => (
              <span key={m.model} class="chip">
                {m.model} <span>×{m.count}</span>
              </span>
            ))
          ) : (
            <p style="margin:0;font-size:13.5px;color:var(--dim)">{t(lang, "home", "no_models")}</p>
          )}
        </div>
      </div>

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
          <pre dangerouslySetInnerHTML={{ __html: `curl <span class="k">https://your-worker.workers.dev</span>/v1/chat/completions \\\n  -H "<span class="k">Authorization</span>: Bearer sk-${t(lang, "home", "curl_token")}" \\\n  -H "<span class="k">Content-Type</span>: application/json" \\\n  -d '{"model":"<span class="m">gpt-4o-mini</span>","messages":[{"role":"user","content":"你好"}]}'` }}></pre>
        </div>
      </div>
    </div>
  );
}

export function IndexPage(props: { user?: DBUser | null; health: Health; lang: Lang; env: Env; base?: string; seo?: Seo }) {
  const { user, health, lang, env, base, seo } = props;
  return (
    <Layout title={t(lang, "home", "title")} user={user} active="home" lang={lang} env={env} base={base} seo={seo}>
      <section class="hero">
        <div class="hero-grid"></div>

        <div class="hero-tag">
          <span class="dot dot-ok"></span>
          GATEWAY ONLINE&nbsp;·&nbsp;POOL <b>{health.channels}</b> {t(lang, "home", "tag_pool")}
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

        <div id="health-panel" hx-get="/health" hx-trigger="load delay:300ms, every 60s" hx-swap="outerHTML">
          <HealthPanel health={health} lang={lang} />
        </div>

        {health.budget.state === "paused" ? (
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