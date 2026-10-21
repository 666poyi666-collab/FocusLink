import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import './workspace-columns.css';

type Columns = { left: number; right: number };

export function fitWorkspaceColumns(width: number, preferred: Columns): Columns {
  const budget = Math.max(0, width - 360 - 12);
  const left = Math.max(144, Math.min(preferred.left, 300, budget - 260));
  const right = Math.max(260, Math.min(preferred.right, 520, budget - left));
  return { left, right };
}

export function useWorkspaceColumns(storageKey: string, defaults: Columns) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  const [preferred, setPreferred] = useState<Columns>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      return saved && Number.isFinite(saved.left) && Number.isFinite(saved.right)
        ? saved
        : defaults;
    } catch {
      return defaults;
    }
  });
  /* 首帧宽度必须与真实 clientWidth 一致（v1.6.8）：原来用 useEffect 在首绘之后才量宽，
   * 于是任务页 / 统计页首访都多一次「先按 1200 布局、再按真实宽度重排」的提交，
   * CDP 里能看到 4 次布局。改成 useLayoutEffect 后这次修正发生在**首绘之前**，
   * 页面不会再出现列宽跳动；宽度没变时用函数式 bail-out 让 React 直接跳过重渲染。
   * 任务页与统计页共用本 hook，两页默认列宽都远小于 1200 的预算，故修正常常是等值写入。*/
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const sync = () => {
      const next = node.clientWidth;
      setWidth((current) => (current === next ? current : next));
    };
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    sync();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(preferred));
    } catch {
      /* storage unavailable */
    }
  }, [preferred, storageKey]);
  const actual = fitWorkspaceColumns(width, preferred);
  const set = (side: keyof Columns, value: number) => {
    setPreferred((current) => fitWorkspaceColumns(width, { ...current, [side]: value }));
  };
  const divider = (side: keyof Columns, label: string) => (
    <WorkspaceDivider
      key={side}
      label={label}
      side={side}
      value={actual[side]}
      min={side === 'left' ? 144 : 260}
      max={Math.min(
        side === 'left' ? 300 : 520,
        width - 372 - actual[side === 'left' ? 'right' : 'left'],
      )}
      onChange={(value) => set(side, value)}
      onReset={() => set(side, defaults[side])}
    />
  );
  return {
    ref,
    style: {
      '--workspace-left': `${actual.left}px`,
      '--workspace-right': `${actual.right}px`,
    } as CSSProperties,
    divider,
  };
}

function WorkspaceDivider({
  label,
  side,
  value,
  min,
  max,
  onChange,
  onReset,
}: {
  label: string;
  side: keyof Columns;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onReset: () => void;
}) {
  const drag = useRef<{ x: number; value: number } | null>(null);
  return (
    <div
      className={`workspace-divider workspace-divider-${side}`}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={Math.max(min, Math.round(max))}
      tabIndex={0}
      title={`${label}，拖动调整；双击恢复`}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        const delta = event.shiftKey ? 40 : 16;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          onChange(
            value + (event.key === 'ArrowRight' ? delta : -delta) * (side === 'right' ? -1 : 1),
          );
        } else if (event.key === 'Home') {
          event.preventDefault();
          onChange(min);
        } else if (event.key === 'End') {
          event.preventDefault();
          onChange(max);
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        drag.current = { x: event.clientX, value };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        onChange(
          drag.current.value + (event.clientX - drag.current.x) * (side === 'right' ? -1 : 1),
        );
      }}
      onPointerUp={(event) => {
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
    />
  );
}
