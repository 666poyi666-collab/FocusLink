import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { ChevronLeft, ChevronRight, ListTree, MoreVertical, Plus, Search, X } from 'lucide-react';
import type { SyncedTask, SyncedTaskProject } from '@shared/sync/taskSnapshotProtocol';
import {
  ALL_PROJECTS,
  filterSyncedTaskForest,
  groupSyncedTaskForest,
  type SyncedTaskGroup,
  type SyncedTaskTreeNode,
} from './taskBrowserModel';
import { TASK_COMPLETION_UNDO_MS } from './localTaskCompletions';

/** 行内同步状态：本机已保存 / 已同步 / 同步失败。 */
export type TaskCompletionSyncState = 'pending' | 'synced' | 'failed';

/** 撤销窗口结束后行高收起的时长，与 .tt-node 的 transition 保持一致。 */
const NODE_COLLAPSE_MS = 220;

/** 长按进入批量选择的阈值；必须大于滑动判定的 8px 抖动。 */
const LONG_PRESS_MS = 480;

/**
 * 滴答清单移动端任务页复刻（结构 / 交互 / 视觉）。
 *
 * 视觉基准来自真机截图：页面底色 #F4F5F7、白色圆角面板、圆形优先级复选框、
 * 行高 44dp、右侧延期天数用红色、父任务带展开箭头、右下角蓝色新建按钮。
 * 数据与回调仍走 FocusLink 的任务快照，行为与 TaskBrowser 一致。
 */

interface TickTickTaskPageProps {
  tasks: readonly SyncedTask[];
  projects: readonly SyncedTaskProject[];
  selectedTaskId: string;
  canStart: boolean;
  pendingLocalCount?: number;
  pendingLocalIssue?: string | null;
  publishedAt: number | null;
  revision: number;
  onSelect: (task: SyncedTask) => void;
  onStart: (task: SyncedTask) => void;
  onCreate?: (title: string, projectId: string | null) => Promise<void>;
  onCreateProject?: (name: string) => Promise<string | void>;
  /** 清单改名/配色由调用方保留，本页暂不暴露入口。 */
  onUpdateProject?: (
    project: SyncedTaskProject,
    input: { name?: string; color?: string | null },
  ) => Promise<void>;
  onDeleteProject?: (project: SyncedTaskProject) => Promise<void>;
  onMoveTask?: (task: SyncedTask, projectId: string) => Promise<void>;
  /** completed 是明确的目标状态：true=完成，false=恢复到未完成。 */
  onToggleComplete?: (task: SyncedTask, completed: boolean) => Promise<void>;
  /** 由调用方按本机意图队列算出的行内状态，页面不自行猜测。 */
  completionStates?: Readonly<Record<string, TaskCompletionSyncState>>;
  onUpdateTask?: (
    task: SyncedTask,
    patch: {
      title?: string;
      priority?: number | null;
      startDate?: number | null;
      dueDate?: number | null;
      tags?: string[];
      parentId?: string | null;
    },
  ) => Promise<void>;
  onDeleteTask?: (task: SyncedTask) => Promise<void>;
  /** 批量完成/恢复：一次交出一组任务和目标状态；失败必须 reject，页面行内报错。 */
  onSetTasksCompleted?: (tasks: SyncedTask[], completed: boolean) => Promise<void>;
  /** 批量删除：失败必须 reject；页面负责二次确认。 */
  onDeleteTasks?: (tasks: SyncedTask[]) => Promise<void>;
  /** 批量移动：projectId 为目标清单；失败必须 reject。 */
  onMoveTasks?: (tasks: SyncedTask[], projectId: string) => Promise<void>;
  /** 新增子任务：title 已去空白且非空；失败必须 reject，详情面板保持打开。 */
  onCreateSubtask?: (parent: SyncedTask, title: string) => Promise<void>;
}

