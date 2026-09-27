// 时间之带：一条真实墙钟刻度轨道，用「材料」表达时间的去向。
//
//  · 专注 = 强调色的半透明磨砂带。运行、暂停、结束展示都使用同一套平直玻璃边缘与柔和内雾，
//    不生成逐列锯齿或外溢浮尘；镜头随墙钟连续滑动，所以轮廓始终干净、稳定。
//  · 暂停 = 红色粒子从前沿持续剥离、上浮、缩小、熄灭。粒子最终会全部消散，
//    只在轨道底部留下一道疤痕：那段时间确实发生过，但什么都没留下。
//
// 渲染成本与时长无关：专注段是常数次渐变填充，暂停粒子由固定寿命封顶。
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BAND_POINTER_RATIO,
  BAND_SCALE_FAR,
  BAND_SCALE_NEAR,
  BAND_ZOOM_MS,
  DISSOLVE_ION_MAX_LIFE_MS,
  PAUSE_LOSS_MAX_LIFE_MS,
  POINTER_GLOW_MAX_ALPHA,
  bandScaleForState,
  dissolveIons,
  easeInOutQuart,
  focusMaterialPose,
  frontierGlowAlpha,
  interpolateZoomScale,
  macroTickAlpha,
  mixRgb,
  overviewMajorStepSec,
  overviewScaleForSpan,
  OVERVIEW_TICK_LADDER_SEC,
  overviewTickStepSec,
  particleAshColor,
  pointerBreathPulse,
  secondTickAlpha,
  steppedDisplaySeconds,
} from '@shared/focus/bandMath';
import type { RgbTuple } from '@shared/focus/bandMath';
import { formatClockSeconds, formatDurationPadded } from '../../lib/time';
import { getCumulativeActiveMs, getCurrentPauseDisplayMs } from '@shared/focus/selectors';
import { buildMixedTimelineItems } from '@shared/focus/timeline';
import type { TimelineItem } from '@shared/focus/timeline';
import type { TimerSnapshot, TimerState } from '@shared/types';

/**
 * 唯一的跨帧可变状态就是镜头尺度与进行中的变焦动画。
 * 材料形态全部由「时段 + 墙钟」纯函数推导，因此画面可以随时冻结、随时恢复。
 */
type BandEngine = {
  scale: number;
  zoom: { from: number; to: number; start: number; duration: number } | null;
};

type BandColors = {
  ink: RgbTuple;
  text: RgbTuple;
  muted: RgbTuple;
  subtle: RgbTuple;
  accent: RgbTuple;
  accentDeep: RgbTuple;
  pause: RgbTuple;
  surface: RgbTuple;
  surface2: RgbTuple;
  border: RgbTuple;
  borderStrong: RgbTuple;
  /** 亮色主题为白、暗色主题为浅墨；高光与蚀刻线共用。 */
  light: RgbTuple;
  isDark: boolean;
};

type BandPaintStyle = {
  colors: BandColors;
  fontNumber: string;
  fontSmallNumber: string;
  fontUi: string;
};

