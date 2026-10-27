// 移动端时间之带（1.7.1）。
//
// 三种表现形式来自已评审的交互预览 `frontend-design/mobile-next-preview.html`：
//   · 流线 flow  —— 多层细线沿时间轴缓慢起伏（默认）
//   · 光栅 light —— 逐 3px 竖线的呼吸光栅
//   · 时段 blocks—— 连续的实心时段块
// 三种模式共用同一套时间窗：`zoom` 分钟视野 + 拖动平移；游标永远指向「现在」（暂停时指向暂停）。
//
// 数据只来自真实 TimerSnapshot（segments / pauseEvents），不伪造时段；颜色全部读取 app 的
// --m-* 语义 token（即 --app-* 的移动端别名），不新增一套配色；桌面 TemporalRibbon 不受影响。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import type { TimerSnapshot, TimerState } from '@shared/types';
import { formatClockDuration } from './runtimeModel';

export type RibbonMode = 'flow' | 'light' | 'blocks';

interface RibbonPhase {
  type: 'focus' | 'pause';
  /** 相对本次 session 开始的秒数 */
  start: number;
  /** 秒；null 表示仍在进行 */
  end: number | null;
  taskTitle: string | null;
}

interface RibbonModel {
  phases: RibbonPhase[];
  /** 本次 session 的起点（本地 epoch ms），用于把相对秒还原成钟点 */
  sessionStart: number | null;
}

const MODE_LABELS: Array<{ id: RibbonMode; label: string }> = [
  { id: 'flow', label: '流线' },
  { id: 'light', label: '光栅' },
  { id: 'blocks', label: '时段' },
];

const DEFAULT_ZOOM_MINUTES = 40;
const MIN_ZOOM_MINUTES = 5;
const MAX_ZOOM_MINUTES = 60;

/** 把真实账本折成「专注 / 暂停」交替的相对秒时间线。 */
function buildRibbonModel(snapshot: TimerSnapshot): RibbonModel {
  const starts = [
    ...snapshot.segments.map((segment) => segment.startedAt),
    ...snapshot.pauseEvents.map((pause) => pause.pauseStartedAt),
  ];
  if (starts.length === 0) return { phases: [], sessionStart: null };
  const sessionStart = Math.min(...starts);
  const phases: RibbonPhase[] = [
    ...snapshot.segments.map((segment) => ({
      type: 'focus' as const,
      start: (segment.startedAt - sessionStart) / 1000,
      end: segment.endedAt === null ? null : (segment.endedAt - sessionStart) / 1000,
      taskTitle: segment.taskTitle,
    })),
    ...snapshot.pauseEvents.map((pause) => ({
      type: 'pause' as const,
      start: (pause.pauseStartedAt - sessionStart) / 1000,
      end: pause.pauseEndedAt === null ? null : (pause.pauseEndedAt - sessionStart) / 1000,
      taskTitle: null,
    })),
  ].sort((left, right) => left.start - right.start);
  return { phases, sessionStart };
}

