/** 输入校验 + 恶意域名识别（见 4.3 / 附录 J） */

export type ValidationResult = { ok: true } | { ok: false; message: string };

export function ok(): ValidationResult {
  return { ok: true };
}

export function fail(message: string): ValidationResult {
  return { ok: false, message };
}

export function validateUsername(username: string): ValidationResult {
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return fail("用户名需为 3-20 位字母、数字或下划线");
  }
  return ok();
}

export function validatePassword(pw: string): ValidationResult {
  if (pw.length < 8) return fail("密码至少 8 位");
  if (pw.length > 128) return fail("密码过长");
  return ok();
}

export function validateProvider(name: string): ValidationResult {
  if (!/^[a-zA-Z0-9 _\-\.]{1,40}$/.test(name)) return fail("厂商名称格式不正确");
  return ok();
}

/** API 端点校验：必须是 https（本地调试除外）、合法 URL、不含路径 */
export function validateApiUrl(url: string): ValidationResult {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return fail("API 地址不是合法 URL");
  }
  if (u.protocol !== "https:") return fail("仅支持 HTTPS 地址");
  if (!u.hostname) return fail("缺少域名");
  return ok();
}

/** 疑似恶意域名黑名单（宽松判断，见 J.3：-30 分 + 下架） */
const SKETCHY = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  ".local",
  ".internal",
  ".example",
  ".test",
  ".onion",
];

export function isMaliciousDomain(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  // 内网 / 保留 IPv4 段（SSRF 防护）
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (ipv4) {
    const o1 = Number(ipv4[1]);
    const o2 = Number(ipv4[2]);
    const reserved =
      o1 === 10 ||
      o1 === 127 ||
      o1 === 0 ||
      (o1 === 192 && o2 === 168) ||
      (o1 === 172 && o2 >= 16 && o2 <= 31) ||
      (o1 === 169 && o2 === 254) ||
      (o1 === 100 && o2 >= 64 && o2 <= 127);
    if (reserved) return true;
  }
  return SKETCHY.some((s) => h === s || h.endsWith(s));
}

/** 模型列表必须是 JSON 字符串数组，长度<=50 */
export function validateModelsList(modelsJson: string): ValidationResult {
  try {
    const arr = JSON.parse(modelsJson) as unknown;
    if (!Array.isArray(arr) || arr.length === 0) return fail("请至少选择一个模型");
    if (arr.length > 50) return fail("最多选择 50 个模型");
    for (const m of arr) {
      if (typeof m !== "string" || !/^[a-zA-Z0-9 _\-\.:]{1,80}$/.test(m)) {
        return fail("模型名称格式不正确");
      }
    }
    return ok();
  } catch {
    return fail("模型列表格式错误");
  }
}

/** 校验传入上游 API 的明文 Key 是否"明显无效"（无空、前缀检查，不做真实调用） */
export function isBlatantlyInvalidKey(key: string): boolean {
  return !key || key.length < 8 || !/^[A-Za-z0-9_\-.]{8,256}$/.test(key);
}