type BandGeometry = {
  width: number;
  height: number;
  channelTop: number;
  channelBottom: number;
  /** 材料相对轨道的内缩，使实体不贴死轨道边框。 */
  materialTop: number;
  materialBottom: number;
};

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export function TemporalRibbon({
  snapshot,
  state,
  now,
}: {
  snapshot: TimerSnapshot | null;
  state: TimerState;
  now: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<BandEngine>({
    scale: bandScaleForState(state),
    zoom: null,
  });
  const scheduleDrawRef = useRef<() => void>(() => undefined);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const stateRef = useRef(state);
  stateRef.current = state;
  const timelineItems = useMemo(
    () =>
      buildMixedTimelineItems({
        segments: snapshot?.segments ?? [],
        pauseEvents: snapshot?.pauseEvents ?? [],
        currentSegmentId: snapshot?.currentSegmentId ?? null,
        state,
        // 进行中区间的绘制终点始终使用当前帧墙钟；duration 不参与 Canvas 投影。
        now: 0,
      }),
    [snapshot?.segments, snapshot?.pauseEvents, snapshot?.currentSegmentId, state],
  );
  const timelineItemsRef = useRef(timelineItems);
  timelineItemsRef.current = timelineItems;

  /* 结束退场：主进程在 finished → idle 时会把 snapshot 的片段一并清空
     （实测：finished 时 moments 有数据，3 秒后转 idle 那一帧 moments 变成空数组）。
     因此材料、账本行、读数会在同一帧被硬拔掉——用户感觉到的「卡顿」就在这里，
     跟帧率无关（帧率全程满，最大 12.5ms）。
     这里把最后一笔已结束的会话留一份，idle 之后继续画，由 renderBand 在 320ms 内淡出。 */
  const exitRef = useRef<{
    moments: TimelineItem[];
    endedAt: number;
    idleSince: number | null;
  }>({ moments: [], endedAt: 0, idleSince: null });
  const exit = exitRef.current;
  if (state === 'finished' && timelineItems.length > 0) {
    const lastEnd = timelineItems.reduce(
      (latest, item) => Math.max(latest, item.endedAt ?? item.startedAt),
      0,
    );
    exit.moments = timelineItems;
    exit.endedAt = lastEnd;
    exit.idleSince = null;
  } else if (state === 'idle') {
    exit.idleSince = exit.idleSince ?? Date.now();
  } else {
    exit.idleSince = null;
  }
  /** 本帧应该画哪些区间：活动态用自己的数据，idle 退场期用留住的那一份。 */
  const paintItems =
    state === 'idle' && exit.moments.length > 0 && exit.idleSince !== null
      ? exit.moments
      : timelineItems;
  const paintItemsRef = useRef(paintItems);
  paintItemsRef.current = paintItems;

  const reducedMotion = useReducedMotion();
  const [viewMode, setViewMode] = useState<'auto' | 'near' | 'far'>('auto');
  const [viewportWidth, setViewportWidth] = useState(0);

  // 暂停保持近景：损耗最需要被看清的时刻不应该被拉远。
  const effectiveViewMode = state === 'paused' ? 'near' : viewMode;
  const live = state === 'running' || state === 'paused';
  const resolvedMode: 'near' | 'far' =
    effectiveViewMode === 'auto'
      ? bandScaleForState(state) === BAND_SCALE_NEAR
        ? 'near'
        : 'far'
      : effectiveViewMode;

  // 总览铺满指针左侧的“过去”区域；留 12% 余量，让会话起点不贴死画布左缘。
  const sessionSpanSec = useMemo(() => {
    let earliest = Number.POSITIVE_INFINITY;
    let latest = 0;
    for (const item of timelineItems) {
      earliest = Math.min(earliest, item.startedAt);
      latest = Math.max(latest, item.endedAt ?? (item.isOngoing ? now : item.startedAt));
    }
    if (!Number.isFinite(earliest) || latest <= earliest) return 0;
    return (latest - earliest) / 1000;
  }, [timelineItems, now]);
  const overviewScale = overviewScaleForSpan(
    sessionSpanSec,
    viewportWidth * BAND_POINTER_RATIO * 0.88,
  );

  const targetScale = resolvedMode === 'near' ? BAND_SCALE_NEAR : overviewScale;
  const isNear = resolvedMode === 'near';
  const activeElapsedMs = getCumulativeActiveMs(snapshot, now);
  const pauseElapsedMs = getCurrentPauseDisplayMs(snapshot, now);
  const hasRecordedTime =
    activeElapsedMs > 0 ||
    pauseElapsedMs > 0 ||
    (snapshot?.segments.length ?? 0) > 0 ||
    (snapshot?.pauseEvents.length ?? 0) > 0;

  // 只用真正影响场景投影的业务字段唤醒 Canvas；活动态的连续推进由 rAF 完成。
  const renderRevision = [
    snapshot?.sessionId ?? 'none',
    state,
    snapshot?.activeElapsedMs ?? 0,
    snapshot?.pauseElapsedMs ?? 0,
    snapshot?.currentPauseStartedAt ?? 'none',
    snapshot?.lastTick ?? 0,
    ...(snapshot?.segments.map(
      (segment) =>
        `${segment.id}:${segment.startedAt}:${segment.endedAt ?? 'open'}:${segment.activeElapsedMs}`,
    ) ?? []),
    ...(snapshot?.pauseEvents.map(
      (pause) => `${pause.id}:${pause.pauseStartedAt}:${pause.pauseEndedAt ?? 'open'}`,
    ) ?? []),
  ].join(':');

  useEffect(() => {
    const engine = engineRef.current;
    if (Math.abs(targetScale - engine.scale) < 1e-6 && !engine.zoom) return;
    if (reducedMotion) {
      engine.scale = targetScale;
      engine.zoom = null;
      return;
    }
    engine.zoom = {
      from: engine.scale,
      to: targetScale,
      start: performance.now(),
      duration: BAND_ZOOM_MS,
    };
  }, [reducedMotion, targetScale]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const context = ctx;

    let raf = 0;
    let wakeTimer: number | null = null;
    let disposed = false;
    let paintStyle = readBandPaintStyle();
    const viewport = { width: 0, height: 0 };

    const resize = () => {
      // 2x 已足够保持文字锐利；3x 会把每帧填充像素放大到 2.25 倍。
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      viewport.width = width;
      viewport.height = height;
      // 总览尺度依赖可视宽度，宽度必须回到 React 才能重算 targetScale。
      setViewportWidth((previous) => (Math.abs(previous - width) < 0.5 ? previous : width));
      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);
      if (
        width > 0 &&
        height > 0 &&
        (canvas.width !== pixelWidth || canvas.height !== pixelHeight)
      ) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      canvas.dataset.pixelRatio = String(dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const schedule = () => {
      if (disposed || raf !== 0) return;
      if (wakeTimer !== null) {
        window.clearTimeout(wakeTimer);
        wakeTimer = null;
      }
      raf = requestAnimationFrame(draw);
    };

    const wakeAtNextLiveSecond = () => {
      const currentState = stateRef.current;
      if (
        disposed ||
        wakeTimer !== null ||
        (currentState !== 'running' && currentState !== 'paused')
      )
        return;
      const delay = Math.max(16, 1002 - (Date.now() % 1000));
      wakeTimer = window.setTimeout(() => {
        wakeTimer = null;
        schedule();
      }, delay);
    };

    function draw() {
      raf = 0;
      if (disposed) return;

      const currentState = stateRef.current;
      const wallNowMs = Date.now();
      const needsNextFrame = renderBand(context, engineRef.current, {
        snapshot: snapshotRef.current,
        state: currentState,
        nowMs: wallNowMs,
        reducedMotion,
        moments: paintItemsRef.current,
        exitIdleSince: exitRef.current.idleSince,
        paintStyle,
        viewport,
      });

      if (!reducedMotion && (currentState === 'running' || currentState === 'paused')) {
        schedule();
      } else if (!reducedMotion && needsNextFrame) {
        // 变焦动画与暂停尾灰在恢复/结束后仍需自然演完。
        schedule();
      } else if (currentState === 'running' || currentState === 'paused') {
        // reduced-motion 关闭的是连续动画，不是墙钟投影。
        wakeAtNextLiveSecond();
      }
    }

    const observer = new ResizeObserver(() => {
      resize();
      schedule();
    });
    const handleWindowResize = () => {
      resize();
      schedule();
    };
    const themeObserver = new MutationObserver(() => {
      paintStyle = readBandPaintStyle();
      schedule();
    });
    observer.observe(canvas);
    window.addEventListener('resize', handleWindowResize);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    resize();
    scheduleDrawRef.current = schedule;
    schedule();

    return () => {
      disposed = true;
      scheduleDrawRef.current = () => undefined;
      cancelAnimationFrame(raf);
      if (wakeTimer !== null) window.clearTimeout(wakeTimer);
      observer.disconnect();
      window.removeEventListener('resize', handleWindowResize);
      themeObserver.disconnect();
    };
  }, [reducedMotion]);

  // 数据、状态或缩放目标变化只请求一帧，不销毁 rAF、ResizeObserver 和主题观察器。
  useEffect(() => {
    scheduleDrawRef.current();
  }, [renderRevision, targetScale, timelineItems]);
  const viewDescription = isNear
    ? state === 'paused'
      ? reducedMotion
        ? '秒级近景 · 暂停损耗静态呈现'
        : '秒级近景 · 时间正在消散'
      : '秒级近景 · 每格 1 秒 · 分钟主刻'
    : sessionSpanSec > 0
      ? `整段总览 · 本次 ${formatSpanLabel(sessionSpanSec)} 铺满全带`
      : '整段总览 · 专注与暂停时间轨迹';
  const lastRecordedAt = Math.max(
    0,
    ...(snapshot?.segments.map((segment) => segment.endedAt ?? segment.startedAt) ?? []),
    ...(snapshot?.pauseEvents.map((pause) => pause.pauseEndedAt ?? pause.pauseStartedAt) ?? []),
  );
  const clockAt = live ? now : lastRecordedAt || now;
  const clockLabel = live ? '当前精确时间' : hasRecordedTime ? '最后记录时间' : '待机时间锚点';
  /* 实时时钟必须与刻度标签、账本边界同源。
     这里原先是 toLocaleTimeString('zh-CN')：zh-CN 的 h24 循环把午夜渲染成 24:00，
     而同一组件的 wallClockTickLabel 用 00:00，两个字段在同一块画布上自相矛盾；
     locale 输出还会随 ICU 版本漂移，不适合做产品字段。 */
  const clockValue = formatClockSeconds(clockAt);
  const clockAccessibleLabel =
    state === 'paused'
      ? `暂停损耗 ${formatDurationPadded(pauseElapsedMs)}，${clockLabel} ${clockValue}`
      : `${clockLabel} ${clockValue}`;

  return (
    <figure
      className="temporal-ribbon"
      data-state={state}
      data-scale={isNear ? 'seconds' : 'minutes'}
      data-view-mode={effectiveViewMode}
      data-motion={
        state === 'running'
          ? 'continuous-material'
          : state === 'paused'
            ? 'pause-dissolve'
            : 'frozen'
      }
      data-dissolve={state === 'paused' ? 'frontier-ash' : 'none'}
    >
      <figcaption className="ribbon-caption">
        <span className="ribbon-title">时间之带</span>
        <span className="ribbon-legend">{viewDescription}</span>
        <span className="ribbon-live-clock" aria-label={clockAccessibleLabel}>
          {state === 'paused' ? `损耗 ${formatDurationPadded(pauseElapsedMs)}` : null}
          {state === 'paused' ? ' · ' : null}
          {!live ? (hasRecordedTime ? '最后记录 · ' : '待机 · ') : null}
          {clockValue}
        </span>
        <span className="ribbon-view-switch" role="group" aria-label="时间之带视野">
          <button
            type="button"
            className={isNear ? 'active' : ''}
            onClick={() => setViewMode('near')}
            aria-pressed={isNear}
            title="放大到秒级精密刻度"
          >
            近景
          </button>
          <button
            type="button"
            className={!isNear ? 'active' : ''}
            onClick={() => setViewMode('far')}
            aria-pressed={!isNear}
            disabled={state === 'paused'}
            aria-label={
              state === 'paused' ? '远景暂不可用：暂停时保持近景以看清时间损耗' : '切换到远景'
            }
            title={state === 'paused' ? '暂停时保持近景以看清时间损耗' : '拉远查看累计专注'}
          >
            远景
          </button>
          {viewMode !== 'auto' && state !== 'paused' && (
            <button type="button" className="ribbon-auto" onClick={() => setViewMode('auto')}>
              跟随状态
            </button>
          )}
        </span>
        <span className="ribbon-scale-tag">
          {isNear
            ? '1 格 = 1 秒'
            : `1 大格 = ${formatSpanLabel(overviewMajorStepSec(overviewTickStepSec(overviewScale)))}`}
        </span>
      </figcaption>
      <canvas
        ref={canvasRef}
        className="ribbon-canvas"
        role="img"
        aria-label={`本次累计有效专注 ${formatDurationPadded(activeElapsedMs)}，当前${
          state === 'paused'
            ? `暂停损耗 ${formatDurationPadded(pauseElapsedMs)}，红色粒子正从当前时刻剥离消散`
            : state === 'running'
              ? '专注进行中，强调色实体连续生长'
              : '画面已冻结'
        }，${viewDescription}`}
      />
    </figure>
  );
}

/* ─── Canvas 渲染内核 ─────────────────────────────────────── */

function readBandPaintStyle(): BandPaintStyle {
  const css = getComputedStyle(document.documentElement);
  const raw = (name: string) => css.getPropertyValue(name).trim();
  const rgb = (name: string, fallback: RgbTuple): RgbTuple => {
    const parts = raw(name)
      .split(/[\s,]+/)
      .filter(Boolean)
      .slice(0, 3)
      .map(Number);
    return parts.length === 3 && parts.every((value) => Number.isFinite(value))
      ? ([parts[0], parts[1], parts[2]] as RgbTuple)
      : fallback;
  };
  const isDark = document.documentElement.classList.contains('dark');
  return {
    colors: {
      ink: rgb('--app-ink', isDark ? [239, 239, 235] : [24, 26, 29]),
      text: rgb('--app-text', isDark ? [239, 239, 235] : [24, 26, 29]),
      muted: rgb('--app-muted', [95, 99, 104]),
      subtle: rgb('--app-subtle', [154, 157, 162]),
      accent: rgb('--app-accent', [14, 159, 110]),
      accentDeep: rgb('--app-accent-active', [11, 122, 85]),
      pause: rgb('--app-pause', [210, 67, 57]),
      surface: rgb('--app-surface', [252, 252, 250]),
      surface2: rgb('--app-surface-2', [240, 240, 236]),
      border: rgb('--app-border', [221, 220, 214]),
      borderStrong: rgb('--app-border-strong', [198, 197, 190]),
      light: isDark ? [226, 232, 236] : [255, 255, 255],
      isDark,
    },
    fontNumber: `10px ${raw('--font-number') || 'monospace'}`,
    fontSmallNumber: `9px ${raw('--font-number') || 'monospace'}`,
    fontUi: `600 10px ${raw('--font-ui') || 'sans-serif'}`,
  };
}

/** @returns 是否还需要下一帧（变焦未完成或暂停尾灰未散尽）。 */
function renderBand(
  ctx: CanvasRenderingContext2D,
  engine: BandEngine,
  input: {
    snapshot: TimerSnapshot | null;
    state: TimerState;
    nowMs: number;
    reducedMotion: boolean;
    moments: TimelineItem[];
    paintStyle: BandPaintStyle;
    viewport: { width: number; height: number };
    /** idle 退场的起点时间戳（null 表示不在退场期）。 */
    exitIdleSince: number | null;
  },
): boolean {
  const { width, height } = input.viewport;
  if (width <= 0 || height <= 0) return false;

  const { colors, fontNumber, fontSmallNumber, fontUi } = input.paintStyle;

  let zooming = false;
  if (engine.zoom) {
    /* 变焦进度。
       正常路径用 performance.now()；诊断/对比时可注入 `__flForceProgress`（0..1）
       把画面精确钉在某个进度上，用于逐帧对比不同刻度过渡方案的真实渲染，
       免得靠实时抓帧碰运气。生产环境该变量不存在，走的就是原来那条路径。 */
    const forced = (globalThis as { __flForceProgress?: number | null }).__flForceProgress;
    const progress =
      typeof forced === 'number'
        ? Math.min(1, Math.max(0, forced))
        : Math.min(1, (performance.now() - engine.zoom.start) / engine.zoom.duration);
    engine.scale = interpolateZoomScale(engine.zoom.from, engine.zoom.to, easeInOutQuart(progress));
    zooming = progress < 1;
    if (!zooming) {
      engine.scale = engine.zoom.to;
      engine.zoom = null;
    }
  }

  const moments = input.moments;
  const lastRecordedAt = moments.reduce(
    (latest, moment) => Math.max(latest, moment.endedAt ?? moment.startedAt),
    0,
  );
  const live = input.state === 'running' || input.state === 'paused';
  const cameraMs = live ? input.nowMs : lastRecordedAt || input.nowMs;

  const scale = engine.scale;
  const pointerX = Math.round(width * BAND_POINTER_RATIO);

  // 镜头随墙钟连续滑动——这正是「连续平稳」的来源；逐秒吸附只留给 reduced-motion。
  const cameraSeconds =
    live && !input.reducedMotion ? cameraMs / 1000 : steppedDisplaySeconds(cameraMs, true);
  const toX = (ms: number) => (ms / 1000 - cameraSeconds) * scale + pointerX;
  const visibleStartSec = cameraSeconds - pointerX / scale;
  const visibleEndSec = cameraSeconds + (width - pointerX) / scale;
  const motionSeconds = live && !input.reducedMotion ? input.nowMs / 1000 : cameraMs / 1000;
  const pulseAgeMs =
    input.state === 'paused' && input.snapshot?.currentPauseStartedAt
      ? Math.max(0, input.nowMs - input.snapshot.currentPauseStartedAt) % 1000
      : input.nowMs % 1000;

  const channelTop = Math.round(Math.max(20, height * 0.2));
  const channelBottom = Math.round(height - Math.max(24, height * 0.22));
  const inset = clamp((channelBottom - channelTop) * 0.1, 3, 8);
  const geometry: BandGeometry = {
    width,
    height,
    channelTop,
    channelBottom,
    materialTop: channelTop + inset,
    materialBottom: channelBottom - inset,
  };

  ctx.clearRect(0, 0, width, height);

  /* 1. 轨道：无论待机还是专注，都只画待机态那条扁平时间轴——
     顶部发丝 + 底部基线，中段完全透明。
     这里原先是「待机=扁平轴、有记录=内凹中性槽」两套画法，于是点开始专注之后
     轨道的材质会突然变一次：同一条时间之带在两态看起来不是同一件东西。
     统一之后，专注与待机的差别只剩下「走过的那一段」——那由基线上的强调线与
     刻度染色表达，不需要换一套轨道材质。 */
  drawChannel(ctx, geometry, colors);

  // 2. 已发生的时间段。暂停先画（它是底下的疤），专注实体压在其上。
  const focusMoments: TimelineItem[] = [];
  const pauseMoments: TimelineItem[] = [];
  for (const moment of moments) {
    const endMs = moment.endedAt ?? (moment.isOngoing ? input.nowMs : null);
    if (endMs === null) continue;
    const startSec = moment.startedAt / 1000;
    const endSec = endMs / 1000;
    if (endSec <= startSec || endSec < visibleStartSec || startSec > visibleEndSec) continue;
    (moment.type === 'focus' ? focusMoments : pauseMoments).push(moment);
  }

  for (const moment of pauseMoments) {
    const endMs = moment.endedAt ?? input.nowMs;
    drawPauseScar(ctx, geometry, colors, {
      x0: toX(moment.startedAt),
      x1: toX(endMs),
      ageSec: (endMs - moment.startedAt) / 1000,
      motionSeconds,
      isOngoing: moment.endedAt === null,
      reducedMotion: input.reducedMotion,
    });
  }

  for (const moment of focusMoments) {
    const endMs = moment.endedAt ?? input.nowMs;
    /* 结束后的退场：材料**不能瞬间消失**。
       实测时间线：点结束后 12ms 状态变 finished，冻结 3 秒，第 3019ms 变 idle——
       材料、账本行、读数在同一帧全部清空。用户感觉到的「卡」其实在这里：
       帧率一直是满的（最大 12.5ms），但那一下是硬跳变。
       现在给结束后的材料一个 320ms 的退场：冻结期间保持满实度（那段已经挣到的
       时间就该立在带子上给你看），持有期结束后淡出，而不是啪地抽走。 */
    /* 结束退场的不透明度。
       注意判据必须用「进入 idle 之后过了多久」，不能用 moment.endedAt：
       主进程在 finished → idle 时会把片段数据清空，那一帧起 moment 已经不存在了，
       所以这里用的是组件留住的那份区间 + idle 起点。 */
    const exitFade =
      input.state === 'idle' && input.exitIdleSince !== null
        ? clamp01(1 - (input.nowMs - input.exitIdleSince) / 320)
        : 1;
    if (exitFade <= 0.001) continue;
    drawFocusMaterial(ctx, geometry, colors, {
      x0: toX(moment.startedAt),
      x1: toX(endMs),
      ageSec: (endMs - moment.startedAt) / 1000,
      motionSeconds,
      isOngoing: moment.endedAt === null,
      reducedMotion: input.reducedMotion,
      opacity: exitFade,
    });
  }

  // 4. 绝对墙钟刻度；边界与账本 HH:mm 完全一致。
  /* 刻度过渡模式（诊断可切换）：
       'ladder'     现状——步长直接从阶梯表里跳档，一帧内成批换位置
       'crossfade'  旧步长淡出、新步长淡入，重叠一段时间
       'continuous' 步长按对数连续映射，永不跳档（一档淡出时下一档已淡入）
     生产默认 'ladder'；对比时由 __flTickMode 注入。 */
  const tickMode =
    (globalThis as { __flTickMode?: string }).__flTickMode === 'crossfade'
      ? 'crossfade'
      : (globalThis as { __flTickMode?: string }).__flTickMode === 'continuous'
        ? 'continuous'
        : 'ladder';
  const zoomPrevStep = engine.zoom && zooming ? overviewTickStepSec(engine.zoom.from) : undefined;
  const zoomProgress = engine.zoom
    ? Math.min(1, Math.max(0, (performance.now() - engine.zoom.start) / engine.zoom.duration))
    : 1;
  drawRulerTicks(ctx, geometry, colors, {
    cameraSeconds,
    nowSeconds: cameraMs / 1000,
    visibleStartSec,
    visibleEndSec,
    toX,
    scale,
    nearAlpha: secondTickAlpha(scale),
    farAlpha: macroTickAlpha(scale),
    fontNumber,
    fontSmallNumber,
    tickMode,
    zoomPrevStep,
    zoomProgress,
  });

  // 4b. 材料压在刻度之上重画一遍。
  //     材料是时间之带里最实的一层：让刻度透过来，颜色会被底白与刻度线搅成脏色
  //     （红会读成熟橙）。先画一遍让刻度只出现在空档里，再盖一遍让材料本身干净。
  for (const moment of pauseMoments) {
    const endMs = moment.endedAt ?? input.nowMs;
    drawPauseScar(ctx, geometry, colors, {
      x0: toX(moment.startedAt),
      x1: toX(endMs),
      ageSec: (endMs - moment.startedAt) / 1000,
      motionSeconds,
      isOngoing: moment.endedAt === null,
      reducedMotion: input.reducedMotion,
      skipSeam: true,
    });
  }
  for (const moment of focusMoments) {
    const endMs = moment.endedAt ?? input.nowMs;
    /* 结束退场的不透明度。
       注意判据必须用「进入 idle 之后过了多久」，不能用 moment.endedAt：
       主进程在 finished → idle 时会把片段数据清空，那一帧起 moment 已经不存在了，
       所以这里用的是组件留住的那份区间 + idle 起点。 */
    const exitFade =
      input.state === 'idle' && input.exitIdleSince !== null
        ? clamp01(1 - (input.nowMs - input.exitIdleSince) / 320)
        : 1;
    if (exitFade <= 0.001) continue;
    drawFocusMaterial(ctx, geometry, colors, {
      x0: toX(moment.startedAt),
      x1: toX(endMs),
      ageSec: (endMs - moment.startedAt) / 1000,
      motionSeconds,
      isOngoing: moment.endedAt === null,
      reducedMotion: input.reducedMotion,
      opacity: exitFade,
    });
  }

  // 4c. 断口蒸发：暂停段的起点就是材料的断口，把断口左侧那段材料擦成渐隐。
  //     材料自己化掉才是「时间在消散」；只撒粒子、材料硬切一刀，读起来是
  //     「被剪断 + 旁边有灰」。这一步必须在材料画完之后做。
  for (const moment of pauseMoments) {
    const endedAt = moment.endedAt;
    if (endedAt !== null && input.nowMs - endedAt > PAUSE_LOSS_MAX_LIFE_MS) continue;
    drawFrontierEvaporation(ctx, geometry, {
      frontierX: toX(moment.startedAt),
      fadePx: 18,
    });
  }

  /* 5. 时间消散：材料断口的蒸发区升起细离子。
   *
   * 前面几版都不对，原因是粒子起点在空档里（「现在」指针附近或断口外侧），
   * 所以读起来是「旁边飘着灰」，跟材料没有关系。现在起点严格落在断口的蒸发区内
   * （就是被 destination-out 擦掉的那 18px），离子从材料上「升起」，
   * 于是它读起来是**材料自己在化掉**。
   *
   * 发射窗口 3 秒：暂停刚开始时持续发射，之后只让尾离子散尽，
   * 所以长时间暂停看到的是一段静止的材料与断口，不会一直冒灰。 */
  const EVAPORATE_PX = 18;
  let ashAlive = false;
  const DISSOLVE_WINDOW_MS = 3_000;
  for (const moment of pauseMoments) {
    const endedAt = moment.endedAt;
    if (endedAt !== null && input.nowMs - endedAt > DISSOLVE_ION_MAX_LIFE_MS) continue;
    const frontierX = toX(moment.startedAt);
    if (frontierX < -80 || frontierX > width + 80) continue;
    const emitted = drawDissolveIons(ctx, geometry, colors, {
      nowMs: input.nowMs,
      emissiveStartMs: moment.startedAt,
      frontierX,
      evaporatePx: EVAPORATE_PX,
      windowMs: endedAt === null ? DISSOLVE_WINDOW_MS : Math.max(0, endedAt - moment.startedAt),
      reducedMotion: input.reducedMotion,
    });
    ashAlive = ashAlive || emitted;
  }

  // 6. 状态指针：只标记「现在」在墙钟上的位置。
  drawNowPointer(ctx, geometry, colors, {
    pointerX,
    state: input.state,
    pulseAgeMs,
    reducedMotion: input.reducedMotion,
    fontUi,
    label:
      input.state === 'running' || input.state === 'paused'
        ? '现在'
        : moments.length > 0
          ? '最后记录'
          : '待机',
  });

  return zooming || ashAlive;
}

/* ─── 轨道 ─────────────────────────────────────────────────── */

function drawChannel(ctx: CanvasRenderingContext2D, geo: BandGeometry, colors: BandColors): void {
  const { channelTop, channelBottom, width } = geo;

  /* 扁平时间轴：顶部发丝 + 底部实基线，中段完全透明。
     这里原先有第二套画法——「有记录时」把整条轨道填成内凹中性槽。结果是点开始专注
     之后轨道的材质会突然换一次，同一条时间之带在两态不像同一件东西。
     统一成一种材质之后，专注与待机的差别只剩「走过的那一段」：基线上的强调线
     与刻度染色。 */
  ctx.fillStyle = rgba(colors.border, 0.7);
  ctx.fillRect(0, channelTop, width, 1);
  ctx.fillStyle = rgba(colors.borderStrong, 0.95);
  ctx.fillRect(0, channelBottom - 1, width, 1);
}

/* ─── 专注：连续实体 ───────────────────────────────────────── */

function drawFocusMaterial(
  ctx: CanvasRenderingContext2D,
  geo: BandGeometry,
  colors: BandColors,
  input: {
    x0: number;
    x1: number;
    ageSec: number;
    motionSeconds: number;
    isOngoing: boolean;
    reducedMotion: boolean;
    /** 整体不透明度：结束退场时用它淡出，而不是瞬间抽走材料。 */
    opacity?: number;
  },
): void {
  const left = Math.max(-4, input.x0);
  const right = Math.min(geo.width + 4, input.x1);
  if (right - left < 0.4) return;

  /* 结束退场：整体降不透明度淡出，而不是瞬间抽走整块材料。
     用 globalAlpha 包一层，保证内部所有笔触（棱线、内阴影、前缘）同步淡出。 */
  if (input.opacity !== undefined && input.opacity < 0.999) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, input.opacity));
    drawFrostedFocusRibbon(ctx, geo, colors, input, left, right);
    ctx.restore();
    return;
  }

  drawFrostedFocusRibbon(ctx, geo, colors, input, left, right);
}

