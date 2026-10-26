/**
 * Android 15（API 35）强制 edge-to-edge 后，WebView 里的 env(safe-area-inset-*) 只反映刘海/挖孔，
 * 不含系统状态栏与手势条的高度——顶部内容会被状态栏压住、底部按钮落到手势区下面。
 * 原生侧把真实 inset 写进 CSS 变量，样式层用 --fl-edge-top/bottom 取「原生值与 env() 的较大者」。
 *
 * 约定：
 *   - 原生通过 window.__focuslinkInsetsApply(top, bottom)（单位 px）注入；
 *   - 样式层读 --fl-inset-top / --fl-inset-bottom，上限 clamp 到 120px，避免异常值把首屏挤掉。
 */

export interface MobileSystemInsets {
  top: number;
  bottom: number;
}

const MAX_INSET_PX = 120;

declare global {
  interface Window {
    __focuslinkInsets?: MobileSystemInsets;
    __focuslinkInsetsApply?: (top: number, bottom: number) => MobileSystemInsets;
  }
}

function clampInset(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_INSET_PX, Math.max(0, Math.round(value)));
}

/** 写入 CSS 变量并回读给原生；返回实际生效的整数值。 */
export function applyMobileSystemInsets(top: number, bottom: number): MobileSystemInsets {
  const insets = { top: clampInset(top), bottom: clampInset(bottom) };
  const root = document.documentElement;
  root.style.setProperty('--fl-inset-top', insets.top + 'px');
  root.style.setProperty('--fl-inset-bottom', insets.bottom + 'px');
  window.__focuslinkInsets = insets;
  return insets;
}

/** 让原生在页面就绪后可以直接调用；重复注册是幂等的。 */
export function installMobileSystemInsetsBridge(): void {
  window.__focuslinkInsetsApply = applyMobileSystemInsets;
}
