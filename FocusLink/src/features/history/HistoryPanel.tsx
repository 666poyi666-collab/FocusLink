// 历史与统计工作台：以真实账本与可用宽度组织统计、筛选和会话详情。
// 可调整的三栏工作区、窄窗口账本入口、真实图表与任务关联。
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../../styles/stats-workbench.css';
import { SessionLedger } from './SessionLedger';
import { createPortal } from 'react-dom';
import { useStore } from '../../app/store';
import {
  getDayRange,
  shiftLocalDay,
  summarizeAnalyticsRange,
  type RangePreset,
  type TimeRange,
} from './historyStats';
import type { FocusSession } from '@shared/types';
import type { SessionAnalyticsDaily, SessionAnalyticsResult } from '@shared/ipc/api';
import { HistoryInsights } from './HistoryInsights';
import { StatsSidebar, type StatsSidebarView } from './StatsSidebar';
import { TaskPicker } from '../tasks/TaskPicker';
import type { Task } from '@shared/types';
import { useWorkspaceColumns } from '../../ui/WorkspaceColumns';
import {
  HEATMAP_WINDOW_DAYS,
  formatCompactHours,
  formatHoursMinutes,
  summarizeRangeWindows,
  type StatsRangeWindows,
  type StatsSidebarCategory,
} from './statsLedgerModel';

type StatsPreset = RangePreset | 'heatmap';

// Web Audio API 晶莹和弦音效合成器
function playWebAudioChime(kind: 'kpi' | 'click') {
  if (
    typeof document !== 'undefined' &&
    document.documentElement.getAttribute('data-sound') === 'off'
  ) {
    return;
  }
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    const freqs = kind === 'kpi' ? [523.25, 659.25, 783.99] : [587.33, 880];
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now + i * 0.035);
      gain.gain.setValueAtTime(0.025, now + i * 0.035);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.035 + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.035);
      osc.stop(now + i * 0.035 + 0.24);
    });
  } catch {}
}

