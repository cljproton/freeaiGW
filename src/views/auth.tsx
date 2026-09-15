import type { DBUser } from "../db/schema";
import type { PowChallenge } from "../utils/pow";
import { Layout } from "./layout";

export function AuthPage(props: {
  user?: DBUser | null;
  pow: PowChallenge;
  gotTs: number;
  error?: string;
  mode?: "login" | "register";
}) {
  const { user, pow, gotTs, error, mode } = props;
  return (
    <Layout title="登录 / 注册" user={user}>
      <div data-2col style="display:grid;grid-template-columns:1fr 1fr;gap:28px;max-width:920px;margin:44px auto 0;align-items:stretch">
        <div class="card" style="padding:30px;display:flex;flex-direction:column">
          <div class="hero-tag" style="margin-bottom:22px">
            <span class="dot dot-ok"></span>ANONYMOUS · NO-EMAIL
          </div>
          <h2 style="font-family:var(--disp);font-weight:700;font-size:24px;letter-spacing:.4px;margin:0;line-height:1.25">
            无邮箱注册，
            <br />
            <em style="font-style:normal;color:var(--amber)">一个账号双向身份。</em>
          </h2>
          <p style="color:var(--muted);font-size:14px;margin:16px 0 0">
            同一账号既是使用者也是贡献者：提交渠道赚取每日加成，透明信誉分守护公平，
            <span style="color:var(--green)">永不封禁</span>。
          </p>
          <ul class="doc-list" style="margin-top:auto;padding-top:28px">
            <li>密码与 Token 仅存哈希，管理员亦无法找回</li>
            <li>新用户 7 天配额减半 · 最低 3 次/天永不归零</li>
            <li>贡献 +10 ~ +100 次/天加成，按信誉分级</li>
          </ul>
        </div>

        <div class="card pad" style="padding:28px">
          <div class="panel-title" style="font-size:19px">登录 / 注册</div>

          {error ? (
            <div class="flash flash-err" style="margin-top:16px">
              <span class="dot dot-bad"></span><span>{error}</span>
            </div>
          ) : null}

          <div style="display:flex;border:1px solid var(--line);border-radius:10px;overflow:hidden;margin:18px 0 20px;font-size:14px">
            <a href="/auth?mode=login" class={mode !== "register" ? "seg-active" : "seg-idle"}
              style={`flex:1;text-align:center;padding:9px 0;${mode !== "register" ? "background:var(--bg-2);color:var(--amber)" : "color:var(--muted)"}`}>
              登录
            </a>
            <a href="/auth?mode=register" class={mode === "register" ? "seg-active" : "seg-idle"}
              style={`flex:1;text-align:center;padding:9px 0;${mode === "register" ? "background:var(--bg-2);color:var(--amber)" : "color:var(--muted)"}`}>
              注册
            </a>
          </div>
          <style dangerouslySetInnerHTML={{ __html: `.seg-active,.seg-idle{transition:background .15s,color .15s}.seg-idle:hover{background:rgba(255,200,87,.06)}` }}></style>

          <form id="auth-form" method="post" action={mode === "register" ? "/auth/register" : "/auth/login"} style="display:grid;gap:16px">
            {/* 蜜罐：CSS 移出可视区，自动填充的机器人才会填写 */}
            <div style="position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden" aria-hidden="true">
              <label>网站（选填）<input type="input" name="website" tabIndex={-1} autoComplete="off" /></label>
            </div>
            <input type="hidden" name="pow_id" id="pow_id" value={pow.id} />
            <input type="hidden" name="pow_salt" id="pow_salt" value={pow.salt} />
            <input type="hidden" name="pow_d" id="pow_d" value={pow.difficulty} />
            <input type="hidden" name="pow_n" id="pow_n" value="" />
            <input type="hidden" name="got_ts" value={gotTs} />

            <div class="field">
              <label>用户名</label>
              <input class="input" name="username" required minLength={3} maxLength={20}
                placeholder="3-20 位字母、数字或下划线" autocomplete="username" />
            </div>
            <div class="field">
              <label>密码</label>
              <input class="input" name="password" type="password" required minLength={8}
                placeholder="至少 8 位" autocomplete="current-password" />
            </div>

            <button type="submit" class="btn btn-primary btn-block" id="auth-submit">
              {mode === "register" ? "注册并开始使用" : "登录"}
            </button>
            <p style="margin:-2px 0 0;font-size:12px;color:var(--dim);text-align:center">
              提交时将自动进行无感安全校验，不会计费
            </p>
            <script dangerouslySetInnerHTML={{ __html: `
window.__powReady = true;
(function () {
  var form = document.getElementById('auth-form');
  if (!form) return;
  var btn = form.querySelector('button[type=submit]');
  var nInput = form.querySelector('#pow_n');
  var salt = form.querySelector('#pow_salt').value;
  var d = parseInt(form.querySelector('#pow_d').value, 10) || 4;
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
    var origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '安全校验中…';
    try {
      for (var n = 1; n <= 1000000; n++) {
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
      alert('安全校验失败，请刷新页面重试');
    }
  });
})();
` }}></script>
          </form>

          <div style="margin-top:18px;font-size:12.5px;color:var(--dim);line-height:1.7">
            <p style="margin:0">🔑 密码与 Token 仅存哈希、无法找回，匿名制无邮箱，请妥善保存。</p>
            <p style="margin:6px 0 0">📌 贡献者可提交渠道获得每日调用加成。</p>
          </div>
        </div>
      </div>
    </Layout>
  );
}