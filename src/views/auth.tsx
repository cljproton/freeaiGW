import type { DBUser } from "../db/schema";
import type { Env } from "../types";
import type { Lang } from "../i18n";
import { t } from "../i18n";
import type { PowChallenge } from "../utils/pow";
import { Layout } from "./layout";
import { AdSlot } from "./ads";
import type { Seo } from "../utils/seo";

export function AuthPage(props: {
  user?: DBUser | null;
  pow: PowChallenge;
  gotTs: number;
  error?: string;
  mode?: "login" | "register";
  lang: Lang;
  env: Env;
  base?: string;
  seo?: Seo;
}) {
  const { user, pow, gotTs, error, mode, lang, env, base, seo } = props;
  return (
    <Layout title={t(lang, "auth", "title")} user={user} lang={lang} env={env} base={base} seo={seo}>
      <div data-2col style="display:grid;grid-template-columns:1fr 1fr;gap:28px;max-width:920px;margin:44px auto 0;align-items:stretch">
        <div class="card" style="padding:30px;display:flex;flex-direction:column">
          <div class="hero-tag" style="margin-bottom:22px">
            <span class="dot dot-ok"></span>{t(lang, "auth", "tag")}
          </div>
          <h2 style="font-family:var(--disp);font-weight:700;font-size:24px;letter-spacing:.4px;margin:0;line-height:1.25">
            {t(lang, "auth", "h2a")}
            <br />
            <em style="font-style:normal;color:var(--amber)">{t(lang, "auth", "h2b")}</em>
          </h2>
          <p style="color:var(--muted);font-size:14px;margin:16px 0 0">
            {t(lang, "auth", "p")}
            <span style="color:var(--green)">{t(lang, "auth", "no_ban")}</span>
          </p>
          <ul class="doc-list" style="margin-top:auto;padding-top:28px">
            <li>{t(lang, "auth", "li1")}</li>
            <li>{t(lang, "auth", "li2")}</li>
            <li>{t(lang, "auth", "li3")}</li>
          </ul>
        </div>

        <div class="card pad" style="padding:28px">
          <div class="panel-title" style="font-size:19px">{t(lang, "auth", "form_title")}</div>

          {error ? (
            <div class="flash flash-err" style="margin-top:16px">
              <span class="dot dot-bad"></span><span>{error}</span>
            </div>
          ) : null}

          <div style="display:flex;border:1px solid var(--line);border-radius:10px;overflow:hidden;margin:18px 0 20px;font-size:14px">
            <a href="/auth?mode=login" class={mode !== "register" ? "seg-active" : "seg-idle"}
              style={`flex:1;text-align:center;padding:9px 0;${mode !== "register" ? "background:var(--bg-2);color:var(--amber)" : "color:var(--muted)"}`}>
              {t(lang, "auth", "tab_login")}
            </a>
            <a href="/auth?mode=register" class={mode === "register" ? "seg-active" : "seg-idle"}
              style={`flex:1;text-align:center;padding:9px 0;${mode === "register" ? "background:var(--bg-2);color:var(--amber)" : "color:var(--muted)"}`}>
              {t(lang, "auth", "tab_register")}
            </a>
          </div>
          <style dangerouslySetInnerHTML={{ __html: `.seg-active,.seg-idle{transition:background .15s,color .15s}.seg-idle:hover{background:rgba(255,200,87,.06)}` }}></style>

          <form id="auth-form" method="post" action={mode === "register" ? "/auth/register" : "/auth/login"} style="display:grid;gap:16px">
            {/* 蜜罐：CSS 移出可视区，自动填充的机器人才会填写 */}
            <div style="position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden" aria-hidden="true">
              <label>{t(lang, "auth", "honeypot_label")}<input type="input" name="website" tabIndex={-1} autoComplete="off" /></label>
            </div>
            <input type="hidden" name="pow_id" id="pow_id" value={pow.id} />
            <input type="hidden" name="pow_salt" id="pow_salt" value={pow.salt} />
            <input type="hidden" name="pow_d" id="pow_d" value={pow.difficulty} />
            <input type="hidden" name="pow_n" id="pow_n" value="" />
            <input type="hidden" name="got_ts" value={gotTs} />

            <div class="field">
              <label>{t(lang, "auth", "label_username")}</label>
              <input class="input" name="username" required minLength={3} maxLength={20}
                placeholder={t(lang, "auth", "ph_username")} autocomplete="username" />
            </div>
            <div class="field">
              <label>{t(lang, "auth", "label_password")}</label>
              <input class="input" name="password" type="password" required minLength={8}
                placeholder={t(lang, "auth", "ph_password")} autocomplete="current-password" />
            </div>

            <button type="submit" class="btn btn-primary btn-block" id="auth-submit">
              {mode === "register" ? t(lang, "auth", "btn_submit_register") : t(lang, "auth", "btn_submit_login")}
            </button>
            <p style="margin:-2px 0 0;font-size:12px;color:var(--dim);text-align:center">
              {t(lang, "auth", "pow_note")}
            </p>
            <script dangerouslySetInnerHTML={{ __html: `
window.POW_STR = ${JSON.stringify({ busy: t(lang, "auth", "pow_busy"), fail: t(lang, "auth", "pow_fail") })};
window.__powReady = true;
(function () {
  var form = document.getElementById('auth-form');
  if (!form) return;
  var btn = form.querySelector('button[type=submit]');
  var nInput = form.querySelector('#pow_n');
  var salt = form.querySelector('#pow_salt').value;
  var d = parseInt(form.querySelector('#pow_d').value, 10) || 5;
  var enc = new TextEncoder();
  if (!window.crypto || !window.crypto.subtle) return;
  function leadingZeros(hex) {
    var z = 0;
    for (var i = 0; i < hex.length; i++) { if (hex[i] === '0') z++; else break; }
    return z;
  }
  var done = false;
  form.addEventListener('submit', async function (ev) {
    if (done && nInput.value) return;
    ev.preventDefault();
    var S = window.POW_STR || { busy: '…', fail: '' };
    var origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = S.busy;
    try {
      for (var n = 1; n <= 16000000; n++) {
        var buf = await crypto.subtle.digest('SHA-256', enc.encode(salt + ':' + n.toString(16)));
        var arr = new Uint8Array(buf);
        var h = '';
        for (var i = 0; i < arr.length; i++) h += (arr[i] < 16 ? '0' : '') + arr[i].toString(16);
        if (leadingZeros(h) >= d) {
          nInput.value = n.toString(16);
          done = true;
          form.submit();
          return;
        }
      }
      throw new Error('pow limit');
    } catch (err) {
      btn.disabled = false;
      btn.textContent = origText;
      console.error('[pow]', err);
      alert(S.fail);
    }
  });
})();
` }}></script>
          </form>

          <div style="margin-top:18px;font-size:12.5px;color:var(--dim);line-height:1.7">
            <p style="margin:0">{t(lang, "auth", "foot1")}</p>
            <p style="margin:6px 0 0">{t(lang, "auth", "foot2")}</p>
          </div>
        </div>
      </div>

      <AdSlot env={env} />
    </Layout>
  );
}