/**
 * 时间材料：轨道基线上一条**铺满刻度高度**的磨砂材料。专注是强调色，暂停是红色。
 *
 * 画四层，全部零模糊、每层一次填充：
 *   1. 本体：垂直五段明度阶（色相全程守住，见 toneAtLightness）；
 *   2. 上棱 1px（最亮）与下棱 1px（最深）——材料的厚度就靠这两条线立住；
 *   3. 顶部内阴影 5px：让材料像嵌在凹槽里，而不是浮在轨道上的一张色纸；
 *   4. 前缘受光角：只在最上 1/3 高度亮，下面留暗，像玻璃被光斜切到的断面。
 *
 * 材料从 0 宽开始生长，所以宽度门槛是亚像素：卡在 1px 上会让起步那一百多毫秒
 * 什么都不画。上下沿各自只是一条整像素线——保持上下沿完全平直。
 */
function drawFrostedFocusRibbon(
  ctx: CanvasRenderingContext2D,
  geo: BandGeometry,
  colors: BandColors,
  input: {
    x0: number;
    ageSec: number;
    motionSeconds: number;
    isOngoing: boolean;
    reducedMotion: boolean;
    /** 材料色调：专注用强调色，暂停用红色。画法完全一致。 */
    tone?: 'focus' | 'pause';
    opacity?: number;
  },
  rawLeft: number,
  rawRight: number,
): void {
  const left = Math.round(rawLeft);
  const right = Math.round(rawRight);
  const width = Math.max(1, right - left);
  const pose = focusMaterialPose(input.ageSec, 0.5, input.motionSeconds, input.reducedMotion);
  const base = input.tone === 'pause' ? colors.pause : colors.accent;

  // 材料几何：铺满整个刻度高度（顶部刻度到基线）。这是定稿的形状——
  // 曾经试过「窄带 / 半透明 / 分区」三种替代画法，用户明确要求保持这一种。
  const top = geo.channelTop + 1;
  const baseline = geo.channelBottom - 1;
  const height = baseline - top;

  ctx.save();

  /* 1. 磨砂玻璃本体：垂直分五段。
     色相全程守住（见 toneAtLightness 的说明）：上沿最亮、往下逐段压深，
     最后一段落到最深。这样材料有厚度、有体积，但不会因为混白而褪成粉/橙。
     暂停再加 12% 饱和、并把实度抬一档：暂停红在浅底上偏「粉」是用户明确点出的问题。 */
  const dim = 1;
  const satBoost = input.tone === 'pause' ? 1.12 : 1;
  const glass = ctx.createLinearGradient(0, top, 0, baseline);
  const ramp: Array<[number, number, number]> = [
    [0, 0.82, (colors.isDark ? 0.5 : 0.6) * dim],
    [0.07, 0.66, (colors.isDark ? 0.52 : 0.62) * dim],
    [0.34, 0.5, (colors.isDark ? 0.5 : 0.6) * (input.tone === 'pause' ? 1.08 : 1)],
    [0.78, 0.3, (colors.isDark ? 0.46 : 0.54) * (input.tone === 'pause' ? 1.08 : 1)],
    [1, 0.12, (colors.isDark ? 0.54 : 0.6) * (input.tone === 'pause' ? 1.06 : 1)],
  ];
  for (const [at, k, alpha] of ramp) {
    glass.addColorStop(at, rgba(toneAtLightness(base, k, satBoost), Math.min(0.95, alpha)));
  }
  ctx.fillStyle = glass;
  ctx.fillRect(left, top, width, height);

  // 2. 上棱 1px：比本体再亮一档，是「实体感」的来源；下棱压到最深，材料才有厚度。
  //    上下沿各自只是一条整像素线——保持上下沿完全平直，不出现毛边或阶梯。
  ctx.fillStyle = rgba(toneAtLightness(base, 0.95, satBoost), colors.isDark ? 0.44 : 0.56 * dim);
  ctx.fillRect(left, top, width, 1);
  ctx.fillStyle = rgba(toneAtLightness(base, 0.08, satBoost), colors.isDark ? 0.5 : 0.58 * dim);
  ctx.fillRect(left, baseline - 1, width, 1);

  // 3. 顶部内阴影：上棱往下 5px 的极淡压深。这一笔是「高级感」的关键——
  //    它让材料读起来是嵌在凹槽里的一块实体，而不是浮在轨道上的一张色纸。
  //    成本只有一次填充，且不带任何模糊。
  const innerShadow = ctx.createLinearGradient(0, top + 1, 0, top + 6);
  innerShadow.addColorStop(
    0,
    rgba(toneAtLightness(base, 0.1, satBoost), colors.isDark ? 0.3 : 0.24),
  );
  innerShadow.addColorStop(1, rgba(toneAtLightness(base, 0.3), 0));
  ctx.fillStyle = innerShadow;
  ctx.fillRect(left, top + 1, width, 5);

  // 4. 内棱：上棱往下 2px 一条极淡的亮线。玻璃的厚度就靠这两条线立住。
  ctx.fillStyle = rgba(toneAtLightness(base, 0.78), colors.isDark ? 0.14 : 0.18 * dim);
  ctx.fillRect(left, top + 2, width, 1);

  // 5. 前缘：正在生长的那一头。
  if (input.isOngoing && input.tone !== 'pause' && width > 1) {
    const head = 12;
    const cap = ctx.createLinearGradient(Math.max(left, right - head), 0, right, 0);
    cap.addColorStop(0, rgba(toneAtLightness(base, 0.72), 0));
    cap.addColorStop(1, rgba(toneAtLightness(base, 0.72), 0.3 + pose.sheen * 0.08));
    ctx.fillStyle = cap;
    ctx.fillRect(Math.max(left, right - head), top, Math.min(head, width), height);
    // 前缘受光角：只在最上面 1/3 高度给一条亮线，下面留暗。
    // 整条边均匀发亮会读成一根发光棒；只亮上段才像玻璃被光斜切到的断面。
    ctx.fillStyle = rgba(toneAtLightness(base, 0.92), 0.6);
    ctx.fillRect(right - 1, top, 1, Math.max(2, Math.round(height * 0.34)));
  }

  // 6. 段落两端收口：1px 暗边。
  const seam = rgba(toneAtLightness(base, 0.1), 0.45);
  ctx.fillStyle = seam;
  if (input.x0 >= 0) ctx.fillRect(left, top, 1, height);
  if (!input.isOngoing) ctx.fillRect(right - 1, top, 1, height);
  ctx.restore();
}

