import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Project, Task, TaskRecurrenceDefinition } from '@shared/types';
import { assembleTaskTree } from '@shared/taskTreeUtils';
import { TASK_PROJECT_COLOR_PALETTE } from '@shared/taskProjectPolicy';
import { useStore } from '../../app/store';
import '../../styles/task-workbench.css';

const DAY_MS = 86_400_000;

function getNowMidnight(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const ICONS: Record<string, string> = {
  inbox:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
  today:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  upcoming:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  all: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  checkCircle:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"></circle><path d="M8 12.5l2.8 2.8 5.4-5.6"></path></svg>',
  checkMark:
    '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 10.5 L8.2 14.2 L15.5 6.5" class="check-path" pathLength="100"></path></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/></svg>',
  folder:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
  clock:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  trash:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  close:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="8 5 19 12 8 19 8 5"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  briefcase:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  heart:
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
  zap: '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  coffee:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>',
  music:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
};

const ICON_PICK_LIST = [
  'folder',
  'briefcase',
  'book',
  'code',
  'heart',
  'zap',
  'coffee',
  'music',
  'star',
  'flag',
  'tag',
  'clock',
];

const EMOJI_PICK_LIST = [
  '💼',
  '📚',
  '💻',
  '🎯',
  '🎨',
  '🚀',
  '⭐',
  '🔥',
  '💡',
  '🏆',
  '🌿',
  '☕',
  '❤️',
  '✈️',
  '🛒',
  '🎵',
];

const COLOR_PALETTE = [
  '#2563EB',
  '#7C3AED',
  '#DB2777',
  '#EA580C',
  '#10B981',
  '#0891B2',
  '#6366F1',
  '#EC4899',
  '#F59E0B',
  '#14B8A6',
  '#4B5563',
  '#DC2626',
];

let audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioCtxClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioCtxClass) audioCtx = new AudioCtxClass();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    void audioCtx.resume();
  }
  return audioCtx;
}

function playCheckChime(isDone: boolean, soundEnabled: boolean) {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    if (isDone) {
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.08); // A5
      osc.frequency.exponentialRampToValueAtTime(1174.66, now + 0.18); // D6
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.2, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.36);
    } else {
      osc.frequency.setValueAtTime(783.99, now); // G5
      osc.frequency.exponentialRampToValueAtTime(440, now + 0.16); // A4
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.12, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.23);
    }
  } catch {}
}

