/**
 * i18n 支持（中/英，默认英文）
 * - 语言偏好存 cookie `ln`（en | zh）
 * - 首次访问无 cookie 时，按请求 Accept-Language 嗅探（含 zh 即中文，其它英文）
 * - 翻译词典按视图分组；动态文案用 {占位符}，由 tr() 替换
 */

export type Lang = "en" | "zh";
export const DEFAULT_LANG: Lang = "en";
export const COOKIE = "ln";
export const LANGS: Lang[] = ["en", "zh"];
export const LANG_LABEL: Record<Lang, string> = { en: "English", zh: "中文" };

/** cookie / query 等原始值 → 合法 Lang（非法回退默认） */
export function resolveLang(v: string | null | undefined): Lang {
  return v === "zh" ? "zh" : v === "en" ? "en" : DEFAULT_LANG;
}

/** 首次无 cookie 时按浏览器语言嗅探：接受中文则中文，否则英文 */
export function sniffLang(acceptLanguage: string | null | undefined): Lang {
  if (!acceptLanguage) return DEFAULT_LANG;
  return /(?:^|,)\s*\*?zh(?:-|;|,|$|\s)/i.test(acceptLanguage) ? "zh" : DEFAULT_LANG;
}

/** Accept-Language → 解析（结果缓存到每请求变量） */
export function langFromReq(
  cookie: string | null | undefined,
  acceptLanguage: string | null | undefined,
): Lang {
  const parsed = parseCookies(cookie);
  const v = parsed[COOKIE];
  if (v === "en" || v === "zh") return v;
  return sniffLang(acceptLanguage);
}

function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const val = part.slice(i + 1).trim();
    if (k && val) out[k] = decodeURIComponent(val);
  }
  return out;
}

/** 类型化动态文案替换：{name} → 值 */
export function tr<Vars extends Record<number | string, unknown> | undefined>(
  key: string,
  dict: Record<string, string>,
  lang: Lang,
  vars?: Vars,
): string {
  let s = dict[key];
  if (!s) s = dict[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v ?? ""));
  }
  return s;
}

/** 当前语言对应词典 */
export function dictOf(lang: Lang): typeof en {
  return lang === "zh" ? zh : en;
}

/** 简便访问器：tr(key, dictOf(lang), lang, vars) */
export function t<Section extends keyof typeof en>(
  lang: Lang,
  section: Section,
  key: keyof (typeof en)[Section],
  vars?: Record<string, string | number>,
): string {
  const dict = dictOf(lang);
  const sub = dict[section] as Record<string, string>;
  return tr(String(key), sub, lang, vars);
}

