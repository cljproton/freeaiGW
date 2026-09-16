import { Hono } from "hono";
import type { AppEnv } from "../types";
import {
  clearSessionCookie,
  createSession,
  destroySession,
  getSessionSid,
  setFlash,
  setSessionCookie,
} from "../middleware/auth";
import { clientIp, loginBlocked, loginFailIncrease, loginFailReset } from "../middleware/rate-limit";
import { countIpRegsToday, createUser, getUserByUsername, insertIpLog, issueToken } from "../db";
import { generateGatewayToken, pbkdf2Hash, pbkdf2Verify, sha256Hex } from "../utils/crypto";
import { powIssue, powVerify } from "../utils/pow";
import { validatePassword, validateUsername } from "../validators";
import { t } from "../i18n";
import { canonicalBase } from "../utils/seo";
import { AuthPage } from "../views/auth";

const ROUTER = new Hono<AppEnv>();

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

/** 反滥用（无第三方）：蜜罐 + 提交时序。返回错误文案（已本地化）；通过返回 null */
const MIN_ELAPSED_MS = 2500;
const MAX_ELAPSED_MS = 600_000;
function botcheckError(lang: "en" | "zh", body: Record<string, unknown>, now: number): string | null {
  // 蜜罐：真实用户不可见，自动填充的机器人会填写
  if (typeof body.website === "string" && body.website.length > 0) {
    return t(lang, "auth", "err_suspicious");
  }
  // 提交时序：过快或过旧视为机器人
  const gotTs = Number(body.got_ts ?? "");
  const elapsed = now - gotTs;
  if (!Number.isFinite(gotTs) || elapsed < MIN_ELAPSED_MS || elapsed > MAX_ELAPSED_MS) {
    return t(lang, "auth", "err_timing");
  }
  return null;
}

// 认证页禁止缓存，避免拿到旧版页面
ROUTER.use("*", (c, next) => {
  c.res.headers.set("Cache-Control", "no-store");
  c.res.headers.set("Pragma", "no-cache");
  return next();
});

/** GET /auth 渲染表单（登录/注册 Tab 合并一页） */
ROUTER.get("/", async (c) => {
  const mode = c.req.query("mode") === "register" ? "register" : "login";
  const pow = await powIssue(c.env);
  const lang = c.get("lang");
  return c.html(
    <AuthPage
      pow={pow}
      gotTs={Date.now()}
      mode={mode}
      lang={lang}
      env={c.env}
      base={canonicalBase(c)}
      seo={{ path: "/auth", description: t(lang, "seo", "auth_desc"), noindex: true }}
    />,
  );
});

/** POST /auth/register */
ROUTER.post("/register", async (c) => {
  const body = await c.req.parseBody();
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  const ip = clientIp(c);
  const lang = c.get("lang");
  // 每个 POST 渲染都带一份新挑战，避免错误页复用已消费/过期的挑战
  const pow = await powIssue(c.env);
  const gotTs = Date.now();

  const r1 = validateUsername(username);
  if (!r1.ok) {
    return c.html(<AuthPage pow={pow} gotTs={gotTs} mode="register" error={t(lang, "errors", "v_username")} lang={lang} env={c.env} />);
  }
  const r2 = validatePassword(password);
  if (!r2.ok) {
    const key = r2.kind === "password_long" ? "v_password_long" : "v_password_short";
    return c.html(<AuthPage pow={pow} gotTs={gotTs} mode="register" error={t(lang, "errors", key)} lang={lang} env={c.env} />);
  }

  const ipCount = await countIpRegsToday(c.env, ip);
  if (ipCount >= (Number(c.env.MAX_REGISTER_PER_IP_PER_DAY) || 20)) {
    return c.html(<AuthPage pow={pow} gotTs={gotTs} mode="register" error={t(lang, "auth", "err_ip_limit")} lang={lang} env={c.env} />);
  }

  const botErr = botcheckError(lang, body as Record<string, unknown>, Date.now());
  if (botErr) return c.html(<AuthPage pow={pow} gotTs={gotTs} mode="register" error={botErr} lang={lang} env={c.env} />);
  const okPow = await powVerify(c.env, String(body.pow_id ?? ""), String(body.pow_salt ?? ""), String(body.pow_n ?? ""));
  if (!okPow) return c.html(<AuthPage pow={pow} gotTs={gotTs} mode="register" error={t(lang, "auth", "err_pow")} lang={lang} env={c.env} />);

  if (!USERNAME_RE.test(username)) {
    return c.html(
      <AuthPage pow={pow} gotTs={gotTs} mode="register" error={t(lang, "auth", "err_username_charset")} lang={lang} env={c.env} />,
    );
  }

  const exists = await getUserByUsername(c.env, username);
  if (exists) {
    return c.html(<AuthPage pow={pow} gotTs={gotTs} mode="register" error={t(lang, "auth", "err_username_exists")} lang={lang} env={c.env} />);
  }

  const passwordHash = await pbkdf2Hash(password);
  const user = await createUser(c.env, username, passwordHash, ip);
  await insertIpLog(c.env, ip);

  const sid = await createSession(c.env, user.id);
  setSessionCookie(c, sid);
  // 生成明文一次，写入 flash（注册成功页展示），随后只存哈希
  const plainToken = generateGatewayToken();
  const tokenHash = await sha256Hex(plainToken);
  await issueToken(c.env, user.id, tokenHash, plainToken.slice(0, 7), "Default");
  await setFlash(c.env, sid, plainToken);
  return c.redirect("/dashboard?welcome=1");
});

/** POST /auth/login */
ROUTER.post("/login", async (c) => {
  const body = await c.req.parseBody();
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  const ip = clientIp(c);
  const lang = c.get("lang");
  const pow = await powIssue(c.env);
  const gotTs = Date.now();

  if (await loginBlocked(c.env, ip)) {
    return c.html(<AuthPage pow={pow} gotTs={gotTs} mode="login" error={t(lang, "auth", "err_login_blocked")} lang={lang} env={c.env} />);
  }

  const botErr = botcheckError(lang, body as Record<string, unknown>, Date.now());
  if (botErr) return c.html(<AuthPage pow={pow} gotTs={gotTs} mode="login" error={botErr} lang={lang} env={c.env} />);
  const okPow = await powVerify(c.env, String(body.pow_id ?? ""), String(body.pow_salt ?? ""), String(body.pow_n ?? ""));
  if (!okPow) return c.html(<AuthPage pow={pow} gotTs={gotTs} mode="login" error={t(lang, "auth", "err_pow")} lang={lang} env={c.env} />);

  const user = await getUserByUsername(c.env, username);
  if (!user || !(await pbkdf2Verify(password, user.password_hash))) {
    await loginFailIncrease(c.env, ip);
    return c.html(<AuthPage pow={pow} gotTs={gotTs} mode="login" error={t(lang, "auth", "err_bad_credentials")} lang={lang} env={c.env} />);
  }

  await loginFailReset(c.env, ip);
  const sid = await createSession(c.env, user.id);
  setSessionCookie(c, sid);
  return c.redirect("/dashboard");
});

/** POST /auth/logout */
ROUTER.post("/logout", async (c) => {
  const sid = getSessionSid(c);
  if (sid) await destroySession(c.env, sid);
  clearSessionCookie(c);
  return c.redirect("/");
});

export default ROUTER;