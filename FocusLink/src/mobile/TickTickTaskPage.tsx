import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { ChevronLeft, ChevronRight, ListTree, MoreVertical, Plus } from 'lucide-react';
import type { SyncedTask, SyncedTaskProject } from '@shared/sync/taskSnapshotProtocol';
import {
  ALL_PROJECTS,
  filterSyncedTaskForest,
  groupSyncedTaskForest,
  type SyncedTaskGroup,
  type SyncedTaskTreeNode,
} from './taskBrowserModel';

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
  onToggleComplete?: (task: SyncedTask) => Promise<void>;
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

interface RowProps {
  node: SyncedTaskTreeNode;
  depth: number;
  collapsed: boolean;
  onToggleCollapse: (id: string) => void;
  onOpen: (task: SyncedTask) => void;
  onComplete: (task: SyncedTask) => void;
  onMoveRequest: (task: SyncedTask) => void;
  now: number;
}

/** 滴答清单式滑动：右滑完成、左滑移到清单；纵向滑动仍然交还给页面滚动。 */
function TaskRow({
  node,
  depth,
  collapsed,
  onToggleCollapse,
  onOpen,
  onComplete,
  onMoveRequest,
  now,
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

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      active: true,
      horizontal: false,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag?.active) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
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
    const drag = dragRef.current;
    dragRef.current = null;
    const value = offset;
    setOffset(0);
    if (!drag?.horizontal) return;
    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 260);
    if (value >= 72) onComplete(node);
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
        data-completed={node.isCompleted}
        style={offset === 0 ? undefined : { transform: `translateX(${offset}px)` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishGesture}
        onPointerCancel={finishGesture}
      >
        <button
          type="button"
          className="tt-check"
          data-tone={tone}
          data-checked={node.isCompleted}
          aria-label={node.isCompleted ? `取消完成 ${node.title}` : `完成 ${node.title}`}
          onClick={() => onComplete(node)}
        >
          {node.isCompleted ? (
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
        <button
          type="button"
          className="tt-row-main"
          onClick={() => {
            if (suppressClickRef.current) return;
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
        {due ? (
          <span className="tt-row-due" data-overdue={due.overdue}>
            {due.text}
          </span>
        ) : null}
        {hasChildren ? (
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

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const groups = useMemo<SyncedTaskGroup[]>(
    () =>
      groupSyncedTaskForest(
        filterSyncedTaskForest(tasks, '', ALL_PROJECTS, showCompleted ? 'completed' : 'open'),
        projects,
      ),
    [projects, showCompleted, tasks],
  );
  const activeGroups = useMemo(
    () =>
      projectFilter === ALL_PROJECTS
        ? groups
        : groups.filter((group) => group.projectId === projectFilter),
    [groups, projectFilter],
  );
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

  const handleComplete = (task: SyncedTask) => {
    if (!onToggleComplete || busy) return;
    setBusy(true);
    setError(null);
    void onToggleComplete(task)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      )
      .finally(() => setBusy(false));
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

  const renderNodes = (nodes: readonly SyncedTaskTreeNode[], depth: number): ReactNode =>
    nodes.map((node) => (
      <div key={node.id} className="tt-node">
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
            onComplete={handleComplete}
            onMoveRequest={(task) => setMoveTaskId(task.id)}
            now={now}
          />
        </ul>
        {node.children.length > 0 && !collapsed.has(node.id)
          ? renderNodes(node.children, depth + 1)
          : null}
      </div>
    ));

  return (
    <section className="tt-page" aria-label="任务">
      <header className="tt-appbar">
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
      </header>

      <div className="tt-sheet">
        {activeGroups.length === 0 ? (
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

      <button type="button" className="tt-fab" aria-label="新建任务" onClick={openComposer}>
        <Plus aria-hidden="true" />
      </button>

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
                    className="tt-composer-submit"
                    disabled={busy || draft.trim() === ''}
                    onClick={submitTask}
                  >
                    添加
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
                    className="tt-composer-submit"
                    disabled={busy || projectDraft.trim() === ''}
                    onClick={submitProject}
                  >
                    创建
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
            <p className="tt-menu-meta">移动到清单</p>
            {projects.map((project) => (
              <button
                type="button"
                key={project.id}
                onClick={() => {
                  const target = tasks.find((task) => task.id === moveTaskId);
                  if (target && onMoveTask) void onMoveTask(target, project.id);
                  setMoveTaskId(null);
                }}
              >
                {project.name}
              </button>
            ))}
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
                  handleComplete(detailTask);
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
                  onChange={(event) => {
                    const next = event.target.value || null;
                    if (next === null) return;
                    void onMoveTask(detailTask, next);
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
                className="tt-check tt-check-lg"
                data-tone={priorityTone(detailTask.priority)}
                data-checked={detailTask.isCompleted}
                aria-label={detailTask.isCompleted ? '取消完成' : '完成任务'}
                onClick={() => handleComplete(detailTask)}
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
            <h2 className="tt-detail-title">{detailTask.title}</h2>
            {detailTask.tags.length > 0 ? (
              <p className="tt-detail-tags">
                {detailTask.tags.map((tag) => (
                  <span key={tag}>#{tag}</span>
                ))}
              </p>
            ) : null}
            {detailChildren.length > 0 ? (
              <ul className="tt-detail-subtasks">
                {detailChildren.map((child) => (
                  <li key={child.id}>
                    <button
                      type="button"
                      className="tt-check"
                      data-tone={priorityTone(child.priority)}
                      data-checked={child.isCompleted}
                      aria-label={
                        child.isCompleted ? `取消完成 ${child.title}` : `完成 ${child.title}`
                      }
                      onClick={() => handleComplete(child)}
                    />
                    <span className="tt-detail-subtask-title">{child.title}</span>
                    <span
                      className="tt-row-due"
                      data-overdue={dueLabel(child, now)?.overdue ?? false}
                    >
                      {dueLabel(child, now)?.text ?? ''}
                    </span>
                  </li>
                ))}
              </ul>
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