/* ─── 暂停：疤痕 + 前沿消散 ────────────────────────────────── */

/**
 * 暂停：和专注**同一种材料**，只是红的。
 *
 * 试过四版才对：① 被掏空的槽（暂停越久色块越大）；② 红虚线（长时段下整条带子变成
 * 一片红噪点）；③ 只留断面 + 一大簇粒子（细材料旁边像一团渣）；④ 极淡冷红留白
 * （α≈0.05，等于没画，用户看不到红色）。
 *
 * 正确做法是复用专注材料的画法、只换色调：两段是同一种东西、同一高度、同一条基线，
 * 因此读起来是「这段时间的材料是红的」，而不是「这里有个洞」。再加一道极短断面
 * 说明断口在哪；不做虚线、不做高墙、不堆粒子。
 */
function drawPauseScar(
  ctx: CanvasRenderingContext2D,
  geo: BandGeometry,
  colors: BandColors,
  input: {
    x0: number;
    x1: number;
    ageSec: number;
    motionSeconds: number;
    isOngoing: boolean;
    reducedMotion: boolean;
    /** 第二遍只补材料，不再重复断面。 */
    skipSeam?: boolean;
  },
): void {
  const left = Math.max(-4, input.x0);
  const right = Math.min(geo.width + 4, input.x1);
  if (right - left < 0.4) return;

  drawFrostedFocusRibbon(
    ctx,
    geo,
    colors,
    {
      x0: input.x0,
      ageSec: input.ageSec,
      motionSeconds: input.motionSeconds,
      isOngoing: input.isOngoing,
      reducedMotion: input.reducedMotion,
      tone: 'pause',
    },
    left,
    right,
  );

  if (input.skipSeam) return;

  /* 断口电离：消散必须发生在**材料的断口上**，不在空档里飘。
   *
   * 之前几版都在空档（「现在」指针附近）撒粒子，于是粒子飘在一片什么都没有的地方，
   * 读起来只是「有灰尘」，和材料没有任何关系。真正在解离的是材料被切断的那一端：
   * 所以现在把一道很短的电离弧贴在断口上——靠近断口处最亮、向外 30px 渐隐，
   * 再叠一层逐秒呼吸。弧本身不移动，移动的是它上方那撮离子（见 drawDissolveIons）。
   *
   * 颜色跟着材料走（暂停红），不再混灰色灰烬色，所以读起来是「这块材料在解体」，
   * 而不是「旁边有些脏点」。
   */
  const top = geo.channelTop + 1;
  const bodyHeight = geo.channelBottom - geo.channelTop - 2;
  const pulse = 0.55 + 0.45 * Math.sin((input.motionSeconds % 1) * Math.PI);
  const arc = Math.min(30, Math.max(10, Math.round(bodyHeight * 0.4)));
  const tail = Math.max(0, Math.round(left));
  const grad = ctx.createLinearGradient(tail, 0, tail + arc, 0);
  grad.addColorStop(0, rgba(toneAtLightness(colors.pause, 0.86, 1.12), 0.5 * pulse));
  grad.addColorStop(0.45, rgba(colors.pause, 0.22 * pulse));
  grad.addColorStop(1, rgba(colors.pause, 0));
  ctx.fillStyle = grad;
  ctx.fillRect(tail, top, arc, bodyHeight);

  // 断口断面：1px 高光，把「材料到此为止」说死。
  ctx.fillStyle = rgba(toneAtLightness(colors.pause, 0.95, 1.12), 0.62);
  ctx.fillRect(tail, top, 1, bodyHeight);
}

