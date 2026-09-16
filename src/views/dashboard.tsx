import type { DBChannel, DBUser } from "../db/schema";
import type { Env } from "../types";
import type { Lang } from "../i18n";
import { t } from "../i18n";
import { Layout, Flash } from "./layout";
import type { Seo } from "../utils/seo";

export interface UsageInfo {
  calls: number;
  tokens: number;
  limit: number;
  tokensLimit: number;
  tier: number;
  tierBonus: number;
  isNew: boolean;
  reputation: number;
}

/** 渠道状态文案（dashboard / submit 共用） */
export function channelStatusText(lang: Lang, c: DBChannel): string {
  if (c.is_circuited === 1) return t(lang, "dashboard", "status_circuited");
  if (!c.is_valid) return t(lang, "dashboard", "status_invalid");
  if (c.is_active === 0) return t(lang, "dashboard", "status_inactive");
  return t(lang, "dashboard", "status_pooled", { pct: Math.round(c.success_rate * 100) });
}

export function channelStatusCls(c: DBChannel): string {
  if (c.is_circuited === 1) return "badge badge-warn";
  if (!c.is_valid) return "badge badge-bad";
  if (c.is_active === 0) return "badge badge-muted";
  return "badge badge-ok";
}

export function ChannelStatusBadge(props: { c: DBChannel; lang: Lang }) {
  return <span class={channelStatusCls(props.c)}>{channelStatusText(props.lang, props.c)}</span>;
}

/** /api/tokens/reset 返回的 token-box partial（含 htmx 内联动作） */
export function TokenBoxPartial(props: { plain: string; lang: Lang }) {
  const { plain, lang } = props;
  const copied = t(lang, "dashboard", "codeblob_copied");
  return (
    <div id="token-box" class="token-box">
      <span class="token-code">{plain}</span>
      <button
        class="btn btn-ok btn-sm"
        onclick={`navigator.clipboard.writeText(this.previousElementSibling.textContent).then(()=>{this.textContent=${JSON.stringify(
          copied,
        )}}).catch(()=>{})`}
      >
        {t(lang, "dashboard", "codeblob_copied")}
      </button>
    </div>
  );
}

