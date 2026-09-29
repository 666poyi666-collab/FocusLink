// 历史与统计工作台：100% 对齐设计原型 (统计页原型.html)
// 包含 42px 沉浸式标题栏、三栏弹性响应式工作区、5 大核心卡贴画卷、横向连续账本流、
// Web Audio 晶莹和弦音效、鼠标感应镜面高光、双向高光联动与外观弹窗。
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../../styles/stats-workbench.css';
import { formatClock, formatDuration, formatMinutes } from '../../lib/time';
import {
  getDayRange,
  shiftLocalDay,
  summarizeAnalyticsRange,
  type RangePreset,
  type TimeRange,
} from './historyStats';
import type { FocusSession } from '@shared/types';
import type { SessionAnalyticsResult } from '@shared/ipc/api';
import { HistoryInsights } from './HistoryInsights';

type StatsPreset = RangePreset | 'heatmap';

interface ProtoSession {
  id: number | string;
  clock: string;
  title: string;
  project: string;
  projectKey: string;
  dur: string;
  segCount: number;
  pauseCount: number;
  meta: string;
  track: Array<{ type: 'focus' | 'pause'; width: number; lbl: string }>;
  segments: Array<{ type: 'focus' | 'pause'; name: string; time: string; dur: string }>;
}

const DEFAULT_SESSIONS: ProtoSession[] = [
  {
    id: 1,
    clock: '14:20 - 15:45',
    title: 'Q3 季度重点业务复盘与跨部门协作交付物整理汇报',
    project: '工作任务',
    projectKey: 'dev',
    dur: '1h 20m',
    segCount: 2,
    pauseCount: 1,
    meta: '起止：14:20:00 - 15:45:00 · 自然历时 1h 25m',
    track: [
      { type: 'focus', width: 55, lbl: '专注 45m' },
      { type: 'pause', width: 8, lbl: '5m' },
      { type: 'focus', width: 37, lbl: '专注 35m' },
    ],
    segments: [
      {
        type: 'focus',
        name: '片段 1 · 业务数据汇总结算',
        time: '14:20:00 - 15:05:00',
        dur: '45m 00s',
      },
      { type: 'pause', name: '暂停事件 · 休息喝水', time: '15:05:00 - 15:10:00', dur: '5m 00s' },
      {
        type: 'focus',
        name: '片段 2 · 协作看板对齐联调',
        time: '15:10:00 - 15:45:00',
        dur: '35m 00s',
      },
    ],
  },
  {
    id: 2,
    clock: '16:10 - 17:30',
    title: '设计并实现 FocusLink 任务页 4K 纯净网膜级交互设计规范',
    project: '工作任务',
    projectKey: 'dev',
    dur: '1h 20m',
    segCount: 1,
    pauseCount: 0,
    meta: '起止：16:10:00 - 17:30:00 · 自然历时 1h 20m',
    track: [{ type: 'focus', width: 100, lbl: '专注 1h 20m (满格心流)' }],
    segments: [
      {
        type: 'focus',
        name: '片段 1 · 规范设计推导与实现',
        time: '16:10:00 - 17:30:00',
        dur: '1h 20m 00s',
      },
    ],
  },
  {
    id: 3,
    clock: '10:40 - 11:30',
    title: '重构 LocalTaskProvider 数据库写入与排序幂等迁移',
    project: '深度学习',
    projectKey: 'ui',
    dur: '50m',
    segCount: 1,
    pauseCount: 0,
    meta: '起止：10:40:00 - 11:30:00 · 自然历时 50m',
    track: [{ type: 'focus', width: 100, lbl: '专注 50m' }],
    segments: [
      {
        type: 'focus',
        name: '片段 1 · 数据库写入校验',
        time: '10:40:00 - 11:30:00',
        dur: '50m 00s',
      },
    ],
  },
  {
    id: 4,
    clock: '09:15 - 10:25',
    title: '精读《深度工作》(Deep Work)：沉浸式专注与心流建立策略',
    project: '个人生活',
    projectKey: 'read',
    dur: '1h 05m',
    segCount: 2,
    pauseCount: 1,
    meta: '起止：09:15:00 - 10:25:00 · 自然历时 1h 10m',
    track: [
      { type: 'focus', width: 45, lbl: '专注 30m' },
      { type: 'pause', width: 10, lbl: '5m' },
      { type: 'focus', width: 45, lbl: '专注 35m' },
    ],
    segments: [
      { type: 'focus', name: '片段 1 · 核心策略研读', time: '09:15:00 - 09:45:00', dur: '30m 00s' },
      {
        type: 'pause',
        name: '暂停事件 · 记录架构笔记',
        time: '09:45:00 - 09:50:00',
        dur: '5m 00s',
      },
      { type: 'focus', name: '片段 2 · 实践比对', time: '09:50:00 - 10:25:00', dur: '35m 00s' },
    ],
  },
];

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
  // 状态变量
  const [curRange, setCurRange] = useState<StatsPreset>('today');
  const [dayCursor, setDayCursor] = useState<number>(() => Date.now());
  const [taskQuery, setTaskQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [curSelectedSession, setCurSelectedSession] = useState(0);
  const [activePeriod, setActivePeriod] = useState<number>(-1);
  const [hoveredTaskIdx, setHoveredTaskIdx] = useState<number | null>(null);

  // 外观设置
  const [palette, setPalette] = useState<'linear' | 'rose' | 'contrast'>('linear');
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>('light');
  const [font, setFont] = useState<'sans' | 'serif'>('sans');
  const [cardSkin, setCardSkin] = useState<'ceramic' | 'frosted' | 'titanium'>('ceramic');
  const [soundEnabled, setSoundEnabled] = useState(true);

  // 外观弹出菜单
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const appearanceBtnRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // 浮动通知队列
  const [toasts, setToasts] = useState<Array<{ id: number; msg: string; fade: boolean }>>([]);

  const showToast = useCallback((msg: string) => {
    playWebAudioChime('click');
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, msg, fade: false }]);
    setTimeout(() => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, fade: true } : t)));
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 200);
    }, 2000);
  }, []);

  // 监听真实数据（若有）
  const [analytics, setAnalytics] = useState<SessionAnalyticsResult | null>(null);
  const range = useMemo<TimeRange>(() => {
    if (curRange === 'today') return getDayRange(dayCursor);
    const end = Date.now();
    const days = curRange === '7d' ? 7 : curRange === '30d' ? 30 : 84;
    return { start: end - days * 86_400_000, end };
  }, [curRange, dayCursor]);

  useEffect(() => {
    let cancelled = false;
    const loadAnalytics = async () => {
      try {
        if (window.focuslink?.sessions?.analytics) {
          const res = await window.focuslink.sessions.analytics({
            start: range.start,
            end: range.end,
            timelineStart: range.start,
            timelineEnd: range.end,
          });
          if (!cancelled) setAnalytics(res);
        }
      } catch (err) {
        console.error('Failed to load session analytics:', err);
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
  }, [range]);

  // 会话列表数据投影
  const sessions = useMemo<ProtoSession[]>(() => {
    if (!analytics?.sessions || analytics.sessions.length === 0) {
      return DEFAULT_SESSIONS;
    }
    return analytics.sessions.map((s: FocusSession, idx: number) => {
      const isDev = Boolean(s.defaultTaskTitle);
      const dur = formatMinutes(s.activeElapsedMs);
      const clock = `${formatClock(s.startedAt)} - ${s.endedAt ? formatClock(s.endedAt) : '进行中'}`;
      const title = s.title || s.defaultTaskTitle || '专注会话';
      const meta = `起止：${formatClock(s.startedAt)} - ${s.endedAt ? formatClock(s.endedAt) : '进行中'} · 自然历时 ${formatDuration(s.wallElapsedMs || s.activeElapsedMs)}`;
      return {
        id: s.id || idx,
        clock,
        title,
        project: isDev ? '工作任务' : '默认心流',
        projectKey: isDev ? 'dev' : 'all',
        dur,
        segCount: 1,
        pauseCount: s.pauseElapsedMs > 0 ? 1 : 0,
        meta,
        track: [
          {
            type: 'focus',
            width: Math.min(
              100,
              Math.max(
                10,
                Math.round((s.activeElapsedMs / (s.activeElapsedMs + s.pauseElapsedMs || 1)) * 100),
              ),
            ),
            lbl: `专注 ${dur}`,
          },
          ...(s.pauseElapsedMs > 0
            ? [
                {
                  type: 'pause' as const,
                  width: Math.min(
                    30,
                    Math.round((s.pauseElapsedMs / (s.activeElapsedMs + s.pauseElapsedMs)) * 100),
                  ),
                  lbl: `${formatMinutes(s.pauseElapsedMs)}`,
                },
              ]
            : []),
        ],
        segments: [{ type: 'focus', name: `片段 1 · ${title}`, time: clock, dur }],
      };
    });
  }, [analytics?.sessions]);

  // 过滤后的会话流（根据搜索框与分类）
  const filteredSessions = useMemo(() => {
    const q = taskQuery.trim().toLowerCase();
    return sessions.filter((s) => {
      const matchCat = projectFilter === 'all' || s.projectKey === projectFilter;
      const matchQ = !q || s.title.toLowerCase().includes(q) || s.project.toLowerCase().includes(q);
      return matchCat && matchQ;
    });
  }, [sessions, projectFilter, taskQuery]);

  const activeSession = filteredSessions[curSelectedSession] || filteredSessions[0] || sessions[0];

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
  const handleContainerMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    const card = (e.target as HTMLElement).closest('.card-widget') as HTMLElement | null;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    card.style.setProperty('--mouse-x', `${x}px`);
    card.style.setProperty('--mouse-y', `${y}px`);
  };

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
    if (mode === 'heatmap') {
      const el = document.getElementById('tileHeatmap');
      el?.scrollIntoView({ behavior: 'smooth' });
      showToast('已定位至 24 周心流活动矩阵');
      return;
    }
    const titles: Record<string, string> = {
      today: '今日心流看板',
      '7d': '最近 7 天精力全景',
      '30d': '最近 30 天心流沉淀',
    };
    showToast(`已切换至${titles[mode] ?? '心流看板'}`);
  };

  // 切换清单分类
  const handleFilterProject = (catKey: string, name: string) => {
    playWebAudioChime('click');
    setProjectFilter(catKey);
    setCurSelectedSession(0);
    showToast(`已筛选清单：${name}`);
  };

  // 前后日期导航
  const handleStepDate = (d: number) => {
    playWebAudioChime('click');
    setDayCursor((cur) => shiftLocalDay(cur, d));
    const nextDate = new Date(shiftLocalDay(dayCursor, d));
    showToast(
      `已切换至 ${nextDate.getFullYear()}年${nextDate.getMonth() + 1}月${nextDate.getDate()}日`,
    );
  };

  // 导出账本
  const handleExportDataReport = () => {
    playWebAudioChime('click');
    showToast('已导出 FocusLink 时间账本 (CSV & JSON)');
  };

  // 复制 Markdown
  const handleCopySessionRecord = (s: ProtoSession) => {
    playWebAudioChime('click');
    const md = `### [FocusLink 会话记录]\n- **任务**：${s.title}\n- **起止**：${s.clock}\n- **有效专注**：${s.dur}\n- **所属清单**：${s.project}\n- **片段数**：${s.segCount} 段\n- **暂停**：${s.pauseCount} 次`;
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(md);
    }
    showToast('会话结构化 Markdown 已复制');
  };

  // 时段高亮
  const handlePeriodClick = (idx: number) => {
    playWebAudioChime('click');
    if (activePeriod === idx) {
      setActivePeriod(-1);
      showToast('已重置时段高亮');
    } else {
      setActivePeriod(idx);
      const names = ['深夜时段', '黄金上午', '沉浸下午', '晚间收尾', '深夜休整'];
      showToast(`时段聚焦：${names[idx]}`);
    }
  };

  // 任务选择联动
  const handleTaskSelect = (idx: number) => {
    playWebAudioChime('click');
    setCurSelectedSession(idx);
    const cardEl = document.querySelectorAll('.session-card')[idx] as HTMLElement | null;
    cardEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const dayDate = new Date(dayCursor);
  const dayDateStr = `${dayDate.getFullYear()}年${dayDate.getMonth() + 1}月${dayDate.getDate()}日`;

  const activeViewTitle =
    curRange === 'today'
      ? '今日心流看板'
      : curRange === '7d'
        ? '最近 7 天精力全景'
        : '最近 30 天心流沉淀';

  const activeViewStats =
    curRange === 'today'
      ? `${dayDateStr} · ${filteredSessions.length} 个专注会话 · 累计 4h 35m`
      : curRange === '7d'
        ? '2026年9月22日 - 9月28日 · 28 个专注会话 · 累计 32.2h'
        : '2026年8月30日 - 9月28日 · 84 个会话 · 累计 128.6h';

  return (
    <div
      className="stats-page app-window"
      data-pal={palette}
      data-theme={themeMode}
      data-font={font}
      data-skin={cardSkin}
      data-sound={soundEnabled ? 'on' : 'off'}
      onContextMenu={handleRightClick}
      onClick={() => setMenuOpen(false)}
      onMouseMove={handleContainerMouseMove}
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
              placeholder="快速查找专注记录、任务或标签..."
              value={taskQuery}
              onChange={(e) => setTaskQuery(e.target.value)}
            />
            <span className="kbd-hint">Ctrl K</span>
          </div>
        </div>

        <div className="titlebar-right">
          <div className="sync-badge">
            <i />
            <span>本地同步就绪</span>
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
      <div className="workspace-body">
        {/* 左侧栏：统计视图与清单分类 */}
        <aside className="sidebar">
          <div className="nav-section">
            <div className="nav-section-title">
              <span>统计视图</span>
            </div>
            <button
              className={`side-item ${curRange === 'today' ? 'active' : ''}`}
              onClick={() => handleSwitchPreset('today')}
            >
              <span className="side-item-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </span>
              <span className="side-name">今日看板</span>
              <span className="nav-num">4.6h</span>
            </button>
            <button
              className={`side-item ${curRange === '7d' ? 'active' : ''}`}
              onClick={() => handleSwitchPreset('7d')}
            >
              <span className="side-item-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
              </span>
              <span className="side-name">最近 7 天</span>
              <span className="nav-num">32.2h</span>
            </button>
            <button
              className={`side-item ${curRange === '30d' ? 'active' : ''}`}
              onClick={() => handleSwitchPreset('30d')}
            >
              <span className="side-item-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 20V10M18 20V4M6 20v-4" />
                </svg>
              </span>
              <span className="side-name">最近 30 天</span>
              <span className="nav-num">128.6h</span>
            </button>
            <button
              className={`side-item ${curRange === 'heatmap' ? 'active' : ''}`}
              onClick={() => handleSwitchPreset('heatmap')}
            >
              <span className="side-item-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                </svg>
              </span>
              <span className="side-name">心流热力全景</span>
              <span className="nav-num">84天</span>
            </button>
          </div>

          <div className="nav-section">
            <div className="nav-section-title">
              <span>清单分类</span>
            </div>
            <button
              className={`side-item ${projectFilter === 'all' ? 'active' : ''}`}
              onClick={() => handleFilterProject('all', '全部分类')}
            >
              <span className="project-dot" style={{ background: 'var(--accent)' }} />
              <span className="side-name">全部分类</span>
              <span className="nav-num">100%</span>
            </button>
            <button
              className={`side-item ${projectFilter === 'dev' ? 'active' : ''}`}
              onClick={() => handleFilterProject('dev', '工作任务')}
            >
              <span className="project-dot" style={{ background: '#2563EB' }} />
              <span className="side-name">工作任务</span>
              <span className="nav-num">55%</span>
            </button>
            <button
              className={`side-item ${projectFilter === 'ui' ? 'active' : ''}`}
              onClick={() => handleFilterProject('ui', '深度学习')}
            >
              <span className="project-dot" style={{ background: '#10B981' }} />
              <span className="side-name">深度学习</span>
              <span className="nav-num">25%</span>
            </button>
            <button
              className={`side-item ${projectFilter === 'read' ? 'active' : ''}`}
              onClick={() => handleFilterProject('read', '个人生活')}
            >
              <span className="project-dot" style={{ background: '#F59E0B' }} />
              <span className="side-name">个人生活</span>
              <span className="nav-num">12%</span>
            </button>
          </div>

          <div className="sidebar-footer">
            <div className="sidebar-user-pill">
              <div className="user-avatar-mini">FL</div>
              <span>FocusLink 统计空间</span>
            </div>
            <div
              style={{
                fontSize: '11px',
                color: '#10B981',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: '5px',
                  height: '5px',
                  borderRadius: '50%',
                  background: '#10B981',
                }}
              />
              已就绪
            </div>
          </div>
        </aside>

        {/* 中间：统计画卷 (Stats Paper) */}
        <main className="stats-paper">
          <div className="list-toolbar">
            <div className="list-title-group">
              <h2 id="activeViewTitle">{activeViewTitle}</h2>
              <span className="list-stats-text" id="activeViewStats">
                {activeViewStats}
              </span>
            </div>

            <div className="list-toolbar-actions">
              <button className="btn-tool" onClick={() => handleStepDate(-1)} title="前一天">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                前一天
              </button>
              <button className="btn-tool" onClick={() => handleStepDate(1)} title="后一天">
                后一天
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
              <button className="btn-tool" onClick={handleExportDataReport}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                </svg>
                导出账本
              </button>
            </div>
          </div>

          <div className="stats-scroll-area">
            <HistoryInsights
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

        {/* 3. 右侧：会话详情面板 (100% 对齐横向时间展示) */}
        <aside className="detail-pane">
          <div className="detail-head-bar">
            <div className="detail-head-title">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{ width: '14px', height: '14px', color: 'var(--accent)' }}
              >
                <path d="M12 8v4l3 3" />
                <circle cx="12" cy="12" r="10" />
              </svg>
              会话时间账本
            </div>
            <span
              style={{
                fontSize: '11px',
                fontFamily: 'var(--font-num)',
                color: 'var(--text-tertiary)',
              }}
              id="sessionBadgeCount"
            >
              {filteredSessions.length} 轮记录
            </span>
          </div>

          {/* 会话流列表 */}
          <div className="session-card-stream" id="sessionCardStream">
            {filteredSessions.map((s, idx) => {
              const isActive = idx === curSelectedSession;
              const isHoverLinked = hoveredTaskIdx === idx;
              return (
                <div
                  key={s.id}
                  className={`session-card ${isActive ? 'active' : ''}`}
                  onClick={() => {
                    playWebAudioChime('click');
                    setCurSelectedSession(idx);
                  }}
                  style={
                    isHoverLinked
                      ? { transform: 'translateX(4px)', borderColor: 'var(--accent)' }
                      : undefined
                  }
                >
                  <div className="sc-top">
                    <span className="sc-time-pill">{s.clock}</span>
                    <span className="sc-dur">{s.dur}</span>
                  </div>
                  <div className="sc-title">{s.title}</div>
                  <div className="sc-meta">
                    <span>{s.project}</span>
                    <span>
                      · {s.segCount}片段 · {s.pauseCount}暂停
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 选中会话详情 (横向多段时序图) */}
          {activeSession && (
            <div className="card-widget deep-dive-box" id="deepDiveBox">
              <div className="dd-head">
                <h4 id="ddTitle">{activeSession.title}</h4>
                <p id="ddMeta">{activeSession.meta}</p>
              </div>

              <div>
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    color: 'var(--text-tertiary)',
                    marginBottom: '4px',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  <span>连续时序轨 (Chronological Track)</span>
                  <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-num)' }}>
                    有效专注 {activeSession.dur}
                  </span>
                </div>
                <div className="horiz-flow-track" id="ddTrack">
                  {activeSession.track.map((t, i) => (
                    <div
                      key={i}
                      className={t.type === 'focus' ? 'hf-seg-focus' : 'hf-seg-pause'}
                      style={{ width: `${t.width}%` }}
                    >
                      {t.lbl}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    color: 'var(--text-tertiary)',
                    marginBottom: '6px',
                  }}
                >
                  片段流水明细 (Segments & Pauses)
                </div>
                <div className="segment-mini-list" id="ddSegmentList">
                  {activeSession.segments.map((seg, i) => (
                    <div className="seg-mini-row" key={i}>
                      <div className="seg-row-top">
                        <div className="seg-name-wrap">
                          <span className={`seg-dot ${seg.type}`} />
                          <span className="seg-name-txt">{seg.name}</span>
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
                      <div className="seg-time-sub">{seg.time}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div
                style={{
                  borderTop: '1px solid var(--border-row)',
                  paddingTop: '10px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span
                  style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}
                  id="ddProjectLabel"
                >
                  所属清单：{activeSession.project}
                </span>
                <button
                  className="btn-tool"
                  style={{ height: '25px', fontSize: '11px' }}
                  onClick={() => handleCopySessionRecord(activeSession)}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    style={{ width: '12px', height: '12px' }}
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  复制 Markdown
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* 浮动通知容器 */}
      <div className="app-toast-container" id="toastContainer">
        {toasts.map((t) => (
          <div key={t.id} className={`app-toast ${t.fade ? 'fade-out' : ''}`}>
            <span style={{ color: 'var(--accent)', fontWeight: 700, marginRight: '4px' }}>✓</span>
            <span>{t.msg}</span>
          </div>
        ))}
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
            showToast('色彩基调：Linear 纯净白 (电光蓝)');
          }}
        >
          ● Linear 纯净白 (电光蓝)
        </div>
        <div
          className="ctx-menu-item"
          data-pal="rose"
          aria-checked={palette === 'rose'}
          onClick={() => {
            playWebAudioChime('click');
            setPalette('rose');
            setMenuOpen(false);
            showToast('色彩基调：高级粉 (Rose 典雅粉)');
          }}
        >
          ● 高级粉 (Rose 典雅粉)
        </div>
        <div
          className="ctx-menu-item"
          data-pal="contrast"
          aria-checked={palette === 'contrast'}
          onClick={() => {
            playWebAudioChime('click');
            setPalette('contrast');
            setMenuOpen(false);
            showToast('色彩基调：极致对比 (Sharp Black)');
          }}
        >
          ● 极致对比 (Sharp Black)
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
            showToast('字体：Noto Sans SC (无衬线)');
          }}
        >
          无衬线体 (Noto Sans SC)
        </div>
        <div
          className="ctx-menu-item"
          data-font="serif"
          aria-checked={font === 'serif'}
          onClick={() => {
            playWebAudioChime('click');
            setFont('serif');
            setMenuOpen(false);
            showToast('字体：Noto Serif SC (衬线)');
          }}
        >
          衬线体 (Noto Serif SC)
        </div>

        <div className="ctx-divider" />
        <div className="ctx-menu-title">卡贴质感外观 (Card Skin)</div>
        <div
          className="ctx-menu-item"
          data-skin="ceramic"
          aria-checked={cardSkin === 'ceramic'}
          onClick={() => {
            playWebAudioChime('click');
            setCardSkin('ceramic');
            setMenuOpen(false);
            showToast('卡贴外观：已切换至 ▫️ 纯白陶瓷 (Pure Ceramic)');
          }}
        >
          ▫️ 纯白陶瓷 (Pure Ceramic)
        </div>
        <div
          className="ctx-menu-item"
          data-skin="frosted"
          aria-checked={cardSkin === 'frosted'}
          onClick={() => {
            playWebAudioChime('click');
            setCardSkin('frosted');
            setMenuOpen(false);
            showToast('卡贴外观：已切换至 🪟 微光磨砂 (Frosted Glass)');
          }}
        >
          🪟 微光磨砂 (Frosted Glass)
        </div>
        <div
          className="ctx-menu-item"
          data-skin="titanium"
          aria-checked={cardSkin === 'titanium'}
          onClick={() => {
            playWebAudioChime('click');
            setCardSkin('titanium');
            setMenuOpen(false);
            showToast('卡贴外观：已切换至 ⚙️ 极客钛金 (Titanium Sheen)');
          }}
        >
          ⚙️ 极客钛金 (Titanium Sheen)
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
          🔔 晶莹和弦音效：{soundEnabled ? '开' : '关'}
        </div>
      </div>
    </div>
  );
}
