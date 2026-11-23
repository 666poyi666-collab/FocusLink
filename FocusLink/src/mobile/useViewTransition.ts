import { useCallback, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';

export interface ViewTransitionDetail {
  from: string;
  to: string;
  animated: boolean;
}

/** 运行时可能没有 View Transitions（旧 WebView），这里按可选能力探测。 */
type ViewTransitionCapableDocument = Document & {
  startViewTransition?: (callback: () => void) => unknown;
};

/**
 * 切页过渡：优先用浏览器原生 View Transitions（合成器做交叉淡入，主线程只负责换内容），
 * 不支持时直接切换；reduced-motion 下退化为瞬时切换。
 * 无论走哪条路径都会派发 fl:view-transition 事件，方便测试与降级观察。
 */
export function useViewTransition(current: string, onChange: (next: string) => void) {
  const currentRef = useRef(current);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  return useCallback(
    (next: string) => {
      const from = currentRef.current;
      if (next === from) return;
      const doc = document as ViewTransitionCapableDocument;
      const reduceMotion =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const start = doc.startViewTransition;
      const animated = !reduceMotion && typeof start === 'function';
      const detail: ViewTransitionDetail = { from, to: next, animated };
      window.dispatchEvent(new CustomEvent<ViewTransitionDetail>('fl:view-transition', { detail }));
      if (animated && typeof start === 'function') {
        start.call(doc, () => {
          currentRef.current = next;
          // 必须同步提交：否则快照拍在旧 DOM 上，新页面反而看不到。
          flushSync(() => onChange(next));
        });
        return;
      }
      currentRef.current = next;
      onChange(next);
    },
    [onChange],
  );
}