export function DashboardPage(props: {
  user: DBUser;
  usage: UsageInfo;
  contributions: DBChannel[];
  tokenPrefix?: string | null;
  flash?: string;
  lang: Lang;
  env: Env;
  base?: string;
  seo?: Seo;
}) {
  const { user, usage, contributions, tokenPrefix, flash, lang, env, base, seo } = props;
  const callPct = usage.limit > 0 ? Math.min(100, Math.round((usage.calls / usage.limit) * 100)) : 0;
  const tokPct = usage.tokensLimit > 0 ? Math.min(100, Math.round((usage.tokens / usage.tokensLimit) * 100)) : 0;
  const repCls =
    usage.reputation >= 80 ? "badge badge-ok" : usage.reputation >= 60 ? "badge badge-warn" : "badge badge-bad";
  const repText =
    usage.reputation >= 80
      ? t(lang, "dashboard", "rep_excellent")
      : usage.reputation >= 60
        ? t(lang, "dashboard", "rep_good")
        : usage.reputation >= 30
          ? t(lang, "dashboard", "rep_attention")
          : t(lang, "dashboard", "rep_low");
  return (
    <Layout title={t(lang, "dashboard", "title")} user={user} active="dashboard" lang={lang} env={env} base={base} seo={seo}>
      <div class="page-head">
        <h1>{t(lang, "dashboard", "title")}</h1>
        <span class="ph-sub">{t(lang, "dashboard", "sub", { user: user.username })}</span>
      </div>

      {flash ? <Flash msg={flash} ok /> : null}

      {usage.reputation < 60 ? <Flash msg={t(lang, "dashboard", "rep_low_flash")} /> : null}

      <section class="card pad">
        <div class="panel-head">
          <h2 class="panel-title">{t(lang, "dashboard", "token_title")}</h2>
          <span class="panel-sub">{t(lang, "dashboard", "token_sub")}</span>
        </div>
        <div id="token-box" class="token-box">
          <span class="token-code empty">{tokenPrefix ? `${tokenPrefix}…` : t(lang, "dashboard", "token_empty")}</span>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:14px">
          <button
            class="btn btn-primary btn-sm"
            hx-post="/api/tokens/reset"
            hx-target="#token-box"
            hx-swap="outerHTML"
            hx-confirm={t(lang, "dashboard", "token_confirm")}
          >
            {t(lang, "dashboard", "token_reset")}
          </button>
        </div>
        <p style="margin:12px 0 0;font-size:12.5px;color:var(--dim)">
          {t(lang, "dashboard", "token_note")}
        </p>
      </section>

      <section class="card pad" style="margin-top:22px">
        <div class="panel-head">
          <h2 class="panel-title">{t(lang, "dashboard", "usage_title")}</h2>
          <span class="panel-sub">
            {usage.isNew ? t(lang, "dashboard", "usage_sub_new") : ""}{t(lang, "dashboard", "usage_sub_reset")}
          </span>
        </div>
        <div class="stat-grid">
          <div class={`stat ${callPct >= 80 ? "warn" : ""}`}>
            <div class="stat-label">{t(lang, "dashboard", "stat_calls")}</div>
            <div class="stat-num">{usage.calls} / {usage.limit}</div>
            <div class="meter"><div class="meter-fill" style={`width:${callPct}%`}></div></div>
          </div>
          <div class={`stat ${tokPct >= 80 ? "warn" : ""}`}>
            <div class="stat-label">{t(lang, "dashboard", "stat_tokens")}</div>
            <div class="stat-num">{usage.tokens.toLocaleString()} / {usage.tokensLimit.toLocaleString()}</div>
            <div class="meter"><div class="meter-fill" style={`width:${tokPct}%`}></div></div>
          </div>
          <div class="stat">
            <div class="stat-label">{t(lang, "dashboard", "stat_bonus")}</div>
            <div class="stat-num">{usage.tier ? `+${usage.tierBonus}` : t(lang, "dashboard", "bonus_none")}</div>
            <div style="margin-top:11px">
              {usage.tier ? (
                <span class="badge badge-ok">{t(lang, "dashboard", "badge_tier", { tier: usage.tier })}</span>
              ) : (
                <span class="badge badge-muted">{t(lang, "dashboard", "badge_none")}</span>
              )}
            </div>
          </div>
          <div class="stat">
            <div class="stat-label">{t(lang, "dashboard", "stat_rep")}</div>
            <div class="stat-num">{usage.reputation}</div>
            <div style="margin-top:11px"><span class={repCls}>{repText}</span></div>
          </div>
        </div>
        <p style="margin:14px 0 0;font-size:12.5px;color:var(--dim)">
          {t(lang, "dashboard", "bonus_note")}
        </p>
      </section>

      {contributions.length ? (
        <section class="card pad" style="margin-top:22px">
          <div class="panel-head">
            <h2 class="panel-title">{t(lang, "dashboard", "contributions_title")}</h2>
            <span class="panel-sub">{t(lang, "dashboard", "contributions_sub", { n: contributions.length })}</span>
          </div>
          <ul style="list-style:none;margin:0;padding:0">
            {contributions.map((c) => (
              <li key={c.id} class="row">
                <div class="row-main">
                  <div class="row-title">
                    <span class={`dot ${c.is_active && c.is_valid && !c.is_circuited ? "dot-ok" : "dot-bad"}`}></span>
                    <span>{c.provider}</span>
                    {c.key_hint ? <CodeBadge text={`${c.key_hint}…`} /> : null}
                    <ChannelStatusBadge c={c} lang={lang} />
                  </div>
                  <div class="row-sub">{c.api_url}</div>
                  {c.last_error ? <div class="row-err">{c.last_error}</div> : null}
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
                  {c.is_active === 0 && (
                    <button
                      class="btn btn-ok btn-sm"
                      hx-post={`/api/channels/${c.id}/reactivate`}
                      hx-target="closest li"
                      hx-swap="outerHTML"
                    >
                      {t(lang, "dashboard", "btn_reactivate")}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section class="empty" style="margin-top:22px">
          {t(lang, "dashboard", "contributions_empty", { bonus: "+10 ~ +100" })}{" "}
          <a href="/submit"><b>{t(lang, "dashboard", "contributions_cta")}</b></a>
        </section>
      )}
    </Layout>
  );
}

function CodeBadge(props: { text: string }) {
  return <span class="badge badge-muted">{props.text}</span>;
}