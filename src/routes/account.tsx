import { Hono } from "hono";
import type { AppEnv } from "../types";
import { getSessionSid, refreshSessionPassword, requireApiUser } from "../middleware/auth";
import { clientIp, loginBlocked, loginBlockedForUser, loginFailIncrease, loginFailIncreaseUser, loginLockRemainingMs, loginLockRemainingMsUser } from "../middleware/rate-limit";
import { updatePassword } from "../db";
import { pbkdf2Hash, pbkdf2Verify } from "../utils/crypto";
import { validatePassword } from "../validators";
import { t } from "../i18n";

const ROUTER = new Hono<AppEnv>();

/** 修改密码结果 partial（htmx 插入 #pw-result），复用 dashboard flash 样式 */
function MessagePartial(props: { ok?: boolean; text: string }) {
  const cls = props.ok ? "flash flash-ok" : "flash flash-err";
  const dot = props.ok ? "dot-ok" : "dot-bad";
  return (
    <div class={cls}>
      <span class={`dot ${dot}`}></span>
      <span>{props.text}</span>
    </div>
  );
}

/**
 * POST /api/account/password：修改密码
 * - 需登录会话；旧密码验证失败计入 IP+账户登录失败限流（与登录共用，防爆破）
 * - 成功后：更新当前会话 pwv 指纹（当前端保持登录），其它端自动失效
 */
ROUTER.post("/password", requireApiUser, async (c) => {
  const body = await c.req.parseBody();
  const user = c.get("user");
  const username = user.username;
  const ip = clientIp(c);
  const lang = c.get("lang");
  const current = String(body.current_password ?? "");
  const next = String(body.new_password ?? "");
  const confirm = String(body.new_password2 ?? "");

  // 双维度登录锁定联动：已锁定账户/ IP 禁用改密入口
  if ((await loginBlocked(c.env, ip)) || (await loginBlockedForUser(c.env, username))) {
    const remSec = Math.ceil(
      Math.max(await loginLockRemainingMs(c.env, ip), await loginLockRemainingMsUser(c.env, username)) / 1000,
    );
    const message =
      remSec > 0
        ? t(lang, "auth", "err_login_locked").replace("{s}", String(remSec))
        : t(lang, "auth", "err_login_failed");
    return c.html(<MessagePartial text={message} />);
  }

  const r = validatePassword(next);
  if (!r.ok) {
    const key = r.kind === "password_long" ? "v_password_long" : "v_password_short";
    return c.html(<MessagePartial text={t(lang, "errors", key as "v_password_short")} />);
  }
  if (confirm !== next) {
    return c.html(<MessagePartial text={t(lang, "dashboard", "pw_mismatch")} />);
  }
  if (current === next) {
    return c.html(<MessagePartial text={t(lang, "dashboard", "pw_same")} />);
  }
  if (!(await pbkdf2Verify(current, user.password_hash))) {
    await loginFailIncrease(c.env, ip);
    await loginFailIncreaseUser(c.env, username);
    return c.html(<MessagePartial text={t(lang, "dashboard", "pw_bad_current")} />);
  }

  const hash = await pbkdf2Hash(next);
  await updatePassword(c.env, user.id, hash);
  await refreshSessionPassword(c.env, getSessionSid(c), user.id, hash);
  return c.html(<MessagePartial ok text={t(lang, "dashboard", "pw_ok")} />);
});

export default ROUTER;