/** 分层双语词典容器：每个视图目录（layout/home/dashboard/...）在下面定义 */
export const en = {
  layout: {
    brand: "freeai",
    nav_help: "Docs",
    nav_terms: "Terms",
    nav_dashboard: "Dashboard",
    nav_submit: "Submit Channel",
    nav_logout: "Log out",
    nav_login: "Log in / Sign up",
    switch_to: "中文",
    footer_text: "Community-aggregated free AI keys for learning and testing only. By using this service you agree to the",
    footer_terms: "User Agreement",
    footer_docs: "Usage Policy",
  },
  home: {
    title: "FreeAI Gateway — Free AI API Aggregation Gateway",
    tag_pool: "CHANNELS",
    h1a: "One token,",
    h1b: "talk to every free AI",
    p: "Aggregates community-contributed free AI keys behind one OpenAI-compatible endpoint. No vendor accounts needed; one {sk} token drives many models with automatic failover and circuit breaking.",
    sk: "sk-",
    cta_start: "Start Free",
    cta_docs: "Read Docs",
    meta1: "Tiered quota · never zeroed",
    meta2: "Anonymous · hashed only",
    meta3: "Auto circuit-break · failover",
    meta4: "Contribute and be rewarded",
    models_title: "Available Models",
    models_hint: "auto-refresh every 60s",
    no_models: "No models yet — waiting for contributors…",
    example_title: "Quick Start",
    example_hint: "OpenAI compatible",
    curl_token: "your-gateway-token",
    curl_body: "how are you?",
    paused: "Budget protection active. Dynamic services are paused; expected to resume at 00:00 UTC.",
  },
  auth: {
    title: "Log in / Sign up",
    tag: "ANONYMOUS · NO-EMAIL",
    h2a: "No-email sign-up,",
    h2b: "one account, two roles.",
    p: "One account is both consumer and contributor: submit channels for daily bonuses, transparent reputation keeps things fair, and",
    no_ban: "nobody is ever banned.",
    li1: "Passwords & tokens are stored hashed — even admins can't recover them",
    li2: "New users half quota for 7 days · floor of 3 calls/day never zeroed",
    li3: "Contribution bonus +10 ~ +100 calls/day by reputation tier",
    form_title: "Log in / Sign up",
    tab_login: "Log in",
    tab_register: "Sign up",
    honeypot_label: "Website (optional)",
    label_username: "Username",
    ph_username: "3-20 letters, digits or underscores",
    label_password: "Password",
    ph_password: "at least 8 characters",
    btn_submit_register: "Sign up & start",
    btn_submit_login: "Log in",
    pow_note: "An invisible security check runs on submit — no cost to you.",
    pow_busy: "Verifying security…",
    pow_fail: "Security check failed, please refresh the page and retry",
    foot1: "🔑 Password & token are hash-only and unrecoverable — no email tied to your account, please save them safely.",
    foot2: "📌 Contributors can submit channels for a daily call bonus.",
    err_suspicious: "Suspicious submission detected, please refresh and retry",
    err_timing: "Security verification failed, please refresh and retry",
    err_pow: "Security verification failed, please refresh and retry",
    err_ip_limit: "Too many registrations from this IP today, try again tomorrow",
    err_username_charset: "Username must be 3-20 letters, digits or underscores",
    err_username_exists: "Username already taken",
    err_login_blocked: "Too many failed attempts, try again in 10 minutes",
    err_bad_credentials: "Incorrect username or password",
    v_username: "Username must be 3-20 letters, digits or underscores",
    v_password_short: "Password must be at least 8 characters",
    v_password_long: "Password is too long",
  },
  dashboard: {
    title: "Dashboard",
    sub: "@{user} · anonymous",
    rep_low_flash: "Your reputation is currently low; your quota was temporarily adjusted and will recover automatically after a few days of normal use.",
    token_title: "Gateway Token",
    token_sub: "Single token model · reset invalidates the old token immediately",
    token_empty: "Not created yet — click reset to create one",
    token_reset: "Reset Token",
    token_confirm: "Reset gateway token? The old token will be invalidated immediately.",
    token_note: "The plaintext is shown only here when first created/reset; afterwards only its hash is stored — admins can't recover it.",
    token_flash_prefix:
      "This is your gateway token — shown only this once, save it now (unrecoverable): {token}",
    usage_title: "Today's Usage",
    usage_sub_new: "New users: half quota for 7 days · ",
    usage_sub_reset: "UTC daily reset",
    stat_calls: "Calls",
    stat_tokens: "Tokens",
    stat_bonus: "Contribution",
    stat_rep: "Reputation",
    bonus_none: "None",
    badge_tier: "CR tier Lv.{tier}",
    badge_none: "Not tiered",
    bonus_note: "The +N calls/day from submitted channels is the community's reward to contributors.",
    contributions_title: "My Channels",
    contributions_sub: "{n} total",
    btn_revalidate: "Re-validate",
    btn_reactivate: "Reactivate",
    contributions_empty:
      "No channels yet. Contribute an API key for a daily {bonus} bonus —",
    contributions_cta: "submit your first channel →",
    rep_excellent: "Excellent · full quota",
    rep_good: "Good",
    rep_attention: "Watch out",
    rep_low: "Low · temporarily capped",
    status_circuited: "Circuit open",
    status_invalid: "Validation failed",
    status_inactive: "Archived",
    status_pooled: "In pool · {pct}%",
    codeblob_copied: "Copied",
  },
  submit: {
    title: "Submit Channel",
    sub: "Contribute a free AI key and light up a model for the community",
    form_title: "Channel Info",
    form_sub: "Validated on submit; auto-listed after passing",
    label_provider: "Provider name",
    ph_provider: "e.g. OpenAI / Groq / Google",
    label_api_url: "API Base URL (HTTPS only)",
    ph_api_url: "https://api.openai.com/v1",
    label_api_key: "API Key (AES-256-GCM encrypted)",
    ph_api_key: "sk-…",
    btn_fetch: "Fetch Models",
    label_models: "Models (pick from fetch, or type manually)",
    mp_hint_fetch: "Click “Fetch Models” to auto-load, or type manually (comma-separated, or * for all).",
    mp_hint_pick: "Check the models to expose (leave empty for wildcard all):",
    mp_hint_sync: "Selected models sync into the “Models” field below.",
    mp_warn_fetch: "Fetch failed: {err}. Enter model names manually below.",
    mp_err_fetch: "URL or Key is clearly invalid.",
    ph_models: "gpt-4o-mini, gpt-4o    or    *",
    label_weight: "Scheduling weight (0.1 ~ 5.0, default 1.0)",
    agree: "I confirm this is a key I legitimately hold and share voluntarily, and I agree to the {terms} authorization statement; sharing a key may violate vendor ToS — your own responsibility.",
    agree_terms: "User Agreement",
    btn_submit: "Submit & Validate Now",
    my_channels: "My Channels",
    btn_delete: "Delete",
    delete_confirm: "Delete? The channel leaves the pool immediately, the contribution bonus stops at once, and this cannot be undone.",
    empty_contributions: "You haven't submitted any channels yet. Keys are used only for request forwarding and can be withdrawn anytime.",
    flash_agree: "Please tick the authorization statement first",
    flash_invalid_key: "Key is clearly invalid; rejected (reputation penalty applied)",
    flash_malicious: "Suspected malicious address; rejected and logged",
    flash_circular_ok: "Validation passed; auto-listed. Contribution bonus applies from tomorrow.",
    flash_circular_fail: "Validation failed, not listed: {err}",
    status_circuited: "Circuit open",
    status_invalid: "Validation failed",
    status_inactive: "Archived",
    status_pooled: "In pool · {pct}%",
  },
  docs: {
    title: "Docs",
    terms_title: "Terms",
    page_sub: "OpenAI-compatible",
    s01: "01 · Get your gateway token",
    s01_body:
      "Log in and click “Reset” on the dashboard to generate a unique {sk} token — it works against any upstream provider. The token is shown only once and can never be recovered.",
    s02: "02 · curl",
    s03: "03 · Python (OpenAI SDK)",
    s04: "04 · JavaScript (fetch)",
    s05: "05 · Quota & limits",
    s05_l1: "Tiered daily calls/tokens by reputation (80+ → 100 calls / 300k tokens; floor of 3 calls/day never zeroed)",
    s05_l2: "New users get half quota for the first 7 days",
    s05_l3: "Contributors earn +10 ~ +100 extra calls/day per tier",
    s05_l4: "Every request rides automatic failover and circuit breaking for maximum availability",
    s06: "06 · Troubleshooting",
    s06_l1_401: "Token was reset or is invalid — re-login to get a fresh one",
    s06_l2_429: "Daily quota exhausted — resets automatically tomorrow",
    s06_l3_503: "No channel available for this model — try later or contribute one",
    s06_l4_503: "Budget protection: dynamic services paused under free-tier protection, resumes at 00:00 UTC",
    terms_h1: "User Agreement & Disclaimer",
    terms_sub: "Not for use against vendor ToS or local law",
    t01: "01 · Nature of service",
    t01_body:
      "FreeAI Gateway is a community-driven AI aggregation gateway for learning and testing. The platform runs no models itself — it only aggregates API credentials voluntarily shared by community members.",
    t02: "02 · Voluntary submission",
    t02_body:
      "Submitting an API key affirms that you legitimately hold it, share it voluntarily, and authorize the platform to route requests through it. The platform neither scrapes nor forces any credentials into its pool.",
    t03: "03 · Disclaimer",
    t03_body:
      "Sharing an API key may violate the relevant vendor's terms of service. Any resulting account bans, legal risks, and direct or indirect losses are the submitter's own responsibility. The platform protects credentials with AES-256-GCM and never displays them in plaintext, but is not liable for data loss caused by force majeure.",
    t04: "04 · Withdrawal",
    t04_body:
      "Contributors may delete their channels anytime from the Submit page; the channel leaves the pool immediately and related contribution rewards end at once. Contact us for help with removal.",
    t05: "05 · Prohibited conduct",
    t05_pre:
      "Do not use this service to break local law, attack others, abuse other people's credentials, or mass-register. The platform auto-restricts abnormal accounts via reputation and never bans anyone",
    t05_post: ".",
    t05_mid: "",
    t06: "06 · Audit & privacy",
    t06_body:
      "To defend against abuse we log calls (caller, channel, time, status). Logs are kept ~7 days for stats and troubleshooting; call content is never stored or inspected.",
  },
  seo: {
    home_desc:
      "Free AI API aggregation gateway: one OpenAI-compatible endpoint, one gateway token, many free models. Community-contributed keys with automatic failover and circuit breaking.",
    docs_desc:
      "Usage docs for FreeAI Gateway: get a one-time gateway token, call the OpenAI-compatible /v1 API with curl, Python or JavaScript; quotas, reliability and error handling.",
    terms_desc:
      "FreeAI Gateway user agreement and disclaimer: voluntary key sharing, AES-256-GCM encrypted storage, instant revocation, prohibited use, audit and privacy.",
    auth_desc: "Anonymous, no-email sign-up for FreeAI Gateway free AI API access.",
  },
  errors: {
    unauthorized: "Please log in first",
    pool_empty: "No channels are available for this model yet",
    pool_none: "The resource pool has no available channels at the moment",
    quota_exceeded: "Daily call quota exhausted, try again tomorrow",
    v_username: "Username must be 3-20 letters, digits or underscores",
    v_password_short: "Password must be at least 8 characters",
    v_password_long: "Password is too long",
    v_provider: "Provider name format is invalid",
    v_api_url: "API URL is not a valid URL",
    v_api_url_https: "Only HTTPS URLs are supported",
    v_api_url_host: "Missing hostname",
    v_models_empty: "Please select at least one model",
    v_models_too_many: "At most 50 models allowed",
    v_models_bad: "Model name format is invalid",
    v_models_format: "Model list format is invalid",
  },
};

