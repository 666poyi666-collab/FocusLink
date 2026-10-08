import type { FocusSegment, FocusSession, PauseEvent } from './types';
import type { SessionAnalyticsSource } from './sessionAnalytics';

/**
 * 片段 → 分类 key。
 * 必须与 buildSessionAnalytics 里 tasks[].key 的算法完全同源：这里保留唯一实现，
 * sessionAnalytics.ts 反过来引用它，避免「统计页分类筛选」和「tasks 聚合」两处算法漂移。
 */
export function segmentTaskKey(segment: FocusSegment): string {
  return segment.taskId
    ? `${segment.taskSource ?? 'unknown'}:${segment.taskId}`
    : `unlinked:${segment.title?.trim() || '未关联任务'}`;
}

/**
 * 按分类 key 收窄 analytics 输入。
 * taskKey 为 null 表示「全部分类」，直接原样返回同一引用，调用方可以据此跳过拷贝。
 */
export function scopeAnalyticsSource(
  source: SessionAnalyticsSource,
  taskKey: string | null,
): SessionAnalyticsSource {
  if (taskKey === null) return source;

  // 片段是分类的唯一定义来源：先按 key 命中片段，再据此决定会话与暂停的取舍。
  const segments = source.segments.filter((segment) => segmentTaskKey(segment) === taskKey);
  const keptSegmentIds = new Set(segments.map((segment) => segment.id));
  const keptSessionIds = new Set(segments.map((segment) => segment.sessionId));

  // 没有任何命中片段的会话不属于任何可点击分类（例如旧的纯会话记录），整体丢弃。
  const sessions: FocusSession[] = source.sessions.filter((session) =>
    keptSessionIds.has(session.id),
  );

  // 暂停归属：显式 segmentId 直接跟随该片段；空 segmentId 的旧暂停按「同会话中在它之前
  // 最后一条被保留片段」补齐。先按会话归组并按 startedAt 升序，归属结果才与片段顺序一致。
  const keptSegmentsBySession = new Map<string, FocusSegment[]>();
  for (const segment of segments) {
    const list = keptSegmentsBySession.get(segment.sessionId) ?? [];
    list.push(segment);
    keptSegmentsBySession.set(segment.sessionId, list);
  }
  for (const list of keptSegmentsBySession.values()) {
    list.sort((left, right) => left.startedAt - right.startedAt);
  }

  const pauses: PauseEvent[] = source.pauses.filter((pause) => {
    // 空字符串按「未关联片段」处理，与 segmentId 为 null 的旧数据走同一条归属规则。
    if (pause.segmentId) return keptSegmentIds.has(pause.segmentId);
    const candidates = keptSegmentsBySession.get(pause.sessionId);
    if (!candidates) return false;
    // 列表已按 startedAt 升序，从后往前第一个满足 startedAt <= 暂停开始时刻的即为归属片段。
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      if (candidates[index].startedAt <= pause.pauseStartedAt) return true;
    }
    return false;
  });

  return { sessions, segments, pauses };
}
