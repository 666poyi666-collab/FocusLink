// 历史记录 - Session 列表 + 详情 + 导出 + 删除 + Segment 任务关联/后补/批量
import '../../styles/history-motion.css';
import '../../styles/stats-workbench.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../ui/Icon';
import { useStore } from '../../app/store';
import { formatClock, formatClockSeconds, formatDuration, formatMinutes } from '../../lib/time';
import {
  formatDayLabel,
  formatShortDate,
  getDayRange,
  getRange,
  isSameLocalDay,
  shiftLocalDay,
  startOfDay,
  summarizeAnalyticsRange,
  toDateInput,
  type RangePreset,
} from './historyStats';
import {
  resolveTaskWorkspaceAppearance,
  type FocusSession,
  type FocusSegment,
  type Task,
} from '@shared/types';
import type { SessionAnalyticsResult } from '@shared/ipc/api';
import { TaskPicker } from '../tasks/TaskPicker';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import type { SessionDetail } from './HistoryBadges';
import { HistoryInsights } from './HistoryInsights';
import { StatsSidebar, type StatsSidebarView } from './StatsSidebar';
import {
  HEATMAP_WINDOW_DAYS,
  buildStatsSidebarCategories,
  formatCompactHours,
  formatHoursMinutes,
  ledgerTotalsOf,
  summarizeRangeWindows,
  type StatsRangeWindows,
} from './statsLedgerModel';
import { createRequestGate } from './requestGate';

/** TaskPicker 弹窗目标类型 */
type PickerTarget =
  | { kind: 'segment'; segmentId: string; title: string }
  | { kind: 'session-default'; sessionId: string; title: string }
  | { kind: 'batch-unlinked'; sessionId: string; title: string }
  | { kind: 'batch-all'; sessionId: string; title: string };

/** ConfirmDialog 确认目标类型：替代原生 confirm() 的三处确认流 */
type ConfirmTarget =
  | { kind: 'delete-session'; sessionId: string }
  | { kind: 'batch-all'; sessionId: string; task: Task };

/** 空 Session 列表的模块级稳定引用：避免 `analytics?.sessions ?? []` 每次渲染
    产生新数组，导致下游 useMemo 依赖不稳定（react-hooks/exhaustive-deps）。 */
const EMPTY_SESSIONS: FocusSession[] = [];

const DAY_MS = 24 * 60 * 60_000;

/** 侧栏「最近 30 天」窗口长度：统计视图的 今日/7 天/30 天 三个读数共用这一次请求。 */
const SIDEBAR_WINDOW_DAYS = 30;

/** 侧栏「统计视图」标题与工具栏标题：与原型的 activeViewTitle 文案一致。 */
const RANGE_VIEW_TITLES: Record<string, string> = {
  today: '今日心流看板',
  '7d': '最近 7 天精力全景',
  '30d': '最近 30 天心流沉淀',
  '15d': '最近 15 天心流沉淀',
  custom: '自定义范围心流沉淀',
};

