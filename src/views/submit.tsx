import type { DBChannel, DBUser } from "../db/schema";
import type { Env } from "../types";
import type { Lang } from "../i18n";
import { t } from "../i18n";
import { Layout, Flash } from "./layout";
import { AdSlot } from "./ads";
import { channelStatusCls, channelStatusText } from "./dashboard";
import type { Seo } from "../utils/seo";

export function SubmitPage(props: {
  user: DBUser;
  contributions: DBChannel[];
  flash?: string;
  flashOk?: boolean;
  lang: Lang;
  env: Env;
  base?: string;
  seo?: Seo;
}) {
  const { user, contributions, flash, flashOk, lang, env, base, seo } = props;
  return (
    <Layout title={t(lang, "submit", "title")} user={user} active="submit" lang={lang} env={env} base={base} seo={seo}>
      <div class="page-head">
        <h1>{t(lang, "submit", "title")}</h1>
        <span class="ph-sub">{t(lang, "submit", "sub")}</span>
      </div>

      {flash ? <Flash msg={flash} ok={flashOk} /> : null}

      <div data-2col style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start">
        <section class="card pad">
          <div class="panel-head">
            <h2 class="panel-title">{t(lang, "submit", "form_title")}</h2>
            <span class="panel-sub">{t(lang, "submit", "form_sub")}</span>
          </div>
          <form method="post" action="/api/channels">
            <div style="display:grid;gap:16px">
              <div class="field">
                <label>{t(lang, "submit", "label_provider")}</label>
                <input class="input" name="provider" placeholder={t(lang, "submit", "ph_provider")} required />
              </div>
              <div class="field">
                <label>{t(lang, "submit", "label_api_url")}</label>
                <input class="input" name="api_url" placeholder={t(lang, "submit", "ph_api_url")} required />
              </div>
              <div class="field">
                <label>{t(lang, "submit", "label_api_key")}</label>
                <div style="display:flex;gap:9px">
                  <input class="input" name="api_key" type="password" placeholder={t(lang, "submit", "ph_api_key")} required />
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm"
                    hx-post="/api/channels/fetch-models"
                    hx-include="previous input[name=api_url], previous input[name=api_key]"
                    hx-target="#model-picker"
                    hx-swap="innerHTML"
                  >
                    {t(lang, "submit", "btn_fetch")}
                  </button>
                </div>
              </div>
              <div class="field">
                <label>{t(lang, "submit", "label_models")}</label>
                <div id="model-picker" class="model-picker">
                  <p class="mp-hint">{t(lang, "submit", "mp_hint_fetch")}</p>
                </div>
                <input class="input" name="models" placeholder={t(lang, "submit", "ph_models")} style="margin-top:9px" />
              </div>
              <div class="field">
                <label>{t(lang, "submit", "label_weight")}</label>
                <input class="input" name="weight" type="number" step="0.1" min="0.1" max="5" defaultValue="1.0" />
              </div>

              <label class="check-card">
                <input type="checkbox" name="agree" required />
                <span style="font-size:13.5px;color:var(--muted)">
                  {t(lang, "submit", "agree", { terms: t(lang, "submit", "agree_terms") })}
                </span>
              </label>

              <button class="btn btn-primary btn-block" style="margin-top:2px">
                {t(lang, "submit", "btn_submit")}
              </button>
            </div>
          </form>
        </section>

        {contributions.length ? (
          <section class="card pad">
            <div class="panel-head">
              <h2 class="panel-title">{t(lang, "submit", "my_channels")}</h2>
              <span class="panel-sub">{t(lang, "dashboard", "contributions_sub", { n: contributions.length })}</span>
            </div>
            <ul style="list-style:none;margin:0;padding:0">
              {contributions.map((c) => (
                <ChannelRow c={c} key={c.id} lang={lang} />
              ))}
            </ul>
          </section>
        ) : (
          <section class="empty">
            {t(lang, "submit", "empty_contributions")}
          </section>
        )}
      </div>

      <AdSlot env={env} />
    </Layout>
  );
}

export function ChannelRow(props: { c: DBChannel; lang: Lang }) {
  const { c, lang } = props;
  return (
    <li class="row">
      <div class="row-main">
        <div class="row-title">
          <span class={`dot ${statusOk(c) ? "dot-ok" : "dot-bad"}`}></span>
          <span>{c.provider}</span>
          <span class={channelStatusCls(c)}>{channelStatusText(lang, c)}</span>
        </div>
        <div class="row-sub">{c.api_url}</div>
        {c.last_error && <div class="row-err">{c.last_error}</div>}
      </div>
      <div class="row-actions">
        {!c.is_valid && (
          <button
            class="btn btn-ok btn-sm"
            hx-post={`/api/channels/${c.id}/validate`}
            hx-target="closest li"
            hx-swap="outerHTML"
          >
            {t(lang, "dashboard", "btn_revalidate")}
          </button>
        )}
        {c.is_active === 0 && c.is_circuited === 1 && (
          <button
            class="btn btn-ok btn-sm"
            hx-post={`/api/channels/${c.id}/reactivate`}
            hx-target="closest li"
            hx-swap="outerHTML"
          >
            {t(lang, "dashboard", "btn_reactivate")}
          </button>
        )}
        <button
          class="btn btn-danger btn-sm"
          hx-post={`/api/channels/${c.id}/delete`}
          hx-target="closest li"
          hx-swap="outerHTML"
          hx-confirm={t(lang, "submit", "delete_confirm")}
        >
          {t(lang, "submit", "btn_delete")}
        </button>
      </div>
    </li>
  );
}

export function statusOk(c: DBChannel): boolean {
  return c.is_active === 1 && c.is_valid === 1 && c.is_circuited === 0;
}