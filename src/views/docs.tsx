import type { DBUser } from "../db/schema";
import type { Env } from "../types";
import type { Lang } from "../i18n";
import { t } from "../i18n";
import { Layout } from "./layout";
import { AdSlot } from "./ads";
import type { Seo } from "../utils/seo";

export function DocsPage(props: { user?: DBUser | null; lang: Lang; env: Env; base?: string; seo?: Seo }) {
  const { user, lang, env, base, seo } = props;
  const sk = t(lang, "home", "sk");
  return (
    <Layout title={t(lang, "docs", "title")} user={user} active="docs" lang={lang} env={env} base={base} seo={seo}>
      <div class="page-head">
        <h1>{t(lang, "docs", "title")}</h1>
        <span class="ph-sub">{t(lang, "docs", "page_sub")}</span>
      </div>

      <Section title={t(lang, "docs", "s01")}>
        <p>{t(lang, "docs", "s01_body", { sk })}</p>
      </Section>

      <Section title={t(lang, "docs", "s02")}>
        <div class="codeblock">
          <div class="cb-head"><i style="background:#f87171"></i><i style="background:#ffc857"></i><i style="background:#3ddc97"></i><span style="margin-left:6px">bash</span></div>
          <pre dangerouslySetInnerHTML={{ __html: `curl <span class="k">https://freeai-gateway.YOUR-SUBDOMAIN.workers.dev</span>/v1/chat/completions \\\n  -H "<span class="k">Authorization</span>: Bearer sk-${t(lang, "home", "curl_token")}" \\\n  -H "<span class="k">Content-Type</span>: application/json" \\\n  -d '{"model":"<span class="m">gpt-4o-mini</span>","messages":[{"role":"user","content":"你好"}]}'` }}></pre>
        </div>
      </Section>

      <Section title={t(lang, "docs", "s03")}>
        <div class="codeblock">
          <div class="cb-head"><i style="background:#f87171"></i><i style="background:#ffc857"></i><i style="background:#3ddc97"></i><span style="margin-left:6px">python</span></div>
          <pre dangerouslySetInnerHTML={{ __html: `from <span class="k">openai</span> import OpenAI\nclient = OpenAI(\n    base_url="<span class="k">https://freeai-gateway.YOUR-SUBDOMAIN.workers.dev/v1</span>",\n    api_key="sk-${t(lang, "home", "curl_token")}",\n)\nresp = client.chat.completions.create(\n    model="<span class="m">gpt-4o-mini</span>",\n    messages=[{"role": "user", "content": "你好"}],\n)\nprint(resp.choices[0].message.content)` }}></pre>
        </div>
      </Section>

      <Section title={t(lang, "docs", "s04")}>
        <div class="codeblock">
          <div class="cb-head"><i style="background:#f87171"></i><i style="background:#ffc857"></i><i style="background:#3ddc97"></i><span style="margin-left:6px">js</span></div>
          <pre dangerouslySetInnerHTML={{ __html: `const resp = await fetch(\n  "<span class="k">https://freeai-gateway.YOUR-SUBDOMAIN.workers.dev/v1/chat/completions</span>",\n  {\n    method: "POST",\n    headers: {\n      Authorization: "Bearer sk-${t(lang, "home", "curl_token")}",\n      "Content-Type": "application/json",\n    },\n    body: JSON.stringify({\n      model: "<span class="m">gpt-4o-mini</span>",\n      messages: [{ role: "user", content: "你好" }],\n    }),\n  },\n);\nconst data = await resp.json();\nconsole.log(data.choices[0].message.content);` }}></pre>
        </div>
      </Section>

      <Section title={t(lang, "docs", "s05")}>
        <ul class="doc-list">
          <li>{t(lang, "docs", "s05_l1")}</li>
          <li>{t(lang, "docs", "s05_l2")}</li>
          <li>{t(lang, "docs", "s05_l3")}</li>
          <li>{t(lang, "docs", "s05_l4")}</li>
        </ul>
      </Section>

      <Section title={t(lang, "docs", "s06")}>
        <ul class="doc-list">
          <li><code>401 invalid_token</code>：{t(lang, "docs", "s06_l1_401")}</li>
          <li><code>429 quota_exceeded</code>：{t(lang, "docs", "s06_l2_429")}</li>
          <li><code>503 pool_empty</code>：{t(lang, "docs", "s06_l3_503")}</li>
          <li><code>503 预算保护</code>：{t(lang, "docs", "s06_l4_503")}</li>
        </ul>
      </Section>

      <AdSlot env={env} />
    </Layout>
  );
}

export function TermsPage(props: { user?: DBUser | null; lang: Lang; env: Env; base?: string; seo?: Seo }) {
  const { user, lang, env, base, seo } = props;
  return (
    <Layout title={t(lang, "docs", "terms_title")} user={user} active="terms" lang={lang} env={env} base={base} seo={seo}>
      <div class="page-head">
        <h1>{t(lang, "docs", "terms_h1")}</h1>
        <span class="ph-sub">{t(lang, "docs", "terms_sub")}</span>
      </div>

      <Section title={t(lang, "docs", "t01")}>
        <p>{t(lang, "docs", "t01_body")}</p>
      </Section>

      <Section title={t(lang, "docs", "t02")}>
        <p>{t(lang, "docs", "t02_body")}</p>
      </Section>

      <Section title={t(lang, "docs", "t03")}>
        <p>{t(lang, "docs", "t03_body")}</p>
      </Section>

      <Section title={t(lang, "docs", "t04")}>
        <p>{t(lang, "docs", "t04_body")}</p>
      </Section>

      <Section title={t(lang, "docs", "t05")}>
        <p>
          {t(lang, "docs", "t05_pre")}
          <a href="/docs" style="color:var(--amber)">{t(lang, "docs", "t05_mid")}</a>
          {t(lang, "docs", "t05_post")}
        </p>
      </Section>

      <Section title={t(lang, "docs", "t06")}>
        <p>{t(lang, "docs", "t06_body")}</p>
      </Section>

      <AdSlot env={env} />
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