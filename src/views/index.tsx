import type { DBUser } from "../db/schema";
import { Layout } from "./layout";

export interface Health {
  models: { model: string; count: number }[];
  channels: number;
  budget: { state: string; at?: string | null };
}

/** 健康面板 htmx partial（/health 每 60s 刷新，含模型与示例） */
export function HealthPanel(props: { health: Health }) {
  const { health } = props;
  return (
    <div id="health-panel" class="mt-10" data-2col style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <div class="card pad">
        <div class="panel-head">
          <h2 class="panel-title">可用模型</h2>
          <span class="panel-sub">每 60s 自动刷新</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:9px">
          {health.models.length ? (
            health.models.map((m) => (
              <span key={m.model} class="chip">
                {m.model} <span>×{m.count}</span>
              </span>
            ))
          ) : (
            <p style="margin:0;font-size:13.5px;color:var(--dim)">暂无可用模型，等待贡献者提交渠道…</p>
          )}
        </div>
      </div>

      <div class="card pad">
        <div class="panel-head">
          <h2 class="panel-title">接入示例</h2>
          <span class="panel-sub">OpenAI 兼容</span>
        </div>
        <div class="codeblock">
          <div class="cb-head">
            <i style="background:#f87171"></i><i style="background:#ffc857"></i><i style="background:#3ddc97"></i>
            <span style="margin-left:6px">curl</span>
          </div>
          <pre dangerouslySetInnerHTML={{ __html: `curl <span class="k">https://your-worker.workers.dev</span>/v1/chat/completions \\\n  -H "<span class="k">Authorization</span>: Bearer sk-你的网关Token" \\\n  -H "<span class="k">Content-Type</span>: application/json" \\\n  -d '{"model":"<span class="m">gpt-4o-mini</span>","messages":[{"role":"user","content":"你好"}]}'` }}></pre>
        </div>
      </div>
    </div>
  );
}

export function IndexPage(props: { user?: DBUser | null; health: Health }) {
  const { user, health } = props;
  return (
    <Layout title="FreeAI Gateway — 免费 AI API 聚合代理" user={user} active="home">
      <section class="hero">
        <div class="hero-grid"></div>

        <div class="hero-tag">
          <span class="dot dot-ok"></span>
          GATEWAY ONLINE&nbsp;·&nbsp;POOL <b>{health.channels}</b> 渠道
        </div>

        <h1>
          一个 Token，
          <br />
          <em>调通全部免费 AI</em>
        </h1>

        <p>
          聚合社区贡献的免费 AI 密钥，统一开放兼容接入点。无需注册大厂账号，
          一个 <code class="doc-inline">sk-</code> Token 调用多种模型，自动故障转移与熔断。
        </p>

        <div class="hero-cta">
          <a href="/auth" class="btn btn-primary">免费开始</a>
          <a href="/docs" class="btn btn-ghost">查看接入文档</a>
        </div>

        <div class="hero-meta">
          <span>分层配额 · 永不归零</span>
          <span>匿名制 · 仅存哈希</span>
          <span>自动熔断 · 故障转移</span>
          <span>贡献即激励</span>
        </div>

        <div id="health-panel" hx-get="/health" hx-trigger="load delay:300ms, every 60s" hx-swap="outerHTML">
          <HealthPanel health={health} />
        </div>

        {health.budget.state === "paused" ? (
          <div class="flash flash-err" style="margin-top:18px">
            <span class="dot dot-bad"></span>
            <span>服务预算保护中，动态服务已暂停，预计 UTC 00:00 自动恢复。</span>
          </div>
        ) : null}
      </section>
    </Layout>
  );
}