function formatSeconds(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  return `${hours > 0 ? `${hours}:` : ''}${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function formatClockTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(timestamp);
}

function cssColor(varName: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return value || fallback;
}

interface RibbonPalette {
  accent: string;
  pause: string;
  muted: string;
  line: string;
  font: string;
}

/**
 * 主题 / 强调色 / 字体都会改 `<html>` 上的类名，用类名做缓存键：
 * 逐帧读取 5 个 CSS 变量会强制样式重算，在 headless + 高 DPR 下会把主线程拖死。
 */
let paletteKey = '';
let paletteCache: RibbonPalette | null = null;

function readPalette(): RibbonPalette {
  const key = document.documentElement.className;
  if (paletteCache && paletteKey === key) return paletteCache;
  paletteKey = key;
  paletteCache = {
    accent: cssColor('--m-accent', '#007A55'),
    pause: cssColor('--m-pause', '#D24339'),
    muted: cssColor('--m-muted', '#5F6368'),
    line: cssColor('--m-border', '#DDDCD6'),
    font: cssColor('--font-number', 'monospace'),
  };
  return paletteCache;
}

function phaseListRows(model: RibbonModel, wallSeconds: number) {
  return model.phases
    .map((phase) => {
      const end = phase.end ?? Math.max(phase.start, wallSeconds);
      const durationMinutes = Math.max(0, Math.round((end - phase.start) / 60));
      const startLabel =
        model.sessionStart === null
          ? '—'
          : formatClockTime(model.sessionStart + phase.start * 1000);
      const endLabel =
        phase.end === null || model.sessionStart === null
          ? '现在'
          : formatClockTime(model.sessionStart + phase.end * 1000);
      return {
        key: `${phase.type}-${phase.start}`,
        label: `${startLabel}–${endLabel} ${phase.type === 'pause' ? '暂停' : '专注'} ${durationMinutes} 分钟`,
      };
    })
    .slice(0, 24);
}

export interface MobileRibbonProps {
  snapshot: TimerSnapshot;
  /** 实时墙钟已过毫秒（含秒级推进），决定游标位置与可视窗右界 */
  wallMs: number;
  /** 实时有效专注毫秒，用于 aria 说明 */
  activeMs: number;
  state: TimerState;
}

export function MobileRibbon({ snapshot, wallMs, activeMs, state }: MobileRibbonProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [mode, setMode] = useState<RibbonMode>('flow');
  const [zoomMinutes, setZoomMinutes] = useState(DEFAULT_ZOOM_MINUTES);
  const [offsetSeconds, setOffsetSeconds] = useState(0);
  const dragRef = useRef<{ pointerId: number; lastX: number; usable: number; span: number } | null>(
    null,
  );
  const model = useMemo(() => buildRibbonModel(snapshot), [snapshot]);
  const wallSeconds = Math.max(0, wallMs / 1000);
  const phasesRef = useRef<RibbonPhase[]>(model.phases);
  phasesRef.current = model.phases;

  const clampOffset = useCallback((value: number, span: number, wall: number) => {
    const maxOffset = Math.max(0, wall - span * 0.82);
    return Math.min(maxOffset, Math.max(0, value));
  }, []);

  // 画布：一次绘制函数，模式 / 视野 / 平移 / 尺寸变化都走它。
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const width = wrap.clientWidth;
    const height = wrap.clientHeight;
    if (width <= 0 || height <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const palette = readPalette();
    const accent = palette.accent;
    const pause = palette.pause;
    const muted = palette.muted;
    const line = palette.line;
    const numberFont = palette.font;

    const wall = wallSeconds;
    const span = zoomMinutes * 60;
    const pad = 8;
    const usable = Math.max(1, width - pad * 2);
    const left = Math.max(0, wall - span * 0.82 - offsetSeconds);
    const right = left + span;
    const map = (seconds: number) => pad + ((seconds - left) / span) * usable;

    // 纵向分区（画布高度会被 CSS 压在 96px 左右）：
    //   顶部 labelBand 留给「现在 / 暂停」游标标签，基线 23 → 11px 字号的字顶在 14px，
    //   不会被画布上边缘切掉；底部 labelBand 留给刻度文字；中间才是波形通道。
    const cursorLabelBaseline = 23;
    const axisY = height - 24;
    const channelTop = cursorLabelBaseline + 2;
    const mid = (channelTop + axisY) / 2;

    // 基线 + 刻度
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, axisY);
    ctx.lineTo(width - pad, axisY);
    ctx.stroke();
    const tick = span <= 900 ? 120 : 600;
    ctx.font = `11px ${numberFont}`;
    ctx.fillStyle = muted;
    for (let second = Math.ceil(left / tick) * tick; second < right; second += tick) {
      const x = map(second);
      if (x < 24 || x > width - 24) continue;
      ctx.beginPath();
      ctx.moveTo(x, axisY - 3);
      ctx.lineTo(x, axisY + 3);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillText(formatSeconds(second).replace(/:00$/, ''), x, height - 6);
    }

    const animate = state === 'running';
    const at = animate ? performance.now() / 1000 : 0;

    model.phases.forEach((phase, index) => {
      const from = Math.max(left, phase.start);
      const to = Math.min(right, phase.end ?? wall);
      if (to <= from) return;
      const xa = map(from);
      const xb = map(to);
      const width = xb - xa;
      const color = phase.type === 'pause' ? pause : accent;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      if (mode === 'blocks') {
        ctx.globalAlpha = phase.type === 'pause' ? 0.65 : 0.85;
        ctx.beginPath();
        ctx.roundRect(
          xa,
          mid - (phase.type === 'pause' ? 8 : 17),
          Math.max(1, width - 2),
          phase.type === 'pause' ? 16 : 34,
          5,
        );
        ctx.fill();
      } else if (mode === 'light') {
        for (let x = xa; x < xb; x += 3) {
          const ratio = (x - xa) / Math.max(1, width);
          const barHeight =
            (phase.type === 'pause' ? 7 : 17) * (0.4 + 0.6 * Math.sin(Math.PI * ratio));
          ctx.globalAlpha = 0.25 + 0.65 * Math.sin(Math.PI * ratio);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(x, mid - barHeight);
          ctx.lineTo(x, mid + barHeight);
          ctx.stroke();
        }
      } else {
        const layers = phase.type === 'pause' ? 7 : 15;
        for (let layer = 0; layer < layers; layer += 1) {
          const centre = layer - (layers - 1) / 2;
          ctx.globalAlpha =
            (phase.type === 'pause' ? 0.2 : 0.09) +
            0.34 * (1 - Math.abs(centre) / Math.max(1, layers));
          ctx.lineWidth = phase.type === 'pause' ? 0.8 : 1;
          ctx.beginPath();
          for (let x = xa; x <= xb; x += 2) {
            const ratio = (x - xa) / Math.max(1, width);
            const fade = Math.pow(
              Math.sin(Math.PI * Math.min(0.999, Math.max(0.001, ratio))),
              0.45,
            );
            const amplitude = phase.type === 'pause' ? 2.5 : 5.5;
            const wave =
              Math.sin(x * 0.027 - at * 0.32 + index + layer * 0.16) * amplitude +
              Math.sin(x * 0.009 + at * 0.21 + layer * 0.14) * amplitude * 0.65;
            const y = mid + (centre * 2.5 + wave) * fade;
            if (x === xa) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    });

    // 游标：现在 / 暂停
    const nowX = map(wall);
    if (nowX >= pad && nowX <= width - pad) {
      ctx.strokeStyle = state === 'paused' ? pause : accent;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(nowX, channelTop);
      ctx.lineTo(nowX, axisY);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = state === 'paused' ? pause : accent;
      ctx.beginPath();
      ctx.arc(nowX, mid, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.textAlign = nowX > width - 60 ? 'right' : 'left';
      ctx.fillText(
        state === 'paused' ? '暂停' : '现在',
        nowX + (nowX > width - 60 ? -6 : 6),
        cursorLabelBaseline,
      );
    }
  }, [mode, offsetSeconds, state, wallSeconds, zoomMinutes, model.phases]);

  // 尺寸变化重绘
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [draw]);

  // 运行中持续重绘（流线会缓慢起伏）；暂停 / 待机只画一次，尊重减少动效。
  useEffect(() => {
    draw();
    if (state !== 'running') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    let last = 0;
    const tick = (timestamp: number) => {
      // 约 25fps：流线的起伏本来就慢，再高只会白烧主线程。
      if (timestamp - last >= 40) {
        last = timestamp;
        draw();
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [draw, state]);

  // 主题切换（html 上的 light/dark 类）时重绘，让画布颜色跟着 token 走。
  useEffect(() => {
    const observer = new MutationObserver(() => draw());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [draw]);

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const span = zoomMinutes * 60;
    dragRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      usable: Math.max(1, wrap.clientWidth - 16),
      span,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaPx = event.clientX - drag.lastX;
    if (deltaPx === 0) return;
    drag.lastX = event.clientX;
    const secondsPerPixel = drag.span / drag.usable;
    setOffsetSeconds((current) =>
      clampOffset(current + deltaPx * secondsPerPixel, drag.span, wallSeconds),
    );
  };

  const endDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  };

  const onWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    const next = zoomMinutes + (event.deltaY > 0 ? 5 : -5);
    setZoomMinutes(Math.min(MAX_ZOOM_MINUTES, Math.max(MIN_ZOOM_MINUTES, next)));
    setOffsetSeconds((current) => clampOffset(current, next * 60, wallSeconds));
  };

  const rows = phaseListRows(model, wallSeconds);
  const stateLabel = state === 'running' ? '专注进行中' : state === 'paused' ? '已暂停' : '待开始';
  const canvasLabel = `本轮专注与暂停时间线：有效专注 ${formatClockDuration(
    activeMs,
  )}，${stateLabel}；下方有等价时段明细`;

  return (
    <section className="ribbon-area" data-ribbon-mode={mode} aria-label="时间之带">
      <div className="ribbon-head">
        <h3 className="ribbon-heading">时间之带</h3>
        <div className="ribbon-modes" role="group" aria-label="时间之带表现形式">
          {MODE_LABELS.map((item) => (
            <button
              key={item.id}
              className={item.id === mode ? 'ribbon-mode is-active' : 'ribbon-mode'}
              type="button"
              aria-pressed={item.id === mode}
              onClick={() => setMode(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ribbon-canvas-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="ribbon-canvas"
          role="img"
          aria-label={canvasLabel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onWheel={onWheel}
        />
      </div>

      <div className="ribbon-tools">
        <span className="ribbon-hint">拖动查看时段</span>
        <label className="ribbon-zoom">
          <span>视野</span>
          <input
            type="range"
            min={MIN_ZOOM_MINUTES}
            max={MAX_ZOOM_MINUTES}
            step={1}
            value={zoomMinutes}
            aria-label="时间之带显示分钟数"
            onChange={(event) => {
              const next = Number(event.target.value);
              setZoomMinutes(next);
              setOffsetSeconds((current) => clampOffset(current, next * 60, wallSeconds));
            }}
          />
        </label>
      </div>

      <ol className="ribbon-phases sr-only">
        {rows.map((row) => (
          <li key={row.key}>{row.label}</li>
        ))}
        {rows.length === 0 && <li>本轮还没有记录</li>}
      </ol>
    </section>
  );
}
