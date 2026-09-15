import type { DBChannel, DBUser } from "../db/schema";
import { Layout, Flash } from "./layout";

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

export function DashboardPage(props: {
  user: DBUser;
  usage: UsageInfo;
  contributions: DBChannel[];
  tokenPrefix?: string | null;
  tokenPlain?: string | null;
  flash?: string;
}) {
  const { user, usage, contributions, tokenPrefix, tokenPlain, flash } = props;
  const callPct = usage.limit > 0 ? Math.min(100, Math.round((usage.calls / usage.limit) * 100)) : 0;
  const tokPct = usage.tokensLimit > 0 ? Math.min(100, Math.round((usage.tokens / usage.tokensLimit) * 100)) : 0;
  const repCls =
    usage.reputation >= 80 ? "badge badge-ok" : usage.reputation >= 60 ? "badge badge-warn" : "badge badge-bad";
  return (
    <Layout title="使用面板" user={user} active="dashboard">
      <div class="page-head">
        <h1>使用面板</h1>
        <span class="ph-sub">@{user.username} · 匿名制</span>
      </div>

      {flash ? <Flash msg={flash} ok /> : null}

      {tokenPlain ? (
        <Flash msg={`这是你的网关 Token，仅显示这一次，请立即复制保存（无法找回）：${tokenPlain}`} ok />
      ) : null}

      {usage.reputation < 60 ? <Flash msg="当前信誉分较低，额度已临时调整，正常使用几天后自动恢复。" /> : null}

      <section class="card pad">
        <div class="panel-head">
          <h2 class="panel-title">网关 Token</h2>
          <span class="panel-sub">单 Token 模型 · 重置后旧 Token 立即失效</span>
        </div>
        <div id="token-box" class="token-box">
          <span class="token-code empty">{tokenPrefix ? `${tokenPrefix}…` : "尚未创建（点击重置创建）"}</span>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:14px">
          <button
            class="btn btn-primary btn-sm"
            hx-post="/api/tokens/reset"
            hx-target="#token-box"
            hx-swap="outerHTML"
            hx-confirm="确认重置网关 Token？旧 Token 将立即失效。"
          >
            重置 Token
          </button>
        </div>
        <p style="margin:12px 0 0;font-size:12.5px;color:var(--dim)">
          仅在此处首次创建/重置时展示明文，随后只存哈希，管理员也无法找回。
        </p>
      </section>

      <section class="card pad" style="margin-top:22px">
        <div class="panel-head">
          <h2 class="panel-title">今日用量</h2>
          <span class="panel-sub">
            {usage.isNew ? "新用户 7 天内配额减半 · " : ""}UTC 日重置
          </span>
        </div>
        <div class="stat-grid">
          <div class={`stat ${callPct >= 80 ? "warn" : ""}`}>
            <div class="stat-label">调用次数</div>
            <div class="stat-num">{usage.calls} / {usage.limit}</div>
            <div class="meter"><div class="meter-fill" style={`width:${callPct}%`}></div></div>
          </div>
          <div class={`stat ${tokPct >= 80 ? "warn" : ""}`}>
            <div class="stat-label">Token 用量</div>
            <div class="stat-num">{usage.tokens.toLocaleString()} / {usage.tokensLimit.toLocaleString()}</div>
            <div class="meter"><div class="meter-fill" style={`width:${tokPct}%`}></div></div>
          </div>
          <div class="stat">
            <div class="stat-label">贡献加成</div>
            <div class="stat-num">{usage.tier ? `+${usage.tierBonus}` : "无"}</div>
            <div style="margin-top:11px">
              {usage.tier ? (
                <span class="badge badge-ok">CR 档位 Lv.{usage.tier}</span>
              ) : (
                <span class="badge badge-muted">未入档</span>
              )}
            </div>
          </div>
          <div class="stat">
            <div class="stat-label">信誉分</div>
            <div class="stat-num">{usage.reputation}</div>
            <div style="margin-top:11px"><span class={repCls}>{repText(usage.reputation)}</span></div>
          </div>
        </div>
        <p style="margin:14px 0 0;font-size:12.5px;color:var(--dim)">
          通过提交渠道获得的 +N 次/天加成，全部来自社区对贡献者的激励。
        </p>
      </section>

      {contributions.length ? (
        <section class="card pad" style="margin-top:22px">
          <div class="panel-head">
            <h2 class="panel-title">我的贡献</h2>
            <span class="panel-sub">共 {contributions.length} 条</span>
          </div>
          <ul style="list-style:none;margin:0;padding:0">
            {contributions.map((c) => (
              <li key={c.id} class="row">
                <div class="row-main">
                  <div class="row-title">
                    <span class={`dot ${c.is_active && c.is_valid && !c.is_circuited ? "dot-ok" : "dot-bad"}`}></span>
                    <span>{c.provider}</span>
                    {c.key_hint ? <CodeBadge text={`${c.key_hint}…`} /> : null}
                    <ChannelStatus c={c} />
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
                      重新校验
                    </button>
                  )}
                  {c.is_active === 0 && (
                    <button
                      class="btn btn-ok btn-sm"
                      hx-post={`/api/channels/${c.id}/reactivate`}
                      hx-target="closest li"
                      hx-swap="outerHTML"
                    >
                      重新激活
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section class="empty" style="margin-top:22px">
          还没有贡献渠道。贡献 API Key 可获得每日
          <span style="color:var(--amber)"> +10 ~ +100 调用次数加成</span>，
          <a href="/submit"><b>去提交第一个渠道 →</b></a>
        </section>
      )}
    </Layout>
  );
}

function CodeBadge(props: { text: string }) {
  return <span class="badge badge-muted">{props.text}</span>;
}

function repText(r: number) {
  if (r >= 80) return "优秀 · 全量额度";
  if (r >= 60) return "良好";
  if (r >= 30) return "需留意";
  return "较低 · 已暂调";
}

function ChannelStatus(props: { c: DBChannel }) {
  const { c } = props;
  if (c.is_circuited === 1) return <span class="badge badge-warn">熔断中</span>;
  if (!c.is_valid) return <span class="badge badge-bad">校验未通过</span>;
  if (c.is_active === 0) return <span class="badge badge-muted">已下架</span>;
  return <span class="badge badge-ok">在池 · {Math.round(c.success_rate * 100)}%</span>;
}