/** 中文词典：与 en 键一一对应 */
export const zh: typeof en = {
  layout: {
    brand: "freeai",
    nav_help: "使用帮助",
    nav_terms: "协议",
    nav_dashboard: "使用面板",
    nav_submit: "提交渠道",
    nav_logout: "登出",
    nav_login: "登录 / 注册",
    switch_to: "English",
    footer_text: "自由聚合社区渠道，仅供学习测试。使用即代表同意",
    footer_terms: "用户协议",
    footer_docs: "使用规范",
  },
  home: {
    title: "FreeAI Gateway — 免费 AI API 聚合网关",
    tag_pool: "渠道",
    h1a: "一个 Token，",
    h1b: "调通全部免费 AI",
    p: "聚合社区贡献的免费 AI 密钥，统一开放兼容接入点。无需注册大厂账号，一个 {sk} Token 调用多种模型，自动故障转移与熔断。",
    sk: "sk-",
    cta_start: "免费开始",
    cta_docs: "查看接入文档",
    meta1: "分层配额 · 永不归零",
    meta2: "匿名制 · 仅存哈希",
    meta3: "自动熔断 · 故障转移",
    meta4: "贡献即激励",
    models_title: "可用模型",
    models_hint: "每 60s 自动刷新",
    no_models: "暂无可用模型，等待贡献者提交渠道…",
    example_title: "接入示例",
    example_hint: "OpenAI 兼容",
    curl_token: "你的网关Token",
    curl_body: "你好",
    paused: "服务预算保护中，动态服务已暂停，预计 UTC 00:00 自动恢复。",
  },
  auth: {
    title: "登录 / 注册",
    tag: "ANONYMOUS · NO-EMAIL",
    h2a: "无邮箱注册，",
    h2b: "一个账号双向身份。",
    p: "同一账号既是使用者也是贡献者：提交渠道赚取每日加成，透明信誉分守护公平，",
    no_ban: "永不封禁。",
    li1: "密码与 Token 仅存哈希，管理员亦无法找回",
    li2: "新用户 7 天配额减半 · 最低 3 次/天永不归零",
    li3: "贡献 +10 ~ +100 次/天加成，按信誉分级",
    form_title: "登录 / 注册",
    tab_login: "登录",
    tab_register: "注册",
    honeypot_label: "网站（选填）",
    label_username: "用户名",
    ph_username: "3-20 位字母、数字或下划线",
    label_password: "密码",
    ph_password: "至少 8 位",
    btn_submit_register: "注册并开始使用",
    btn_submit_login: "登录",
    pow_note: "提交时将自动进行无感安全校验，不会计费",
    pow_busy: "安全校验中…",
    pow_fail: "安全校验失败，请刷新页面重试",
    foot1: "🔑 密码与 Token 仅存哈希、无法找回，匿名制无邮箱，请妥善保存。",
    foot2: "📌 贡献者可提交渠道获得每日调用加成。",
    err_suspicious: "检测到可疑提交，请刷新后重试",
    err_timing: "安全校验失败，请刷新后重试",
    err_pow: "安全校验失败，请刷新后重试",
    err_ip_limit: "该 IP 今日注册次数过多，请明日再试",
    err_username_charset: "用户名需为 3-20 位字母、数字或下划线",
    err_username_exists: "用户名已存在",
    err_login_blocked: "失败次数过多，请 10 分钟后再试",
    err_bad_credentials: "用户名或密码错误",
    v_username: "用户名需为 3-20 位字母、数字或下划线",
    v_password_short: "密码至少 8 位",
    v_password_long: "密码过长",
  },
  dashboard: {
    title: "使用面板",
    sub: "@{user} · 匿名制",
    rep_low_flash: "当前信誉分较低，额度已临时调整，正常使用几天后自动恢复。",
    token_title: "网关 Token",
    token_sub: "单 Token 模型 · 重置后旧 Token 立即失效",
    token_empty: "尚未创建（点击重置创建）",
    token_reset: "重置 Token",
    token_confirm: "确认重置网关 Token？旧 Token 将立即失效。",
    token_note: "仅在此处首次创建/重置时展示明文，随后只存哈希，管理员也无法找回。",
    token_flash_prefix: "这是你的网关 Token，仅显示这一次，请立即复制保存（无法找回）：{token}",
    usage_title: "今日用量",
    usage_sub_new: "新用户 7 天内配额减半 · ",
    usage_sub_reset: "UTC 日重置",
    stat_calls: "调用次数",
    stat_tokens: "Token 用量",
    stat_bonus: "贡献加成",
    stat_rep: "信誉分",
    bonus_none: "无",
    badge_tier: "CR 档位 Lv.{tier}",
    badge_none: "未入档",
    bonus_note: "通过提交渠道获得的 +N 次/天加成，全部来自社区对贡献者的激励。",
    contributions_title: "我的贡献",
    contributions_sub: "共 {n} 条",
    btn_revalidate: "重新校验",
    btn_reactivate: "重新激活",
    contributions_empty: "还没有贡献渠道。贡献 API Key 可获得每日 {bonus} 调用次数加成，",
    contributions_cta: "去提交第一个渠道 →",
    rep_excellent: "优秀 · 全量额度",
    rep_good: "良好",
    rep_attention: "需留意",
    rep_low: "较低 · 已暂调",
    status_circuited: "熔断中",
    status_invalid: "校验未通过",
    status_inactive: "已下架",
    status_pooled: "在池 · {pct}%",
    codeblob_copied: "已复制",
  },
  submit: {
    title: "提交渠道",
    sub: "贡献一个免费 AI 密钥，为社区点亮模型",
    form_title: "渠道信息",
    form_sub: "提交即校验，通过自动入池",
    label_provider: "厂商名称",
    ph_provider: "例如 OpenAI / Groq / Google",
    label_api_url: "API 地址（Base URL，仅 HTTPS）",
    ph_api_url: "https://api.openai.com/v1",
    label_api_key: "API Key（AES-256-GCM 加密存储）",
    ph_api_key: "sk-…",
    btn_fetch: "拉取模型",
    label_models: "模型（拉取成功勾选，失败可手动输入）",
    mp_hint_fetch: "点击「拉取模型」自动获取，或手动输入（逗号分隔多个模型，或 * 通配全部）。",
    mp_hint_pick: "勾选要暴露的模型（留空则通配全部）：",
    mp_hint_sync: "选中的模型会自动同步到下方「模型」输入框。",
    mp_warn_fetch: "拉取失败：{err}。可直接在下方手动输入模型名。",
    mp_err_fetch: "URL 或 Key 明显无效，无法拉取。",
    ph_models: "gpt-4o-mini, gpt-4o   或   *",
    label_weight: "调度权重（0.1 ~ 5.0，默认 1.0 平均分配）",
    agree: "我确认这是本人合法持有、自愿共享的密钥，并同意 {terms} 中的授权声明；共享密钥可能违反厂商服务条款，后果自负。",
    agree_terms: "用户协议",
    btn_submit: "提交并立即校验",
    my_channels: "我的渠道",
    btn_delete: "删除",
    delete_confirm: "确认删除？删除后该渠道立即退出资源池，贡献加成立即失效，且无法恢复。",
    empty_contributions: "你还没提交过渠道。密钥只用于请求转发，随时可一键撤回。",
    flash_agree: "请先勾选授权声明",
    flash_invalid_key: "Key 明显无效，已拒绝入池（信誉扣减）",
    flash_malicious: "疑似恶意地址，已拒绝并记录",
    flash_circular_ok: "校验通过，已自动入池，贡献加分将于明日生效。",
    flash_circular_fail: "校验未通过，暂不入池：{err}",
    status_circuited: "熔断中",
    status_invalid: "校验未通过",
    status_inactive: "已下架",
    status_pooled: "在池 · {pct}%",
  },
  docs: {
    title: "使用帮助",
    terms_title: "用户协议",
    page_sub: "接入即用 · OpenAI 兼容",
    s01: "01 · 获取网关 Token",
    s01_body:
      "登录后在使用面板点击「重置」，即会生成唯一的 {sk} Token，更换任意厂商上游地址即可使用。Token 仅展示一次，无法找回。",
    s02: "02 · curl 调用",
    s03: "03 · Python (OpenAI SDK)",
    s04: "04 · JavaScript (fetch)",
    s05: "05 · 配额与限制",
    s05_l1: "每日调用与 Token 分级（信誉 80+ → 100 次/300k Token，最低档 3 次/天永不归零）",
    s05_l2: "新用户注册 7 天内配额减半",
    s05_l3: "提交渠道的贡献者可获得每日 +10 ~ +100 调用次数加成",
    s05_l4: "所有请求走自动故障转移与熔断，尽可能保证请求成功",
    s06: "06 · 异常排查",
    s06_l1_401: "Token 已被重置或无效，重新登录获取",
    s06_l2_429: "今日额度用完，明日自动恢复",
    s06_l3_503: "当前模型无可用渠道，稍后再试或贡献新渠道",
    s06_l4_503: "全站动态服务按免费额度保护，UTC 00:00 自动恢复",
    terms_h1: "用户协议与免责声明",
    terms_sub: "请勿用于违反厂商条款与法律法规的场景",
    t01: "01 · 服务性质",
    t01_body:
      "FreeAI Gateway 是一个社区驱动、仅供学习与测试的 AI 网关。平台本身不提供任何模型服务，仅聚合社区成员自愿共享的 API 凭据。",
    t02: "02 · 自愿提交与授权声明",
    t02_body:
      "提交 API Key 即视为本人合法持有该凭据、自愿共享，并授权平台将其用于请求转发。平台不爬取、不强制任何凭据入库。",
    t03: "03 · 免责声明",
    t03_body:
      "共享 API Key 可能违反相关厂商的服务条款，由此产生的账号封禁、法律风险与任何直接或间接损失，由提交者自行承担。平台尽力保护凭据（AES-256-GCM 加密存储、永不明文展示），但不承担因不可抗力导致的数据丢失责任。",
    t04: "04 · 可撤回",
    t04_body:
      "贡献者可随时在「提交渠道」页面一键删除自己的渠道，删除后该渠道立即退出资源池并失效，相关贡献激励同步终止。如需公开协助删除，可联系平台。",
    t05: "05 · 禁止行为",
    t05_pre: "禁止将本服务用于违反所在地法律、恶意攻击、滥用他人凭据、批量注册等用途。平台将依据信誉机制自动限制异常账号，且永不封禁（见",
    t05_mid: "使用帮助",
    t05_post: "）。",
    t06: "06 · 审计与隐私",
    t06_body:
      "为防御滥用与安全审计，平台记录调用日志（调用方、渠道、时间、状态），日志保留近 7 天用于统计与故障排查；调用内容不会被平台存储或审查。",
  },
  seo: {
    home_desc:
      "免费 AI API 聚合网关：一个 OpenAI 兼容端点、一个网关 Token、调用多个免费模型。社区共享密钥，自动故障转移与熔断保护。",
    docs_desc:
      "FreeAI Gateway 使用帮助：获取一次性网关 Token，用 curl、Python 或 JavaScript 调用 OpenAI 兼容 /v1 接口；配额、可靠性与错误处理。",
    terms_desc:
      "FreeAI Gateway 用户协议与免责声明：自愿共享密钥、AES-256-GCM 加密存储、一键撤回、禁止行为、审计与隐私。",
    auth_desc: "FreeAI Gateway 免费 AI 访问，匿名注册、无需邮箱。",
  },
  errors: {
    unauthorized: "请先登录",
    pool_empty: "资源池当前没有支持该模型的可用渠道",
    pool_none: "资源池暂无可用渠道",
    quota_exceeded: "今日调用额度已用完，请明日再试",
    v_username: "用户名需为 3-20 位字母、数字或下划线",
    v_password_short: "密码至少 8 位",
    v_password_long: "密码过长",
    v_provider: "厂商名称格式不正确",
    v_api_url: "API 地址不是合法 URL",
    v_api_url_https: "仅支持 HTTPS 地址",
    v_api_url_host: "缺少域名",
    v_models_empty: "请至少选择一个模型",
    v_models_too_many: "最多选择 50 个模型",
    v_models_bad: "模型名称格式不正确",
    v_models_format: "模型列表格式错误",
  },
};