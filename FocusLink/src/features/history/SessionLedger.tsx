import { useEffect, useState } from 'react';
import type { FocusSession } from '@shared/types';
import type { SessionDetail } from '@shared/ipc/api';
import { formatClock, formatDuration, formatMinutes } from '../../lib/time';

interface Props {
  sessions: FocusSession[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onLink: (session: FocusSession, segmentId?: string) => void;
  reloadToken: number;
  notify: (message: string) => void;
  filterLabel?: string;
  onResetFilter: () => void;
}

export function SessionLedger({
  sessions,
  selectedId,
  onSelect,
  onLink,
  reloadToken,
  notify,
  filterLabel,
  onResetFilter,
}: Props) {
  const selected = sessions.find((session) => session.id === selectedId) ?? sessions[0];
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
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
  const total = rows.reduce((sum, row) => sum + Math.max(0, row.ms), 0);
  const titleOf = (session: FocusSession) =>
    session.title || session.defaultTaskTitle || '专注会话';
  const linkedLabel = (session: FocusSession) =>
    session.defaultTaskId || session.defaultTaskTitle
      ? `已关联 · ${session.defaultTaskTitle || '任务'}`
      : (session.linkedSegmentCount ?? 0) > 0
        ? '片段已关联'
        : '未关联';
  const clockOf = (session: FocusSession) =>
    `${formatClock(session.startedAt)} – ${session.endedAt ? formatClock(session.endedAt) : '进行中'}`;
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

  return (
    <aside className="detail-pane" aria-label="会话时间账本">
      <div className="detail-head-bar">
        <div className="detail-head-title">会话时间账本</div>
        <span id="sessionBadgeCount">{sessions.length} 条记录</span>
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
        {!sessions.length && (
          <div className="ledger-empty">
            没有符合条件的会话
            <br />
            <span>调整日期、分类或搜索条件后再查看。</span>
          </div>
        )}
        {sessions.map((session) => (
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
                  {new Date(session.startedAt).toLocaleDateString('zh-CN', {
                    month: 'numeric',
                    day: 'numeric',
                  })}{' '}
                  · {clockOf(session)}
                </span>
                <span className="sc-dur">{formatMinutes(session.activeElapsedMs)}</span>
              </span>
              <span className="sc-title" title={titleOf(session)}>
                {titleOf(session)}
              </span>
              <span className="sc-meta">{linkedLabel(session)}</span>
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
        ))}
      </div>
      {selected && (
        <section className="card-widget deep-dive-box" id="deepDiveBox" aria-busy={loading}>
          <div className="dd-head">
            <h4 id="ddTitle">{titleOf(selected)}</h4>
            <p id="ddMeta">
              {clockOf(selected)} · 总历时 {formatDuration(selected.wallElapsedMs)}
            </p>
          </div>
          <div className="ledger-totals">
            <span>
              专注 <strong>{formatMinutes(selected.activeElapsedMs)}</strong>
            </span>
            <span>
              暂停 <strong>{formatMinutes(selected.pauseElapsedMs)}</strong>
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
                  {rows
                    .filter((row) => row.ms > 0)
                    .map((row) => (
                      <div
                        key={row.id}
                        className={row.kind === 'focus' ? 'hf-seg-focus' : 'hf-seg-pause'}
                        style={{ flex: Math.max(0, row.ms) / (total || 1) }}
                        title={`${row.title} · ${formatMinutes(row.ms)}`}
                      />
                    ))}
                </div>
              </div>
              <div>
                <h5>片段与暂停</h5>
                <div className="segment-mini-list" id="ddSegmentList">
                  {!rows.length && <p className="ledger-empty">旧记录没有可还原的片段明细。</p>}
                  {rows.map((row) => (
                    <div className="seg-mini-row" key={row.id}>
                      <div className="seg-row-top">
                        <div className="seg-name-wrap">
                          <span className={`seg-dot ${row.kind}`} />
                          <span className="seg-name-txt" title={row.title}>
                            {row.title}
                          </span>
                        </div>
                        <span className="seg-dur-txt">{formatMinutes(row.ms)}</span>
                      </div>
                      <div className="seg-time-sub">
                        {formatClock(row.start)} – {row.end ? formatClock(row.end) : '进行中'}
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
            <button
              type="button"
              className="btn-tool"
              onClick={() => {
                void copyRecord();
              }}
            >
              复制记录
            </button>
          </div>
        </section>
      )}
    </aside>
  );
}