/**
 * 材料在断口处「蒸发」：把断口左侧那段材料按渐隐擦掉。
 *
 * 这是「时间消散」的核心一笔，也是前几版一直缺的东西——之前只在断口旁边撒粒子，
 * 材料本身是硬切的一刀，读起来是「被剪断 + 旁边有灰」。真正像消散的是**材料自己**
 * 从断口往里渐渐化掉：靠断口最透明，往外 18px 恢复成完整材料。
 *
 * 必须画在材料**之后**、且用 destination-out 擦除，而不是覆盖一层白——覆盖会在
 * 彩色材料上留一层雾，擦除才是真的「这里没有材料」。
 */
function drawFrontierEvaporation(
  ctx: CanvasRenderingContext2D,
  geo: BandGeometry,
  input: { frontierX: number; fadePx: number },
): void {
  const width = Math.max(2, Math.round(input.fadePx));
  const right = Math.round(input.frontierX);
  const left = right - width;
  if (right < -2 || left > geo.width + 2) return;
  const top = geo.channelTop + 1;
  const bodyHeight = geo.channelBottom - geo.channelTop - 2;

  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  const grad = ctx.createLinearGradient(left, 0, right, 0);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.5)');
  grad.addColorStop(1, 'rgba(0,0,0,0.96)');
  ctx.fillStyle = grad;
  ctx.fillRect(left, top, width, bodyHeight);
  ctx.restore();
}

