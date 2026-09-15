import type { DBUser } from "../db/schema";
import { Layout } from "./layout";

export function DocsPage(props: { user?: DBUser | null }) {
  const { user } = props;
  return (
    <Layout title="使用帮助" user={user} active="docs">
      <div class="page-head">
        <h1>使用帮助</h1>
        <span class="ph-sub">接入即用 · OpenAI 兼容</span>
      </div>

      <Section title="01 · 获取网关 Token">
        <p>登录后在使用面板点击「重置」，即会生成唯一的 <code class="doc-inline">sk-…</code> Token，更换任意厂商上游地址即可使用。Token 仅展示一次，无法找回。</p>
      </Section>

      <Section title="02 · curl 调用">
        <div class="codeblock">
          <div class="cb-head"><i style="background:#f87171"></i><i style="background:#ffc857"></i><i style="background:#3ddc97"></i><span style="margin-left:6px">bash</span></div>
          <pre dangerouslySetInnerHTML={{ __html: `curl <span class="k">https://freeai-gateway.YOUR-SUBDOMAIN.workers.dev</span>/v1/chat/completions \\\n  -H "<span class="k">Authorization</span>: Bearer sk-你的网关Token" \\\n  -H "<span class="k">Content-Type</span>: application/json" \\\n  -d '{"model":"<span class="m">gpt-4o-mini</span>","messages":[{"role":"user","content":"你好"}]}'` }}></pre>
        </div>
      </Section>

      <Section title="03 · Python (OpenAI SDK)">
        <div class="codeblock">
          <div class="cb-head"><i style="background:#f87171"></i><i style="background:#ffc857"></i><i style="background:#3ddc97"></i><span style="margin-left:6px">python</span></div>
          <pre dangerouslySetInnerHTML={{ __html: `from <span class="k">openai</span> import OpenAI\nclient = OpenAI(\n    base_url="<span class="k">https://freeai-gateway.YOUR-SUBDOMAIN.workers.dev/v1</span>",\n    api_key="sk-你的网关Token",\n)\nresp = client.chat.completions.create(\n    model="<span class="m">gpt-4o-mini</span>",\n    messages=[{"role": "user", "content": "你好"}],\n)\nprint(resp.choices[0].message.content)` }}></pre>
        </div>
      </Section>

      <Section title="04 · JavaScript (fetch)">
        <div class="codeblock">
          <div class="cb-head"><i style="background:#f87171"></i><i style="background:#ffc857"></i><i style="background:#3ddc97"></i><span style="margin-left:6px">js</span></div>
          <pre dangerouslySetInnerHTML={{ __html: `const resp = await fetch(\n  "<span class="k">https://freeai-gateway.YOUR-SUBDOMAIN.workers.dev/v1/chat/completions</span>",\n  {\n    method: "POST",\n    headers: {\n      Authorization: "Bearer sk-你的网关Token",\n      "Content-Type": "application/json",\n    },\n    body: JSON.stringify({\n      model: "<span class="m">gpt-4o-mini</span>",\n      messages: [{ role: "user", content: "你好" }],\n    }),\n  },\n);\nconst data = await resp.json();\nconsole.log(data.choices[0].message.content);` }}></pre>
        </div>
      </Section>

      <Section title="05 · 配额与限制">
        <ul class="doc-list">
          <li>每日调用与 Token 分级（信誉 80+ → 100 次/300k Token，最低档 3 次/天永不归零）</li>
          <li>新用户注册 7 天内配额减半</li>
          <li>提交渠道的贡献者可获得每日 +10 ~ +100 调用次数加成</li>
          <li>所有请求走自动故障转移与熔断，尽可能保证请求成功</li>
        </ul>
      </Section>

      <Section title="06 · 异常排查">
        <ul class="doc-list">
          <li><code>401 invalid_token</code>：Token 已被重置或无效，重新登录获取</li>
          <li><code>429 quota_exceeded</code>：今日额度用完，明日自动恢复</li>
          <li><code>503 pool_empty</code>：当前模型无可用渠道，稍后再试或贡献新渠道</li>
          <li><code>503 预算保护</code>：全站动态服务按免费额度保护，UTC 00:00 自动恢复</li>
        </ul>
      </Section>
    </Layout>
  );
}

export function TermsPage(props: { user?: DBUser | null }) {
  const { user } = props;
  return (
    <Layout title="用户协议" user={user} active="terms">
      <div class="page-head">
        <h1>用户协议与免责声明</h1>
        <span class="ph-sub">请勿用于违反厂商条款与法律法规的场景</span>
      </div>

      <Section title="01 · 服务性质">
        <p>FreeAI Gateway 是一个社区驱动、仅供学习与测试的 AI 代理网关。平台本身不提供任何模型服务，仅聚合社区成员自愿共享的 API 凭据。</p>
      </Section>

      <Section title="02 · 自愿提交与授权声明">
        <p>提交 API Key 即视为本人合法持有该凭据、自愿共享，并授权平台将其用于代理转发。平台不爬取、不强制任何凭据入库。</p>
      </Section>

      <Section title="03 · 免责声明">
        <p>共享 API Key 可能违反相关厂商的服务条款，由此产生的账号封禁、法律风险与任何直接或间接损失，由提交者自行承担。平台尽力保护凭据（AES-256-GCM 加密存储、永不明文展示），但不承担因不可抗力导致的数据丢失责任。</p>
      </Section>

      <Section title="04 · 可撤回">
        <p>贡献者可随时在「提交渠道」页面一键删除自己的渠道，删除后该渠道立即退出资源池并失效，相关贡献激励同步终止。如需公开协助删除，可联系平台。</p>
      </Section>

      <Section title="05 · 禁止行为">
        <p>禁止将本服务用于违反所在地法律、恶意攻击、滥用他人凭据、批量注册等用途。平台将依据信誉机制（见 <a href="/docs" style="color:var(--amber)">使用帮助</a>）自动限制异常账号，且永不封禁。</p>
      </Section>

      <Section title="06 · 审计与隐私">
        <p>为防御滥用与安全审计，平台记录调用日志（调用方、渠道、时间、状态），日志保留近 7 天用于统计与故障排查；调用内容不会被平台存储或审查。</p>
      </Section>
    </Layout>
  );
}

function Section(props: { title: string; children: any }) {
  return (
    <section class="card pad" style="margin-bottom:18px">
      <h2 class="panel-title" style="margin-bottom:12px">{props.title}</h2>
      <div class="doc-prose" style="max-width:720px">{props.children}</div>
    </section>
  );
}