type ComposerMode = 'closed' | 'task' | 'project';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(value: number): number {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** 右侧元信息：延期天数优先，其次今天/明天/日期，与滴答清单一致。 */
function dueLabel(task: SyncedTask, now: number): { text: string; overdue: boolean } | null {
  if (task.isCompleted) {
    if (task.updatedAt === null) return null;
    const date = new Date(task.updatedAt);
    return { text: `${date.getMonth() + 1}月${date.getDate()}日`, overdue: false };
  }
  if (task.dueDate === null) return null;
  const dayDelta = Math.round((startOfDay(task.dueDate) - startOfDay(now)) / DAY_MS);
  if (dayDelta < 0) return { text: `${Math.abs(dayDelta)}天`, overdue: true };
  if (dayDelta === 0) return { text: '今天', overdue: false };
  if (dayDelta === 1) return { text: '明天', overdue: false };
  const date = new Date(task.dueDate);
  return { text: `${date.getMonth() + 1}月${date.getDate()}日`, overdue: false };
}

function priorityTone(priority: number | null): 'high' | 'medium' | 'low' | 'none' {
  if (priority === 3) return 'high';
  if (priority === 2) return 'medium';
  if (priority === 1) return 'low';
  return 'none';
}

function listTitle(projectId: string | null, projects: readonly SyncedTaskProject[]): string {
  if (projectId === null) return '收集箱';
  return projects.find((project) => project.id === projectId)?.name ?? '清单';
}

/** 批量选择只认屏幕上真的看得到的行：折叠起来的子任务不算，顺序按渲染顺序。 */
function collectVisibleTaskIds(
  nodes: readonly SyncedTaskTreeNode[],
  isCollapsed: (id: string) => boolean,
): string[] {
  const ids: string[] = [];
  const visit = (list: readonly SyncedTaskTreeNode[]) => {
    for (const node of list) {
      ids.push(node.id);
      if (!isCollapsed(node.id)) visit(node.children);
    }
  };
  visit(nodes);
  return ids;
}

interface RowProps {
  node: SyncedTaskTreeNode;
  depth: number;
  collapsed: boolean;
  onToggleCollapse: (id: string) => void;
  onOpen: (task: SyncedTask) => void;
  /** 目标状态由调用方明确给出：完成 true，恢复 false。 */
  onToggle: (task: SyncedTask, completed: boolean) => void;
  onMoveRequest: (task: SyncedTask) => void;
  completionState?: TaskCompletionSyncState;
  completionError?: string;
  /** 只有本次会话里刚勾选的行才播放弹跳；打开已完成列表不重播。 */
  justCompleted?: boolean;
  /** 行当前显示的勾选态（本机意图覆盖后可能是 true，而底层快照还没完成）。 */
  completed: boolean;
  now: number;
  /** 批量选择模式：行不再打开详情，点击即选中。 */
  selectMode: boolean;
  selected: boolean;
  /** 切换单个任务的选择态（批量条与行共用）。 */
  onSelect: (task: SyncedTask) => void;
  /** 行右侧「选择」与长按共用：进入批量模式并选中该行。 */
  onEnterSelectMode: (task: SyncedTask) => void;
}

/** 滴答清单式滑动：右滑完成、左滑移到清单；纵向滑动仍然交还给页面滚动。 */
function TaskRow({
  node,
  depth,
  collapsed,
  onToggleCollapse,
  onOpen,
  onToggle,
  onMoveRequest,
  completionState,
  completionError,
  justCompleted = false,
  completed,
  now,
  selectMode,
  selected,
  onSelect,
  onEnterSelectMode,
}: RowProps) {
  const hasChildren = node.children.length > 0;
  const due = dueLabel(node, now);
  const tone = priorityTone(node.priority);
  const [offset, setOffset] = useState(0);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    active: boolean;
    horizontal: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const longPressRef = useRef<number | null>(null);

  const cancelLongPress = () => {
    if (longPressRef.current !== null) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  };

  // 行被批量选择替换掉时，挂在行上的长按计时器必须一起收掉。
  useEffect(() => {
    return () => {
      if (longPressRef.current !== null) window.clearTimeout(longPressRef.current);
    };
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // 批量模式下行本身就是选择框，不再起滑动和长按。
    if (selectMode) return;
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      active: true,
      horizontal: false,
    };
    cancelLongPress();
    longPressRef.current = window.setTimeout(() => {
      longPressRef.current = null;
      suppressClickRef.current = true;
      onEnterSelectMode(node);
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 260);
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag?.active) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    // 一旦真的开始移动，就不能再当成「长按」。
    if (Math.abs(deltaX) > 8 || Math.abs(deltaY) > 8) cancelLongPress();
    if (!drag.horizontal) {
      if (Math.abs(deltaX) < 8) return;
      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        drag.active = false;
        return;
      }
      drag.horizontal = true;
    }
    setOffset(Math.max(-112, Math.min(112, deltaX)));
  };

  const finishGesture = () => {
    cancelLongPress();
    const drag = dragRef.current;
    dragRef.current = null;
    const value = offset;
    setOffset(0);
    if (!drag?.horizontal) return;
    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 260);
    if (value >= 72) onToggle(node, true);
    else if (value <= -72) onMoveRequest(node);
  };

  return (
    <li className="tt-row-shell" data-depth={depth > 2 ? 2 : depth}>
      <div className="tt-swipe-actions" aria-hidden="true">
        <span className="tt-swipe-done" data-visible={offset > 6}>
          完成
        </span>
        <span className="tt-swipe-move" data-visible={offset < -6}>
          移到清单
        </span>
      </div>
      <div
        className="tt-row"
        data-depth={depth > 2 ? 2 : depth}
        data-completed={completed}
        data-select-mode={selectMode}
        data-selected={selectMode ? selected : undefined}
        style={offset === 0 ? undefined : { transform: `translateX(${offset}px)` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishGesture}
        onPointerCancel={finishGesture}
      >
        {selectMode ? (
          <button
            type="button"
            className="tt-check tt-select-mark"
            data-checked={selected}
            aria-pressed={selected}
            aria-label={selected ? `取消选择 ${node.title}` : `选择 ${node.title}`}
            onClick={(event) => {
              // 批量模式下最显眼的目标是复选框本身，点它必须真的切换选中。
              event.stopPropagation();
              onSelect(node);
            }}
          >
            {selected ? (
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path
                  d="M4.5 10.5 8 14l7.5-8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : null}
          </button>
        ) : (
          <button
            type="button"
            key={completed ? 'done' : 'open'}
            className="tt-check"
            data-tone={tone}
            data-checked={completed}
            data-just-checked={justCompleted}
            aria-label={completed ? `取消完成 ${node.title}` : `完成 ${node.title}`}
            onClick={() => onToggle(node, !completed)}
          >
            {completed ? (
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path
                  d="M4.5 10.5 8 14l7.5-8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : null}
          </button>
        )}
        <button
          type="button"
          className="tt-row-main"
          data-selected={selectMode ? selected : undefined}
          aria-pressed={selectMode ? selected : undefined}
          onClick={() => {
            if (suppressClickRef.current) return;
            // 批量模式下行点击就是选中/取消，不再打开详情。
            if (selectMode) {
              onSelect(node);
              return;
            }
            onOpen(node);
          }}
        >
          <span className="tt-row-title">{node.title}</span>
          {node.tags.length > 0 ? (
            <span className="tt-row-tags">
              {node.tags.slice(0, 2).map((tag) => (
                <span key={tag}>#{tag}</span>
              ))}
            </span>
          ) : null}
        </button>
        {hasChildren ? <ListTree className="tt-subtasks-icon" aria-hidden="true" /> : null}
        {completionState ? (
          <span
            className="tt-row-status"
            data-state={completionState}
            title={completionError ?? undefined}
            aria-live="polite"
          >
            {completionState === 'pending'
              ? '本机已保存'
              : completionState === 'synced'
                ? '已同步'
                : '同步失败'}
          </span>
        ) : null}
        {due ? (
          <span className="tt-row-due" data-overdue={due.overdue}>
            {due.text}
          </span>
        ) : null}
        {hasChildren && !selectMode ? (
          <button
            type="button"
            className="tt-disclosure"
            data-collapsed={collapsed}
            aria-label={collapsed ? `展开 ${node.title} 的子任务` : `收起 ${node.title} 的子任务`}
            aria-expanded={!collapsed}
            onClick={(event) => {
              event.stopPropagation();
              onToggleCollapse(node.id);
            }}
          >
            <ChevronRight aria-hidden="true" />
          </button>
        ) : (
          <span className="tt-disclosure-space" aria-hidden="true" />
        )}
        {selectMode ? (
          <button
            type="button"
            className="tt-row-select"
            data-selected={selected}
            aria-pressed={selected}
            aria-label={selected ? `取消选择 ${node.title}` : `选择 ${node.title}`}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(node);
            }}
          >
            {selected ? '已选' : '选择'}
          </button>
        ) : (
          <button
            type="button"
            className="tt-row-select"
            aria-label={`选择 ${node.title}`}
            onClick={(event) => {
              event.stopPropagation();
              onEnterSelectMode(node);
            }}
          >
            选择
          </button>
        )}
      </div>
    </li>
  );
}

export function TickTickTaskPage({
  tasks,
  projects,
  selectedTaskId,
  canStart,
  pendingLocalCount = 0,
  pendingLocalIssue = null,
  publishedAt,
  revision,
  onSelect,
  onStart,
  onCreate,
  onCreateProject,
  onMoveTask,
  onToggleComplete,
  completionStates,
  onUpdateTask,
  onDeleteTask,
  onSetTasksCompleted,
  onDeleteTasks,
  onMoveTasks,
  onCreateSubtask,
}: TickTickTaskPageProps) {
  const [now, setNow] = useState(() => Date.now());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [composer, setComposer] = useState<ComposerMode>('closed');
  const [draft, setDraft] = useState('');
  const [draftProjectId, setDraftProjectId] = useState<string | null>(null);
  const [projectDraft, setProjectDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [projectFilter, setProjectFilter] = useState<string>(ALL_PROJECTS);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [moveTaskId, setMoveTaskId] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // 搜索只在页面内过滤：不改排序、不改层级，仍走 filterSyncedTaskForest 这同一条通道。
  const [query, setQuery] = useState('');
  // 批量选择：selectMode 决定行的形态，selection 只存 id，任务消失即自动失效。
  const [selectMode, setSelectMode] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchConfirmDelete, setBatchConfirmDelete] = useState(false);
  const [batchMoveOpen, setBatchMoveOpen] = useState(false);
  const [batchNotice, setBatchNotice] = useState<string | null>(null);
  // 详情面板的子任务输入：失败只报错，面板保持打开。
  const [subtaskDraft, setSubtaskDraft] = useState('');
  const [subtaskBusy, setSubtaskBusy] = useState(false);
  const [subtaskError, setSubtaskError] = useState<string | null>(null);
  // 单任务「移动到清单」浮层自己的 busy / 错误，不再静默吞掉 reject。
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const noticeTimer = useRef<number | null>(null);
  // 刚勾选完成的任务先在原位停留 6 秒：动效看得见，撤销够得着；窗口结束后行高收起。
  // 每个任务独立计时，连续勾选互不阻塞。
  const [heldCompletions, setHeldCompletions] = useState<
    Record<string, { completedAt: number; phase: 'held' | 'exiting' }>
  >({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const holdTimers = useRef(new Map<string, number>());
  const exitTimers = useRef(new Map<string, number>());
  const completionStatesRef = useRef(completionStates);
  completionStatesRef.current = completionStates;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // 页面切走时清掉所有计时器，避免回到任务页时补播已经过期的收拢动画。
  useEffect(() => {
    const holds = holdTimers.current;
    const exits = exitTimers.current;
    return () => {
      for (const timer of holds.values()) window.clearTimeout(timer);
      for (const timer of exits.values()) window.clearTimeout(timer);
      holds.clear();
      exits.clear();
    };
  }, []);

  // 批量提示（已完成 3 项）自动消失，页面切走时也要清掉，不留悬挂计时器。
  useEffect(() => {
    return () => {
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    };
  }, []);

  // Esc / 返回键按「最上层先关」的顺序退出：异步进行中也不阻塞关闭。
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (moveTaskId) {
        setMoveTaskId(null);
        setMoveError(null);
        return;
      }
      if (composer !== 'closed') {
        setComposer('closed');
        return;
      }
      if (menuOpen) {
        setMenuOpen(false);
        return;
      }
      if (drawerOpen) {
        setDrawerOpen(false);
        return;
      }
      if (detailTaskId) {
        setDetailTaskId(null);
        return;
      }
      if (batchMoveOpen) {
        setBatchMoveOpen(false);
        return;
      }
      if (selectMode) {
        setSelectMode(false);
        setSelection(new Set());
        setBatchError(null);
        setBatchConfirmDelete(false);
        setBatchMoveOpen(false);
        return;
      }
      if (query !== '') setQuery('');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [batchMoveOpen, composer, detailTaskId, drawerOpen, menuOpen, moveTaskId, query, selectMode]);

  useEffect(() => {
    const task = tasks.find((candidate) => candidate.id === detailTaskId);
    setEditTitle(task?.title ?? '');
    setEditTags(task?.tags.join(' ') ?? '');
    setEditError(null);
    setConfirmDelete(false);
    // 换到另一条任务时，上一条留下的子任务草稿和错误不能跟过来。
    setSubtaskDraft('');
    setSubtaskError(null);
  }, [detailTaskId, tasks]);

  // 窗口中刚勾选的任务必须继续留在「待办」森林里才能保住原位：过滤器按 isCompleted 选状态，
  // 所以这里把它按未完成交给过滤器，勾选态由 TaskRow 的 completed 单独渲染。
  const displayTasks = useMemo(() => {
    if (showCompleted) return tasks;
    return tasks
      .filter((task) => !task.isCompleted || heldCompletions[task.id] !== undefined)
      .map((task) =>
        heldCompletions[task.id] === undefined ? task : { ...task, isCompleted: false },
      );
  }, [heldCompletions, showCompleted, tasks]);
  // 搜索词只交给同一条森林过滤器：排序、层级、父任务折叠都是现成的，不再另造一套。
  const trimmedQuery = query.trim();
  const groups = useMemo<SyncedTaskGroup[]>(
    () =>
      groupSyncedTaskForest(
        filterSyncedTaskForest(
          displayTasks,
          trimmedQuery,
          ALL_PROJECTS,
          showCompleted ? 'completed' : 'open',
        ),
        projects,
      ),
    [displayTasks, projects, showCompleted, trimmedQuery],
  );
  const activeGroups = useMemo(
    () =>
      projectFilter === ALL_PROJECTS
        ? groups
        : groups.filter((group) => group.projectId === projectFilter),
    [groups, projectFilter],
  );
  /** 当前可见（含搜索过滤、折叠之后）的任务 id：批量选择的合法范围。 */
  const visibleTaskIds = useMemo(
    () =>
      collectVisibleTaskIds(
        activeGroups.flatMap((group) => group.tasks),
        (id) => collapsed.has(id),
      ),
    [activeGroups, collapsed],
  );
  // 不再按 isCompleted 过滤：已完成列表里同样要能批量删除/移动。
  const selectedTasks = useMemo(() => {
    if (selection.size === 0) return [] as SyncedTask[];
    return tasks.filter((task) => selection.has(task.id));
  }, [selection, tasks]);
  const selectedCount = selectedTasks.length;
  const allVisibleSelected =
    visibleTaskIds.length > 0 && visibleTaskIds.every((id) => selection.has(id));
  const searching = trimmedQuery !== '';
  const searchEmpty = searching && activeGroups.length === 0;

  // 搜索或切清单之后，选中项收缩到当前可见范围：计数永远等于看得见的行。
  useEffect(() => {
    if (!selectMode) return;
    const visible = new Set(visibleTaskIds);
    setSelection((current) => {
      if (current.size === 0) return current;
      let changed = false;
      const next = new Set<string>();
      for (const id of current) {
        if (visible.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : current;
    });
  }, [selectMode, visibleTaskIds]);
  const openCount = useMemo(() => tasks.filter((task) => !task.isCompleted).length, [tasks]);
  const detailTask = useMemo(
    () => tasks.find((task) => task.id === detailTaskId) ?? null,
    [tasks, detailTaskId],
  );
  const detailChildren = useMemo(
    () => (detailTask ? tasks.filter((task) => task.parentId === detailTask.id) : []),
    [tasks, detailTask],
  );
  const headline = projectFilter === ALL_PROJECTS ? '所有任务' : listTitle(projectFilter, projects);

  const toggleCollapsed = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applyPatch = (patch: {
    title?: string;
    priority?: number | null;
    startDate?: number | null;
    dueDate?: number | null;
    tags?: string[];
  }) => {
    if (!onUpdateTask || !detailTask || editBusy) return;
    setEditBusy(true);
    setEditError(null);
    void onUpdateTask(detailTask, patch)
      .catch((reason: unknown) => {
        setEditError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => setEditBusy(false));
  };

  const handleDelete = () => {
    if (!onDeleteTask || !detailTask || editBusy) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setEditBusy(true);
    setEditError(null);
    void onDeleteTask(detailTask)
      .then(() => setDetailTaskId(null))
      .catch((reason: unknown) => {
        setEditError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => setEditBusy(false));
  };

  const clearTimers = (taskId: string) => {
    const hold = holdTimers.current.get(taskId);
    if (hold !== undefined) window.clearTimeout(hold);
    holdTimers.current.delete(taskId);
    const exit = exitTimers.current.get(taskId);
    if (exit !== undefined) window.clearTimeout(exit);
    exitTimers.current.delete(taskId);
  };

  const dropHeld = (taskId: string) =>
    setHeldCompletions((current) => {
      if (current[taskId] === undefined) return current;
      const next = { ...current };
      delete next[taskId];
      return next;
    });

  // 撤销窗口结束后先标记退出（触发收拢动画），动画结束再真正移出列表。
  const scheduleCollapse = (taskId: string) => {
    clearTimers(taskId);
    const hold = window.setTimeout(() => {
      holdTimers.current.delete(taskId);
      // 同步失败：撤销不再成立，勾选态回到未完成，行留在原位并显示失败状态。
      if (completionStatesRef.current?.[taskId] === 'failed') {
        dropHeld(taskId);
        return;
      }
      setHeldCompletions((current) =>
        current[taskId] === undefined
          ? current
          : { ...current, [taskId]: { ...current[taskId], phase: 'exiting' } },
      );
      const exit = window.setTimeout(() => {
        exitTimers.current.delete(taskId);
        dropHeld(taskId);
      }, NODE_COLLAPSE_MS);
      exitTimers.current.set(taskId, exit);
    }, TASK_COMPLETION_UNDO_MS);
    holdTimers.current.set(taskId, hold);
  };

  /**
   * 勾选不再串行等待网络：先给出行内反馈，本机保存成功后回调立刻返回。
   * 失败只影响这一行，不阻断其他行的连续勾选。
   */
  const setTaskCompleted = (task: SyncedTask, completed: boolean) => {
    if (!onToggleComplete) return;
    const now = Date.now();
    setError(null);
    setRowErrors((current) => {
      if (current[task.id] === undefined) return current;
      const next = { ...current };
      delete next[task.id];
      return next;
    });
    if (completed) {
      setHeldCompletions((current) => ({
        ...current,
        [task.id]: { completedAt: now, phase: 'held' },
      }));
      scheduleCollapse(task.id);
    } else {
      clearTimers(task.id);
      dropHeld(task.id);
    }
    void onToggleComplete(task, completed).catch((reason: unknown) => {
      const message = reason instanceof Error ? reason.message : String(reason);
      if (completed) {
        clearTimers(task.id);
        dropHeld(task.id);
        setRowErrors((current) => ({ ...current, [task.id]: message }));
        return;
      }
      // 撤销失败：这次完成仍然成立，把勾选状态放回原位，避免它凭空消失。
      setHeldCompletions((current) => ({
        ...current,
        [task.id]: { completedAt: now, phase: 'held' },
      }));
      setRowErrors((current) => ({ ...current, [task.id]: message }));
      scheduleCollapse(task.id);
    });
  };

  const undoableIds = useMemo(
    () =>
      Object.entries(heldCompletions)
        .filter(([, held]) => held.phase === 'held')
        .map(([taskId]) => taskId),
    [heldCompletions],
  );

  /** 一批连续勾选一起撤销：每一条都明确要求恢复到未完成。 */
  const undoBatch = () => {
    if (!onToggleComplete || undoableIds.length === 0) return;
    const targets = undoableIds
      .map((id) => tasks.find((task) => task.id === id))
      .filter((task): task is SyncedTask => task !== undefined);
    for (const task of targets) {
      clearTimers(task.id);
      dropHeld(task.id);
      void onToggleComplete(task, false).catch((reason: unknown) => {
        setRowErrors((current) => ({
          ...current,
          [task.id]: reason instanceof Error ? reason.message : String(reason),
        }));
      });
    }
  };

  const openComposer = () => {
    setDraft('');
    setDraftProjectId(projectFilter === ALL_PROJECTS ? null : projectFilter);
    setComposer('task');
  };

  const submitTask = () => {
    const title = draft.trim();
    if (!title || !onCreate || busy) return;
    setBusy(true);
    setError(null);
    void onCreate(title, draftProjectId)
      .then(() => {
        setDraft('');
        setComposer('closed');
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      )
      .finally(() => setBusy(false));
  };

  const submitProject = () => {
    const name = projectDraft.trim();
    if (!name || !onCreateProject || busy) return;
    setBusy(true);
    setError(null);
    void onCreateProject(name)
      .then(() => {
        setProjectDraft('');
        setComposer('closed');
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      )
      .finally(() => setBusy(false));
  };

  const showBatchNotice = (text: string) => {
    setBatchNotice(text);
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => {
      noticeTimer.current = null;
      setBatchNotice(null);
    }, 4000);
  };

  const enterSelectMode = (task?: SyncedTask) => {
    setSelectMode(true);
    setSelection(task ? new Set([task.id]) : new Set());
    setBatchError(null);
    setBatchConfirmDelete(false);
    setBatchMoveOpen(false);
    setBatchNotice(null);
  };

  /** 退出批量只清页面状态：正在跑的批量请求不取消、也不阻塞关闭。 */
  const exitSelectMode = () => {
    setSelectMode(false);
    setSelection(new Set());
    setBatchError(null);
    setBatchConfirmDelete(false);
    setBatchMoveOpen(false);
  };

  const toggleSelected = (task: SyncedTask) => {
    setBatchError(null);
    setBatchConfirmDelete(false);
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setBatchError(null);
    setBatchConfirmDelete(false);
    setSelection((current) => {
      const allSelected =
        visibleTaskIds.length > 0 && visibleTaskIds.every((id) => current.has(id));
      return allSelected ? new Set<string>() : new Set(visibleTaskIds);
    });
  };

  /**
   * 批量动作统一入口：busy 期间按钮禁用，但取消/Esc 始终可点；
   * 失败只写 batchError，选中项保留，用户能原地重试。
   */
  const runBatchAction = (label: string, action: (targets: SyncedTask[]) => Promise<void>) => {
    if (batchBusy || selectedTasks.length === 0) return;
    const targets = selectedTasks;
    setBatchBusy(true);
    setBatchError(null);
    setBatchConfirmDelete(false);
    void action(targets)
      .then(() => {
        setSelection(new Set());
        setSelectMode(false);
        setBatchMoveOpen(false);
        showBatchNotice(`${label} ${targets.length} 项`);
      })
      .catch((reason: unknown) => {
        setBatchError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => setBatchBusy(false));
  };

  const batchComplete = () => {
    const handler = onSetTasksCompleted;
    if (!handler) return;
    runBatchAction('已完成', (targets) => handler(targets, true));
  };

  const batchDelete = () => {
    const handler = onDeleteTasks;
    if (!handler) return;
    if (!batchConfirmDelete) {
      setBatchConfirmDelete(true);
      return;
    }
    runBatchAction('已删除', handler);
  };

  const batchMove = (projectId: string) => {
    const handler = onMoveTasks;
    if (!handler) return;
    setBatchMoveOpen(false);
    runBatchAction('已移动', (targets) => handler(targets, projectId));
  };

  const addSubtask = () => {
    const title = subtaskDraft.trim();
    const handler = onCreateSubtask;
    if (!title || !detailTask || !handler || subtaskBusy) return;
    const parent = detailTask;
    setSubtaskBusy(true);
    setSubtaskError(null);
    void handler(parent, title)
      .then(() => setSubtaskDraft(''))
      .catch((reason: unknown) => {
        // 面板不关闭：错误就地显示，改个名字可以直接重试。
        setSubtaskError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => setSubtaskBusy(false));
  };

  const moveSelectedTask = (projectId: string) => {
    const target = tasks.find((task) => task.id === moveTaskId);
    const handler = onMoveTask;
    if (!target || !handler) {
      setMoveTaskId(null);
      return;
    }
    setMoveBusy(true);
    setMoveError(null);
    void handler(target, projectId)
      .then(() => setMoveTaskId(null))
      .catch((reason: unknown) => {
        setMoveError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => setMoveBusy(false));
  };

  const moveDetailTask = (projectId: string) => {
    const handler = onMoveTask;
    if (!handler || !detailTask || editBusy) return;
    const target = detailTask;
    setEditBusy(true);
    setEditError(null);
    void handler(target, projectId)
      .catch((reason: unknown) => {
        setEditError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => setEditBusy(false));
  };

  const renderNodes = (nodes: readonly SyncedTaskTreeNode[], depth: number): ReactNode =>
    nodes.map((node) => (
      <div
        key={node.id}
        className="tt-node"
        data-exit={heldCompletions[node.id]?.phase === 'exiting'}
      >
        <div className="tt-node-collapse">
          <div className="tt-node-content">
            <ul className="tt-rows">
              <TaskRow
                node={node}
                depth={depth}
                collapsed={collapsed.has(node.id)}
                onToggleCollapse={toggleCollapsed}
                onOpen={(task) => {
                  setDetailTaskId(task.id);
                  onSelect(task);
                }}
                onToggle={setTaskCompleted}
                onMoveRequest={(task) => {
                  setMoveError(null);
                  setMoveTaskId(task.id);
                }}
                completionState={rowErrors[node.id] ? 'failed' : completionStates?.[node.id]}
                completionError={rowErrors[node.id]}
                justCompleted={!showCompleted && heldCompletions[node.id] !== undefined}
                completed={heldCompletions[node.id] !== undefined || node.isCompleted}
                now={now}
                selectMode={selectMode}
                selected={selection.has(node.id)}
                onSelect={toggleSelected}
                onEnterSelectMode={(task) => enterSelectMode(task)}
              />
            </ul>
            {node.children.length > 0 && !collapsed.has(node.id)
              ? renderNodes(node.children, depth + 1)
              : null}
          </div>
        </div>
      </div>
    ));

  return (
    <section className="tt-page" aria-label="任务" data-select-mode={selectMode}>
      <header className="tt-appbar" data-select-mode={selectMode}>
        {selectMode ? (
          <>
            <button
              type="button"
              className="tt-appbar-text"
              aria-label="退出批量选择"
              onClick={exitSelectMode}
            >
              取消
            </button>
            <h1 className="tt-appbar-title">已选 {selectedCount} 项</h1>
            <button type="button" className="tt-appbar-text" onClick={selectAllVisible}>
              {allVisibleSelected ? '取消全选' : '全选'}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="tt-appbar-button"
              aria-label="打开清单列表"
              onClick={() => setDrawerOpen(true)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="tt-hamburger">
                <path
                  d="M4 7h16M4 12h16M4 17h11"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <h1 className="tt-appbar-title">{headline}</h1>
            <button
              type="button"
              className="tt-appbar-button"
              aria-label="更多操作"
              onClick={() => setMenuOpen(true)}
            >
              <MoreVertical aria-hidden="true" />
            </button>
          </>
        )}
      </header>

      <div className="tt-sheet">
        <div className="tt-search" role="search">
          <Search className="tt-search-icon" aria-hidden="true" />
          <input
            className="tt-search-input"
            type="search"
            aria-label="搜索任务或标签"
            placeholder="搜索任务或标签"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setQuery('');
            }}
          />
          {searching ? (
            <button
              type="button"
              className="tt-search-clear"
              aria-label="清除搜索"
              onClick={() => setQuery('')}
            >
              <X aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {searchEmpty ? (
          <div className="tt-empty">
            <p>没有匹配的任务</p>
            <button type="button" className="tt-empty-action" onClick={() => setQuery('')}>
              清除搜索
            </button>
          </div>
        ) : activeGroups.length === 0 ? (
          <div className="tt-empty">
            <p>还没有任务</p>
            <p className="tt-empty-hint">点右下角的加号，写下第一件事</p>
          </div>
        ) : (
          activeGroups.map((group) => (
            <div key={group.key} className="tt-group">
              {projectFilter === ALL_PROJECTS ? (
                <p className="tt-group-title">
                  {group.name}
                  <span className="tt-group-count">{group.tasks.length}</span>
                </p>
              ) : null}
              {renderNodes(group.tasks, 0)}
            </div>
          ))
        )}
      </div>

      {pendingLocalCount > 0 ? (
        <p className="tt-pending" role="status">
          {pendingLocalIssue ?? `${pendingLocalCount} 条已存本机，等待同步`}
        </p>
      ) : null}
      {error ? (
        <p className="tt-error" role="alert">
          {error}
        </p>
      ) : null}

      {undoableIds.length > 0 ? (
        <div className="tt-undo" role="status">
          <span className="tt-undo-text">
            {undoableIds.length === 1
              ? `已完成「${tasks.find((task) => task.id === undoableIds[0])?.title ?? '任务'}」`
              : `已完成 ${undoableIds.length} 项`}
          </span>
          <button type="button" className="tt-undo-action" onClick={undoBatch}>
            撤销
          </button>
        </div>
      ) : null}

      {selectMode ? (
        <div className="tt-batch" role="toolbar" aria-label="批量操作">
          <div className="tt-batch-head">
            <span className="tt-batch-count" role="status">
              已选 {selectedCount} 项
            </span>
            {batchBusy ? <span className="tt-batch-busy">处理中…</span> : null}
          </div>
          {batchError ? (
            <p className="tt-batch-error" role="alert">
              {batchError}
            </p>
          ) : null}
          {batchMoveOpen ? (
            <div className="tt-batch-move">
              <p className="tt-batch-move-title">移动到清单</p>
              <div className="tt-batch-move-list">
                {projects.map((project) => (
                  <button
                    type="button"
                    key={project.id}
                    className="tt-batch-move-item"
                    disabled={batchBusy}
                    onClick={() => batchMove(project.id)}
                  >
                    {project.name}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="tt-batch-action"
                onClick={() => setBatchMoveOpen(false)}
              >
                取消移动
              </button>
            </div>
          ) : null}
          <div className="tt-batch-actions">
            <button
              type="button"
              className="tt-batch-action"
              disabled={batchBusy || selectedCount === 0 || !onSetTasksCompleted}
              onClick={batchComplete}
            >
              完成
            </button>
            <button
              type="button"
              className="tt-batch-action"
              data-tone="danger"
              data-confirm={batchConfirmDelete}
              disabled={batchBusy || selectedCount === 0 || !onDeleteTasks}
              onClick={batchDelete}
            >
              {batchConfirmDelete ? `确认删除 ${selectedCount} 项` : '删除'}
            </button>
            <button
              type="button"
              className="tt-batch-action"
              disabled={batchBusy || selectedCount === 0 || !onMoveTasks}
              onClick={() => setBatchMoveOpen((current) => !current)}
            >
              移动
            </button>
            <button type="button" className="tt-batch-action" onClick={exitSelectMode}>
              取消
            </button>
          </div>
        </div>
      ) : null}
      {batchNotice ? (
        <p className="tt-batch-notice" role="status">
          {batchNotice}
        </p>
      ) : null}

      {!selectMode ? (
        <button type="button" className="tt-fab" aria-label="新建任务" onClick={openComposer}>
          <Plus aria-hidden="true" />
        </button>
      ) : null}

      {drawerOpen ? (
        <div
          className="tt-overlay"
          data-kind="drawer"
          role="presentation"
          onClick={() => setDrawerOpen(false)}
        >
          <aside
            className="tt-drawer"
            role="dialog"
            aria-label="清单列表"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="tt-drawer-title">清单</p>
            <button
              type="button"
              className="tt-drawer-item"
              data-active={projectFilter === ALL_PROJECTS}
              onClick={() => {
                setProjectFilter(ALL_PROJECTS);
                setDrawerOpen(false);
              }}
            >
              <span>所有任务</span>
              <span className="tt-drawer-count">{openCount}</span>
            </button>
            {projects.map((project) => {
              const count = tasks.filter(
                (task) => task.projectId === project.id && !task.isCompleted,
              ).length;
              return (
                <button
                  type="button"
                  key={project.id}
                  className="tt-drawer-item"
                  data-active={projectFilter === project.id}
                  onClick={() => {
                    setProjectFilter(project.id);
                    setDrawerOpen(false);
                  }}
                >
                  <span
                    className="tt-drawer-dot"
                    data-color={project.color ?? undefined}
                    aria-hidden="true"
                  />
                  <span>{project.name}</span>
                  <span className="tt-drawer-count">{count}</span>
                </button>
              );
            })}
            <button type="button" className="tt-drawer-add" onClick={() => setComposer('project')}>
              <Plus aria-hidden="true" />
              新建清单
            </button>
          </aside>
        </div>
      ) : null}

      {menuOpen ? (
        <div
          className="tt-overlay"
          data-kind="menu"
          role="presentation"
          onClick={() => setMenuOpen(false)}
        >
          <div
            className="tt-menu"
            role="dialog"
            aria-label="更多操作"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                setShowCompleted((current) => !current);
                setMenuOpen(false);
              }}
            >
              {showCompleted ? '只看待办' : '显示已完成'}
            </button>
            <button
              type="button"
              onClick={() => {
                setCollapsed(new Set());
                setMenuOpen(false);
              }}
            >
              展开全部子任务
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                enterSelectMode();
              }}
            >
              批量选择
            </button>
            <p className="tt-menu-meta">
              本机 · rev {revision}
              {publishedAt
                ? ` · ${new Date(publishedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
                : ''}
            </p>
          </div>
        </div>
      ) : null}

      {composer !== 'closed' ? (
        <div
          className="tt-overlay"
          data-kind="sheet"
          role="presentation"
          onClick={() => setComposer('closed')}
        >
          <div
            className="tt-composer"
            role="dialog"
            aria-label={composer === 'task' ? '新建任务' : '新建清单'}
            onClick={(event) => event.stopPropagation()}
          >
            {composer === 'task' ? (
              <>
                <input
                  className="tt-composer-input"
                  placeholder="准备做什么？"
                  value={draft}
                  autoFocus
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') submitTask();
                  }}
                />
                <div className="tt-composer-tools">
                  <label className="tt-composer-select">
                    <span>清单</span>
                    <select
                      value={draftProjectId ?? ''}
                      onChange={(event) => setDraftProjectId(event.target.value || null)}
                    >
                      <option value="">收集箱</option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="tt-composer-cancel"
                    onClick={() => setComposer('closed')}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="tt-composer-submit"
                    disabled={busy || draft.trim() === ''}
                    onClick={submitTask}
                  >
                    {busy ? '保存中…' : '添加'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <input
                  className="tt-composer-input"
                  placeholder="清单名称"
                  value={projectDraft}
                  autoFocus
                  onChange={(event) => setProjectDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') submitProject();
                  }}
                />
                <div className="tt-composer-tools">
                  <button
                    type="button"
                    className="tt-composer-cancel"
                    onClick={() => setComposer('closed')}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="tt-composer-submit"
                    disabled={busy || projectDraft.trim() === ''}
                    onClick={submitProject}
                  >
                    {busy ? '创建中…' : '创建'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {moveTaskId ? (
        <div
          className="tt-overlay"
          data-kind="sheet"
          role="presentation"
          onClick={() => setMoveTaskId(null)}
        >
          <div
            className="tt-menu"
            role="dialog"
            aria-label="移动到清单"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="tt-menu-meta">{moveBusy ? '正在移动…' : '移动到清单'}</p>
            {moveError ? (
              <p className="tt-detail-error" role="alert">
                {moveError}
              </p>
            ) : null}
            {projects.map((project) => (
              <button
                type="button"
                key={project.id}
                disabled={moveBusy}
                onClick={() => moveSelectedTask(project.id)}
              >
                {project.name}
              </button>
            ))}
            <button type="button" onClick={() => setMoveTaskId(null)}>
              取消
            </button>
          </div>
        </div>
      ) : null}

      {detailTask ? (
        <div
          className="tt-overlay"
          data-kind="sheet"
          role="presentation"
          onClick={() => setDetailTaskId(null)}
        >
          <article
            className="tt-detail"
            role="dialog"
            aria-label={detailTask.title}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="tt-detail-head">
              <button
                type="button"
                className="tt-detail-back"
                aria-label="返回任务列表"
                onClick={() => setDetailTaskId(null)}
              >
                <ChevronLeft aria-hidden="true" />
              </button>
              <span className="tt-detail-head-title">任务</span>
              <button
                type="button"
                className="tt-detail-done"
                onClick={() => {
                  setTaskCompleted(detailTask, !detailTask.isCompleted);
                  setDetailTaskId(null);
                }}
              >
                完成
              </button>
            </header>
            <div className="tt-detail-parent">
              <span className="tt-detail-parent-name">
                {listTitle(detailTask.projectId, projects)}
              </span>
              {onMoveTask ? (
                <select
                  className="tt-detail-move"
                  aria-label="移动到清单"
                  value={detailTask.projectId ?? ''}
                  disabled={editBusy}
                  onChange={(event) => {
                    const next = event.target.value || null;
                    if (next === null) return;
                    moveDetailTask(next);
                  }}
                >
                  <option value="" disabled>
                    移动
                  </option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
            <div className="tt-detail-date">
              <button
                type="button"
                key={detailTask.isCompleted ? 'done' : 'open'}
                className="tt-check tt-check-lg"
                data-tone={priorityTone(detailTask.priority)}
                data-checked={detailTask.isCompleted}
                aria-label={detailTask.isCompleted ? '取消完成' : '完成任务'}
                onClick={() => setTaskCompleted(detailTask, !detailTask.isCompleted)}
              >
                {detailTask.isCompleted ? (
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path
                      d="M4.5 10.5 8 14l7.5-8"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : null}
              </button>
              <span className="tt-detail-date-copy">
                <span
                  className="tt-detail-date-main"
                  data-overdue={dueLabel(detailTask, now)?.overdue ?? false}
                >
                  {dueLabel(detailTask, now)?.text ?? '无日期'}
                  {dueLabel(detailTask, now)?.overdue ? '，已延期' : ''}
                </span>
                <span className="tt-detail-date-sub">
                  {pendingLocalCount > 0 ? '本机已保存 · 待同步' : '本机已保存'}
                </span>
              </span>
            </div>
            <input
              className="tt-detail-title-input"
              aria-label="任务标题"
              value={editTitle}
              disabled={editBusy}
              onChange={(event) => setEditTitle(event.target.value)}
              onBlur={() => {
                const next = editTitle.trim();
                if (next && next !== detailTask.title) applyPatch({ title: next });
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
            />
            {editError ? (
              <p className="tt-detail-error" role="alert">
                {editError}
              </p>
            ) : null}
            {rowErrors[detailTask.id] ? (
              <p className="tt-detail-error" role="alert">
                {rowErrors[detailTask.id]}
              </p>
            ) : null}
            <div className="tt-detail-chips" role="group" aria-label="优先级">
              {[
                { value: null, label: '无' },
                { value: 1, label: '低' },
                { value: 2, label: '中' },
                { value: 3, label: '高' },
              ].map((option) => (
                <button
                  key={option.label}
                  type="button"
                  className="tt-chip"
                  data-active={(detailTask.priority ?? null) === option.value}
                  disabled={editBusy}
                  onClick={() => applyPatch({ priority: option.value })}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="tt-detail-chips" role="group" aria-label="截止日期">
              {[
                { value: null, label: '无日期' },
                { value: startOfDay(now) + DAY_MS - 1, label: '今天' },
                { value: startOfDay(now) + 2 * DAY_MS - 1, label: '明天' },
              ].map((option) => (
                <button
                  key={option.label}
                  type="button"
                  className="tt-chip"
                  data-active={
                    option.value === null
                      ? detailTask.dueDate === null
                      : detailTask.dueDate !== null &&
                        startOfDay(detailTask.dueDate) === startOfDay(option.value)
                  }
                  disabled={editBusy}
                  onClick={() => applyPatch({ dueDate: option.value })}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <input
              className="tt-detail-tags-input"
              aria-label="标签，空格分隔"
              placeholder="标签（空格分隔）"
              value={editTags}
              disabled={editBusy}
              onChange={(event) => setEditTags(event.target.value)}
              onBlur={() => {
                const next = editTags
                  .split(/\s+/)
                  .map((tag) => tag.trim())
                  .filter(Boolean);
                if (next.join(' ') !== detailTask.tags.join(' ')) applyPatch({ tags: next });
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
            />
            <button
              type="button"
              className="tt-detail-delete"
              data-confirm={confirmDelete}
              disabled={editBusy || !onDeleteTask}
              onClick={handleDelete}
            >
              {confirmDelete ? '确认删除（含子任务）' : '删除任务'}
            </button>
            {detailChildren.length > 0 ? (
              <ul className="tt-detail-subtasks">
                {detailChildren.map((child) => (
                  <li key={child.id}>
                    <button
                      type="button"
                      className="tt-check"
                      data-tone={priorityTone(child.priority)}
                      data-checked={child.isCompleted}
                      data-pending={completionStates?.[child.id] === 'pending'}
                      aria-busy={completionStates?.[child.id] === 'pending'}
                      aria-label={
                        child.isCompleted ? `取消完成 ${child.title}` : `完成 ${child.title}`
                      }
                      onClick={() => setTaskCompleted(child, !child.isCompleted)}
                    />
                    <span className="tt-detail-subtask-title">{child.title}</span>
                    <span
                      className="tt-row-due"
                      data-overdue={dueLabel(child, now)?.overdue ?? false}
                    >
                      {dueLabel(child, now)?.text ?? ''}
                    </span>
                    {rowErrors[child.id] ? (
                      <span className="tt-subtask-error" role="alert">
                        {rowErrors[child.id]}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {onCreateSubtask ? (
              <div className="tt-subtask">
                <input
                  className="tt-subtask-input"
                  aria-label="子任务标题"
                  placeholder="添加子任务"
                  value={subtaskDraft}
                  disabled={subtaskBusy}
                  onChange={(event) => setSubtaskDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') addSubtask();
                  }}
                />
                <button
                  type="button"
                  className="tt-subtask-add"
                  disabled={subtaskBusy || subtaskDraft.trim() === ''}
                  onClick={addSubtask}
                >
                  {subtaskBusy ? '添加中…' : '添加'}
                </button>
              </div>
            ) : null}
            {subtaskError ? (
              <p className="tt-subtask-error" role="alert">
                {subtaskError}
              </p>
            ) : null}
            <footer className="tt-detail-foot">
              <button
                type="button"
                className="tt-detail-start"
                disabled={!canStart}
                onClick={() => {
                  onStart(detailTask);
                  setDetailTaskId(null);
                }}
              >
                开始专注
              </button>
            </footer>
          </article>
        </div>
      ) : null}

      {selectedTaskId ? <span className="tt-selected" aria-hidden="true" /> : null}
    </section>
  );
}
