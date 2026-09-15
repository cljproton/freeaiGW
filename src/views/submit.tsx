import type { DBChannel, DBUser } from "../db/schema";
import { Layout, Flash } from "./layout";

export function SubmitPage(props: {
  user: DBUser;
  contributions: DBChannel[];
  flash?: string;
  flashOk?: boolean;
}) {
  const { user, contributions, flash, flashOk } = props;
  return (
    <Layout title="提交渠道" user={user} active="submit">
      <div class="page-head">
        <h1>提交渠道</h1>
        <span class="ph-sub">贡献一个免费 AI 密钥，为社区点亮模型</span>
      </div>

      {flash ? <Flash msg={flash} ok={flashOk} /> : null}

      <div data-2col style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start">
        <section class="card pad">
          <div class="panel-head">
            <h2 class="panel-title">渠道信息</h2>
            <span class="panel-sub">提交即校验，通过自动入池</span>
          </div>
          <form method="post" action="/api/channels">
            <div style="display:grid;gap:16px">
              <div class="field">
                <label>厂商名称</label>
                <input class="input" name="provider" placeholder="例如 OpenAI / Groq / Google" required />
              </div>
              <div class="field">
                <label>API 地址（Base URL，仅 HTTPS）</label>
                <input class="input" name="api_url" placeholder="https://api.openai.com/v1" required />
              </div>
              <div class="field">
                <label>API Key（AES-256-GCM 加密存储）</label>
                <div style="display:flex;gap:9px">
                  <input class="input" name="api_key" type="password" placeholder="sk-…" required />
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm"
                    hx-post="/api/channels/fetch-models"
                    hx-include="previous input[name=api_url], previous input[name=api_key]"
                    hx-target="#model-picker"
                    hx-swap="innerHTML"
                  >
                    拉取模型
                  </button>
                </div>
              </div>
              <div class="field">
                <label>模型（拉取成功勾选，失败可手动输入）</label>
                <div id="model-picker" class="model-picker">
                  <p class="mp-hint">点击「拉取模型」自动获取，或手动输入（逗号分隔多个模型，或 * 通配全部）。</p>
                </div>
                <input class="input" name="models" placeholder="gpt-4o-mini, gpt-4o   或   *" style="margin-top:9px" />
              </div>
              <div class="field">
                <label>调度权重（0.1 ~ 5.0，默认 1.0 平均分配）</label>
                <input class="input" name="weight" type="number" step="0.1" min="0.1" max="5" defaultValue="1.0" />
              </div>

              <label class="check-card">
                <input type="checkbox" name="agree" required />
                <span style="font-size:13.5px;color:var(--muted)">
                  我确认这是本人合法持有、自愿共享的密钥，并同意
                  <a href="/terms" target="_blank" style="color:var(--amber)">用户协议</a>
                  中的授权声明；共享密钥可能违反厂商服务条款，后果自负。
                </span>
              </label>

              <button class="btn btn-primary btn-block" style="margin-top:2px">
                提交并立即校验
              </button>
            </div>
          </form>
        </section>

        {contributions.length ? (
          <section class="card pad">
            <div class="panel-head">
              <h2 class="panel-title">我的渠道</h2>
              <span class="panel-sub">共 {contributions.length} 条</span>
            </div>
            <ul style="list-style:none;margin:0;padding:0">
              {contributions.map((c) => (
                <ChannelRow c={c} key={c.id} />
              ))}
            </ul>
          </section>
        ) : (
          <section class="empty">
            你还没提交过渠道。密钥只用于代理转发，随时可一键撤回。
          </section>
        )}
      </div>
    </Layout>
  );
}

export function ChannelRow(props: { c: DBChannel }) {
  const c = props.c;
  return (
    <li class="row">
      <div class="row-main">
        <div class="row-title">
          <span class={`dot ${statusOk(c) ? "dot-ok" : "dot-bad"}`}></span>
          <span>{c.provider}</span>
          <StatusBadge c={c} />
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
            重新校验
          </button>
        )}
        {c.is_active === 0 && c.is_circuited === 1 && (
          <button
            class="btn btn-ok btn-sm"
            hx-post={`/api/channels/${c.id}/reactivate`}
            hx-target="closest li"
            hx-swap="outerHTML"
          >
            重新激活
          </button>
        )}
        <button
          class="btn btn-danger btn-sm"
          hx-post={`/api/channels/${c.id}/delete`}
          hx-target="closest li"
          hx-swap="outerHTML"
          hx-confirm="确认删除？删除后该渠道立即退出资源池，贡献加成立即失效，且无法恢复。"
        >
          删除
        </button>
      </div>
    </li>
  );
}

export function statusOk(c: DBChannel): boolean {
  return c.is_active === 1 && c.is_valid === 1 && c.is_circuited === 0;
}

function StatusBadge(props: { c: DBChannel }) {
  const { c } = props;
  if (c.is_circuited === 1) return <span class="badge badge-warn">熔断中</span>;
  if (!c.is_valid) return <span class="badge badge-bad">校验未通过</span>;
  if (c.is_active === 0) return <span class="badge badge-muted">已下架</span>;
  return <span class="badge badge-ok">在池 · {Math.round(c.success_rate * 100)}%</span>;
}