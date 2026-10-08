import { useEffect, useState } from 'react';
import type { FocusSession } from '@shared/types';
import type { SessionDetail } from '@shared/ipc/api';
import { formatDuration, formatMinutes } from '../../lib/time';
import { formatLedgerClock, formatLedgerSpan } from './ledgerTimeFormat';
import { ConfirmDialog } from '../../ui/ConfirmDialog';

interface Props {
  sessions: FocusSession[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onLink: (session: FocusSession, segmentId?: string) => void;
  /** 删除成功后由页面层刷新账本读数并清理选中态 */
  onDeleted: (sessionId: string) => void;
  reloadToken: number;
  notify: (message: string) => void;
  filterLabel?: string;
  onResetFilter: () => void;
  /** 当前统计范围：卡片与深潜区读数都按它裁切（v1.6.0 数据对齐） */
  range: { start: number; end: number };
  /** 每个会话在当前范围内真正发生的专注时长（analytics.sessionActive，按片段精确裁切） */
  clippedActiveBySession?: Readonly<Record<string, number>>;
}

/* 片段/暂停落在 [rangeStart, rangeEnd) 内真正发生的毫秒数。
   完全落在范围内时原样返回（不做比例换算，避免取整漂移）；
   部分重叠时按墙钟重叠比例折算 —— 片段只存起止时间，没有逐秒分布，
   比例折算是唯一能给出的口径，且与 shared 层 legacy 摊分同源。 */
function scopedMs(
  ms: number,
  start: number,
  end: number,
  rangeStart: number,
  rangeEnd: number,
): number {
  const span = end - start;
  if (span <= 0) return ms;
  const overlap = Math.min(end, rangeEnd) - Math.max(start, rangeStart);
  if (overlap <= 0) return 0;
  if (overlap >= span) return ms;
  return Math.round((ms * overlap) / span);
}

export function SessionLedger({
  sessions,
  selectedId,
  onSelect,
  onLink,
  onDeleted,
  reloadToken,
  notify,
  filterLabel,
  onResetFilter,
  range,
  clippedActiveBySession,
}: Props) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  /* v1.5.5：删除入口在 v1.3.15 被整段删掉后再没恢复（见 IMPLEMENTATION_LOG
     FL-UI-20261004-STATS-DELETE）。本组件自己记住刚删掉的会话 id，让列表与读数
     立刻收敛，不必等 analytics 重新取数回来。 */
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<FocusSession | null>(null);
  const [deleting, setDeleting] = useState(false);
  const visibleSessions = removedIds.length
    ? sessions.filter((session) => !removedIds.includes(session.id))
    : sessions;
  const selected =
    visibleSessions.find((session) => session.id === selectedId) ?? visibleSessions[0];
  const selectedSessionId = selected?.id;
  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    if (!selectedSessionId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void window.focuslink.sessions
      .get(selectedSessionId)
      .then((result) => {
        if (!cancelled) {
          setDetail(result);
          if (!result) setError('这条会话已不存在，请刷新统计。');
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '读取会话失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSessionId, reloadToken, retry]);

  const current = detail?.session.id === selected?.id ? detail : null;
  const rows = current
    ? [
        ...current.segments.map((segment, index) => ({
          id: segment.id,
          kind: 'focus',
          title: segment.title || `专注片段 ${index + 1}`,
          start: segment.startedAt,
          end: segment.endedAt,
          ms: segment.activeElapsedMs,
          linked: Boolean(segment.taskId),
        })),
        ...current.pauses.map((pause) => ({
          id: pause.id,
          kind: 'pause',
          title: pause.reason || '暂停',
          start: pause.pauseStartedAt,
          end: pause.pauseEndedAt,
          ms: pause.durationMs,
          linked: false,
        })),
      ].sort((a, b) => a.start - b.start)
    : [];
  /* v1.6.0 数据对齐：跨午夜会话在「今天」视图里，卡片与深潜区原本显示的是**整段**
     时长（10/06 22:00 → 10/07 08:00 的会话在 10/07 卡片上写 41 分钟，而当天贡献
     0 分钟），与页头/卡贴按范围裁切后的 totals 对不上。现在统一按当前范围裁切，
     并把整段值作为小字注脚保留，用户两边都能看到。 */
  const scopedRows = rows.map((row) => ({
    ...row,
    scopedMs: scopedMs(row.ms, row.start, row.end ?? range.end, range.start, range.end),
  }));
  const shownRows = scopedRows.filter((row) => row.scopedMs > 0);
  const total = shownRows.reduce((sum, row) => sum + Math.max(0, row.scopedMs), 0);
  const rowsClipped =
    shownRows.length !== rows.length || shownRows.some((row) => row.scopedMs !== row.ms);
  const selectedClippedActiveMs =
    selected && clippedActiveBySession?.[selected.id] !== undefined
      ? clippedActiveBySession[selected.id]
      : (selected?.activeElapsedMs ?? 0);
  const selectedClippedPauseMs = current
    ? current.pauses.reduce(
        (sum, pause) =>
          sum +
          scopedMs(
            pause.durationMs,
            pause.pauseStartedAt,
            pause.pauseEndedAt ?? range.end,
            range.start,
            range.end,
          ),
        0,
      )
    : (selected?.pauseElapsedMs ?? 0);
  const sessionScoped = Boolean(
    selected &&
    (selectedClippedActiveMs !== selected.activeElapsedMs ||
      (current !== null && selectedClippedPauseMs !== selected.pauseElapsedMs)),
  );
  const titleOf = (session: FocusSession) =>
    session.title || session.defaultTaskTitle || '专注会话';
  const linkedLabel = (session: FocusSession) =>
    session.defaultTaskId || session.defaultTaskTitle
      ? `已关联 · ${session.defaultTaskTitle || '任务'}`
      : (session.linkedSegmentCount ?? 0) > 0
        ? '片段已关联'
        : '未关联';
  const copyRecord = async () => {
    if (!selected) return;
    try {
      const text = await window.focuslink.sessions.export(selected.id, 'markdown');
      await navigator.clipboard.writeText(text);
      notify('会话记录已复制');
    } catch (cause) {
      notify(`复制失败：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };
  /* 进行中的会话由主进程拒绝删除（ipc.ts sessions:delete）。这里直接给出同一条
     规则，避免让用户点一次必然失败的按钮。 */
  const sessionInProgress = Boolean(selected && !selected.endedAt);
  const performDelete = async () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    setDeleting(true);
    try {
      await window.focuslink.sessions.delete(target.id);
      setRemovedIds((ids) => (ids.includes(target.id) ? ids : [...ids, target.id]));
      setDetail(null);
      notify('会话记录已删除');
      onDeleted(target.id);
    } catch (cause) {
      notify(`删除失败：${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <aside className="detail-pane" aria-label="会话时间账本">
      <div className="detail-head-bar">
        <div className="detail-head-title">会话时间账本</div>
        <span id="sessionBadgeCount">{visibleSessions.length} 条记录</span>
      </div>
      {filterLabel && (
        <div className="ledger-filter">
          筛选：{filterLabel}
          <button type="button" className="sc-link-btn" onClick={onResetFilter}>
            清除筛选
          </button>
        </div>
      )}
      <div className="session-card-stream" id="sessionCardStream" aria-label="会话列表">
        {!visibleSessions.length && (
          <div className="ledger-empty">
            没有符合条件的会话
            <br />
            <span>调整日期、分类或搜索条件后再查看。</span>
          </div>
        )}
        {visibleSessions.map((session) => {
          const clippedActive = clippedActiveBySession?.[session.id];
          const cardActiveMs =
            clippedActive === undefined ? session.activeElapsedMs : clippedActive;
          const cardClipped = cardActiveMs !== session.activeElapsedMs;
          return (
            <div
              key={session.id}
              className={`session-card ${selected?.id === session.id ? 'active' : ''}`}
            >
              <button
                type="button"
                className="session-select"
                aria-pressed={selected?.id === session.id}
                onClick={() => onSelect(session.id)}
              >
                <span className="sc-top">
                  <span className="sc-time-pill">
                    {formatLedgerClock(session.startedAt, session.endedAt)}
                  </span>
                  <span
                    className="sc-dur"
                    title={
                      cardClipped
                        ? `当前范围 ${formatMinutes(cardActiveMs)} · 整段 ${formatMinutes(session.activeElapsedMs)}`
                        : undefined
                    }
                  >
                    {formatMinutes(cardActiveMs)}
                  </span>
                </span>
                <span className="sc-title" title={titleOf(session)}>
                  {titleOf(session)}
                </span>
                <span className="sc-meta">
                  {linkedLabel(session)}
                  {cardClipped && (
                    <span className="sc-scope-note">
                      {' '}
                      · 整段 {formatMinutes(session.activeElapsedMs)}
                    </span>
                  )}
                </span>
              </button>
              <button
                type="button"
                className="sc-link-btn"
                onClick={(event) => {
                  event.currentTarget.focus();
                  onLink(session);
                }}
              >
                {session.defaultTaskId || session.defaultTaskTitle ? '更换任务' : '关联任务'}
              </button>
            </div>
          );
        })}
      </div>
      {selected && (
        <section className="card-widget deep-dive-box" id="deepDiveBox" aria-busy={loading}>
          <div className="dd-head">
            <h4 id="ddTitle">{titleOf(selected)}</h4>
            <p id="ddMeta">
              {formatLedgerClock(selected.startedAt, selected.endedAt)} · 总历时
              {formatDuration(selected.wallElapsedMs)}
            </p>
            {sessionScoped && (
              <p className="dd-scope-note" id="ddScopeNote">
                当前范围之外的时长不计入统计 · 整段 专注 {formatMinutes(selected.activeElapsedMs)}
                {' / '}暂停 {formatMinutes(selected.pauseElapsedMs)}
              </p>
            )}
          </div>
          <div className="ledger-totals">
            <span title={sessionScoped ? '当前范围内发生的专注时长' : undefined}>
              专注 <strong>{formatMinutes(selectedClippedActiveMs)}</strong>
            </span>
            <span title={sessionScoped ? '当前范围内发生的暂停时长' : undefined}>
              暂停 <strong>{formatMinutes(selectedClippedPauseMs)}</strong>
            </span>
          </div>
          {loading && <p role="status">正在读取片段…</p>}
          {error && (
            <div role="alert">
              {error}
              <button
                type="button"
                className="btn-tool"
                onClick={() => setRetry((value) => value + 1)}
              >
                重试
              </button>
            </div>
          )}
          {current && (
            <>
              <div>
                <h5>会话时序</h5>
                <div className="horiz-flow-track" id="ddTrack" aria-label="专注与暂停时长分布">
                  {shownRows.map((row) => (
                    <div
                      key={row.id}
                      className={row.kind === 'focus' ? 'hf-seg-focus' : 'hf-seg-pause'}
                      style={{ flex: Math.max(0, row.scopedMs) / (total || 1) }}
                      title={`${row.title} · ${formatMinutes(row.scopedMs)}`}
                    />
                  ))}
                </div>
              </div>
              <div>
                <h5>
                  片段与暂停
                  {rowsClipped && <span className="seg-scope-note"> 已按当前范围裁切</span>}
                </h5>
                <div className="segment-mini-list" id="ddSegmentList">
                  {!rows.length && <p className="ledger-empty">旧记录没有可还原的片段明细。</p>}
                  {Boolean(rows.length) && !shownRows.length && (
                    <p className="ledger-empty">这条会话在当前范围内没有片段或暂停。</p>
                  )}
                  {shownRows.map((row) => (
                    <div className="seg-mini-row" key={row.id}>
                      <div className="seg-row-top">
                        <div className="seg-name-wrap">
                          <span className={`seg-dot ${row.kind}`} />
                          <span className="seg-name-txt" title={row.title}>
                            {row.title}
                          </span>
                        </div>
                        <span className="seg-dur-txt">{formatMinutes(row.scopedMs)}</span>
                      </div>
                      <div className="seg-time-sub">
                        {formatLedgerSpan(row.start, row.end, selected.startedAt)}
                      </div>
                      {row.kind === 'focus' && (
                        <button
                          type="button"
                          className="sc-link-btn"
                          onClick={(event) => {
                            event.currentTarget.focus();
                            onLink(selected, row.id);
                          }}
                        >
                          {row.linked ? '更换任务' : '关联片段'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
          <div className="ledger-actions">
            <span id="ddProjectLabel">{linkedLabel(selected)}</span>
            <div className="ledger-action-buttons">
              <button
                type="button"
                className="btn-tool"
                onClick={() => {
                  void copyRecord();
                }}
              >
                复制记录
              </button>
              {/* v1.5.5 恢复：v1.3.15 重写统计页时删掉了记录删除入口，此后第三栏
                  只能看、只能关联，无法删除。删除确认必须走应用内 alertdialog
                  （FRONTEND_SPEC 第 8 节），不得退回原生 confirm。 */}
              <button
                type="button"
                className="btn-tool ledger-delete-btn"
                title={sessionInProgress ? '进行中的专注结束后才能删除' : '删除记录'}
                aria-label="删除记录"
                disabled={sessionInProgress || deleting}
                onClick={(event) => {
                  event.currentTarget.focus();
                  setDeleteTarget(selected);
                }}
              >
                删除记录
              </button>
            </div>
          </div>
        </section>
      )}
      {/* 删除确认按 FRONTEND_SPEC 第 8 节：portal 顶层 alertdialog、危险主按钮、
          默认聚焦「取消」；正文点明会话时间、有效专注与两类后果。 */}
      <ConfirmDialog
        open={deleteTarget !== null}
        danger
        title="删除记录"
        description={
          deleteTarget
            ? `${titleOf(deleteTarget)}\n${new Date(deleteTarget.startedAt).toLocaleString('zh-CN')} 开始 · 有效专注 ${formatMinutes(deleteTarget.activeElapsedMs)}\n删除后 FocusLink 本地记录永久删除；番茄 To-do 只清理本机记录，不代表远端记录已验证删除。此操作不可撤销。`
            : undefined
        }
        confirmLabel="删除记录"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          void performDelete();
        }}
      />
    </aside>
  );
}
