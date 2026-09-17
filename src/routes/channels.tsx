import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireApiUser } from "../middleware/auth";
import {
  getChannelById,
  insertChannel,
  listChannelsByOwner,
  reactivateChannel,
  deleteChannel,
  updateChannel,
} from "../db";
import { decryptSecret, encryptSecret } from "../utils/crypto";
import { penalize } from "../utils/audit";
import { t } from "../i18n";
import {
  isBlatantlyInvalidKey,
  isMaliciousDomain,
  validateApiUrl,
  validateModelsList,
  validateProvider,
} from "../validators";
import { SubmitPage, ChannelRow } from "../views/submit";

const ROUTER = new Hono<AppEnv>();

/** 兼容用户填写的 Base URL：末尾含 /v1 则不重复拼接 */
function resolveModelsUrl(apiUrl: string): string {
  const base = apiUrl.replace(/\/+$/, "");
  return /\/v1$/i.test(base) ? `${base}/models` : `${base}/v1/models`;
}

export interface ProbeResult {
  ok: boolean;
  models: string[];
  error?: string;
}

/** 即时轻量校验：GET {api_url}/v1/models（见 4.3 B.1，入池必要条件） */
export async function probeChannel(apiUrl: string, apiKey: string): Promise<ProbeResult> {
  const url = resolveModelsUrl(apiUrl);
  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    const text = await resp.text().catch(() => "");
    if (resp.ok) {
      let models: string[] = [];
      try {
        const j = JSON.parse(text) as { data?: { id?: string }[]; models?: { id?: string }[] };
        const items = Array.isArray(j.data) ? j.data : Array.isArray(j.models) ? j.models : [];
        models = items.map((m) => m.id ?? "").filter(Boolean) as string[];
      } catch {
        /* 非标准返回仍视为校验通过，但无模型列表 */
      }
      return { ok: true, models };
    }
    return { ok: false, models: [], error: `校验失败 HTTP ${resp.status}: ${text.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, models: [], error: `无法连接 ${url}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/* ===== 提交页辅助 ===== */

/** 拉取模型列表：返回 htmx partial（可勾选芯片） */
ROUTER.post("/fetch-models", requireApiUser, async (c) => {
  const body = await c.req.parseBody();
  const apiUrl = String(body.api_url ?? "").trim();
  const apiKey = String(body.api_key ?? "").trim();
  const lang = c.get("lang");

  if (!validateApiUrl(apiUrl).ok || isBlatantlyInvalidKey(apiKey)) {
    return c.html(
      <div id="model-picker" class="model-picker">
        <p class="mp-err">{t(lang, "submit", "mp_err_fetch")}</p>
      </div>,
    );
  }
  const probe = await probeChannel(apiUrl, apiKey);
  if (!probe.ok || !probe.models.length) {
    return c.html(
      <div id="model-picker" class="model-picker">
        <p class="mp-warn">{t(lang, "submit", "mp_warn_fetch", { err: probe.error ?? t(lang, "submit", "mp_hint_fetch") })}</p>
      </div>,
    );
  }
  return c.html(
    <div id="model-picker" class="model-picker">
      <p class="mp-hint">{t(lang, "submit", "mp_hint_pick")}</p>
      <div class="mp-toolbar">
        <input
          id="mp-search"
          class="input mp-search"
          type="search"
          placeholder={t(lang, "submit", "mp_search_ph")}
          autocapitalize="off"
          spellcheck={false}
        />
        <button type="button" class="btn btn-ghost btn-sm" data-mp="all">{t(lang, "submit", "mp_select_all")}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-mp="clear">{t(lang, "submit", "mp_clear")}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-mp="wild">{t(lang, "submit", "mp_all_wildcard")}</button>
      </div>
      <p class="mp-sub" data-mp-sub data-format={t(lang, "submit", "mp_count")}>
        {t(lang, "submit", "mp_count", { n: 0, m: probe.models.length })}
      </p>
      <div class="mp-list">
        {probe.models.map((m) => (
          <label class="pick-chip" data-mp-chip>
            <input type="checkbox" name="models_pick" value={m} />
            <span>{m}</span>
          </label>
        ))}
      </div>
      <p class="mp-hint" style="margin-top:10px">{t(lang, "submit", "mp_hint_sync")}</p>
    </div>,
  );
});

/** 提交渠道（见 4.3 / 5.2）：即时校验通过才入池 */
ROUTER.post("/", requireApiUser, async (c) => {
  const user = c.get("user");
  const lang = c.get("lang");
  const body = await c.req.parseBody();

  const provider = String(body.provider ?? "").trim();
  const apiUrl = String(body.api_url ?? "").trim();
  const apiKey = String(body.api_key ?? "").trim();

  // 授权声明必须勾选（十一合规）
  if (body.agree === undefined) {
    return c.html(<SubmitPage user={user} contributions={[]} flash={t(lang, "submit", "flash_agree")} lang={lang} env={c.env} />);
  }

  const urlCheck = validateApiUrl(apiUrl);
  if (!urlCheck.ok) {
    const key =
      urlCheck.kind === "api_url_https"
        ? "v_api_url_https"
        : urlCheck.kind === "api_url_host"
          ? "v_api_url_host"
          : "v_api_url";
    return c.html(<SubmitPage user={user} contributions={[]} flash={t(lang, "errors", key)} lang={lang} env={c.env} />);
  }
  const providerCheck = validateProvider(provider);
  if (!providerCheck.ok) {
    return c.html(<SubmitPage user={user} contributions={[]} flash={t(lang, "errors", "v_provider")} lang={lang} env={c.env} />);
  }
  if (isBlatantlyInvalidKey(apiKey)) {
    await penalize(c.env, user.id, "invalid_key");
    return c.html(<SubmitPage user={user} contributions={[]} flash={t(lang, "submit", "flash_invalid_key")} lang={lang} env={c.env} />);
  }
  const host = new URL(apiUrl).hostname;
  if (isMaliciousDomain(host)) {
    await penalize(c.env, user.id, "malicious");
    return c.html(<SubmitPage user={user} contributions={[]} flash={t(lang, "submit", "flash_malicious")} lang={lang} env={c.env} />);
  }

  // 模型：优先用户勾选/输入的 models；兼容 chips 数组
  const rawModels = body.models_pick ?? body.models;
  let modelsJson: string;
  if (Array.isArray(rawModels) && rawModels.length) {
    modelsJson = JSON.stringify(rawModels);
  } else {
    const manual = String(body.models ?? "").trim();
    modelsJson = manual
      ? JSON.stringify(manual.split(/[,，]/).map((s) => s.trim()).filter(Boolean))
      : JSON.stringify(["*"]);
  }
  const ml = validateModelsList(modelsJson);
  if (!ml.ok) {
    const key =
      ml.kind === "models_empty"
        ? "v_models_empty"
        : ml.kind === "models_too_many"
          ? "v_models_too_many"
          : ml.kind === "models_bad"
            ? "v_models_bad"
            : "v_models_format";
    return c.html(<SubmitPage user={user} contributions={[]} flash={t(lang, "errors", key)} lang={lang} env={c.env} />);
  }

  const weight = Math.min(5, Math.max(0.1, Number(body.weight) || 1));

  // 立即校验（B.1）
  const probe = await probeChannel(apiUrl, apiKey);
  const encrypted = await encryptSecret(c.env.ENCRYPTION_KEY, apiKey);
  const now = new Date().toISOString();
  const channelId = await insertChannel(c.env, {
    owner_user_id: user.id,
    provider,
    api_url: apiUrl,
    api_key_encrypted: encrypted,
    key_hint: apiKey.slice(0, 4),
    models: modelsJson,
    weight,
    is_active: probe.ok ? 1 : 0,
    is_valid: probe.ok ? 1 : 0,
    is_circuited: 0,
    circuit_until: null,
    circuit_count: 0,
    success_rate: 1,
    total_requests: 0,
    failed_requests: 0,
    last_error: probe.ok ? null : (probe.error ?? "validation failed"),
    last_success_at: probe.ok ? now : null,
  });

  const contributions = await listChannelsByOwner(c.env, user.id);
  if (probe.ok) {
    return c.html(
      <SubmitPage user={user} contributions={contributions} flash={t(lang, "submit", "flash_circular_ok")} flashOk lang={lang} env={c.env} />,
    );
  }
  return c.html(
    <SubmitPage user={user} contributions={contributions} flash={t(lang, "submit", "flash_circular_fail", { err: probe.error ?? "" })} lang={lang} env={c.env} />,
  );
});

/** 重新校验（修复后自动入池，B.1） */
ROUTER.post("/:id/validate", requireApiUser, async (c) => {
  const user = c.get("user");
  const lang = c.get("lang");
  const id = Number(c.req.param("id"));
  const ch = await getChannelById(c.env, id);
  if (!ch || ch.owner_user_id !== user.id) return c.notFound();

  const key = await decryptSecret(c.env.ENCRYPTION_KEY, ch.api_key_encrypted).catch(() => "");
  const probe = await probeChannel(ch.api_url, key);
  await updateChannel(c.env, id, {
    is_valid: probe.ok ? 1 : 0,
    is_active: probe.ok ? 1 : 0,
    last_error: probe.ok ? null : (probe.error ?? "validation failed"),
    last_success_at: probe.ok ? new Date().toISOString() : ch.last_success_at,
  });
  const fresh = await getChannelById(c.env, id);
  return c.html(fresh ? <ChannelRow c={fresh} lang={lang} /> : <></>);
});

/** 贡献者重新激活（重置熔断印记，B.2） */
ROUTER.post("/:id/reactivate", requireApiUser, async (c) => {
  const user = c.get("user");
  const lang = c.get("lang");
  const id = Number(c.req.param("id"));
  await reactivateChannel(c.env, id, user.id);
  const ch = await getChannelById(c.env, id);
  return c.html(ch ? <ChannelRow c={ch} lang={lang} /> : <></>);
});

/** 删除渠道（回收贡献，4.3） */
ROUTER.post("/:id/delete", requireApiUser, async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  await deleteChannel(c.env, id, user.id);
  return c.body(null, 200);
});

export default ROUTER;