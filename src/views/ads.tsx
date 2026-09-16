import type { Env } from "../types";
import { adsenseClient, adsenseSlot, adsenseEnabled } from "../config";

/**
 * Google AdSense（仅公开页渲染，由各页面显式放置）
 * - 未启用或 ADSENSE_CLIENT 为空 → 渲染空，行为不变
 * - 有 ADSENSE_SLOT：渲染 728x90 显式广告单元
 * - 无 slot：不渲染显式单元（仅 head 加载自动广告，见 Layout）
 */

export function AdSlot(props: { env: Env; slot?: string }) {
  const { env, slot } = props;
  if (!adsenseEnabled(env)) return null;
  const client = adsenseClient(env);
  const slotId = slot ?? adsenseSlot(env);
  if (!slotId) return null;
  return (
    <div style="margin:26px auto 0;max-width:728px;overflow:hidden">
      <ins
        class="adsbygoogle"
        style="display:inline-block;width:728px;height:90px"
        data-ad-client={client}
        data-ad-slot={slotId}
        data-ad-format="horizontal"
        data-full-width-responsive="true"
      />
      <script dangerouslySetInnerHTML={{ __html: `(adsbygoogle = window.adsbygoogle || []).push({});` }} />
    </div>
  );
}

/** AdSense 官方异步脚本（head 注入；仅启用时输出） */
export function AdSenseHead(props: { env: Env }) {
  const { env } = props;
  if (!adsenseEnabled(env)) return null;
  return (
    <>
      <script
        async
        src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsenseClient(env)}`}
        crossOrigin="anonymous"
      />
    </>
  );
}