/**
 * 在「保色相」的前提下调节明度，并可额外加饱和。
 *
 * 这是材料颜色的关键修正。原来的做法是往段落色里混白色（`mixRgb(base, light, k)`）：
 * 混白会同时拉高明度和**降低饱和度**——暂停红 `rgb(210,67,57)`（饱和 89%）混 0.46 白之后
 * 只剩 42% 饱和，在白底上就直接读成砖红/锈橙，怎么调透明度都救不回来。
 *
 * 现在改为在 HSL 里只动 L：饱和度全程保住，亮的一档仍然是「红」而不是「粉」。
 * @param k 0 = 最深（L 压低 34%），0.5 = 原色，1 = 最亮（L 提到 88%）
 * @param satBoost 额外饱和度倍率（1 = 不变）。用于把暂停红压得更实。
 */
function toneAtLightness(color: RgbTuple, k: number, satBoost = 1): RgbTuple {
  const [h, s, l] = rgbToHsl(color);
  const target = k <= 0.5 ? l * (0.6 + k * 0.8) : l + (0.88 - l) * ((k - 0.5) / 0.5);
  return hslToRgb(h, Math.min(1, s * satBoost), Math.max(0.05, Math.min(0.94, target)));
}

function rgbToHsl(color: RgbTuple): [number, number, number] {
  const r = color[0] / 255;
  const g = color[1] / 255;
  const b = color[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): RgbTuple {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [
    Math.round(channel(h + 1 / 3) * 255),
    Math.round(channel(h) * 255),
    Math.round(channel(h - 1 / 3) * 255),
  ];
}

/* ─── 刻度 ─────────────────────────────────────────────────── */

function drawRulerTicks(
  ctx: CanvasRenderingContext2D,
  geo: BandGeometry,
  colors: BandColors,
  input: {
    cameraSeconds: number;
    nowSeconds: number;
    visibleStartSec: number;
    visibleEndSec: number;
    toX: (ms: number) => number;
    scale: number;
    nearAlpha: number;
    farAlpha: number;
    fontNumber: string;
    fontSmallNumber: string;
    /** 刻度过渡模式（见调用点说明）。 */
    tickMode?: 'ladder' | 'crossfade' | 'continuous';
    /** 变焦起点处的步长（仅过渡模式使用）。 */
    zoomPrevStep?: number;
    /** 变焦进度 0..1（仅过渡模式使用）。 */
    zoomProgress?: number;
  },
): void {
  const { channelTop, channelBottom, width } = geo;
  ctx.textAlign = 'center';

  const majorTick = (x: number, alpha: number) => {
    ctx.fillStyle = rgba(colors.light, alpha * 0.5);
    ctx.fillRect(x + 0.7, channelTop, 1, channelBottom - channelTop);
    ctx.fillStyle = rgba(colors.ink, alpha);
    ctx.fillRect(x, channelTop, 1, channelBottom - channelTop);
  };
  const edgeTick = (x: number, length: number, alpha: number) => {
    ctx.fillStyle = rgba(colors.ink, alpha);
    ctx.fillRect(x, channelTop + 1, 1, length);
    ctx.fillRect(x, channelBottom - 1 - length, 1, length);
  };

  if (input.nearAlpha > 0.02) {
    /* 近景层按「屏幕间距」分阶段淡入，而不是一档全出。
     *
     * 实测（2026-09-11）这里是「震动感」的真正来源：nearAlpha 从 0 到 1 只覆盖
     * scale 2.2→4.0，也就是 820ms 变焦里约 40ms。那 40ms 内近景层要一次画出
     * **每秒一根**的刻度，而 scale 2.2~4.0 时每秒只占 2.5~4px——几十根线挤在几像素里，
     * 阈值上根本不成像，于是画面读起来是「刻度整片消失」；等 scale 升到 8（每秒 8px）
     * 时它们又在同一帧全部出现：实测逐帧刻度数 5→0→0→15，单帧涌出 15 根。
     * 用户描述为「一直会有那种震动的感觉」。
     *
     * 修法：每根刻度按自己的屏幕间距决定可见度——
     *   每秒线  间距 < 7px 时不画，7→11px 之间线性淡入
     *   5 秒线  间距 < 3.5px 时不画（= 每 5 秒 17.5px 起）
     * 于是密度是「一层一层长出来」的，任何时刻都不存在整片网格同时成像的帧。 */
    const pxPerSecond = input.scale;
    const perSecondVisibility = clamp01((pxPerSecond - 7) / 4);
    const fiveSecondVisibility = clamp01((pxPerSecond * 5 - 17.5) / 6);

    for (
      let second = Math.max(0, Math.floor(input.visibleStartSec) - 1);
      second <= input.visibleEndSec + 1;
      second += 1
    ) {
      const x = Math.round(input.toX(second * 1000));
      if (x < -1 || x > width + 1) continue;
      const future = second > input.nowSeconds;
      const minute = positiveMod(second, 60) === 0;
      const fiveSecond = positiveMod(second, 5) === 0;

      if (minute) {
        majorTick(x, (future ? 0.1 : 0.2) * input.nearAlpha);
        ctx.fillStyle = rgba(colors.text, (future ? 0.45 : 0.86) * input.nearAlpha);
        ctx.font = input.fontNumber;
        ctx.fillText(wallClockTickLabel(second), x, channelTop - 8);
      } else {
        const length = fiveSecond ? 9 : 4.5;
        // 逐根刻度自己的可见度：秒线要等间距够宽才出现，5 秒线更早出现。
        const ownAlpha = fiveSecond ? fiveSecondVisibility : perSecondVisibility;
        const alpha = (future ? 0.16 : fiveSecond ? 0.4 : 0.24) * input.nearAlpha * ownAlpha;
        if (alpha > 0.015) edgeTick(x, length, alpha);
        if (fiveSecond && input.nearAlpha > 0.55 && fiveSecondVisibility > 0.6) {
          ctx.fillStyle = rgba(colors.subtle, 0.78 * input.nearAlpha * fiveSecondVisibility);
          ctx.font = input.fontSmallNumber;
          ctx.fillText(
            `:${String(positiveMod(second, 60)).padStart(2, '0')}`,
            x,
            channelBottom + 13,
          );
        }
      }
    }
  }

  if (input.farAlpha > 0.02) {
    /* 总览尺度随会话长度变化，刻度步长必须跟着走，否则标签不是挤成一团就是一根不剩。
       但「直接从阶梯表里挑一档」在变焦过程中会让整层刻度成批跳位：
       实测 820ms / 133 帧里跳 7 档，每档一次性换掉 8–14 根线的位置，
       读起来就是用户说的「震动感」。下面三种模式处理这件事。 */
    const mode = input.tickMode ?? 'ladder';
    const minPx = 74;
    const prevStep = input.zoomPrevStep;

    /* 计算本帧要画哪些步长、各自多大权重。
       返回 [步长, 权重] 列表；ladder 只有一个元素（现状）。 */
    const grids: Array<[number, number]> = [];
    if (mode === 'continuous') {
      // 步长在对数尺度上连续映射：任一时刻最多两档同时存在，合计权重恒为 1。
      // 一档的间隙为 0 时另一档恰好为 1，所以不会有「两根线间距异常」的中间态。
      const ladder = OVERVIEW_TICK_LADDER_SEC;
      let idx = ladder.length - 1;
      for (let i = 0; i < ladder.length; i += 1) {
        if (ladder[i] * input.scale >= minPx) {
          idx = i;
          break;
        }
      }
      const lo = ladder[Math.max(0, idx - 1)];
      const hi = ladder[idx];
      const gap = Math.log(hi * input.scale) - Math.log(Math.max(1e-6, lo * input.scale));
      const wHi =
        gap > 1e-6
          ? clamp01((Math.log(minPx) - Math.log(Math.max(1e-6, lo * input.scale))) / gap)
          : 1;
      if (lo !== hi && wHi < 1) {
        grids.push([lo, 1 - wHi]);
        grids.push([hi, wHi]);
      } else {
        grids.push([hi, 1]);
      }
    } else if (
      mode === 'crossfade' &&
      prevStep !== undefined &&
      prevStep !== overviewTickStepSec(input.scale)
    ) {
      // 旧步长淡出、新步长淡入。权重按「本档跨度内走过的对数距离」推进，
      // 因此在整段变焦里平滑，而不是在全景 alpha 之外再引入一个硬切。
      const cur = overviewTickStepSec(input.scale);
      const ladder = OVERVIEW_TICK_LADDER_SEC;
      let idx = ladder.length - 1;
      for (let i = 0; i < ladder.length; i += 1) {
        if (ladder[i] === cur) {
          idx = i;
          break;
        }
      }
      const pre = ladder[Math.max(0, idx - 1)];
      const gap = Math.log(cur * input.scale) - Math.log(Math.max(1e-6, pre * input.scale));
      const w =
        gap > 1e-6
          ? clamp01((Math.log(minPx) - Math.log(Math.max(1e-6, pre * input.scale))) / gap)
          : 1;
      if (w < 1) {
        grids.push([pre, 1 - w]);
        grids.push([cur, w]);
      } else {
        grids.push([cur, 1]);
      }
    } else {
      grids.push([overviewTickStepSec(input.scale), 1]);
    }

    for (const [step, weight] of grids) {
      if (weight <= 0.02) continue;
      const alpha = input.farAlpha * weight;
      if (alpha <= 0.02) continue;
      const majorStep = overviewMajorStepSec(step);
      const firstTick = Math.max(0, Math.floor(input.visibleStartSec / step) * step);
      for (let second = firstTick; second <= input.visibleEndSec + step; second += step) {
        const x = Math.round(input.toX(second * 1000));
        if (x < -1 || x > width + 1) continue;
        const future = second > input.nowSeconds;
        const major = positiveMod(second, majorStep) === 0;
        const tenMinute = positiveMod(second, step * 2) === 0;

        if (major) {
          majorTick(x, (future ? 0.1 : 0.2) * alpha);
          ctx.fillStyle = rgba(colors.text, (future ? 0.45 : 0.86) * alpha);
          ctx.font = input.fontNumber;
          ctx.fillText(wallClockTickLabel(second), x, channelTop - 8);
        } else {
          edgeTick(x, tenMinute ? 10 : 5.5, (future ? 0.16 : tenMinute ? 0.4 : 0.24) * alpha);
          if (tenMinute && alpha > 0.62) {
            ctx.fillStyle = rgba(colors.subtle, 0.74 * alpha);
            ctx.font = input.fontSmallNumber;
            ctx.fillText(wallClockTickLabel(second), x, channelBottom + 13);
          }
        }
      }
    }
  }
}

/* ─── 指针 ─────────────────────────────────────────────────── */

function drawNowPointer(
  ctx: CanvasRenderingContext2D,
  geo: BandGeometry,
  colors: BandColors,
  input: {
    pointerX: number;
    state: TimerState;
    pulseAgeMs: number;
    reducedMotion: boolean;
    fontUi: string;
    label: '现在' | '最后记录' | '待机';
  },
): void {
  const { channelTop, channelBottom, height } = geo;
  const active = input.state === 'running' || input.state === 'paused';
  const stateColor = input.state === 'paused' ? colors.pause : colors.accent;

  if (active) {
    const breath = pointerBreathPulse(input.pulseAgeMs, input.reducedMotion);
    const centerY = (channelTop + channelBottom) / 2;
    const radius = 22 + breath * 9;
    const glow = ctx.createRadialGradient(
      input.pointerX,
      centerY,
      0,
      input.pointerX,
      centerY,
      radius,
    );
    const glowAlpha = POINTER_GLOW_MAX_ALPHA * (0.35 + 0.65 * breath);
    glow.addColorStop(0, rgba(stateColor, glowAlpha));
    glow.addColorStop(0.55, rgba(stateColor, glowAlpha * 0.38));
    glow.addColorStop(1, rgba(stateColor, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(
      input.pointerX - radius,
      channelTop - 14,
      radius * 2,
      channelBottom - channelTop + 28,
    );

    // 前沿窄条：运行时是强调色刀口，暂停时是正在被烧掉的红色断面。
    ctx.fillStyle = rgba(
      stateColor,
      frontierGlowAlpha(input.pulseAgeMs, input.reducedMotion) * 2.6,
    );
    ctx.fillRect(input.pointerX - 3, channelTop + 1, 3, channelBottom - channelTop - 2);
  }

  ctx.fillStyle = active ? rgba(stateColor, 0.95) : rgba(colors.ink, 0.6);
  ctx.fillRect(
    input.pointerX - 0.5,
    Math.max(2, channelTop - 16),
    1,
    channelBottom - channelTop + 20,
  );

  ctx.beginPath();
  ctx.moveTo(input.pointerX - 5, channelBottom + 2.5);
  ctx.lineTo(input.pointerX + 5, channelBottom + 2.5);
  ctx.lineTo(input.pointerX, channelBottom + 8);
  ctx.closePath();
  ctx.fill();

  ctx.font = input.fontUi;
  ctx.textAlign = 'center';
  ctx.fillStyle = rgba(colors.text, 0.82);
  ctx.fillText(input.label, input.pointerX, Math.min(height - 5, channelBottom + 21));
}

/* ─── 时间消散：断口蒸发区的细离子 ─────────────────────────── */

/**
 * 把断口蒸发区里的细离子画出来。
 *
 * 起点严格落在蒸发区内：`frontierX - evaporatePx * (1 - originRatioX)` → 断口。
 * 颜色从材料色（亮、饱和）随寿命褪向灰烬色，所以刚离开材料的离子就是材料的一部分，
 * 越飘越淡、越飘越灰，最后消失——读起来是「时间在消散」，而不是「有灰尘在飞」。
 * 这也是前几版的病根：粒子起点在空档里，和材料没有任何关系。
 */
function drawDissolveIons(
  ctx: CanvasRenderingContext2D,
  geo: BandGeometry,
  colors: BandColors,
  input: {
    nowMs: number;
    emissiveStartMs: number;
    frontierX: number;
    evaporatePx: number;
    windowMs: number;
    reducedMotion: boolean;
  },
): boolean {
  const ions = dissolveIons(
    input.nowMs,
    input.emissiveStartMs,
    input.evaporatePx,
    input.windowMs,
    input.reducedMotion,
  );
  if (ions.length === 0) return false;

  const top = geo.channelTop + 1;
  const bodyHeight = geo.channelBottom - geo.channelTop - 2;
  const material = colors.pause;
  const ash = particleAshColor(material, colors.muted);
  let drawn = 0;

  ctx.save();
  for (const ion of ions) {
    const originX = input.frontierX - input.evaporatePx * (1 - ion.originRatioX);
    const x = originX + ion.travelX;
    const y = top + ion.originRatioY * bodyHeight + ion.travelY;
    if (x < -10 || x > geo.width + 10 || y < -24 || y > geo.height + 10) continue;
    const color = mixRgb(material, ash, (1 - ion.temperature) * 0.85);
    ctx.fillStyle = rgba(color, ion.alpha);
    const size = Math.max(0.4, ion.size);
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
    drawn += 1;
  }
  ctx.restore();
  return drawn > 0;
}

/* ─── 工具 ─────────────────────────────────────────────────── */

function rgba(color: RgbTuple, alpha: number): string {
  return `rgba(${color[0]},${color[1]},${color[2]},${Math.max(0, Math.min(1, alpha))})`;
}

function positiveMod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** 时长的口语化短标签：总览尺度是动态的，刻度说明必须跟着变。 */
function formatSpanLabel(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} 秒`;
  if (seconds < 3600) {
    const minutes = seconds / 60;
    return `${minutes < 10 ? Math.round(minutes * 10) / 10 : Math.round(minutes)} 分钟`;
  }
  const hours = seconds / 3600;
  return `${hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours)} 小时`;
}

function wallClockTickLabel(totalSeconds: number): string {
  const date = new Date(totalSeconds * 1000);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export { BAND_SCALE_FAR, BAND_SCALE_NEAR };