export function HistoryPanel() {
  // Elapsed time changes every second while focusing. History only needs the identity/state of the
  // current session, so primitive selectors keep the full ledger from rerendering on every tick.
  const currentSessionId = useStore((state) => state.snapshot?.sessionId ?? null);
  const currentTimerState = useStore((state) => state.snapshot?.state ?? 'idle');
  const settings = useStore((state) => state.settings);
  const addToast = useStore((state) => state.addToast);
  const setSnapshot = useStore((state) => state.setSnapshot);
  const syncQueue = useStore((state) => state.syncQueue);

  const [analytics, setAnalytics] = useState<SessionAnalyticsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyticsRefreshing, setAnalyticsRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const expandedRef = useRef<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailLoadError, setDetailLoadError] = useState<{
    sessionId: string;
    message: string;
  } | null>(null);
  const detailRequestGate = useRef(createRequestGate()).current;
  const analyticsRequestGate = useRef(createRequestGate()).current;
  const hasAnalyticsRef = useRef(false);
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);
  const [linking, setLinking] = useState(false);
  const [completedTaskIds, setCompletedTaskIds] = useState<Set<string>>(() => new Set());
  const [sessionSegmentsById, setSessionSegmentsById] = useState<Record<string, FocusSegment[]>>(
    {},
  );
  const [rangePreset, setRangePreset] = useState<RangePreset>('today');
  const [dayCursor, setDayCursor] = useState(() => startOfDay(Date.now()));
  // 单日导航方向：-1 前一天 / 1 后一天 / 0 预设或自定义切换；供图表做有方向感的滑动入场。
  const [slideDirection, setSlideDirection] = useState<-1 | 0 | 1>(0);
  // 原型页头只保留「前一天/后一天 + 导出账本」，自定义区间不再有输入控件；
  // 这里保留默认值，使 getRange('custom') 仍然是一个可用的纯函数口径。
  const customStart = toDateInput(Date.now());
  const customEnd = toDateInput(Date.now());
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [taskQuery, setTaskQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<{ key: string; label: string } | null>(null);
  const [sidebarReloadToken, setSidebarReloadToken] = useState(0);
  const sidebarRequestGate = useRef(createRequestGate()).current;
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const taskAppearance = resolveTaskWorkspaceAppearance(settings?.taskWorkspaceAppearance);
  const [showAppearanceMenu, setShowAppearanceMenu] = useState(false);
  const appearanceMenuRef = useRef<HTMLDivElement | null>(null);

  const [cardSkin, setCardSkin] = useState<'ceramic' | 'frosted' | 'titanium'>(() => {
    try {
      return (
        (localStorage.getItem('focuslink.stats.skin') as 'ceramic' | 'frosted' | 'titanium') ||
        'ceramic'
      );
    } catch {
      return 'ceramic';
    }
  });

  const handleSelectSkin = (skin: 'ceramic' | 'frosted' | 'titanium') => {
    setCardSkin(skin);
    try {
      localStorage.setItem('focuslink.stats.skin', skin);
    } catch {}
  };

  const updatePalette = async (palette: 'linear' | 'rose' | 'contrast') => {
    const current = useStore.getState().settings;
    const currentApp = resolveTaskWorkspaceAppearance(current?.taskWorkspaceAppearance);
    const nextApp = { ...currentApp, palette };
    if (current) {
      useStore.getState().setSettings({ ...current, taskWorkspaceAppearance: nextApp });
    }
    try {
      const saved = await window.focuslink.settings.set({ taskWorkspaceAppearance: nextApp });
      useStore.getState().setSettings(saved);
    } catch {}
  };

  useEffect(() => {
    if (!showAppearanceMenu) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (appearanceMenuRef.current && !appearanceMenuRef.current.contains(event.target as Node)) {
        setShowAppearanceMenu(false);
      }
    };
    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, [showAppearanceMenu]);

  const range = useMemo(
    () =>
      rangePreset === 'today'
        ? getDayRange(dayCursor)
        : getRange(rangePreset, customStart, customEnd),
    [rangePreset, customStart, customEnd, dayCursor],
  );
  const sessions = analytics?.sessions ?? EMPTY_SESSIONS;
  // analytics.sessions is already the authoritative overlap result for the requested range.
  // Filtering again by startedAt would drop a session which began before midnight but continued
  // into the selected day, while the chart buckets correctly retained its clipped contribution.
  const filteredSessions = sessions;
  const rangeStats = useMemo(
    () => summarizeAnalyticsRange(analytics?.daily ?? [], filteredSessions.length),
    [analytics?.daily, filteredSessions.length],
  );

  // ── 统计侧栏读数（原型「统计视图」四项 +「清单分类」四项） ──────────────
  // 侧栏是「总览列」：四项读数与清单分类都取自同一个截止今天的 30 天窗口，
  // 不随页头范围抖动（原型该列同样是范围无关的静态总览）。
  const [sidebarWindows, setSidebarWindows] = useState<StatsRangeWindows | null>(null);
  const [sidebarCategories, setSidebarCategories] = useState<
    ReturnType<typeof buildStatsSidebarCategories>
  >([]);

  useEffect(() => {
    const requestId = sidebarRequestGate.issue();
    void (async () => {
      try {
        if (!window.focuslink) return;
        const end = new Date().setHours(23, 59, 59, 999);
        const start = startOfDay(Date.now() - (SIDEBAR_WINDOW_DAYS - 1) * DAY_MS);
        const result = await window.focuslink.sessions.analytics({ start, end });
        if (!sidebarRequestGate.isCurrent(requestId)) return;
        setSidebarWindows(summarizeRangeWindows(result.daily));
        const totals = ledgerTotalsOf(result.dayLedgers);
        setSidebarCategories(
          buildStatsSidebarCategories(result.dayLedgers, totals.focusMs + totals.estimatedFocusMs),
        );
      } catch {
        // 侧栏读数失败时保留上一次读数，不写空值也不弹错误（主画卷自己的错误处理在 load()）。
      }
    })();
  }, [sidebarRequestGate, sidebarReloadToken]);

  // 标题栏全局搜索框（Ctrl K）：过滤重点任务排行与会话账本，口径对齐原型 handleSearch。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // 会话账本的筛选：搜索框关键词 + 侧栏清单分类，两者可叠加。
  const railKeyword = taskQuery.trim().toLowerCase();
  const railCategory = categoryFilter?.label.trim().toLowerCase() ?? '';
  const visibleSessions = useMemo(() => {
    if (!railKeyword && !railCategory) return filteredSessions;
    return filteredSessions.filter((session) => {
      const segmentTitles = (sessionSegmentsById[session.id] ?? [])
        .map((segment) => segment.title ?? '')
        .join(' ');
      const haystack = [session.title, session.defaultTaskTitle ?? '', segmentTitles]
        .join(' ')
        .toLowerCase();
      if (railKeyword && !haystack.includes(railKeyword)) return false;
      if (railCategory && !haystack.includes(railCategory)) return false;
      return true;
    });
  }, [filteredSessions, railKeyword, railCategory, sessionSegmentsById]);

  const [loadError, setLoadError] = useState<string | null>(null);

  const dayCursorIsToday = isSameLocalDay(dayCursor, Date.now());
  const dayCursorDate = new Date(dayCursor);
  const dayCursorLabel = dayCursorDate.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const dayCursorWeekday = dayCursorDate.toLocaleDateString('zh-CN', { weekday: 'short' });
  const dayCursorFullLabel = `${dayCursorLabel} · ${dayCursorWeekday}`;

  const selectRangePreset = (next: RangePreset) => {
    setSlideDirection(0);
    if (next === 'today') setDayCursor(startOfDay(Date.now()));
    setRangePreset(next);
  };

  /** 原型「心流热力全景」不是范围预设：它把画卷滚到卡贴五（24 周热力矩阵）。 */
  const focusHeatmap = () => {
    const tile = document.getElementById('tileHeatmap');
    if (!tile) return;
    tile.scrollIntoView({ behavior: 'smooth', block: 'start' });
    addToast('已定位至 24 周心流活动矩阵', 'info');
  };

  const statsViews: StatsSidebarView[] = [
    {
      id: 'today',
      label: '今日看板',
      value: formatCompactHours(sidebarWindows?.todayMs ?? 0),
      active: rangePreset === 'today',
      onSelect: () => selectRangePreset('today'),
      title: '只看今天（再用页头「前一天/后一天」逐日回看）',
    },
    {
      id: '7d',
      label: '最近 7 天',
      value: formatCompactHours(sidebarWindows?.weekMs ?? 0),
      active: rangePreset === '7d',
      onSelect: () => selectRangePreset('7d'),
      title: '最近 7 个自然日',
    },
    {
      id: '30d',
      label: '最近 30 天',
      value: formatCompactHours(sidebarWindows?.monthMs ?? 0),
      active: rangePreset === '30d',
      onSelect: () => selectRangePreset('30d'),
      title: '最近 30 个自然日',
    },
    {
      id: 'heatmap',
      label: '心流热力全景',
      // 卡贴五固定渲染 24 周（168 天）矩阵，这里回读的正是它的窗口长度。
      value: `${HEATMAP_WINDOW_DAYS}天`,
      active: false,
      onSelect: focusHeatmap,
      title: `定位到 24 周（${HEATMAP_WINDOW_DAYS} 天）心流活动矩阵`,
    },
  ];

  // 标题栏同步胶囊：可见文案与原型的「本地同步就绪」一致（原型该处是静态样例文案），
  // 但状态是真实的——读取中、云同步队列失败会直接改写文案，队列待处理条数进 title 提示。
  const syncState = useMemo(() => {
    const failed = syncQueue.filter((item) => item.status === 'failed').length;
    const pending = syncQueue.filter((item) => item.status === 'pending').length;
    if (analyticsRefreshing) {
      return { tone: '', label: '正在同步...', detail: '正在重新读取本地账本' };
    }
    if (failed > 0) {
      return {
        tone: 'is-error',
        label: `同步失败 ${failed}`,
        detail: `云同步队列失败 ${failed} 条`,
      };
    }
    if (pending > 0) {
      return {
        tone: '',
        label: '本地同步就绪',
        detail: `本地账本就绪；云同步队列待处理 ${pending} 条`,
      };
    }
    return { tone: '', label: '本地同步就绪', detail: '本地账本与云同步队列均无待处理项' };
  }, [syncQueue, analyticsRefreshing]);

  /**
   * 导出账本：把当前范围的时间账本导成一个 CSV。
   * 客户端没有范围级导出 IPC（`sessions.export` 只接受单个 sessionId），
   * 因此这里用页面上同一份 analytics 数据在前端拼装，保证导出的就是用户看到的账本。
   */
  const handleExportLedger = () => {
    const rows: string[] = [];
    rows.push('# FocusLink 时间账本');
    rows.push(
      rangePreset === 'today'
        ? `# 日期: ${dayCursorFullLabel}`
        : `# 范围: ${formatShortDate(range.start)} – ${formatShortDate(range.end)}`,
    );
    rows.push('日期,开始,结束,任务,有效专注(分钟),暂停(分钟),自然历时(分钟)');
    let totalActiveMs = 0;
    let totalPauseMs = 0;
    for (const session of visibleSessions) {
      totalActiveMs += session.activeElapsedMs;
      totalPauseMs += session.pauseElapsedMs;
      const day = formatDayLabel(Math.max(session.startedAt, range.start));
      const title = (session.defaultTaskTitle ?? session.title ?? '未命名任务').replace(
        /[",\n]/g,
        ' ',
      );
      rows.push(
        [
          day,
          formatClock(session.startedAt),
          session.endedAt ? formatClock(session.endedAt) : '进行中',
          `"${title}"`,
          Math.round(session.activeElapsedMs / 60_000),
          Math.round(session.pauseElapsedMs / 60_000),
          Math.round(session.wallElapsedMs / 60_000),
        ].join(','),
      );
    }
    rows.push(
      [
        '合计',
        '',
        '',
        `"${visibleSessions.length} 个专注会话"`,
        Math.round(totalActiveMs / 60_000),
        Math.round(totalPauseMs / 60_000),
        '',
      ].join(','),
    );
    try {
      const blob = new Blob([`\uFEFF${rows.join('\n')}\n`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `focuslink-ledger-${formatDayLabel(range.start)}_${formatDayLabel(range.end)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      addToast(`已导出 ${visibleSessions.length} 条账本记录（CSV）`, 'success');
    } catch (e) {
      addToast('导出账本失败：' + (e as Error).message, 'error');
    }
  };

  const moveSingleDay = (amount: -1 | 1) => {
    setSlideDirection(amount);
    setDayCursor((current) => {
      const next = startOfDay(shiftLocalDay(current, amount));
      return Math.min(next, startOfDay(Date.now()));
    });
  };

  /**
   * 页头「前一天 / 后一天」（原型 stepDateNav）：原型的这两个按钮始终可用。
   * 在多日范围下先回到单日视图并落在对应日（前一天 → 昨天，后一天 → 今天），
   * 而不是把多日范围整体平移——用户点的是「日」导航。
   */
  const stepDay = (amount: -1 | 1) => {
    if (rangePreset !== 'today') {
      setRangePreset('today');
      setSlideDirection(amount);
      const base = startOfDay(Date.now());
      setDayCursor(Math.min(startOfDay(shiftLocalDay(base, amount)), base));
      return;
    }
    moveSingleDay(amount);
  };

  const load = useCallback(async () => {
    const requestId = analyticsRequestGate.issue();
    if (!hasAnalyticsRef.current) setLoading(true);
    setAnalyticsRefreshing(true);
    setLoadError(null);
    try {
      if (!window.focuslink) {
        throw new Error('FocusLink 桌面接口未就绪');
      }
      // 混合时间轴窗口：单日视图跟随 dayCursor；多天/自定义范围锚定范围最后一天
      // （近 7/15/30 天的范围末日即今天），保证时间轴始终展示一个有意义的自然日。
      const timelineRange = getDayRange(rangePreset === 'today' ? dayCursor : range.end);
      const nextAnalytics = await window.focuslink.sessions.analytics({
        start: range.start,
        end: range.end,
        timelineStart: timelineRange.start,
        timelineEnd: timelineRange.end,
      });
      if (!analyticsRequestGate.isCurrent(requestId)) return;
      setAnalytics(nextAnalytics);
      hasAnalyticsRef.current = true;
      setSessionSegmentsById({});
    } catch (err) {
      if (!analyticsRequestGate.isCurrent(requestId)) return;
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      if (analyticsRequestGate.isCurrent(requestId)) {
        setLoading(false);
        setAnalyticsRefreshing(false);
      }
    }
  }, [dayCursor, rangePreset, range.end, range.start, analyticsRequestGate]);

  useEffect(() => {
    void load();
    return () => {
      // Invalidate a late IPC response after this route has unmounted.
      detailRequestGate.invalidate();
      analyticsRequestGate.invalidate();
      expandedRef.current = null;
    };
  }, [load, detailRequestGate, analyticsRequestGate]);

  const reloadDetail = useCallback(
    async (id: string) => {
      // A slower mutation can finish after the user has already opened another row. Never let that
      // stale callback restart loading for a row which is no longer the active detail target.
      if (expandedRef.current !== id) return;
      const requestId = detailRequestGate.issue();
      setDetailLoadingId(id);
      setDetailLoadError(null);
      try {
        const d = await window.focuslink.sessions.get(id);
        if (!detailRequestGate.isCurrent(requestId) || expandedRef.current !== id) return;
        if (!d) throw new Error('这条专注记录已不存在，请刷新统计列表。');
        setDetail(d);
        setSessionSegmentsById((prev) => ({
          ...prev,
          [id]: d.segments,
        }));
      } catch (error) {
        if (!detailRequestGate.isCurrent(requestId) || expandedRef.current !== id) return;
        setDetail(null);
        setDetailLoadError({
          sessionId: id,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (detailRequestGate.isCurrent(requestId) && expandedRef.current === id) {
          setDetailLoadingId(null);
        }
      }
    },
    [detailRequestGate],
  );

  const toggleExpand = async (id: string) => {
    if (expandedRef.current === id) {
      detailRequestGate.invalidate();
      expandedRef.current = null;
      setExpanded(null);
      setDetail(null);
      setDetailLoadingId(null);
      setDetailLoadError(null);
      return;
    }
    expandedRef.current = id;
    setExpanded(id);
    setDetail(null);
    setDetailLoadError(null);
    await reloadDetail(id);
  };

  // 保持当前选中的会话与可见会话同步（默认选中首条记录）
  useEffect(() => {
    if (visibleSessions.length > 0) {
      if (!selectedSessionId || !visibleSessions.some((s) => s.id === selectedSessionId)) {
        const firstId = visibleSessions[0].id;
        setSelectedSessionId(firstId);
        expandedRef.current = firstId;
        setExpanded(firstId);
        void reloadDetail(firstId);
      }
    } else {
      setSelectedSessionId(null);
      expandedRef.current = null;
      setExpanded(null);
    }
  }, [visibleSessions, selectedSessionId, reloadDetail]);

  const handleSelectSession = (id: string) => {
    setSelectedSessionId(id);
    expandedRef.current = id;
    setExpanded(id);
    void reloadDetail(id);
  };

  const activeSession =
    visibleSessions.find((s) => s.id === selectedSessionId) ?? visibleSessions[0] ?? null;

  const copySessionRecord = (session: FocusSession) => {
    const title = session.title || session.defaultTaskTitle || '专注会话';
    const clock = `${formatClock(session.startedAt)} - ${session.endedAt ? formatClock(session.endedAt) : '进行中'}`;
    const dur = formatMinutes(session.activeElapsedMs);
    const project = session.defaultTaskTitle ? '💻 工作任务' : '默认心流';
    const segs =
      (detail?.session.id === session.id ? detail.segments : sessionSegmentsById[session.id]) ?? [];
    const segCount = segs.length || 1;
    const pauseCount =
      detail?.session.id === session.id ? detail.pauses.length : session.pauseElapsedMs > 0 ? 1 : 0;
    const md = `### [FocusLink 会话记录]\n- **任务**：${title}\n- **起止**：${clock}\n- **有效专注**：${dur}\n- **所属清单**：${project}\n- **片段数**：${segCount} 段\n- **暂停**：${pauseCount} 次`;
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(md);
    }
    addToast('会话结构化 Markdown 已复制', 'success');
  };

  const { trackSlices, miniSegments } = useMemo(() => {
    if (!activeSession) return { trackSlices: [], miniSegments: [] };
    const isLoaded = detail?.session.id === activeSession.id;
    const focusSegments = isLoaded
      ? detail.segments
      : (sessionSegmentsById[activeSession.id] ?? []);
    const pauses = isLoaded ? detail.pauses : [];

    type UnifiedItem = {
      type: 'focus' | 'pause';
      startedAt: number;
      endedAt: number;
      durationMs: number;
      name: string;
      segment?: FocusSegment;
    };

    const items: UnifiedItem[] = [];
    focusSegments.forEach((seg, idx) => {
      const start = seg.startedAt;
      const dur = Math.max(1000, seg.activeElapsedMs);
      const end = seg.endedAt ?? start + dur;
      items.push({
        type: 'focus',
        startedAt: start,
        endedAt: end,
        durationMs: dur,
        name: `片段 ${idx + 1} · ${seg.title || '专注片段'}`,
        segment: seg,
      });
    });

    pauses.forEach((p) => {
      const start = p.pauseStartedAt;
      const dur = Math.max(1000, p.durationMs);
      const end = p.pauseEndedAt ?? start + dur;
      items.push({
        type: 'pause',
        startedAt: start,
        endedAt: end,
        durationMs: dur,
        name: `暂停事件 · ${p.reason || '休息暂停'}`,
      });
    });

    if (items.length === 0) {
      items.push({
        type: 'focus',
        startedAt: activeSession.startedAt,
        endedAt: activeSession.startedAt + activeSession.activeElapsedMs,
        durationMs: Math.max(1000, activeSession.activeElapsedMs),
        name: `片段 1 · ${activeSession.title || activeSession.defaultTaskTitle || '专注片段'}`,
      });
      if (activeSession.pauseElapsedMs > 0) {
        items.push({
          type: 'pause',
          startedAt: activeSession.startedAt + activeSession.activeElapsedMs,
          endedAt:
            activeSession.startedAt + activeSession.activeElapsedMs + activeSession.pauseElapsedMs,
          durationMs: activeSession.pauseElapsedMs,
          name: '暂停事件 · 休息暂停',
        });
      }
    }

    items.sort((a, b) => a.startedAt - b.startedAt);

    const totalMs = Math.max(
      1,
      items.reduce((sum, it) => sum + it.durationMs, 0),
    );

    const slices = items.map((it) => {
      const pct = Math.max(4, Math.round((it.durationMs / totalMs) * 100));
      return {
        type: it.type,
        pct,
        lbl:
          it.type === 'focus'
            ? `专注 ${formatMinutes(it.durationMs)}`
            : formatMinutes(it.durationMs),
      };
    });

    const miniRows = items.map((it, idx) => ({
      key: `${it.type}-${it.startedAt}-${idx}`,
      type: it.type,
      name: it.name,
      time: `${formatClockSeconds(it.startedAt)} - ${formatClockSeconds(it.endedAt)}`,
      dur: formatDuration(it.durationMs),
      segment: it.segment,
    }));

    return { trackSlices: slices, miniSegments: miniRows };
  }, [activeSession, detail, sessionSegmentsById]);

  const handleDelete = (id: string) => {
    const isCurrentSession = currentSessionId === id;
    if (isCurrentSession && (currentTimerState === 'running' || currentTimerState === 'paused')) {
      addToast('当前专注仍在进行中，请先结束专注后再删除这条记录。', 'error');
      return;
    }
    setConfirmTarget({ kind: 'delete-session', sessionId: id });
  };

  const performDeleteSession = async (id: string) => {
    try {
      const freshSnapshot = await window.focuslink.sessions.delete(id);
      if (freshSnapshot) {
        setSnapshot(freshSnapshot);
      }
      await load();
      // 删除会改变侧栏「今日/7 天/30 天」三个读数，需要一并重取。
      setSidebarReloadToken((token) => token + 1);
      if (expandedRef.current === id) {
        expandedRef.current = null;
        detailRequestGate.invalidate();
        setExpanded(null);
        setDetail(null);
        setDetailLoadingId(null);
        setDetailLoadError(null);
      }
      addToast('已删除本地记录；番茄 To-do 仅清理本机记录', 'success');
    } catch (e) {
      addToast('删除失败：' + (e as Error).message, 'error');
    }
  };

  const handlePick = async (task: Task | null) => {
    const target = pickerTarget;
    setPickerTarget(null);
    if (!task || !target) return;
    setLinking(true);
    try {
      if (target.kind === 'segment') {
        await window.focuslink.timer.linkTask(target.segmentId, task.id, task.source, task.title);
        addToast(`已关联：${task.title}`, 'success');
      } else if (target.kind === 'session-default') {
        await window.focuslink.timer.linkSessionTask(
          target.sessionId,
          task.id,
          task.source,
          task.title,
        );
        addToast(`已设为默认任务：${task.title}`, 'success');
      } else if (target.kind === 'batch-unlinked') {
        const count = await window.focuslink.timer.linkSegmentsBatch(
          target.sessionId,
          task.id,
          task.source,
          task.title,
          true,
        );
        addToast(`已批量关联 ${count} 个未关联片段到：${task.title}`, 'success');
      } else if (target.kind === 'batch-all') {
        // 覆盖已关联片段属于破坏性操作，先经 ConfirmDialog 确认再执行
        setConfirmTarget({ kind: 'batch-all', sessionId: target.sessionId, task });
        return;
      }
      if (expanded) await reloadDetail(expanded);
    } catch (e) {
      addToast('关联失败：' + (e as Error).message, 'error');
    } finally {
      setLinking(false);
    }
  };

  /** 批量改关联确认后的实际执行：与原 handlePick 的 batch-all 分支逻辑一致 */
  const performBatchLinkAll = async (sessionId: string, task: Task) => {
    setLinking(true);
    try {
      const count = await window.focuslink.timer.linkSegmentsBatch(
        sessionId,
        task.id,
        task.source,
        task.title,
        false,
      );
      addToast(`已把全部 ${count} 个片段关联到：${task.title}`, 'success');
      if (expanded) await reloadDetail(expanded);
    } catch (e) {
      addToast('关联失败：' + (e as Error).message, 'error');
    } finally {
      setLinking(false);
    }
  };

  const handleCompleteTask = async (seg: FocusSegment) => {
    if (!seg.taskId || !seg.taskSource) return;
    setLinking(true);
    try {
      await window.focuslink.tasks.complete({
        id: seg.taskId,
        source: seg.taskSource,
        externalId: seg.taskId.replace(/^ticktick:/, ''),
        projectId: null,
        title: seg.title ?? '未命名任务',
        status: null,
        priority: null,
        dueDate: null,
        tags: [],
        content: null,
      });
      setCompletedTaskIds((prev) => new Set(prev).add(seg.taskId!));
      addToast(`已完成任务：${seg.title ?? seg.taskId}`, 'success');
    } catch (e) {
      addToast('完成任务失败：' + (e as Error).message, 'error');
    } finally {
      setLinking(false);
    }
  };

  /** ConfirmDialog 文案：明确本地记录与番茄 To-do 的不同后果。 */
  const confirmCopy = (() => {
    if (!confirmTarget) return null;
    switch (confirmTarget.kind) {
      case 'delete-session': {
        const session = sessions.find((item) => item.id === confirmTarget.sessionId);
        return {
          title: '删除专注记录',
          description: session
            ? `${formatClock(session.startedAt)} 开始 · 专注 ${formatDuration(session.activeElapsedMs)}\n\n将永久删除 FocusLink 本地记录。番茄 To-do 只清理本机记录，当前无法验证远端删除。`
            : '将永久删除 FocusLink 本地记录。番茄 To-do 只清理本机记录，当前无法验证远端删除。',
          confirmLabel: '永久删除',
        };
      }
      case 'batch-all':
        return {
          title: '批量改关联',
          description: '确认把本次所有专注片段（含已关联）都改为同一任务？',
          confirmLabel: '全部改关联',
        };
    }
  })();

  const handleConfirmDialog = () => {
    const target = confirmTarget;
    setConfirmTarget(null);
    if (!target) return;
    if (target.kind === 'delete-session') {
      void performDeleteSession(target.sessionId);
    } else if (target.kind === 'batch-all') {
      void performBatchLinkAll(target.sessionId, target.task);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-fg-subtle">
        <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-bg-subtle/60">
          <Icon.Loader size="lg" className="motion-spin text-accent" />
        </div>
        <p className="text-[12px] font-medium text-fg-muted">加载中...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-fg-subtle">
        <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-danger/10 text-danger">
          <Icon.AlertCircle size="xl" />
        </div>
        <div className="text-center">
          <p className="text-[13px] font-medium text-fg-muted">加载失败</p>
          <p className="mt-1 max-w-[360px] text-[11px] text-fg-subtle">{loadError}</p>
        </div>
        <button className="btn-outline motion-press" onClick={() => load()}>
          <Icon.Refresh size="xs" />
          重试
        </button>
      </div>
    );
  }

  return (
    <div
      className="history-page stats-workbench"
      data-pal={taskAppearance.palette}
      data-skin={cardSkin}
    >
      {/* 标题栏（原型 header.app-titlebar）：FL 品牌 + 全局搜索框(Ctrl K) + 同步胶囊 + 外观。
          内容带落在 y=30–72，让开客户端 shell 顶部 0–30px 的固定拖拽带与窗口按钮——
          详见 stats-workbench.css 第 10.1 节：42px 标题栏会被拖拽带吞掉搜索框。 */}
      <header className="app-titlebar">
        <div className="titlebar-left">
          <div className="app-brand">
            <div className="app-brand-badge">FL</div>
            <span>FocusLink</span>
          </div>
        </div>

        <div className="titlebar-center">
          <div className="cmd-search-box">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchInputRef}
              id="globalSearchInput"
              type="text"
              placeholder="快速查找专注记录、任务或标签..."
              aria-label="全局搜索：专注记录、任务或标签"
              value={taskQuery}
              onChange={(event) => setTaskQuery(event.target.value)}
            />
            <span className="kbd-hint">Ctrl K</span>
          </div>
        </div>

        <div className="titlebar-right">
          <div
            className={`sync-badge ${syncState.tone}`}
            role="status"
            aria-live="polite"
            title={syncState.detail}
          >
            <i />
            <span>{syncState.label}</span>
          </div>
          <div className="relative" ref={appearanceMenuRef}>
            <button
              type="button"
              className="btn-tool motion-press"
              onClick={() => setShowAppearanceMenu((prev) => !prev)}
              aria-expanded={showAppearanceMenu}
              aria-label="外观设置"
              title="切换色彩基调与卡贴质感"
            >
              <Icon.Palette size="xs" />
              外观
            </button>
            {showAppearanceMenu && (
              <div
                className="ctx-menu active"
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: '6px',
                  display: 'flex',
                }}
              >
                <div className="ctx-menu-title">色彩基调</div>
                <div
                  className="ctx-menu-item"
                  aria-checked={taskAppearance.palette === 'linear'}
                  onClick={() => {
                    void updatePalette('linear');
                  }}
                >
                  Linear 纯净白 (电光蓝)
                </div>
                <div
                  className="ctx-menu-item"
                  aria-checked={taskAppearance.palette === 'rose'}
                  onClick={() => {
                    void updatePalette('rose');
                  }}
                >
                  高级粉 (Rose 典雅粉)
                </div>
                <div
                  className="ctx-menu-item"
                  aria-checked={taskAppearance.palette === 'contrast'}
                  onClick={() => {
                    void updatePalette('contrast');
                  }}
                >
                  极致对比 (Sharp Black)
                </div>
                <div className="ctx-divider" />
                <div className="ctx-menu-title">卡贴质感外观</div>
                <div
                  className="ctx-menu-item"
                  aria-checked={cardSkin === 'ceramic'}
                  onClick={() => handleSelectSkin('ceramic')}
                >
                  ▫️ 纯白陶瓷 (Pure Ceramic)
                </div>
                <div
                  className="ctx-menu-item"
                  aria-checked={cardSkin === 'frosted'}
                  onClick={() => handleSelectSkin('frosted')}
                >
                  🪟 微光磨砂 (Frosted Glass)
                </div>
                <div
                  className="ctx-menu-item"
                  aria-checked={cardSkin === 'titanium'}
                  onClick={() => handleSelectSkin('titanium')}
                >
                  ⚙️ 极客钛金 (Titanium Sheen)
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* 三栏工作台：统计侧栏 | 统计画卷（工具栏 + 分析画布）| 唯一会话账本阅读列。
          工具栏必须放在中栏内部（原型 main.stats-paper > div.list-toolbar）：
          原型侧栏是从标题栏下方直接开始的，工具栏只压在中栏上。 */}
      <div className="history-body">
        <StatsSidebar
          views={statsViews}
          categories={sidebarCategories}
          activeCategory={categoryFilter?.key ?? 'all'}
          onSelectCategory={(key) => {
            if (key === 'all') {
              setCategoryFilter(null);
              return;
            }
            const match = sidebarCategories.find((category) => category.key === key);
            setCategoryFilter(match ? { key: match.key, label: match.label } : null);
          }}
        />

        <div className="stats-paper-main">
          <div className="list-toolbar stats-toolbar">
            <div className="list-title-group">
              <h2 id="activeViewTitle">{RANGE_VIEW_TITLES[rangePreset] ?? '今日心流看板'}</h2>
              <span className="list-stats-text" id="activeViewStats">
                {rangePreset === 'today'
                  ? `${dayCursorLabel} · ${filteredSessions.length} 个专注会话 · 累计 ${formatHoursMinutes(rangeStats.active)}`
                  : `${formatShortDate(range.start)} - ${formatShortDate(range.end)} · ${filteredSessions.length} 个专注会话 · 累计 ${formatHoursMinutes(rangeStats.active)}`}
              </span>
              {(railKeyword || railCategory) && (
                <button
                  type="button"
                  className="stats-filter-chip motion-press"
                  onClick={() => {
                    setTaskQuery('');
                    setCategoryFilter(null);
                  }}
                  title="清除筛选，恢复完整账本"
                >
                  {categoryFilter ? `清单：${categoryFilter.label}` : `搜索：${taskQuery}`} ·{' '}
                  {visibleSessions.length} 条
                  <Icon.X size="xs" />
                </button>
              )}
            </div>

            <div className="list-toolbar-actions">
              <button
                type="button"
                className="btn-tool motion-press"
                onClick={() => stepDay(-1)}
                title="前一天"
                aria-label="前一天"
              >
                <Icon.ChevronLeft size="xs" />
                前一天
              </button>
              <button
                type="button"
                className="btn-tool motion-press"
                onClick={() => stepDay(1)}
                disabled={rangePreset === 'today' && dayCursorIsToday}
                title={
                  rangePreset === 'today' && dayCursorIsToday ? '今天之后没有统计数据' : '后一天'
                }
                aria-label="后一天"
              >
                后一天
                <Icon.ChevronRight size="xs" />
              </button>
              <button
                type="button"
                className="btn-tool motion-press"
                onClick={handleExportLedger}
                title="导出当前范围的 CSV 时间账本"
              >
                <Icon.Download size="xs" />
                导出账本
              </button>
              <span
                className={`history-range-refresh ${analyticsRefreshing ? 'is-visible' : ''}`}
                role="status"
                aria-live="polite"
              >
                <Icon.Loader size="xs" className={analyticsRefreshing ? 'motion-spin' : ''} />
                更新数据
              </span>
            </div>
          </div>

          <div className="history-canvas">
            {/* 统一分析画布：零数据时同样渲染完整 5 卡贴画卷骨架，
                不再切换到另一套「0 分钟」空态页面。 */}
            <HistoryInsights
              summary={rangeStats}
              range={range}
              analytics={analytics}
              slideDirection={slideDirection}
              onSelectRange={selectRangePreset}
              onOpenSession={toggleExpand}
              taskQuery={taskQuery}
            />
          </div>
        </div>

        <aside className="detail-pane stats-detail-pane" aria-label="会话时间账本">
          <div className="detail-head-bar">
            <div className="detail-head-title">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{ width: 14, height: 14, color: 'var(--accent)' }}
              >
                <path d="M12 8v4l3 3" />
                <circle cx="12" cy="12" r="10" />
              </svg>
              会话时间账本
            </div>
            <span
              id="sessionBadgeCount"
              style={{
                fontSize: 11,
                fontFamily: 'var(--font-num)',
                color: 'var(--text-tertiary)',
              }}
            >
              {visibleSessions.length} 轮记录
            </span>
          </div>

          {/* 会话流列表 */}
          <div className="session-card-stream" id="sessionCardStream">
            {visibleSessions.length === 0 ? (
              <div
                style={{
                  padding: '24px 12px',
                  textAlign: 'center',
                  color: 'var(--text-tertiary)',
                  fontSize: 12,
                }}
              >
                {railKeyword || railCategory
                  ? '没有匹配当前筛选的会话，点页头筛选胶囊可清除。'
                  : '这段时间还没有会话记录。'}
              </div>
            ) : (
              visibleSessions.map((session) => {
                const isSelected = activeSession?.id === session.id;
                const clock = `${formatClock(session.startedAt)} - ${session.endedAt ? formatClock(session.endedAt) : '进行中'}`;
                const dur = formatMinutes(session.activeElapsedMs);
                const title = session.title || session.defaultTaskTitle || '专注会话';
                const project = session.defaultTaskTitle ? '💻 工作任务' : '默认心流';
                const segCount = (sessionSegmentsById[session.id] ?? []).length || 1;
                const pauseCount = session.pauseElapsedMs > 0 ? 1 : 0;
                return (
                  <div
                    key={session.id}
                    className={`session-card ${isSelected ? 'active' : ''}`}
                    onClick={() => handleSelectSession(session.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') handleSelectSession(session.id);
                    }}
                  >
                    <div className="sc-top">
                      <span className="sc-time-pill">{clock}</span>
                      <span className="sc-dur">{dur}</span>
                    </div>
                    <div className="sc-title" title={title}>
                      {title}
                    </div>
                    <div className="sc-meta">
                      <span>{project}</span>
                      <span>
                        · {segCount}片段 · {pauseCount}暂停
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* 选中会话详情 (连续横向多段时序图) */}
          {activeSession && (
            <div className="card-widget deep-dive-box" id="deepDiveBox">
              <div className="dd-head">
                <h4 id="ddTitle">
                  {activeSession.title || activeSession.defaultTaskTitle || '专注会话'}
                </h4>
                <p id="ddMeta">
                  起止：{formatClockSeconds(activeSession.startedAt)} -{' '}
                  {activeSession.endedAt ? formatClockSeconds(activeSession.endedAt) : '进行中'} ·
                  自然历时{' '}
                  {formatDuration(
                    activeSession.wallElapsedMs ||
                      activeSession.activeElapsedMs + activeSession.pauseElapsedMs,
                  )}
                </p>
                {detailLoadingId === activeSession.id && (
                  <div className="flex items-center gap-1.5 pt-1 text-[11px] text-fg-subtle">
                    <Icon.Loader size="xs" className="motion-spin text-accent" />
                    <span>加载明细中…</span>
                  </div>
                )}
                {detailLoadError?.sessionId === activeSession.id && (
                  <div className="pt-1 text-[11px] text-danger">
                    详情加载失败：{detailLoadError.message}
                  </div>
                )}
              </div>

              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'var(--text-tertiary)',
                    marginBottom: 4,
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  <span>连续时序轨 (Chronological Track)</span>
                  <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-num)' }}>
                    有效专注 {formatMinutes(activeSession.activeElapsedMs)}
                  </span>
                </div>
                <div className="horiz-flow-track" id="ddTrack">
                  {trackSlices.map((slice, i) => (
                    <div
                      key={i}
                      className={slice.type === 'focus' ? 'hf-seg-focus' : 'hf-seg-pause'}
                      style={{ width: `${slice.pct}%` }}
                      title={slice.lbl}
                    >
                      {slice.lbl}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'var(--text-tertiary)',
                    marginBottom: 6,
                  }}
                >
                  片段流水明细 (Segments & Pauses)
                </div>
                <div className="segment-mini-list" id="ddSegmentList">
                  {miniSegments.map((seg) => (
                    <div className="seg-mini-row" key={seg.key}>
                      <div className="seg-row-top">
                        <div className="seg-name-wrap">
                          <span className={`seg-dot ${seg.type}`} />
                          <span className="seg-name-txt" title={seg.name}>
                            {seg.name}
                          </span>
                        </div>
                        <span
                          className="seg-dur-txt"
                          style={{
                            color: seg.type === 'focus' ? 'var(--accent)' : 'var(--pause-color)',
                          }}
                        >
                          {seg.dur}
                        </span>
                      </div>
                      <div
                        className="seg-time-sub"
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span>{seg.time}</span>
                        {seg.type === 'focus' && seg.segment && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <button
                              type="button"
                              className="btn-ghost !min-h-[20px] !px-1.5 !py-0 !text-[10px]"
                              disabled={linking}
                              onClick={() =>
                                setPickerTarget({
                                  kind: 'segment',
                                  segmentId: seg.segment!.id,
                                  title: `为片段关联任务`,
                                })
                              }
                            >
                              {seg.segment.taskId ? '更换' : '关联'}
                            </button>
                            {seg.segment.taskId && (
                              <button
                                type="button"
                                className="btn-ghost !min-h-[20px] !px-1.5 !py-0 !text-[10px] text-accent"
                                disabled={linking || completedTaskIds.has(seg.segment.taskId)}
                                onClick={() => void handleCompleteTask(seg.segment!)}
                              >
                                {completedTaskIds.has(seg.segment.taskId) ? '已完成' : '完成'}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div
                style={{
                  borderTop: '1px solid var(--border-row)',
                  paddingTop: 10,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }} id="ddProjectLabel">
                  所属清单：{activeSession.defaultTaskTitle ? '💻 工作任务' : '默认心流'}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    className="btn-tool motion-press"
                    style={{ height: 25, fontSize: 11 }}
                    onClick={() => copySessionRecord(activeSession)}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      style={{ width: 12, height: 12 }}
                    >
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    复制 Markdown
                  </button>
                  <button
                    type="button"
                    className="btn-tool motion-press"
                    style={{
                      height: 25,
                      width: 25,
                      padding: 0,
                      justifyContent: 'center',
                      color: 'var(--prio-p1, #ef4444)',
                    }}
                    onClick={() => handleDelete(activeSession.id)}
                    title="删除记录"
                    aria-label="删除记录"
                  >
                    <Icon.Trash size="xs" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>

      {pickerTarget && <TaskPicker onPick={handlePick} title={pickerTarget.title} />}
      <ConfirmDialog
        open={confirmTarget !== null}
        title={confirmCopy?.title ?? ''}
        description={confirmCopy?.description}
        confirmLabel={confirmCopy?.confirmLabel}
        danger
        onConfirm={handleConfirmDialog}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}