export function HistoryPanel() {
  const columns = useWorkspaceColumns('focuslink.stats.columns', { left: 168, right: 300 });
  const [ledgerOpen, setLedgerOpen] = useState(false);
  // 状态变量
  const [curRange, setCurRange] = useState<StatsPreset>('today');
  const [dayCursor, setDayCursor] = useState<number>(() => Date.now());
  const [taskQuery, setTaskQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [curSelectedSession, setCurSelectedSession] = useState<string | null>(null);
  const [activePeriod, setActivePeriod] = useState<number>(-1);
  const [hoveredTaskIdx, setHoveredTaskIdx] = useState<number | null>(null);

  // 外观设置
  const [palette, setPalette] = useState<'linear' | 'rose' | 'contrast'>('linear');
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>('light');
  const [font, setFont] = useState<'sans' | 'serif'>('sans');
  const [soundEnabled, setSoundEnabled] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const attributes = {
      'data-pal': palette,
      'data-theme': themeMode,
      'data-font': font,
      'data-skin': 'ceramic',
      'data-sound': soundEnabled ? 'on' : 'off',
    };
    const previous = Object.keys(attributes).map((key) => [key, root.getAttribute(key)] as const);
    Object.entries(attributes).forEach(([key, value]) => root.setAttribute(key, value));
    return () =>
      previous.forEach(([key, value]) =>
        value === null ? root.removeAttribute(key) : root.setAttribute(key, value),
      );
  }, [palette, themeMode, font, soundEnabled]);

  // 外观弹出菜单
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const appearanceBtnRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const addToast = useStore((state) => state.addToast);
  const showToast = useCallback((message: string) => addToast(message, 'info'), [addToast]);

  // 监听真实数据（若有）
  /* 关联任务后要重新拉取 analytics；令牌必须声明在下面的 effect 之前。 */
  const [analyticsReloadToken, setAnalyticsReloadToken] = useState(0);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [heatmapDaily, setHeatmapDaily] = useState<SessionAnalyticsDaily[]>([]);
  const [analytics, setAnalytics] = useState<SessionAnalyticsResult | null>(null);
  const range = useMemo<TimeRange>(() => {
    if (curRange === 'today') return getDayRange(dayCursor);
    const end = Date.now();
    const days = curRange === '7d' ? 7 : curRange === '30d' ? 30 : HEATMAP_WINDOW_DAYS;
    return { start: getDayRange(shiftLocalDay(end, -(days - 1))).start, end: getDayRange(end).end };
  }, [curRange, dayCursor]);

  useEffect(() => {
    let cancelled = false;
    let requestId = 0;
    setAnalytics(null);
    setAnalyticsError(null);
    const loadAnalytics = async () => {
      const id = ++requestId;
      try {
        if (window.focuslink?.sessions?.analytics) {
          const res = await window.focuslink.sessions.analytics({
            start: range.start,
            end: range.end,
            timelineStart: range.start,
            timelineEnd: range.end,
          });
          if (!cancelled && id === requestId) setAnalytics(res);
        }
      } catch (err) {
        if (!cancelled && id === requestId)
          setAnalyticsError(err instanceof Error ? err.message : '读取统计失败');
      }
    };

    void loadAnalytics();

    const unsub = window.focuslink?.on?.('timer:state-changed', () => {
      void loadAnalytics();
    });

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [range, analyticsReloadToken]);

  /* ── 侧栏真实读数（v1.3.17 修复：此前是写死的原型样例值）──────────────────
     2026-10-01 事故：侧栏显示 今日看板 4.6h / 最近7天 32.2h / 最近30天 128.6h /
     每日记录 84天，以及 工作任务 55% / 深度学习 25% / 个人生活 12% ——
     这些**全部是统计页原型里的样例数字**，被 e67767f（v1.3.15「彻底剔除旧版残留」）
     连取数逻辑一起换掉了。用户看到的就是「数据来源有问题」。

     侧栏是「范围无关的总览列」：四项读数与清单分类都取自同一个**截止今天的连续 30 天**
     窗口，不随页头范围抖动（原型该列同样是范围无关的静态总览）。
     `summarizeRangeWindows` 要求 daily 是截止今天的连续自然日序列，所以这里必须
     用 start=今天-29天 / end=今天 请求，不能复用页头那份 analytics。 */
  /* 账本里给「未关联」的已结束会话补关联任务（v1.3.19）。
     此前 linkSessionTask 只在专注页、且只对**进行中**的会话可用；已结束的会话
     在任何界面都没有关联入口。主进程的 ensureNotLiveSession() 证明已结束会话
     本来就可以关联，所以这纯粹是 UI 缺口。 */
  const [linkTarget, setLinkTarget] = useState<{
    sessionId: string;
    label: string;
    segmentId?: string;
    taskId?: string | null;
  } | null>(null);
  const [sidebarWindows, setSidebarWindows] = useState<StatsRangeWindows | null>(null);
  const sidebarCategories = useMemo<StatsSidebarCategory[]>(() => {
    const tasks = analytics?.tasks ?? [];
    const total = tasks.reduce((sum, task) => sum + task.activeMs, 0);
    return tasks
      .filter((task) => task.activeMs > 0)
      .map((task, index) => ({
        key: task.key,
        label: task.title,
        activeMs: task.activeMs,
        percent: total > 0 ? Math.round((task.activeMs / total) * 100) : 0,
        color: ['#2563eb', '#6366f1', '#10b981', '#f59e0b'][index % 4],
      }));
  }, [analytics?.tasks]);
  /* 侧栏的点击回调要引用下面才定义的 handleSwitchPreset，用 ref 避开定义顺序问题。 */
  const handleSwitchPresetRef = useRef<(mode: StatsPreset) => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    let requestId = 0;
    const loadSidebar = async () => {
      const id = ++requestId;
      try {
        if (!window.focuslink?.sessions?.analytics) return;
        const now = new Date();
        const end = Date.now();
        const start =
          new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
          (HEATMAP_WINDOW_DAYS - 1) * 86_400_000;
        const res = await window.focuslink.sessions.analytics({
          start,
          end,
          timelineStart: start,
          timelineEnd: end,
        });
        if (cancelled || id !== requestId) return;
        setSidebarWindows(summarizeRangeWindows(res.daily.slice(-30)));
        setHeatmapDaily(res.daily);
      } catch (err) {
        console.error('Failed to load sidebar analytics:', err);
      }
    };

    void loadSidebar();
    const unsub = window.focuslink?.on?.('timer:state-changed', () => {
      void loadSidebar();
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [analyticsReloadToken]);

  const sidebarViews = useMemo<StatsSidebarView[]>(
    () => [
      {
        id: 'today',
        label: '今日看板',
        value: formatCompactHours(sidebarWindows?.todayMs ?? 0),
        active: curRange === 'today',
        onSelect: () => handleSwitchPresetRef.current('today'),
        title: '只看今天的心流看板',
      },
      {
        id: '7d',
        label: '最近 7 天',
        value: formatCompactHours(sidebarWindows?.weekMs ?? 0),
        active: curRange === '7d',
        onSelect: () => handleSwitchPresetRef.current('7d'),
        title: '最近 7 天的累计有效专注',
      },
      {
        id: '30d',
        label: '最近 30 天',
        value: formatCompactHours(sidebarWindows?.monthMs ?? 0),
        active: curRange === '30d',
        onSelect: () => handleSwitchPresetRef.current('30d'),
        title: '最近 30 天的累计有效专注',
      },
      {
        id: 'heatmap',
        label: '每日记录',
        value: `${HEATMAP_WINDOW_DAYS}天`,
        active: curRange === 'heatmap',
        onSelect: () => handleSwitchPresetRef.current('heatmap'),
        title: `热力矩阵窗口：${HEATMAP_WINDOW_DAYS} 天（${HEATMAP_WINDOW_DAYS / 7} 周）`,
      },
    ],
    [sidebarWindows, curRange],
  );

  const filteredSessions = useMemo(() => {
    const query = taskQuery.trim().toLowerCase();
    return (analytics?.sessions ?? []).filter((session: FocusSession) => {
      const timeline = (analytics?.timeline ?? []).filter(
        (item) => item.sessionId === session.id && item.kind === 'focus',
      );
      const matchesCategory =
        projectFilter === 'all' ||
        timeline.some((item) =>
          item.taskId
            ? item.taskId === analytics?.tasks.find((task) => task.key === projectFilter)?.taskId
            : `unlinked:${item.title}` === projectFilter,
        );
      const matchesQuery =
        !query ||
        [session.title, session.defaultTaskTitle, ...timeline.map((item) => item.title)].some(
          (title) => title?.toLowerCase().includes(query),
        );
      return matchesCategory && matchesQuery;
    });
  }, [analytics, projectFilter, taskQuery]);

  // 快捷键 Ctrl+K 搜索聚焦
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // 鼠标移动高光跟随

  // 外观操作
  const openAppearanceAt = (x: number, y: number) => {
    setMenuPos({
      x: Math.min(Math.max(8, x), window.innerWidth - 225),
      y: Math.min(Math.max(8, y), window.innerHeight - 380),
    });
    setMenuOpen(true);
  };

  const handleOpenAppearanceModal = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    const btn = appearanceBtnRef.current;
    if (btn) {
      const rect = btn.getBoundingClientRect();
      openAppearanceAt(rect.right - 215, rect.bottom + 8);
    } else {
      openAppearanceAt(window.innerWidth - 225, 42);
    }
  };

  const handleRightClick = (e: React.MouseEvent) => {
    e.preventDefault();
    openAppearanceAt(e.clientX, e.clientY);
  };

  // 切换预设
  const handleSwitchPreset = (mode: StatsPreset) => {
    playWebAudioChime('click');
    setCurRange(mode);
    setProjectFilter('all');
    setCurSelectedSession(null);
    if (mode === 'heatmap') {
      const el = document.getElementById('tileHeatmap');
      el?.scrollIntoView({ behavior: 'smooth' });

      return;
    }
  };
  handleSwitchPresetRef.current = handleSwitchPreset;

  // 切换清单分类
  const handleFilterProject = (catKey: string) => {
    playWebAudioChime('click');
    setProjectFilter(catKey);
    setCurSelectedSession(null);
  };

  /* 侧栏「清单分类」点击：把真实分类名交给筛选。
     原实现写死 dev/ui/read 三个假键，与真实分类永远对不上。 */
  /** 账本里选中一个任务后，把已结束的会话关联到它。 */
  const handleLinkSessionTask = async (task: Task | null) => {
    const target = linkTarget;
    setLinkTarget(null);
    if (!task || !target) return;
    try {
      if (target.segmentId) {
        await window.focuslink.timer.linkTask(target.segmentId, task.id, task.source, task.title);
      } else {
        await window.focuslink.timer.linkSessionTask(
          target.sessionId,
          task.id,
          task.source,
          task.title,
        );
        // 已结束会话的默认任务不会自动修改片段；只补关联尚未关联的片段。
        await window.focuslink.timer.linkSegmentsBatch(
          target.sessionId,
          task.id,
          task.source,
          task.title,
          true,
        );
      }
      playWebAudioChime('click');
      showToast(`已关联「${target.label}」→ ${task.title}`);
      setAnalyticsReloadToken((token) => token + 1);
    } catch (err) {
      setAnalyticsReloadToken((token) => token + 1);
      showToast('关联失败：' + (err as Error).message);
    }
  };

  const handleSelectSidebarCategory = (key: string) => {
    if (key === 'all') {
      handleFilterProject('all');
      return;
    }
    handleFilterProject(key);
  };

  // 前后日期导航
  const handleStepDate = (d: number) => {
    playWebAudioChime('click');
    setDayCursor((cur) => shiftLocalDay(cur, d));
  };

  const handleExportDataReport = () => {
    const blob = new Blob([JSON.stringify(analytics, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `FocusLink-时间账本-${new Date(range.start).toLocaleDateString('sv-SE')}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // 时段高亮
  const handlePeriodClick = (idx: number) => {
    playWebAudioChime('click');
    if (activePeriod === idx) {
      setActivePeriod(-1);
    } else {
      setActivePeriod(idx);
    }
  };

  // 任务选择联动
  const handleTaskSelect = (taskId: string | null, title: string) => {
    const match = filteredSessions.find((session) =>
      (analytics?.timeline ?? []).some(
        (item) =>
          item.sessionId === session.id &&
          item.kind === 'focus' &&
          (taskId ? item.taskId === taskId : !item.taskId && item.title === title),
      ),
    );
    if (match) setCurSelectedSession(match.id);
  };

  const dayDate = new Date(dayCursor);
  const dayDateStr = `${dayDate.getFullYear()}年${dayDate.getMonth() + 1}月${dayDate.getDate()}日`;

  const activeViewTitle =
    curRange === 'today'
      ? '今日统计'
      : curRange === '7d'
        ? '最近 7 天精力全景'
        : curRange === '30d'
          ? '最近 30 天心流沉淀'
          : '每日记录';

  /* 页头读数必须来自当前范围的真实 analytics。
     2026-10-01 修复：这里原本写死了 '2026年9月22日 - 9月28日 · 28 个专注会话 · 累计 32.2h'
     与 '2026年8月30日 - 9月28日 · 84 个会话 · 累计 128.6h'（原型样例值），
     以及今日的 '累计 4h 35m' —— 与数据库真实值无关。 */
  const formatDayLabel = (ms: number) => {
    const d = new Date(ms);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  };
  const rangeActiveLabel = formatHoursMinutes(analytics?.totals?.activeMs ?? 0);
  const activeViewStats =
    curRange === 'today'
      ? `${dayDateStr} · ${analytics?.sessions.length ?? 0} 个专注会话 · 累计 ${rangeActiveLabel}`
      : `${formatDayLabel(range.start)} - ${formatDayLabel(range.end)} · ${analytics?.sessions.length ?? 0} 个专注会话 · 累计 ${rangeActiveLabel}`;

  return (
    <div
      className="stats-page app-window"
      data-pal={palette}
      data-theme={themeMode}
      data-font={font}
      data-skin="ceramic"
      data-sound={soundEnabled ? 'on' : 'off'}
      onContextMenu={handleRightClick}
      onClick={() => setMenuOpen(false)}
      data-ledger-open={ledgerOpen}
    >
      {/* 1. 42px 沉浸式标题栏 (100% 对齐任务页) */}
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
              type="text"
              id="globalSearchInput"
              placeholder="搜索会话或任务"
              value={taskQuery}
              onChange={(e) => setTaskQuery(e.target.value)}
            />
            <span className="kbd-hint">Ctrl K</span>
          </div>
        </div>

        <div className="titlebar-right">
          <div className="sync-badge">
            <i />
            <span>本地时间账本</span>
          </div>
          <button
            ref={appearanceBtnRef}
            className="btn-tool view-opt-btn"
            id="appearanceBtn"
            onClick={handleOpenAppearanceModal}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            外观
          </button>
        </div>
      </header>

      {/* 2. 三栏工作区 (Workspace Body - 100% 模数) */}
      <div className="workspace-body" ref={columns.ref} style={columns.style}>
        {/* 左侧栏：统计视图与清单分类 —— 真实数据（v1.3.17 修复写死的原型样例值） */}
        <StatsSidebar
          views={sidebarViews}
          categories={sidebarCategories}
          activeCategory={projectFilter}
          onSelectCategory={handleSelectSidebarCategory}
        />

        {/* 中间：统计画卷 (Stats Paper) */}
        {columns.divider('left', '调整统计导航栏宽度')}
        <main className="stats-paper">
          <div className="list-toolbar">
            <div className="list-title-group">
              <h2 id="activeViewTitle">{activeViewTitle}</h2>
              <span className="list-stats-text" id="activeViewStats">
                {activeViewStats}
              </span>
            </div>

            <div className="list-toolbar-actions">
              <button
                type="button"
                className="btn-tool ledger-toggle"
                aria-expanded={ledgerOpen}
                onClick={() => setLedgerOpen((open) => !open)}
              >
                会话账本 · {filteredSessions.length}
              </button>
              <button
                disabled={curRange !== 'today'}
                className="btn-tool"
                onClick={() => handleStepDate(-1)}
                title="前一天"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                前一天
              </button>
              <button
                disabled={
                  curRange !== 'today' ||
                  getDayRange(dayCursor).start >= getDayRange(Date.now()).start
                }
                className="btn-tool"
                onClick={() => handleStepDate(1)}
                title="后一天"
              >
                后一天
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
              <button disabled={!analytics} className="btn-tool" onClick={handleExportDataReport}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                </svg>
                导出账本
              </button>
            </div>
          </div>

          <div className="stats-scroll-area">
            {analyticsError ? (
              <div role="alert" className="ledger-empty">
                读取统计失败：{analyticsError}{' '}
                <button
                  className="btn-tool"
                  type="button"
                  onClick={() => setAnalyticsReloadToken((token) => token + 1)}
                >
                  重试
                </button>
              </div>
            ) : (
              !analytics && (
                <div role="status" className="ledger-empty">
                  正在读取统计…
                </div>
              )
            )}
            <HistoryInsights
              heatmapDaily={heatmapDaily}
              summary={summarizeAnalyticsRange(
                analytics?.daily ?? [],
                analytics?.sessions?.length ?? 0,
              )}
              range={range}
              analytics={analytics}
              slideDirection={0}
              onSelectRange={() => undefined}
              taskQuery={taskQuery}
              activePeriod={activePeriod}
              onPeriodClick={handlePeriodClick}
              onTaskSelect={handleTaskSelect}
              onTaskHover={setHoveredTaskIdx}
              hoveredTaskIndex={hoveredTaskIdx}
              multiDayMode={curRange === '7d' || curRange === '30d'}
            />
          </div>
        </main>

        {columns.divider('right', '调整会话账本宽度')}
        {ledgerOpen && (
          <button
            type="button"
            className="ledger-drawer-close"
            onClick={() => setLedgerOpen(false)}
            aria-label="关闭会话账本"
          >
            关闭账本
          </button>
        )}
        <SessionLedger
          sessions={filteredSessions}
          selectedId={curSelectedSession}
          onSelect={setCurSelectedSession}
          onLink={(session, segmentId) =>
            setLinkTarget({
              sessionId: session.id,
              label: session.title || '专注会话',
              segmentId,
              taskId: session.defaultTaskId,
            })
          }
          reloadToken={analyticsReloadToken}
          notify={showToast}
          filterLabel={
            projectFilter === 'all'
              ? undefined
              : sidebarCategories.find((category) => category.key === projectFilter)?.label
          }
          onResetFilter={() => setProjectFilter('all')}
        />
      </div>

      {/* 外观弹出菜单 (与任务页同源) */}
      <div
        className={`ctx-menu ${menuOpen ? 'active' : ''}`}
        id="appearanceMenu"
        style={menuPos ? { left: `${menuPos.x}px`, top: `${menuPos.y}px` } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ctx-menu-title">色彩基调</div>
        <div
          className="ctx-menu-item"
          data-pal="linear"
          aria-checked={palette === 'linear'}
          onClick={() => {
            playWebAudioChime('click');
            setPalette('linear');
            setMenuOpen(false);
            showToast('色彩基调：纯净白');
          }}
        >
          ● 纯净白
        </div>
        <div
          className="ctx-menu-item"
          data-pal="rose"
          aria-checked={palette === 'rose'}
          onClick={() => {
            playWebAudioChime('click');
            setPalette('rose');
            setMenuOpen(false);
            showToast('色彩基调：典雅粉');
          }}
        >
          ● 典雅粉
        </div>
        <div
          className="ctx-menu-item"
          data-pal="contrast"
          aria-checked={palette === 'contrast'}
          onClick={() => {
            playWebAudioChime('click');
            setPalette('contrast');
            setMenuOpen(false);
            showToast('色彩基调：高对比');
          }}
        >
          ● 高对比
        </div>

        <div className="ctx-divider" />
        <div className="ctx-menu-title">明暗主题</div>
        <div
          className="ctx-menu-item"
          data-theme="light"
          aria-checked={themeMode === 'light'}
          onClick={() => {
            playWebAudioChime('click');
            setThemeMode('light');
            setMenuOpen(false);
            showToast('主题：浅色模式');
          }}
        >
          ☀️ 浅色模式
        </div>
        <div
          className="ctx-menu-item"
          data-theme="dark"
          aria-checked={themeMode === 'dark'}
          onClick={() => {
            playWebAudioChime('click');
            setThemeMode('dark');
            setMenuOpen(false);
            showToast('主题：深色模式');
          }}
        >
          🌙 深色模式
        </div>

        <div className="ctx-divider" />
        <div className="ctx-menu-title">排版字形</div>
        <div
          className="ctx-menu-item"
          data-font="sans"
          aria-checked={font === 'sans'}
          onClick={() => {
            playWebAudioChime('click');
            setFont('sans');
            setMenuOpen(false);
            showToast('字体：无衬线体');
          }}
        >
          无衬线体
        </div>
        <div
          className="ctx-menu-item"
          data-font="serif"
          aria-checked={font === 'serif'}
          onClick={() => {
            playWebAudioChime('click');
            setFont('serif');
            setMenuOpen(false);
            showToast('字体：衬线体');
          }}
        >
          衬线体
        </div>

        <div className="ctx-divider" />
        <div
          className="ctx-menu-item"
          id="soundMenuItem"
          onClick={() => {
            playWebAudioChime('click');
            setSoundEnabled((prev) => !prev);
            setMenuOpen(false);
            showToast(`音效：${!soundEnabled ? '开启' : '关闭'}`);
          }}
        >
          音效：{soundEnabled ? '开' : '关'}
        </div>
      </div>
      {/* v1.3.19：账本补关联任务的任务选择器（TaskPicker 以当前焦点元素为锚点自定位） */}
      {linkTarget &&
        createPortal(
          <TaskPicker
            allowCompleted
            selectedTaskId={linkTarget.taskId}
            title={`关联任务 · ${linkTarget.label}`}
            onPick={(task) => {
              void handleLinkSessionTask(task);
            }}
          />,
          document.body,
        )}
    </div>
  );
}