function fireConfettiSparks(x: number, y: number) {
  if (typeof document === 'undefined') return;
  const count = 12;
  const colorStr =
    window.getComputedStyle(document.documentElement).getPropertyValue('--confetti-colors') || '';
  const cleaned = colorStr.replace(/["']/g, '').trim();
  const colors = cleaned ? cleaned.split(',') : ['#2563EB', '#3B82F6', '#60A5FA', '#93C5FD'];
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    const size = 3.5 + Math.random() * 3.5;
    const angle = (i / count) * 2 * Math.PI + (Math.random() - 0.5) * 0.4;
    const dist = 24 + Math.random() * 26;
    const tx = Math.cos(angle) * dist;
    const ty = Math.sin(angle) * dist;

    p.style.position = 'fixed';
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    p.style.width = `${size}px`;
    p.style.height = `${size}px`;
    p.style.borderRadius = '50%';
    p.style.backgroundColor = colors[i % colors.length];
    p.style.pointerEvents = 'none';
    p.style.zIndex = '9999';
    document.body.appendChild(p);

    p.animate(
      [
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        { transform: `translate(${tx}px, ${ty}px) scale(0)`, opacity: 0 },
      ],
      {
        duration: 360,
        easing: 'cubic-bezier(0, .7, .1, 1)',
        fill: 'forwards',
      },
    );
    setTimeout(() => {
      if (p.parentNode) p.parentNode.removeChild(p);
    }, 380);
  }
}

function renderProjectBadge(p?: Project | null) {
  if (!p) return <span className="project-color-dot" style={{ backgroundColor: '#71717A' }} />;
  const col = p.color || 'var(--accent)';
  const icon = p.icon;

  if (!icon || icon === 'dot') {
    return <span className="project-color-dot" style={{ backgroundColor: col }} />;
  }
  if (ICONS[icon]) {
    return (
      <span
        className="proj-badge-icon svg"
        style={{ color: col }}
        title={p.name}
        dangerouslySetInnerHTML={{ __html: ICONS[icon] }}
      />
    );
  }
  return (
    <span className="proj-badge-icon emoji" title={p.name}>
      {icon}
    </span>
  );
}

function formatDateMeta(t: Task) {
  if (!t || (!t.dueDate && !t.startDate)) return null;
  const nowMidnight = getNowMidnight();
  if (t.startDate && t.dueDate && t.startDate !== t.dueDate) {
    const sD = new Date(t.startDate);
    const eD = new Date(t.dueDate);
    const diffDays = Math.max(1, Math.round((t.dueDate - t.startDate) / DAY_MS) + 1);
    const str = `${sD.getMonth() + 1}/${sD.getDate()} - ${eD.getMonth() + 1}/${eD.getDate()} (${diffDays}天)`;
    return { text: str, cls: 'is-range' };
  }
  if (t.startDate && !t.dueDate) {
    const d = new Date(t.startDate);
    return { text: `安排在 ${d.getMonth() + 1}/${d.getDate()}`, cls: 'is-scheduled' };
  }
  if (t.dueDate) {
    if (t.dueDate < nowMidnight) {
      const d = new Date(t.dueDate);
      return { text: `逾期 ${d.getMonth() + 1}/${d.getDate()}`, cls: 'is-late' };
    }
    if (t.dueDate >= nowMidnight && t.dueDate < nowMidnight + DAY_MS) {
      return { text: '今天截止', cls: 'is-today' };
    }
    const d = new Date(t.dueDate);
    return { text: `${d.getMonth() + 1}月${d.getDate()}日`, cls: '' };
  }
  return null;
}

function formatDuration(ms?: number | null): string {
  if (!ms || ms <= 0) return '';
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h${m > 0 ? `${m}m` : ''}`;
  return `${m}m`;
}

interface CustomSmartView {
  id: string;
  name: string;
  rule: 'prio' | 'upcoming' | 'has_due' | 'has_tag' | 'focused';
  color: string;
}

interface SchedulerDraft {
  mode: 'single' | 'range';
  viewYear: number;
  viewMonth: number;
  draftSingleDate: number | null;
  draftStartDate: number | null;
  draftEndDate: number | null;
  draftSem: 'due' | 'scheduled';
  draftRepeat: 'none' | 'daily' | 'workday' | 'weekly' | 'monthly' | 'custom_3';
}

export function TaskWorkspace() {
  const { setSnapshot, addToast } = useStore();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<
    Array<{ id: string; defaultTaskId?: string | null; activeElapsedMs?: number }>
  >([]);
  const [viewId, setViewId] = useState<string>('all');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [completedCollapsed, setCompletedCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [quickInput, setQuickInput] = useState('');
  const [customSmartViews, setCustomSmartViews] = useState<CustomSmartView[]>(() => {
    try {
      const saved = localStorage.getItem('focuslink_custom_smart_views');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // App Theme & Palette & Sound state
  const [palette, setPalette] = useState<'linear' | 'rose' | 'contrast'>(() => {
    try {
      const saved = localStorage.getItem('focuslink_task_pal');
      if (saved === 'rose' || saved === 'contrast' || saved === 'linear') return saved;
    } catch {}
    return 'linear';
  });

  const [sound, setSound] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('focuslink_task_sound');
      if (saved !== null) return saved === 'true';
    } catch {}
    return true;
  });

  const [themeMode, setThemeMode] = useState<'light' | 'dark'>(() => {
    if (typeof document !== 'undefined') {
      return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    }
    return 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-pal', palette);
    localStorage.setItem('focuslink_task_pal', palette);
  }, [palette]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeMode);
    document.documentElement.classList.toggle('dark', themeMode === 'dark');
    document.documentElement.classList.toggle('light', themeMode === 'light');
  }, [themeMode]);

  useEffect(() => {
    localStorage.setItem('focuslink_task_sound', String(sound));
  }, [sound]);

  // Inline editing state
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitleVal, setEditingTitleVal] = useState('');
  const [editingSubtaskKey, setEditingSubtaskKey] = useState<string | null>(null);
  const [editingSubtaskVal, setEditingSubtaskVal] = useState('');
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');

  // Popover state
  const [popover, setPopover] = useState<{
    type: 'priority' | 'project' | 'tag' | 'date' | 'iconPicker' | null;
    taskId?: string;
    projectId?: string;
    rect?: DOMRect;
  }>({ type: null });

  // Context menus
  const [taskContextMenu, setTaskContextMenu] = useState<{
    open: boolean;
    taskId: string | null;
    x: number;
    y: number;
  }>({ open: false, taskId: null, x: 0, y: 0 });

  const [projContextMenu, setProjContextMenu] = useState<{
    open: boolean;
    projectId: string | null;
    x: number;
    y: number;
  }>({ open: false, projectId: null, x: 0, y: 0 });

  // Smart view modal
  const [smartModalOpen, setSmartModalOpen] = useState(false);
  const [smartModalName, setSmartModalName] = useState('');
  const [smartModalRule, setSmartModalRule] = useState<CustomSmartView['rule']>('prio');

  // Scheduler Draft state
  const [scheduler, setScheduler] = useState<SchedulerDraft>({
    mode: 'single',
    viewYear: 2026,
    viewMonth: 8,
    draftSingleDate: null,
    draftStartDate: null,
    draftEndDate: null,
    draftSem: 'due',
    draftRepeat: 'none',
  });

  // Custom icon input state
  const [customIconInput, setCustomIconInput] = useState('');
  const [nativeColorInput, setNativeColorInput] = useState('#2563EB');

  // Load Data
  const refresh = useCallback(async () => {
    if (!window.focuslink?.tasks) return;
    setRefreshing(true);
    try {
      const [res, sessList] = await Promise.all([
        window.focuslink.tasks.refresh({ includeCompleted: true, completedDays: 90 }),
        window.focuslink.sessions?.list
          ? window.focuslink.sessions.list(100).catch(() => [])
          : Promise.resolve([]),
      ]);
      if (res && res.ok && res.data) {
        const assembled = assembleTaskTree(res.data.tasks);
        setTasks(assembled);
        setProjects(res.data.projects);
        if (!selectedTaskId && assembled.length > 0) {
          const firstUncompleted = assembled.find((t) => !t.isCompleted);
          setSelectedTaskId(firstUncompleted ? firstUncompleted.id : assembled[0].id);
        }
      }
      if (sessList) {
        setSessions(sessList);
      }
    } catch (e) {
      console.error('Failed to load tasks', e);
    } finally {
      setRefreshing(false);
    }
  }, [selectedTaskId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Global click outside to dismiss popovers
  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (
        !target.closest('.date-popover') &&
        !target.closest('.popover-menu') &&
        !target.closest('.tag-popover') &&
        !target.closest('.iconpop') &&
        !target.closest('.ctx-menu') &&
        !target.closest('.prop-action-pill') &&
        !target.closest('.prop-add-tag-btn') &&
        !target.closest('.meta-pill.date') &&
        !target.closest('.task-project-main') &&
        !target.closest('.side-item')
      ) {
        setPopover({ type: null });
        setTaskContextMenu({ open: false, taskId: null, x: 0, y: 0 });
        setProjContextMenu({ open: false, projectId: null, x: 0, y: 0 });
      }
    };
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

  // Compute Task Focus Times
  const taskFocusMap = useMemo(() => {
    const map = new Map<string, { totalMs: number; sessions: number[] }>();
    sessions.forEach((s) => {
      if (!s.defaultTaskId || !s.activeElapsedMs) return;
      const cur = map.get(s.defaultTaskId) || { totalMs: 0, sessions: [] };
      cur.totalMs += s.activeElapsedMs;
      const min = Math.max(1, Math.round(s.activeElapsedMs / 60000));
      cur.sessions.push(min);
      map.set(s.defaultTaskId, cur);
    });
    return map;
  }, [sessions]);

  // Current selected task
  const currentTask = useMemo(() => {
    if (!selectedTaskId) return null;
    return tasks.find((t) => t.id === selectedTaskId) || null;
  }, [tasks, selectedTaskId]);

  // Smart Views Definition
  const nowMidnight = useMemo(() => getNowMidnight(), []);

  const smartViews = useMemo(
    () => [
      {
        id: 'today',
        name: '今天',
        icon: ICONS.today,
        color: '#3B82F6',
        filter: (t: Task) =>
          !t.isCompleted && t.dueDate != null && t.dueDate <= nowMidnight + DAY_MS,
      },
      {
        id: 'next7',
        name: '最近 7 天',
        icon: ICONS.upcoming,
        color: '#F59E0B',
        filter: (t: Task) =>
          !t.isCompleted &&
          t.dueDate != null &&
          t.dueDate >= nowMidnight &&
          t.dueDate < nowMidnight + 7 * DAY_MS,
      },
      {
        id: 'all',
        name: '全部任务',
        icon: ICONS.all,
        color: '#6366F1',
        filter: () => true,
      },
      {
        id: 'done',
        name: '已完成',
        icon: ICONS.checkCircle,
        color: '#10B981',
        filter: (t: Task) => !!t.isCompleted,
      },
      {
        id: 'p1',
        name: '高优先级 (P1)',
        icon: ICONS.flag,
        color: '#EF4444',
        filter: (t: Task) => !t.isCompleted && t.priority === 3,
      },
    ],
    [nowMidnight],
  );

  // Filtered Task List
  const { uncompletedTasks, completedTasks, activeTitle, activeIcon } = useMemo(() => {
    let filterFn = (_t: Task) => true;
    let title = '全部任务';
    let iconNode: React.ReactNode = (
      <span
        className="side-item-icon-wrap"
        style={{ color: '#6366F1' }}
        dangerouslySetInnerHTML={{ __html: ICONS.all }}
      />
    );

    if (projectId) {
      const p = projects.find((x) => x.id === projectId);
      title = p ? p.name : '项目';
      iconNode = p ? renderProjectBadge(p) : null;
      filterFn = (t) => t.projectId === projectId;
    } else {
      const sv = smartViews.find((x) => x.id === viewId);
      if (sv) {
        title = sv.name;
        iconNode = (
          <span
            className="side-item-icon-wrap"
            style={{ color: sv.color }}
            dangerouslySetInnerHTML={{ __html: sv.icon }}
          />
        );
        filterFn = sv.filter;
      } else {
        const csv = customSmartViews.find((x) => x.id === viewId);
        if (csv) {
          title = csv.name;
          iconNode = (
            <span
              className="side-item-icon-wrap"
              style={{ color: csv.color }}
              dangerouslySetInnerHTML={{ __html: ICONS.star }}
            />
          );
          if (csv.rule === 'prio') filterFn = (t) => !t.isCompleted && t.priority === 3;
          else if (csv.rule === 'upcoming')
            filterFn = (t) =>
              !t.isCompleted && t.dueDate != null && t.dueDate < nowMidnight + 3 * DAY_MS;
          else if (csv.rule === 'has_due') filterFn = (t) => !t.isCompleted && t.dueDate != null;
          else if (csv.rule === 'has_tag')
            filterFn = (t) => !t.isCompleted && t.tags && t.tags.length > 0;
          else if (csv.rule === 'focused')
            filterFn = (t) => !t.isCompleted && (taskFocusMap.get(t.id)?.totalMs || 0) > 0;
        }
      }
    }

    const uncompleted: Task[] = [];
    const completed: Task[] = [];

    const query = searchQuery.trim().toLowerCase();

    tasks.forEach((t) => {
      if (query) {
        const matchTitle = t.title.toLowerCase().includes(query);
        const matchTag = t.tags && t.tags.some((tag) => tag.toLowerCase().includes(query));
        const matchContent = t.content && t.content.toLowerCase().includes(query);
        if (!matchTitle && !matchTag && !matchContent) return;
      }
      if (filterFn(t)) {
        if (t.isCompleted) completed.push(t);
        else uncompleted.push(t);
      }
    });

    return {
      uncompletedTasks: uncompleted,
      completedTasks: completed,
      activeTitle: title,
      activeIcon: iconNode,
    };
  }, [
    projectId,
    viewId,
    projects,
    smartViews,
    customSmartViews,
    tasks,
    searchQuery,
    nowMidnight,
    taskFocusMap,
  ]);

  // Mutations
  const handleToggleTaskDone = async (task: Task, event?: React.MouseEvent) => {
    if (event) {
      event.stopPropagation();
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      if (!task.isCompleted) {
        fireConfettiSparks(cx, cy);
      }
    }
    const nextDone = !task.isCompleted;
    playCheckChime(nextDone, sound);

    // Optimistic UI update
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, isCompleted: nextDone } : t)));

    try {
      await window.focuslink.tasks.setCompleted(task, nextDone);
    } catch (e) {
      console.error('Failed to set completed', e);
      addToast('操作失败，已还原', 'error');
      void refresh();
    }
  };

  const handleCommitTaskTitle = async (taskId: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    setEditingTaskId(null);
    if (!trimmed) return;
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, title: trimmed } : t)));
    try {
      await window.focuslink.tasks.update(taskId, { title: trimmed });
    } catch (e) {
      console.error('Failed to update title', e);
    }
  };

  const handleQuickAdd = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const val = quickInput.trim();
      if (!val) return;
      setQuickInput('');
      playCheckChime(true, sound);
      try {
        const created = await window.focuslink.tasks.create(val, projectId ?? undefined, {
          dueDate: nowMidnight,
          priority: 0,
        });
        setTasks((prev) => [created, ...prev]);
        setSelectedTaskId(created.id);
      } catch (err) {
        console.error('Failed to create task', err);
      }
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    if (!confirm(`确认删除任务「${t.title}」？`)) return;
    setTasks((prev) => prev.filter((x) => x.id !== taskId));
    if (selectedTaskId === taskId) {
      setSelectedTaskId(tasks.length > 1 ? tasks.filter((x) => x.id !== taskId)[0].id : null);
    }
    try {
      await window.focuslink.tasks.remove(taskId);
      addToast('任务已删除', 'info');
    } catch (e) {
      console.error('Failed to remove task', e);
    }
  };

  const handleStartFocus = async (task: Task) => {
    if (!window.focuslink?.timer) return;
    playCheckChime(true, sound);
    try {
      const snap = await window.focuslink.timer.startWithTask(task.id, task.source, task.title);
      if (snap) setSnapshot(snap as any);
      addToast(`已开启「${task.title}」25 分钟专注`, 'success');
    } catch (e) {
      console.error('Failed to start focus', e);
    }
  };

  // Subtask mutations
  const handleToggleSubtask = async (subtask: Task, parentTask: Task) => {
    const nextDone = !subtask.isCompleted;
    playCheckChime(nextDone, sound);
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== parentTask.id) return t;
        const nextChildren = (t.children || []).map((c) =>
          c.id === subtask.id ? { ...c, isCompleted: nextDone } : c,
        );
        return { ...t, children: nextChildren };
      }),
    );
    try {
      await window.focuslink.tasks.setCompleted(subtask, nextDone);
    } catch (e) {
      console.error('Failed to toggle subtask', e);
    }
  };

  const handleAddSubtask = async (parentTask: Task) => {
    const val = newSubtaskTitle.trim();
    if (!val) return;
    setNewSubtaskTitle('');
    playCheckChime(true, sound);
    try {
      const created = await window.focuslink.tasks.create(val, parentTask.projectId ?? undefined, {
        parentId: parentTask.id,
      });
      setTasks((prev) =>
        prev.map((t) =>
          t.id === parentTask.id ? { ...t, children: [...(t.children || []), created] } : t,
        ),
      );
    } catch (e) {
      console.error('Failed to add subtask', e);
    }
  };

  const handleDeleteSubtask = async (subtaskId: string, parentTaskId: string) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== parentTaskId) return t;
        return { ...t, children: (t.children || []).filter((c) => c.id !== subtaskId) };
      }),
    );
    try {
      await window.focuslink.tasks.remove(subtaskId);
    } catch (e) {
      console.error('Failed to delete subtask', e);
    }
  };

  const handleCommitSubtaskTitle = async (
    subtaskId: string,
    parentTaskId: string,
    newTitle: string,
  ) => {
    const trimmed = newTitle.trim();
    setEditingSubtaskKey(null);
    if (!trimmed) return;
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== parentTaskId) return t;
        return {
          ...t,
          children: (t.children || []).map((c) =>
            c.id === subtaskId ? { ...c, title: trimmed } : c,
          ),
        };
      }),
    );
    try {
      await window.focuslink.tasks.update(subtaskId, { title: trimmed });
    } catch (e) {
      console.error('Failed to update subtask title', e);
    }
  };

  // Popover positioning helper
  const getPopoverStyle = (rect?: DOMRect, width = 240, height = 300): React.CSSProperties => {
    if (!rect) return { display: 'none' };
    let top = rect.bottom + 6;
    let left = rect.left;
    if (typeof window !== 'undefined') {
      if (top + height > window.innerHeight - 10) {
        top = Math.max(10, rect.top - height - 6);
      }
      if (left + width > window.innerWidth - 10) {
        left = window.innerWidth - width - 12;
      }
    }
    return {
      position: 'fixed',
      top: `${top}px`,
      left: `${left}px`,
      zIndex: 1200,
      display: 'flex',
    };
  };

  // Open Scheduler Board
  const openSchedulerForTask = (taskId: string, rect?: DOMRect) => {
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    const baseTime = t.dueDate || t.startDate || nowMidnight;
    const d = new Date(baseTime);

    let repeatVal: SchedulerDraft['draftRepeat'] = 'none';
    if (t.recurrence) {
      if (t.recurrence.frequency === 'daily' && t.recurrence.interval === 1) repeatVal = 'daily';
      else if (t.recurrence.frequency === 'weekly' && t.recurrence.byWeekday?.length === 5)
        repeatVal = 'workday';
      else if (t.recurrence.frequency === 'weekly') repeatVal = 'weekly';
      else if (t.recurrence.frequency === 'monthly') repeatVal = 'monthly';
      else if (t.recurrence.frequency === 'daily' && t.recurrence.interval === 3)
        repeatVal = 'custom_3';
    }

    setScheduler({
      mode: t.startDate && t.dueDate && t.startDate !== t.dueDate ? 'range' : 'single',
      viewYear: d.getFullYear(),
      viewMonth: d.getMonth(),
      draftSingleDate: t.dueDate || nowMidnight,
      draftStartDate: t.startDate || nowMidnight,
      draftEndDate: t.dueDate || nowMidnight + 2 * DAY_MS,
      draftSem: t.startDate && !t.dueDate ? 'scheduled' : 'due',
      draftRepeat: repeatVal,
    });
    setPopover({ type: 'date', taskId, rect });
  };

  // Save Scheduler Board
  const handleSaveScheduler = async () => {
    if (!popover.taskId) return;
    const taskId = popover.taskId;
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;

    let nextDueDate: number | null = null;
    let nextStartDate: number | null = null;

    if (scheduler.mode === 'single') {
      nextDueDate = scheduler.draftSingleDate;
      nextStartDate = scheduler.draftSem === 'scheduled' ? scheduler.draftSingleDate : null;
    } else {
      nextStartDate = scheduler.draftStartDate;
      nextDueDate = scheduler.draftEndDate || scheduler.draftStartDate;
    }

    let recurrenceDef: TaskRecurrenceDefinition | null = null;
    if (scheduler.draftRepeat !== 'none') {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
      if (scheduler.draftRepeat === 'daily') {
        recurrenceDef = {
          timezone: tz,
          frequency: 'daily',
          interval: 1,
          byWeekday: [],
          byMonthDay: [],
          endAt: null,
          count: null,
          rollover: 'from_schedule',
        };
      } else if (scheduler.draftRepeat === 'workday') {
        recurrenceDef = {
          timezone: tz,
          frequency: 'weekly',
          interval: 1,
          byWeekday: [1, 2, 3, 4, 5],
          byMonthDay: [],
          endAt: null,
          count: null,
          rollover: 'from_schedule',
        };
      } else if (scheduler.draftRepeat === 'weekly') {
        const day = new Date(nextDueDate || nowMidnight).getDay() || 7;
        recurrenceDef = {
          timezone: tz,
          frequency: 'weekly',
          interval: 1,
          byWeekday: [day],
          byMonthDay: [],
          endAt: null,
          count: null,
          rollover: 'from_schedule',
        };
      } else if (scheduler.draftRepeat === 'monthly') {
        const mDay = new Date(nextDueDate || nowMidnight).getDate();
        recurrenceDef = {
          timezone: tz,
          frequency: 'monthly',
          interval: 1,
          byWeekday: [],
          byMonthDay: [mDay],
          endAt: null,
          count: null,
          rollover: 'from_schedule',
        };
      } else if (scheduler.draftRepeat === 'custom_3') {
        recurrenceDef = {
          timezone: tz,
          frequency: 'daily',
          interval: 3,
          byWeekday: [],
          byMonthDay: [],
          endAt: null,
          count: null,
          rollover: 'from_schedule',
        };
      }
    }

    setTasks((prev) =>
      prev.map((item) =>
        item.id === taskId
          ? {
              ...item,
              dueDate: nextDueDate,
              startDate: nextStartDate,
              recurrence: recurrenceDef ? { ...recurrenceDef, completedCount: 0 } : null,
            }
          : item,
      ),
    );

    setPopover({ type: null });

    try {
      await window.focuslink.tasks.update(taskId, {
        dueDate: nextDueDate,
        startDate: nextStartDate,
      });
      addToast('日期与计划已更新', 'success');
    } catch (e) {
      console.error('Failed to update date', e);
    }
  };

  const handleClearScheduler = async () => {
    if (!popover.taskId) return;
    const taskId = popover.taskId;
    setTasks((prev) =>
      prev.map((item) =>
        item.id === taskId ? { ...item, dueDate: null, startDate: null, recurrence: null } : item,
      ),
    );
    setPopover({ type: null });
    try {
      await window.focuslink.tasks.update(taskId, { dueDate: null, startDate: null });
      addToast('日期已清除', 'info');
    } catch (e) {
      console.error('Failed to clear date', e);
    }
  };

  // Priority Selection
  const handleSelectPriority = async (prio: number) => {
    if (!popover.taskId) return;
    const taskId = popover.taskId;
    setTasks((prev) =>
      prev.map((item) => (item.id === taskId ? { ...item, priority: prio } : item)),
    );
    setPopover({ type: null });
    try {
      await window.focuslink.tasks.update(taskId, { priority: prio });
    } catch (e) {
      console.error('Failed to update priority', e);
    }
  };

  // Project Selection
  const moveTaskToProject = async (task: Task, projectId: string | null) => {
    setTasks((prev) => prev.map((item) => (item.id === task.id ? { ...item, projectId } : item)));
    await window.focuslink.tasks.moveTask(task.id, projectId);
  };

  const handleSelectProject = async (projId: string | null) => {
    if (currentTask) void moveTaskToProject(currentTask, projId);
    if (!popover.taskId) return;
    const taskId = popover.taskId;
    setTasks((prev) =>
      prev.map((item) => (item.id === taskId ? { ...item, projectId: projId } : item)),
    );
    setPopover({ type: null });
    try {
      await window.focuslink.tasks.moveTask(taskId, projId);
    } catch (e) {
      console.error('Failed to move task project', e);
    }
  };

  // Project Creation
  const handleCreateProject = async () => {
    const name = prompt('输入新建清单分类名称：', '新项目分类');
    if (!name || !name.trim()) return;
    const randomColor = COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];
    try {
      const created = await window.focuslink.tasks.createProject(
        name.trim(),
        randomColor,
        'folder',
      );
      setProjects((prev) => [...prev, created]);
      setProjectId(created.id);
      setViewId('all');
      addToast(`清单「${name.trim()}」已创建`, 'success');
    } catch (e) {
      console.error('Failed to create project', e);
    }
  };

  // Project Icon & Color Update
  const handleUpdateProjectIcon = async (projId: string, iconKey: string) => {
    setProjects((prev) => prev.map((p) => (p.id === projId ? { ...p, icon: iconKey } : p)));
    setPopover({ type: null });
    try {
      await window.focuslink.tasks.updateProject(projId, { icon: iconKey });
      addToast('清单图标已更新', 'success');
    } catch (e) {
      console.error('Failed to update project icon', e);
    }
  };

  const handleUpdateProjectColor = async (projId: string, colorHex: string) => {
    setProjects((prev) => prev.map((p) => (p.id === projId ? { ...p, color: colorHex } : p)));
    try {
      await window.focuslink.tasks.updateProject(projId, { color: colorHex });
    } catch (e) {
      console.error('Failed to update project color', e);
    }
  };

  // Custom Smart View Creation
  const handleCreateCustomSmartView = () => {
    const name = smartModalName.trim();
    if (!name) return;
    const newView: CustomSmartView = {
      id: `cv_${Date.now()}`,
      name,
      rule: smartModalRule,
      color: '#3B82F6',
    };
    const nextList = [...customSmartViews, newView];
    setCustomSmartViews(nextList);
    localStorage.setItem('focuslink_custom_smart_views', JSON.stringify(nextList));
    setSmartModalOpen(false);
    setSmartModalName('');
    setViewId(newView.id);
    setProjectId(null);
    addToast(`视图「${name}」已创建`, 'success');
  };

  // Priority mapping for UI
  const prioMap: Record<number, { text: string; icon: string; cls: string }> = {
    3: { text: '高优先级 (P1)', icon: '🔴', cls: 'p1' },
    2: { text: '中优先级 (P2)', icon: '🟠', cls: 'p2' },
    1: { text: '低优先级 (P3)', icon: '🔵', cls: 'p3' },
    0: { text: '无优先级', icon: '⚪', cls: 'p0' },
  };

  return (
    <div
      className={`task-workspace-root app-window ${themeMode === 'dark' ? 'dark' : ''}`}
      data-pal={palette}
      data-theme={themeMode}
    >
      {/* 标题栏 */}
      <header className="app-titlebar">
        <div className="titlebar-left">
          <div className="app-brand">
            <div className="app-brand-badge">F</div>
            <span>FocusLink</span>
          </div>
        </div>

        <div className="titlebar-center">
          <div className="cmd-search-box">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              placeholder="快速查找任务、清单或标签..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <span className="kbd-hint">Ctrl K</span>
          </div>
        </div>

        <div className="titlebar-right">
          <div
            className="sync-badge"
            style={{ cursor: 'pointer' }}
            onClick={() => refresh()}
            title="点击立即刷新同步"
          >
            <i style={{ backgroundColor: refreshing ? '#3B82F6' : '#10B981' }} />
            <span>{refreshing ? '正在同步...' : '本地同步就绪'}</span>
          </div>
        </div>
      </header>

      {/* 工作区三栏主体 */}
      <div className="workspace-body">
        {/* 1. 左侧栏 (Sidebar) */}
        <aside className="sidebar">
          <div className="nav-section">
            <div className="nav-section-title">
              <span>智能视图</span>
              <button
                className="btn-add-section"
                title="新建自定义智能视图"
                onClick={() => setSmartModalOpen(true)}
              >
                <span dangerouslySetInnerHTML={{ __html: ICONS.plus }} />
              </button>
            </div>
            <div className="nav-section">
              {smartViews.map((sv) => {
                const count =
                  sv.id === 'done'
                    ? tasks.filter((t) => t.isCompleted).length
                    : tasks.filter((t) => !t.isCompleted && (sv.id === 'all' || sv.filter(t)))
                        .length;
                const isActive = viewId === sv.id && !projectId;
                return (
                  <button
                    key={sv.id}
                    className="side-item"
                    aria-selected={isActive}
                    onClick={() => {
                      setViewId(sv.id);
                      setProjectId(null);
                    }}
                  >
                    <span
                      className="side-item-icon-wrap"
                      style={{ color: sv.color }}
                      dangerouslySetInnerHTML={{ __html: sv.icon }}
                    />
                    <span className="nav-name">{sv.name}</span>
                    <span className="nav-num">{count}</span>
                  </button>
                );
              })}

              {/* 自定义智能视图 */}
              {customSmartViews.map((csv) => {
                const count = tasks.filter((t) => {
                  if (t.isCompleted) return false;
                  if (csv.rule === 'prio') return t.priority === 3;
                  if (csv.rule === 'upcoming')
                    return t.dueDate != null && t.dueDate < nowMidnight + 3 * DAY_MS;
                  if (csv.rule === 'has_due') return t.dueDate != null;
                  if (csv.rule === 'has_tag') return t.tags && t.tags.length > 0;
                  if (csv.rule === 'focused') return (taskFocusMap.get(t.id)?.totalMs || 0) > 0;
                  return true;
                }).length;
                const isActive = viewId === csv.id && !projectId;
                return (
                  <button
                    key={csv.id}
                    className="side-item"
                    aria-selected={isActive}
                    onClick={() => {
                      setViewId(csv.id);
                      setProjectId(null);
                    }}
                  >
                    <span
                      className="side-item-icon-wrap"
                      style={{ color: csv.color }}
                      dangerouslySetInnerHTML={{ __html: ICONS.star }}
                    />
                    <span className="nav-name">{csv.name}</span>
                    <span className="nav-num">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="nav-section">
            <div className="nav-section-title">
              <span>清单分类</span>
              <button
                className="btn-add-section"
                title="新建项目清单"
                onClick={handleCreateProject}
              >
                <span dangerouslySetInnerHTML={{ __html: ICONS.plus }} />
              </button>
            </div>
            <div className="nav-section">
              {projects.map((p) => {
                const count = tasks.filter((t) => !t.isCompleted && t.projectId === p.id).length;
                const isActive = projectId === p.id;
                return (
                  <button
                    key={p.id}
                    className="side-item"
                    aria-selected={isActive}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const droppedTaskId = e.dataTransfer.getData('application/x-focuslink-task');
                      const droppedTask = tasks.find((t) => t.id === droppedTaskId);
                      if (droppedTask) void moveTaskToProject(droppedTask, p.id);
                    }}
                    onClick={() => {
                      setProjectId(p.id);
                      setViewId('');
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setProjContextMenu({
                        open: true,
                        projectId: p.id,
                        x: Math.min(e.clientX, window.innerWidth - 180),
                        y: Math.min(e.clientY, window.innerHeight - 150),
                      });
                    }}
                  >
                    {renderProjectBadge(p)}
                    <span className="nav-name">{p.name}</span>
                    <span className="nav-num">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="sidebar-footer">
            <div className="sidebar-user-pill">
              <div className="user-avatar-mini">FL</div>
              <span>FocusLink 任务空间</span>
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

        {/* 2. 中间：任务列表 (Task Paper) */}
        <main className="task-paper">
          <div className="list-toolbar">
            <div className="list-title-group">
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                {activeIcon}
                <h2 style={{ fontSize: '16px', fontWeight: 600 }}>{activeTitle}</h2>
              </div>
              <span className="list-stats-text">
                {viewId === 'done'
                  ? `共 ${completedTasks.length} 项已完成任务`
                  : `${uncompletedTasks.length} 待办 · ${completedTasks.length} 已完成`}
              </span>
            </div>
            <div className="list-toolbar-actions">
              <button className="btn-tool" onClick={() => refresh()}>
                <span dangerouslySetInnerHTML={{ __html: ICONS.clock }} />
                <span>刷新</span>
              </button>
            </div>
          </div>

          <div className="tasks-scroll-area">
            {/* 未完成任务区域 (黄金分割 1/2 沉底) */}
            <div className="uncompleted-group">
              {viewId === 'done' ? (
                completedTasks.length === 0 ? (
                  <div
                    style={{
                      padding: '40px 20px',
                      textAlign: 'center',
                      color: 'var(--text-tertiary)',
                      fontSize: '13px',
                    }}
                  >
                    暂无已完成任务
                  </div>
                ) : (
                  completedTasks.map((t) => renderTaskEntry(t))
                )
              ) : uncompletedTasks.length === 0 ? (
                <div
                  style={{
                    padding: '40px 20px',
                    textAlign: 'center',
                    color: 'var(--text-tertiary)',
                    fontSize: '13px',
                  }}
                >
                  已全部完成，尽情享受专注心流时光 ☕
                </div>
              ) : (
                uncompletedTasks.map((t) => renderTaskEntry(t))
              )}
            </div>

            {/* 已完成任务折叠区块 (仅在非 "已完成" 视图展示) */}
            {viewId !== 'done' && completedTasks.length > 0 && (
              <div className="completed-section-wrapper">
                <div
                  className={`completed-divider-bar ${completedCollapsed ? 'collapsed' : ''}`}
                  onClick={() => setCompletedCollapsed(!completedCollapsed)}
                >
                  <svg viewBox="0 0 12 12">
                    <path
                      d="M2.5 4.5L6 8L9.5 4.5"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                  <span>已完成 {completedTasks.length}</span>
                </div>
                {!completedCollapsed && (
                  <div className="completed-tasks-list">
                    {completedTasks.map((t) => renderTaskEntry(t))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 快速创建栏 */}
          <div className="quick-create-bar">
            <span dangerouslySetInnerHTML={{ __html: ICONS.plus }} />
            <input
              type="text"
              placeholder="输入任务名称，按 Enter 回车快速创建（右键可快速改卡）"
              value={quickInput}
              onChange={(e) => setQuickInput(e.target.value)}
              onKeyDown={handleQuickAdd}
            />
          </div>
        </main>

        {/* 3. 右侧：详情面板 (Detail Pane) */}
        <aside className="detail-pane">
          {!currentTask ? (
            <div
              style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-tertiary)' }}
            >
              未选择任何任务
            </div>
          ) : (
            <>
              <div className="detail-top-nav">
                <span className={`status-pill ${currentTask.isCompleted ? 'done' : ''}`}>
                  {currentTask.isCompleted ? '● 已完成' : '● 进行中'}
                </span>
                <button
                  className="btn-close-detail"
                  title="关闭详情"
                  onClick={() => setSelectedTaskId(null)}
                >
                  <span dangerouslySetInnerHTML={{ __html: ICONS.close }} />
                </button>
              </div>

              {/* 详情标题 */}
              <textarea
                className={`detail-heading ${currentTask.isCompleted ? 'is-done' : ''}`}
                rows={1}
                value={currentTask.title}
                onChange={(e) => {
                  const val = e.target.value;
                  setTasks((prev) =>
                    prev.map((t) => (t.id === currentTask.id ? { ...t, title: val } : t)),
                  );
                }}
                onBlur={(e) => {
                  void window.focuslink.tasks.update(currentTask.id, {
                    title: e.target.value.trim(),
                  });
                }}
              />

              {/* 属性规格面板 (彻底杜绝误触：仅点击右侧胶囊呼出弹窗) */}
              <div className="linear-props-table">
                {/* 1. 所属清单 */}
                <div className="prop-table-row">
                  <div className="prop-label">
                    <span dangerouslySetInnerHTML={{ __html: ICONS.folder }} /> 所属清单
                  </div>
                  <button
                    className="prop-action-pill"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPopover({
                        type: 'project',
                        taskId: currentTask.id,
                        rect: (e.currentTarget as HTMLElement).getBoundingClientRect(),
                      });
                    }}
                    title="点击选择所属清单"
                  >
                    {renderProjectBadge(projects.find((p) => p.id === currentTask.projectId))}
                    <span style={{ marginLeft: '5px' }}>
                      {projects.find((p) => p.id === currentTask.projectId)?.name || '收件箱'}
                    </span>
                    <svg className="chevron-down" viewBox="0 0 12 12">
                      <path
                        d="M2.5 4.5L6 8L9.5 4.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </div>

                {/* 2. 截止时间 */}
                <div className="prop-table-row">
                  <div className="prop-label">
                    <span dangerouslySetInnerHTML={{ __html: ICONS.upcoming }} /> 截止时间
                  </div>
                  <button
                    className={`prop-action-pill ${
                      formatDateMeta(currentTask)?.cls === 'is-late'
                        ? 'late'
                        : formatDateMeta(currentTask)?.cls === 'is-today'
                          ? 'today'
                          : formatDateMeta(currentTask)?.cls === 'is-range'
                            ? 'range'
                            : ''
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      openSchedulerForTask(
                        currentTask.id,
                        (e.currentTarget as HTMLElement).getBoundingClientRect(),
                      );
                    }}
                    title="点击打开小日历看板设置单日、时间段与重复"
                  >
                    <span>{formatDateMeta(currentTask)?.text || '安排日期...'}</span>
                    {currentTask.recurrence && <span title="周期刷新"> 🔁</span>}
                    <svg className="chevron-down" viewBox="0 0 12 12">
                      <path
                        d="M2.5 4.5L6 8L9.5 4.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </div>

                {/* 3. 优先级 */}
                <div className="prop-table-row">
                  <div className="prop-label">
                    <span dangerouslySetInnerHTML={{ __html: ICONS.flag }} /> 优 先 级
                  </div>
                  <button
                    className={`prop-action-pill ${prioMap[currentTask.priority || 0]?.cls || 'p0'}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPopover({
                        type: 'priority',
                        taskId: currentTask.id,
                        rect: (e.currentTarget as HTMLElement).getBoundingClientRect(),
                      });
                    }}
                    title="点击选择优先级"
                  >
                    <span>
                      {prioMap[currentTask.priority || 0]?.icon}{' '}
                      {prioMap[currentTask.priority || 0]?.text}
                    </span>
                    <svg className="chevron-down" viewBox="0 0 12 12">
                      <path
                        d="M2.5 4.5L6 8L9.5 4.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </div>

                {/* 4. 标签 */}
                <div className="prop-table-row">
                  <div className="prop-label">
                    <span dangerouslySetInnerHTML={{ __html: ICONS.tag }} /> 标 签
                  </div>
                  <div className="prop-tags-cell">
                    {currentTask.tags &&
                      currentTask.tags.map((tag) => (
                        <span key={tag} className="prop-tag-chip">
                          #{tag}
                        </span>
                      ))}
                    <button
                      className="prop-add-tag-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPopover({
                          type: 'tag',
                          taskId: currentTask.id,
                          rect: (e.currentTarget as HTMLElement).getBoundingClientRect(),
                        });
                      }}
                      title="管理标签"
                    >
                      + 标签
                    </button>
                  </div>
                </div>
              </div>

              {/* 子任务清单 */}
              <div className="subtasks-block">
                <div className="subtasks-header-row">
                  <span>子任务清单</span>
                  {(currentTask.children || []).length > 0 ? (
                    <span style={{ color: 'var(--text-secondary)', fontSize: '11.5px' }}>
                      {(currentTask.children || []).filter((c) => c.isCompleted).length} /{' '}
                      {(currentTask.children || []).length} 已完成
                    </span>
                  ) : (
                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                      未拆分子项
                    </span>
                  )}
                </div>

                {(currentTask.children || []).length > 0 && (
                  <div className="sub-progress-bar">
                    <div
                      className="sub-progress-fill"
                      style={{
                        width: `${Math.round(
                          ((currentTask.children || []).filter((c) => c.isCompleted).length /
                            (currentTask.children || []).length) *
                            100,
                        )}%`,
                      }}
                    />
                  </div>
                )}

                <div className="subtask-items-flow">
                  {(currentTask.children || []).map((sub) => {
                    const isEditing = editingSubtaskKey === sub.id;
                    return (
                      <div key={sub.id} className="subtask-item">
                        <button
                          className="subtask-check"
                          role="checkbox"
                          aria-checked={sub.isCompleted}
                          onClick={() => handleToggleSubtask(sub, currentTask)}
                        >
                          <span dangerouslySetInnerHTML={{ __html: ICONS.checkMark }} />
                        </button>

                        {isEditing ? (
                          <input
                            type="text"
                            className="inline-sub-edit"
                            autoFocus
                            value={editingSubtaskVal}
                            onChange={(e) => setEditingSubtaskVal(e.target.value)}
                            onBlur={() =>
                              handleCommitSubtaskTitle(sub.id, currentTask.id, editingSubtaskVal)
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter')
                                handleCommitSubtaskTitle(sub.id, currentTask.id, editingSubtaskVal);
                              else if (e.key === 'Escape') setEditingSubtaskKey(null);
                            }}
                          />
                        ) : (
                          <span
                            className={`subtask-text ${sub.isCompleted ? 'is-done' : ''}`}
                            onClick={() => {
                              setEditingSubtaskKey(sub.id);
                              setEditingSubtaskVal(sub.title);
                            }}
                            title="单击直接就地修改"
                          >
                            {sub.title}
                          </span>
                        )}

                        <button
                          className="btn-del-subtask"
                          title="删除子任务"
                          onClick={() => handleDeleteSubtask(sub.id, currentTask.id)}
                        >
                          <span dangerouslySetInnerHTML={{ __html: ICONS.trash }} />
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div className="subtask-fast-add-row">
                  <span dangerouslySetInnerHTML={{ __html: ICONS.plus }} />
                  <input
                    type="text"
                    className="subtask-fast-input"
                    placeholder="添加子任务，按 Enter 连续创建..."
                    value={newSubtaskTitle}
                    onChange={(e) => setNewSubtaskTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleAddSubtask(currentTask);
                    }}
                  />
                </div>
              </div>

              {/* 横向专注时序看板 (用户硬性要求：改为横向图) */}
              <div className="focus-horizontal-card">
                <div className="f-card-header">
                  <div className="f-card-label">
                    <span dangerouslySetInnerHTML={{ __html: ICONS.clock }} />
                    <span>累计专注时间</span>
                  </div>
                  <div className="f-card-metric">
                    <span className="f-total-time">
                      {formatDuration(taskFocusMap.get(currentTask.id)?.totalMs) || '0m'}
                    </span>
                    <span className="f-session-tag">
                      {(taskFocusMap.get(currentTask.id)?.sessions.length || 0) > 0
                        ? `${taskFocusMap.get(currentTask.id)?.sessions.length} 次专注 · 均 ${Math.round(
                            (taskFocusMap.get(currentTask.id)?.totalMs || 0) /
                              60000 /
                              (taskFocusMap.get(currentTask.id)?.sessions.length || 1),
                          )}m`
                        : '暂无记录'}
                    </span>
                  </div>
                </div>

                {(taskFocusMap.get(currentTask.id)?.sessions.length || 0) > 0 ? (
                  <>
                    <div className="f-horiz-track" title="横向专注分段历程">
                      {taskFocusMap.get(currentTask.id)?.sessions.map((m, idx, arr) => (
                        <div
                          key={idx}
                          className={`f-segment ${idx === arr.length - 1 ? 'latest' : ''}`}
                          style={{ flex: m }}
                          title={`第 ${idx + 1} 次专注: ${m} 分钟`}
                        >
                          <span className="f-seg-label">{m}m</span>
                        </div>
                      ))}
                    </div>

                    <div className="f-nodes-flow">
                      {taskFocusMap.get(currentTask.id)?.sessions.map((m, idx, arr) => (
                        <React.Fragment key={idx}>
                          <div className={`f-node-chip ${idx === arr.length - 1 ? 'latest' : ''}`}>
                            <span className="f-node-idx">#{idx + 1}</span>
                            <span className="f-node-time">{m}m</span>
                          </div>
                          {idx < arr.length - 1 && <span className="f-node-arrow">→</span>}
                        </React.Fragment>
                      ))}
                    </div>
                  </>
                ) : (
                  <div
                    className="f-horiz-track empty"
                    style={{
                      justifyContent: 'center',
                      alignItems: 'center',
                      background: 'var(--bg-hover)',
                    }}
                  >
                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                      点击下方「开始专注」开启本任务首个 25m 番茄钟
                    </span>
                  </div>
                )}
              </div>

              {/* 任务描述/备忘 */}
              <div style={{ padding: '0 16px', marginTop: '12px' }}>
                <textarea
                  style={{
                    width: '100%',
                    minHeight: '70px',
                    padding: '8px 10px',
                    borderRadius: 'var(--r-sm)',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '12.5px',
                    color: 'var(--text-primary)',
                    resize: 'vertical',
                  }}
                  placeholder="添加任务备忘、链接或关键记录..."
                  value={currentTask.content || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setTasks((prev) =>
                      prev.map((t) => (t.id === currentTask.id ? { ...t, content: val } : t)),
                    );
                  }}
                  onBlur={(e) => {
                    void window.focuslink.tasks.update(currentTask.id, { content: e.target.value });
                  }}
                />
              </div>

              {/* 详情底部操作 Dock */}
              <div className="detail-dock-bar">
                <button className="btn-action-focus" onClick={() => handleStartFocus(currentTask)}>
                  <span dangerouslySetInnerHTML={{ __html: ICONS.play }} /> 开始专注 (25m)
                </button>
                <button
                  className="btn-action-done"
                  onClick={(e) => handleToggleTaskDone(currentTask, e)}
                >
                  <span dangerouslySetInnerHTML={{ __html: ICONS.checkCircle }} />{' '}
                  {currentTask.isCompleted ? '重新开启' : '完成任务'}
                </button>
                <button
                  className="btn-action-del"
                  title="删除任务"
                  onClick={() => handleDeleteTask(currentTask.id)}
                >
                  <span dangerouslySetInnerHTML={{ __html: ICONS.trash }} />
                </button>
              </div>
            </>
          )}
        </aside>
      </div>

      {/* ═════════════════════════════════════════════════════════════════════
         弹层系统 (Popovers)
         ═════════════════════════════════════════════════════════════════════ */}

      {/* 1. 优先级面板 */}
      {popover.type === 'priority' && (
        <div
          className="popover-menu active"
          style={getPopoverStyle(popover.rect, 190, 160)}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="popover-item" onClick={() => handleSelectPriority(3)}>
            <span style={{ color: '#EF4444' }}>🔴</span> <span>高优先级 (P1)</span>
          </div>
          <div className="popover-item" onClick={() => handleSelectPriority(2)}>
            <span style={{ color: '#F59E0B' }}>🟠</span> <span>中优先级 (P2)</span>
          </div>
          <div className="popover-item" onClick={() => handleSelectPriority(1)}>
            <span style={{ color: '#3B82F6' }}>🔵</span> <span>低优先级 (P3)</span>
          </div>
          <div className="popover-item" onClick={() => handleSelectPriority(0)}>
            <span style={{ color: '#71717A' }}>⚪</span> <span>无优先级</span>
          </div>
        </div>
      )}

      {/* 2. 所属清单面板 */}
      {popover.type === 'project' && (
        <div
          className="popover-menu active"
          style={getPopoverStyle(popover.rect, 210, 220)}
          onClick={(e) => e.stopPropagation()}
        >
          {projects.map((p) => {
            const isCur = currentTask?.projectId === p.id;
            return (
              <div
                key={p.id}
                className={`popover-item ${isCur ? 'selected' : ''}`}
                onClick={() => handleSelectProject(p.id)}
              >
                {renderProjectBadge(p)}
                <span style={{ flex: 1, marginLeft: '6px' }}>{p.name}</span>
                {isCur && <span style={{ color: 'var(--accent)', fontSize: '12px' }}>✓</span>}
              </div>
            );
          })}
          <div style={{ height: '1px', background: 'var(--border-subtle)', margin: '4px 0' }} />
          <div
            className="popover-item"
            style={{ color: 'var(--accent)' }}
            onClick={() => {
              setPopover({ type: null });
              void handleCreateProject();
            }}
          >
            <span dangerouslySetInnerHTML={{ __html: ICONS.plus }} />
            <span>新建项目清单...</span>
          </div>
        </div>
      )}

      {/* 3. 标签面板 */}
      {popover.type === 'tag' && currentTask && (
        <div
          className="tag-popover active"
          style={getPopoverStyle(popover.rect, 230, 210)}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="tag-active-chips">
            {(currentTask.tags || []).length > 0 ? (
              currentTask.tags.map((t, idx) => (
                <span key={t} className="prop-tag-chip">
                  #{t}
                  <button
                    style={{ marginLeft: '4px', color: 'var(--text-tertiary)' }}
                    onClick={async () => {
                      const next = (currentTask.tags || []).filter((_, i) => i !== idx);
                      setTasks((prev) =>
                        prev.map((item) =>
                          item.id === currentTask.id ? { ...item, tags: next } : item,
                        ),
                      );
                      await window.focuslink.tasks.update(currentTask.id, { tags: next });
                    }}
                  >
                    &times;
                  </button>
                </span>
              ))
            ) : (
              <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                暂未添加任何标签
              </span>
            )}
          </div>

          <div className="tag-input-row">
            <input
              type="text"
              placeholder="输入新标签名，回车添加..."
              onKeyDown={async (e) => {
                if (e.key === 'Enter') {
                  const val = (e.currentTarget.value || '').trim().replace(/^#/, '');
                  if (val) {
                    const next = [...(currentTask.tags || [])];
                    if (!next.includes(val)) next.push(val);
                    setTasks((prev) =>
                      prev.map((item) =>
                        item.id === currentTask.id ? { ...item, tags: next } : item,
                      ),
                    );
                    e.currentTarget.value = '';
                    await window.focuslink.tasks.update(currentTask.id, { tags: next });
                  }
                }
              }}
            />
          </div>

          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>推荐标签：</div>
          <div className="tag-suggestions-list">
            {['重要', '复盘', '紧急', '灵感', '工作', '学习', '健康'].map((tag) => (
              <span
                key={tag}
                className="tag-sug-item"
                onClick={async () => {
                  const next = [...(currentTask.tags || [])];
                  if (!next.includes(tag)) next.push(tag);
                  setTasks((prev) =>
                    prev.map((item) =>
                      item.id === currentTask.id ? { ...item, tags: next } : item,
                    ),
                  );
                  await window.focuslink.tasks.update(currentTask.id, { tags: next });
                }}
              >
                #{tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 4. 全能小日历日程看板 (Scheduler Board) */}
      {popover.type === 'date' && (
        <div
          className="date-popover active"
          style={getPopoverStyle(popover.rect, 330, 420)}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 单日 vs 时间段 切换 */}
          <div className="date-mode-tabs">
            <button
              className={`tab-btn ${scheduler.mode === 'single' ? 'active' : ''}`}
              onClick={() => setScheduler((s) => ({ ...s, mode: 'single' }))}
            >
              📅 单个日期
            </button>
            <button
              className={`tab-btn ${scheduler.mode === 'range' ? 'active' : ''}`}
              onClick={() =>
                setScheduler((s) => ({
                  ...s,
                  mode: 'range',
                  draftStartDate: s.draftStartDate || s.draftSingleDate || nowMidnight,
                  draftEndDate:
                    s.draftEndDate ||
                    (s.draftStartDate || s.draftSingleDate || nowMidnight) + 2 * DAY_MS,
                }))
              }
            >
              ↔️ 起止时间段
            </button>
          </div>

          {/* 快捷方式 */}
          <div className="date-shortcuts-row">
            {scheduler.mode === 'single' ? (
              <>
                <button
                  className="shortcut-chip"
                  onClick={() => {
                    const d = new Date(nowMidnight);
                    setScheduler((s) => ({
                      ...s,
                      draftSingleDate: nowMidnight,
                      viewYear: d.getFullYear(),
                      viewMonth: d.getMonth(),
                    }));
                  }}
                >
                  今天
                </button>
                <button
                  className="shortcut-chip"
                  onClick={() => {
                    const t = nowMidnight + DAY_MS;
                    const d = new Date(t);
                    setScheduler((s) => ({
                      ...s,
                      draftSingleDate: t,
                      viewYear: d.getFullYear(),
                      viewMonth: d.getMonth(),
                    }));
                  }}
                >
                  明天
                </button>
                <button
                  className="shortcut-chip"
                  onClick={() => {
                    const d = new Date(nowMidnight);
                    const day = d.getDay();
                    const diff = day === 0 ? 0 : 6 - day;
                    const t = nowMidnight + diff * DAY_MS;
                    setScheduler((s) => ({
                      ...s,
                      draftSingleDate: t,
                      viewYear: new Date(t).getFullYear(),
                      viewMonth: new Date(t).getMonth(),
                    }));
                  }}
                >
                  本周末
                </button>
                <button
                  className="shortcut-chip"
                  onClick={() => {
                    const d = new Date(nowMidnight);
                    const day = d.getDay();
                    const diff = day === 0 ? 1 : 8 - day;
                    const t = nowMidnight + diff * DAY_MS;
                    setScheduler((s) => ({
                      ...s,
                      draftSingleDate: t,
                      viewYear: new Date(t).getFullYear(),
                      viewMonth: new Date(t).getMonth(),
                    }));
                  }}
                >
                  下周一
                </button>
              </>
            ) : (
              <>
                <button
                  className="shortcut-chip"
                  onClick={() =>
                    setScheduler((s) => ({
                      ...s,
                      draftStartDate: nowMidnight,
                      draftEndDate: nowMidnight + 2 * DAY_MS,
                    }))
                  }
                >
                  未来 3 天
                </button>
                <button
                  className="shortcut-chip"
                  onClick={() =>
                    setScheduler((s) => ({
                      ...s,
                      draftStartDate: nowMidnight,
                      draftEndDate: nowMidnight + 6 * DAY_MS,
                    }))
                  }
                >
                  未来 7 天
                </button>
                <button
                  className="shortcut-chip"
                  onClick={() => {
                    const d = new Date(nowMidnight);
                    const day = d.getDay();
                    const diff = day === 0 ? 0 : 6 - day;
                    setScheduler((s) => ({
                      ...s,
                      draftStartDate: nowMidnight,
                      draftEndDate: nowMidnight + diff * DAY_MS,
                    }));
                  }}
                >
                  本周剩余
                </button>
                <button
                  className="shortcut-chip"
                  onClick={() => {
                    const end = new Date(scheduler.viewYear, scheduler.viewMonth + 1, 0).getTime();
                    setScheduler((s) => ({ ...s, draftStartDate: nowMidnight, draftEndDate: end }));
                  }}
                >
                  本月剩余
                </button>
              </>
            )}
          </div>

          {/* 月份导航与日历网格 */}
          <div className="calendar-widget">
            <div className="cal-month-nav">
              <span className="cal-month-title">
                {scheduler.viewYear}年{scheduler.viewMonth + 1}月
              </span>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  className="cal-nav-btn"
                  onClick={() =>
                    setScheduler((s) => {
                      let m = s.viewMonth - 1;
                      let y = s.viewYear;
                      if (m < 0) {
                        m = 11;
                        y--;
                      }
                      return { ...s, viewMonth: m, viewYear: y };
                    })
                  }
                >
                  <svg viewBox="0 0 12 12">
                    <path d="M7.5 2.5L4 6L7.5 9.5" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                </button>
                <button
                  className="cal-nav-btn"
                  onClick={() =>
                    setScheduler((s) => {
                      let m = s.viewMonth + 1;
                      let y = s.viewYear;
                      if (m > 11) {
                        m = 0;
                        y++;
                      }
                      return { ...s, viewMonth: m, viewYear: y };
                    })
                  }
                >
                  <svg viewBox="0 0 12 12">
                    <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="cal-weekdays">
              <span>日</span>
              <span>一</span>
              <span>二</span>
              <span>三</span>
              <span>四</span>
              <span>五</span>
              <span>六</span>
            </div>

            {/* 日历单元格 */}
            <div className="cal-days-grid">
              {(() => {
                const firstDay = new Date(scheduler.viewYear, scheduler.viewMonth, 1).getDay();
                const daysInMonth = new Date(
                  scheduler.viewYear,
                  scheduler.viewMonth + 1,
                  0,
                ).getDate();
                const prevMonthDays = new Date(
                  scheduler.viewYear,
                  scheduler.viewMonth,
                  0,
                ).getDate();
                const cells = [];

                // 上月占位
                for (let i = firstDay - 1; i >= 0; i--) {
                  cells.push(
                    <span key={`prev_${i}`} className="cal-day other-month">
                      {prevMonthDays - i}
                    </span>,
                  );
                }

                // 本月天数
                for (let day = 1; day <= daysInMonth; day++) {
                  const curTime = new Date(scheduler.viewYear, scheduler.viewMonth, day).getTime();
                  const isToday = curTime === nowMidnight;
                  const isSingleSelected =
                    scheduler.mode === 'single' && scheduler.draftSingleDate === curTime;
                  const isRangeStart =
                    scheduler.mode === 'range' && scheduler.draftStartDate === curTime;
                  const isRangeEnd =
                    scheduler.mode === 'range' && scheduler.draftEndDate === curTime;
                  const isInRange =
                    scheduler.mode === 'range' &&
                    scheduler.draftStartDate &&
                    scheduler.draftEndDate &&
                    curTime > scheduler.draftStartDate &&
                    curTime < scheduler.draftEndDate;

                  const cls = ['cal-day'];
                  if (isToday) cls.push('today');
                  if (isSingleSelected) cls.push('selected');
                  if (isRangeStart) cls.push('range-start');
                  if (isRangeEnd) cls.push('range-end');
                  if (isInRange) cls.push('in-range');

                  cells.push(
                    <span
                      key={day}
                      className={cls.join(' ')}
                      onClick={() => {
                        if (scheduler.mode === 'single') {
                          setScheduler((s) => ({ ...s, draftSingleDate: curTime }));
                        } else {
                          setScheduler((s) => {
                            if (!s.draftStartDate || (s.draftStartDate && s.draftEndDate)) {
                              return { ...s, draftStartDate: curTime, draftEndDate: null };
                            } else {
                              if (curTime >= s.draftStartDate) {
                                return { ...s, draftEndDate: curTime };
                              } else {
                                return {
                                  ...s,
                                  draftStartDate: curTime,
                                  draftEndDate: s.draftStartDate,
                                };
                              }
                            }
                          });
                        }
                      }}
                    >
                      {day}
                    </span>,
                  );
                }

                // 下月占位
                const totalCells = firstDay + daysInMonth;
                const trailing = (7 - (totalCells % 7)) % 7;
                for (let j = 1; j <= trailing; j++) {
                  cells.push(
                    <span key={`next_${j}`} className="cal-day other-month">
                      {j}
                    </span>,
                  );
                }
                return cells;
              })()}
            </div>
          </div>

          {/* 语义选项 (单日模式) */}
          {scheduler.mode === 'single' && (
            <div className="cal-semantics-row">
              <span className="cal-sem-label">语义选项</span>
              <div className="cal-sem-pills">
                <button
                  className={`sem-btn ${scheduler.draftSem === 'due' ? 'active' : ''}`}
                  onClick={() => setScheduler((s) => ({ ...s, draftSem: 'due' }))}
                >
                  截止到该日
                </button>
                <button
                  className={`sem-btn ${scheduler.draftSem === 'scheduled' ? 'active' : ''}`}
                  onClick={() => setScheduler((s) => ({ ...s, draftSem: 'scheduled' }))}
                >
                  安排在该日
                </button>
              </div>
            </div>
          )}

          {/* 时间段摘要 (起止模式) */}
          {scheduler.mode === 'range' && (
            <div className="cal-range-summary-box">
              {scheduler.draftStartDate && scheduler.draftEndDate ? (
                <>
                  已选区间：
                  <strong>
                    {new Date(scheduler.draftStartDate).getMonth() + 1}月
                    {new Date(scheduler.draftStartDate).getDate()}日
                  </strong>{' '}
                  至{' '}
                  <strong>
                    {new Date(scheduler.draftEndDate).getMonth() + 1}月
                    {new Date(scheduler.draftEndDate).getDate()}日
                  </strong>{' '}
                  (
                  <span>
                    {Math.max(
                      1,
                      Math.round((scheduler.draftEndDate - scheduler.draftStartDate) / DAY_MS) + 1,
                    )}
                  </span>{' '}
                  天)
                </>
              ) : scheduler.draftStartDate ? (
                <>
                  已选开始：
                  <strong>
                    {new Date(scheduler.draftStartDate).getMonth() + 1}月
                    {new Date(scheduler.draftStartDate).getDate()}日
                  </strong>{' '}
                  (点击结束日)
                </>
              ) : (
                '点击日历选择起止日期'
              )}
            </div>
          )}

          {/* 重复与周期刷新 */}
          <div className="cal-repeat-row">
            <div className="cal-repeat-header">
              <span>重复与周期刷新</span>
              <span style={{ fontSize: '11px' }}>
                {
                  {
                    none: '不重复',
                    daily: '每天刷新',
                    workday: '工作日刷新',
                    weekly: '每周刷新',
                    monthly: '每月刷新',
                    custom_3: '每 3 天刷新',
                  }[scheduler.draftRepeat]
                }
              </span>
            </div>
            <select
              className="cal-repeat-select"
              value={scheduler.draftRepeat}
              onChange={(e) =>
                setScheduler((s) => ({
                  ...s,
                  draftRepeat: e.target.value as SchedulerDraft['draftRepeat'],
                }))
              }
            >
              <option value="none">不重复</option>
              <option value="daily">每天刷新 (每日重新提醒)</option>
              <option value="workday">工作日刷新 (周一至周五循环)</option>
              <option value="weekly">每周刷新 (每周同日提醒)</option>
              <option value="monthly">每月刷新 (每月同日提醒)</option>
              <option value="custom_3">每 3 天刷新一次</option>
            </select>
          </div>

          {/* 底部保存与清除 */}
          <div className="cal-actions-footer">
            <button className="btn-cal-clear" onClick={handleClearScheduler}>
              清除日期
            </button>
            <button className="btn-cal-cancel" onClick={() => setPopover({ type: null })}>
              取消
            </button>
            <button className="btn-cal-save" onClick={handleSaveScheduler}>
              确定并保存
            </button>
          </div>
        </div>
      )}

      {/* 5. 任务行右键菜单 */}
      {taskContextMenu.open && taskContextMenu.taskId && (
        <div
          className="ctx-menu active"
          style={{ top: `${taskContextMenu.y}px`, left: `${taskContextMenu.x}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="ctx-menu-item"
            onClick={() => {
              const t = tasks.find((x) => x.id === taskContextMenu.taskId);
              setTaskContextMenu({ open: false, taskId: null, x: 0, y: 0 });
              if (t) void handleStartFocus(t);
            }}
          >
            <div className="item-left">
              <span dangerouslySetInnerHTML={{ __html: ICONS.play }} />
              <span>开始专注</span>
            </div>
            <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>25m</span>
          </div>

          <div
            className="ctx-menu-item"
            onClick={() => {
              const t = tasks.find((x) => x.id === taskContextMenu.taskId);
              setTaskContextMenu({ open: false, taskId: null, x: 0, y: 0 });
              if (t) void handleToggleTaskDone(t);
            }}
          >
            <div className="item-left">
              <span dangerouslySetInnerHTML={{ __html: ICONS.checkCircle }} />
              <span>
                {tasks.find((x) => x.id === taskContextMenu.taskId)?.isCompleted
                  ? '恢复为未完成'
                  : '标记为已完成'}
              </span>
            </div>
          </div>

          <div
            className="ctx-menu-item"
            onClick={() => {
              const id = taskContextMenu.taskId;
              setTaskContextMenu({ open: false, taskId: null, x: 0, y: 0 });
              if (id) {
                const t = tasks.find((x) => x.id === id);
                if (t) {
                  setEditingTaskId(id);
                  setEditingTitleVal(t.title);
                }
              }
            }}
          >
            <div className="item-left">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              <span>重命名任务</span>
            </div>
          </div>

          <div className="ctx-menu-divider" />

          <div
            className="ctx-menu-item"
            onClick={() => {
              const id = taskContextMenu.taskId;
              setTaskContextMenu({ open: false, taskId: null, x: 0, y: 0 });
              if (id) {
                const row = document.querySelector(`[data-task-id="${id}"]`);
                if (row) openSchedulerForTask(id, row.getBoundingClientRect());
              }
            }}
          >
            <div className="item-left">
              <span dangerouslySetInnerHTML={{ __html: ICONS.upcoming }} />
              <span>设置日期与看板</span>
            </div>
          </div>

          <div
            className="ctx-menu-item"
            onClick={() => {
              const id = taskContextMenu.taskId;
              setTaskContextMenu({ open: false, taskId: null, x: 0, y: 0 });
              if (id) {
                const row = document.querySelector(`[data-task-id="${id}"]`);
                if (row) {
                  setPopover({
                    type: 'priority',
                    taskId: id,
                    rect: row.getBoundingClientRect(),
                  });
                }
              }
            }}
          >
            <div className="item-left">
              <span dangerouslySetInnerHTML={{ __html: ICONS.flag }} />
              <span>设置优先级</span>
            </div>
          </div>

          <div className="ctx-menu-divider" />

          <div
            className="ctx-menu-item danger"
            onClick={() => {
              const id = taskContextMenu.taskId;
              setTaskContextMenu({ open: false, taskId: null, x: 0, y: 0 });
              if (id) void handleDeleteTask(id);
            }}
          >
            <div className="item-left">
              <span dangerouslySetInnerHTML={{ __html: ICONS.trash }} />
              <span>删除此任务</span>
            </div>
          </div>
        </div>
      )}

      {/* 6. 清单分类右键菜单 */}
      {projContextMenu.open && projContextMenu.projectId && (
        <div
          className="ctx-menu active"
          style={{ top: `${projContextMenu.y}px`, left: `${projContextMenu.x}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="ctx-menu-item"
            onClick={() => {
              const pId = projContextMenu.projectId;
              setProjContextMenu({ open: false, projectId: null, x: 0, y: 0 });
              if (pId) {
                const projEl = document.querySelector(`[data-proj-id="${pId}"]`) || document.body;
                setPopover({
                  type: 'iconPicker',
                  projectId: pId,
                  rect: (projEl as HTMLElement).getBoundingClientRect(),
                });
              }
            }}
          >
            <div className="item-left">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="m4.93 4.93 4.24 4.24" />
              </svg>
              <span>更换图标与颜色</span>
            </div>
          </div>

          <div
            className="ctx-menu-item"
            onClick={() => {
              const pId = projContextMenu.projectId;
              if (!pId) return;
              const p = projects.find((x) => x.id === pId);
              setProjContextMenu({ open: false, projectId: null, x: 0, y: 0 });
              if (p) {
                const newName = prompt('输入新的清单名称：', p.name);
                if (newName && newName.trim()) {
                  setProjects((prev) =>
                    prev.map((item) =>
                      item.id === pId ? { ...item, name: newName.trim() } : item,
                    ),
                  );
                  void window.focuslink.tasks.updateProject(pId, { name: newName.trim() });
                }
              }
            }}
          >
            <div className="item-left">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              <span>重命名清单</span>
            </div>
          </div>

          <div className="ctx-menu-divider" />

          <div
            className="ctx-menu-item danger"
            onClick={() => {
              const pId = projContextMenu.projectId;
              if (!pId) return;
              const p = projects.find((x) => x.id === pId);
              setProjContextMenu({ open: false, projectId: null, x: 0, y: 0 });
              if (p && confirm(`确认删除清单「${p.name}」？关联任务将移至收件箱。`)) {
                setProjects((prev) => prev.filter((item) => item.id !== pId));
                if (projectId === pId) setProjectId(null);
                const project = p;
                void window.focuslink.tasks.deleteProject(project.id);
              }
            }}
          >
            <div className="item-left">
              <span dangerouslySetInnerHTML={{ __html: ICONS.trash }} />
              <span>删除清单</span>
            </div>
          </div>
        </div>
      )}

      {/* 7. 清单图标选择弹层 (支持精选矢量、Emoji矩阵、自定义输入与自由取色) */}
      {popover.type === 'iconPicker' && popover.projectId && (
        <div
          className="iconpop active"
          style={getPopoverStyle(popover.rect, 300, 480)}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="pop-title">精选矢量图标</div>
          <div className="grid-icons">
            {ICON_PICK_LIST.map((k) => {
              const isAct = projects.find((p) => p.id === popover.projectId)?.icon === k;
              return (
                <button
                  key={k}
                  className={`grid-icon-btn ${isAct ? 'active' : ''}`}
                  title={k}
                  onClick={() => handleUpdateProjectIcon(popover.projectId!, k)}
                  dangerouslySetInnerHTML={{ __html: ICONS[k] }}
                />
              );
            })}
            <button
              className={`grid-icon-btn ${projects.find((p) => p.id === popover.projectId)?.icon === 'dot' ? 'active' : ''}`}
              title="极简色点"
              onClick={() => handleUpdateProjectIcon(popover.projectId!, 'dot')}
            >
              <span
                className="project-color-dot"
                style={{
                  backgroundColor:
                    projects.find((p) => p.id === popover.projectId)?.color || 'currentColor',
                }}
              />
            </button>
          </div>

          <div className="pop-title" style={{ marginTop: '10px' }}>
            常用 Emoji 矩阵
          </div>
          <div className="grid-emojis">
            {EMOJI_PICK_LIST.map((em) => (
              <button
                key={em}
                className="grid-emoji-btn"
                onClick={() => handleUpdateProjectIcon(popover.projectId!, em)}
              >
                {em}
              </button>
            ))}
          </div>

          <div className="pop-title" style={{ marginTop: '10px' }}>
            自定义 Emoji / 字符
          </div>
          <div className="custom-icon-row">
            <input
              type="text"
              placeholder="输入任意 Emoji (如 🚀) 或字符..."
              maxLength={4}
              value={customIconInput}
              onChange={(e) => setCustomIconInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customIconInput.trim()) {
                  void handleUpdateProjectIcon(popover.projectId!, customIconInput.trim());
                  setCustomIconInput('');
                }
              }}
            />
            <button
              className="btn-apply-custom-icon"
              onClick={() => {
                if (customIconInput.trim()) {
                  void handleUpdateProjectIcon(popover.projectId!, customIconInput.trim());
                  setCustomIconInput('');
                }
              }}
            >
              设定图标
            </button>
          </div>

          <div
            className="pop-title"
            style={{
              marginTop: '10px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>清单专属色调</span>
            <label
              style={{
                fontSize: '11px',
                color: 'var(--text-tertiary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
              }}
            >
              自定义取色:{' '}
              <input
                type="color"
                value={nativeColorInput}
                onChange={(e) => {
                  setNativeColorInput(e.target.value);
                  void handleUpdateProjectColor(popover.projectId!, e.target.value);
                }}
                style={{
                  width: '20px',
                  height: '18px',
                  border: 'none',
                  cursor: 'pointer',
                  background: 'none',
                  padding: 0,
                  verticalAlign: 'middle',
                }}
              />
            </label>
          </div>

          <div className="grid-colors">
            {TASK_PROJECT_COLOR_PALETTE.map((c) => (
              <button
                key={c}
                className="grid-color-btn"
                style={{ background: c }}
                onClick={() => handleUpdateProjectColor(popover.projectId!, c)}
              />
            ))}
          </div>
        </div>
      )}

      {/* 8. 自定义智能视图模态框 */}
      {smartModalOpen && (
        <div className="modal-overlay open" onClick={() => setSmartModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>新建自定义智能视图</h3>
            <div className="modal-field">
              <label>视图名称</label>
              <input
                type="text"
                placeholder="例如：关键事项、待复盘..."
                value={smartModalName}
                onChange={(e) => setSmartModalName(e.target.value)}
              />
            </div>
            <div className="modal-field">
              <label>过滤规则</label>
              <select
                value={smartModalRule}
                onChange={(e) => setSmartModalRule(e.target.value as CustomSmartView['rule'])}
              >
                <option value="prio">仅高优先级 (P1)</option>
                <option value="upcoming">最近 3 天截止</option>
                <option value="has_due">已安排具体日期</option>
                <option value="has_tag">带有任意标签</option>
                <option value="focused">已有专注时间记录</option>
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn-modal cancel" onClick={() => setSmartModalOpen(false)}>
                取消
              </button>
              <button className="btn-modal primary" onClick={handleCreateCustomSmartView}>
                立即创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 9. 底部悬浮控制条 (HUD) */}
      <div className="floating-hud">
        <span className="hud-label">外观</span>
        <div className="hud-btn-group">
          <button
            className={`hud-btn ${themeMode === 'light' ? 'active' : ''}`}
            onClick={() => setThemeMode('light')}
          >
            浅色
          </button>
          <button
            className={`hud-btn ${themeMode === 'dark' ? 'active' : ''}`}
            onClick={() => setThemeMode('dark')}
          >
            深色
          </button>
        </div>
        <div className="hud-divider" />
        <span className="hud-label">色彩基调</span>
        <div className="hud-btn-group">
          <button
            className={`hud-btn ${palette === 'linear' ? 'active' : ''}`}
            onClick={() => setPalette('linear')}
          >
            Linear 纯净白
          </button>
          <button
            className={`hud-btn ${palette === 'rose' ? 'active' : ''}`}
            onClick={() => setPalette('rose')}
          >
            高级粉调高对比
          </button>
          <button
            className={`hud-btn ${palette === 'contrast' ? 'active' : ''}`}
            onClick={() => setPalette('contrast')}
          >
            锐利黑白对比
          </button>
        </div>
        <div className="hud-divider" />
        <span className="hud-label">音效</span>
        <div className="hud-btn-group">
          <button className={`hud-btn ${sound ? 'active' : ''}`} onClick={() => setSound(true)}>
            晶莹触感 🔊
          </button>
          <button className={`hud-btn ${!sound ? 'active' : ''}`} onClick={() => setSound(false)}>
            静音 🔇
          </button>
        </div>
      </div>
    </div>
  );

  // Helper to render task row
  function renderTaskEntry(t: Task) {
    const isSelected = selectedTaskId === t.id;
    const isEditing = editingTaskId === t.id;
    const dateMeta = formatDateMeta(t);
    const focusDuration = taskFocusMap.get(t.id)?.totalMs || 0;
    const focusStr = formatDuration(focusDuration);

    return (
      <div
        key={t.id}
        className={`task-entry ${t.isCompleted ? 'is-done' : ''}`}
        data-task-id={t.id}
        aria-selected={isSelected}
        onClick={() => {
          setSelectedTaskId(t.id);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setSelectedTaskId(t.id);
          setTaskContextMenu({
            open: true,
            taskId: t.id,
            x: Math.min(e.clientX, window.innerWidth - 185),
            y: Math.min(e.clientY, window.innerHeight - 200),
          });
        }}
      >
        {/* 打勾圆圈 */}
        <button
          className="task-check-circle"
          role="checkbox"
          aria-checked={t.isCompleted}
          title={t.isCompleted ? '恢复为未完成' : '标记为已完成'}
          onClick={(e) => handleToggleTaskDone(t, e)}
        >
          <span dangerouslySetInnerHTML={{ __html: ICONS.checkMark }} />
        </button>

        {/* 标题与就地编辑 */}
        <div className="entry-title-wrap">
          {isEditing ? (
            <input
              type="text"
              className="inline-task-edit"
              autoFocus
              value={editingTitleVal}
              onChange={(e) => setEditingTitleVal(e.target.value)}
              onBlur={() => handleCommitTaskTitle(t.id, editingTitleVal)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCommitTaskTitle(t.id, editingTitleVal);
                else if (e.key === 'Escape') setEditingTaskId(null);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              className="entry-title"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedTaskId(t.id);
                setEditingTaskId(t.id);
                setEditingTitleVal(t.title);
              }}
              title="单击直接就地修改名称"
            >
              {t.title}
              <span className="strike-laser" />
            </span>
          )}
        </div>

        {/* 尾部元数据 */}
        <div className="entry-meta-tail">
          {focusDuration > 0 && (
            <span className="meta-pill focus">
              <span dangerouslySetInnerHTML={{ __html: ICONS.clock }} />
              {focusStr}
            </span>
          )}
          {dateMeta && (
            <span
              className={`meta-pill date ${dateMeta.cls}`}
              onClick={(e) => {
                e.stopPropagation();
                openSchedulerForTask(
                  t.id,
                  (e.currentTarget as HTMLElement).getBoundingClientRect(),
                );
              }}
            >
              {dateMeta.text}
              {t.recurrence && ' 🔁'}
            </span>
          )}
        </div>
      </div>
    );
  }
}
