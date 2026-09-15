import type { DBChannel } from "../db/schema";
import { modelsMatch, parseModels } from "../db/schema";

/**
 * 调度引擎（见五章 5.3）：
 * - 模型用 JSON 解析精确匹配（含 * 通配），LIKE 仅粗筛（A3）
 * - 加权随机：weight × success_rate
 * - 调用方负责故障转移重试链（proxy.ts）
 */
export function pickChannel(channels: DBChannel[], model: string): DBChannel | null {
  const candidates = channels.filter((c) => modelsMatch(model, parseModels(c)));
  if (!candidates.length) return null;

  const weights = candidates.map((c) => Math.max(c.weight, 0.1) * Math.max(c.success_rate, 0.01));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i] ?? 0;
    if (r <= 0) return candidates[i] ?? null;
  }
  return candidates[candidates.length - 1] ?? null;
}