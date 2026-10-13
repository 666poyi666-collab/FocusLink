// Tomatodo sync policy helpers (pure functions, no IO side effects)

import type { FocusSegment, TomatodoSubject } from './types';

export const TOMATODO_SUBJECTS: readonly TomatodoSubject[] = [
  '语文',
  '数学',
  '英语',
  '物理',
  '化学',
  '生物',
];

export const TOMATODO_FALLBACK_SUBJECT: TomatodoSubject = '学习';
/** 标记由 v0.5.3+ 云同步链路管理的记录，避免新配置重复执行旧数据修复。 */
export const TOMATODO_CLOUD_V053_MARKER = '[FocusLink:tomatodo:cloud-v053]';
/** 番茄 To-do 的专注云接口只接受最近 7 天的记录。 */
export const TOMATODO_CLOUD_UPLOAD_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
export const ALL_SUBJECTS: readonly TomatodoSubject[] = [...TOMATODO_SUBJECTS, '学习'];
/**
 * 自定义记录标题的长度上限。番茄 To-do 的 PCRecord.name 是它列表里直接显示的单行短文本，
 * 超长标题会挤坏它的排版；这里在写入前截断，而不是让外部库去处理任意长度的字符串。
 */
export const TOMATODO_RECORD_NAME_MAX_LENGTH = 40;
/**
 * 番茄 To-do 的 PCRecord.time 是整数分钟，且它在列表里按截断显示。真值写成小数会让
 * 「番茄显示 7 分钟、FocusLink 显示 8 分钟」这种同一条记录两个数打架，所以先取整再写。
 * 不足 1 分钟的会话没有可表达的时长，按 1 分钟记录，避免写出 0 分钟的空记录。
 */
export const TOMATODO_MIN_RECORD_MINUTES = 1;
export const TOMATODO_SUBJECT_OPTIONS = [
  { value: '语文', shortLabel: '语' },
  { value: '数学', shortLabel: '数' },
  { value: '英语', shortLabel: '英' },
  { value: '物理', shortLabel: '物' },
  { value: '化学', shortLabel: '化' },
  { value: '生物', shortLabel: '生' },
  { value: '学习', shortLabel: '学' },
] as const satisfies ReadonlyArray<{ value: TomatodoSubject; shortLabel: string }>;

/**
 * 可用于首次自动归类的文本。调用方通常按「片段标题、任务标题、任务正文、标签」的
 * 顺序传入；第一个命中学科的文本优先，避免正文中的偶发词覆盖任务标题。
 */
export type TomatodoSubjectCandidateText = string | null | undefined;

export function isTomatodoCloudUploadEligible(recordCreatedAt: number, now = Date.now()): boolean {
  return (
    Number.isFinite(recordCreatedAt) &&
    Number.isFinite(now) &&
    recordCreatedAt >= now - TOMATODO_CLOUD_UPLOAD_WINDOW_MS
  );
}

interface SubjectKeywordRule {
  subject: Exclude<TomatodoSubject, '学习'>;
  /** 明确的学科名或英文别名，优先于同一文本中的一般关键词。 */
  aliases: readonly string[];
  /** 尽量使用学科特有词，避免「阅读」「实验」等跨学科泛词误判。 */
  keywords: readonly string[];
}

/**
 * 中学常见学科词。这里刻意不把「阅读」「实验」「题目」等泛词作为触发条件：
 * 自动结果只在有足够把握时给出，其他情况交给兜底「学习」和手动修正。
 */
const SUBJECT_KEYWORD_RULES: readonly SubjectKeywordRule[] = [
  {
    subject: '语文',
    aliases: ['语文', '国文', '汉语', '汉语言', 'chinese'],
    keywords: [
      '文言文',
      '古诗文',
      '古诗词',
      '现代文',
      '名著阅读',
      '诗歌鉴赏',
      '作文',
      '写作',
      '病句',
      '修辞',
      '字音',
      '字形',
      '成语',
    ],
  },
  {
    subject: '数学',
    aliases: ['数学', 'maths', 'math'],
    keywords: [
      '三角函数',
      '圆锥曲线',
      '立体几何',
      '解析几何',
      '排列组合',
      '因式分解',
      '不等式',
      '函数',
      '方程',
      '数列',
      '集合',
      '几何',
      '代数',
      '概率',
      '统计',
      '三角',
      '向量',
      '导数',
      '分式',
    ],
  },
  {
    subject: '英语',
    aliases: ['英语', '英文', 'english'],
    keywords: [
      '完形填空',
      '语法填空',
      '英语语法',
      '英文语法',
      '英语阅读',
      '英文阅读',
      '听力',
      '口语',
      '单词',
      '词汇',
      '短语',
      '音标',
      '翻译',
    ],
  },
  {
    subject: '物理',
    aliases: ['物理', 'physics'],
    keywords: [
      '力学',
      '电学',
      '光学',
      '声学',
      '热学',
      '电路',
      '电磁',
      '浮力',
      '压强',
      '功率',
      '加速度',
      '牛顿',
      '动量',
      '机械能',
      '电势',
      '电阻',
      '欧姆',
      '透镜',
      '波动',
    ],
  },
  {
    subject: '化学',
    aliases: ['化学', '化學', 'chemistry'],
    keywords: [
      '化学方程式',
      '化学式',
      '氧化还原',
      '化合价',
      '电解质',
      '金属活动性',
      '元素',
      '原子',
      '分子',
      '离子',
      '酸碱',
      '有机',
      '无机',
      '摩尔',
      '溶液',
      '配平',
      '沉淀',
      '滴定',
    ],
  },
  {
    subject: '生物',
    aliases: ['生物', 'biology'],
    keywords: [
      '光合作用',
      '呼吸作用',
      '生态系统',
      '染色体',
      '微生物',
      '细胞',
      '遗传',
      '基因',
      'dna',
      'rna',
      '生态',
      '种群',
      '群落',
      '植物',
      '动物',
      '人体',
      '免疫',
      '进化',
      '生殖',
      '神经',
      '蛋白质',
      '酶',
    ],
  },
];

export function isTomatodoSubject(subject: string | null | undefined): subject is TomatodoSubject {
  return !!subject && (ALL_SUBJECTS as readonly string[]).includes(subject);
}

export function normalizeSubject(subject: string | null | undefined): TomatodoSubject {
  // 本次迁移前的持久化值使用“杂”；读取时无损迁移到新的默认“学习”。
  if (subject === '杂') return TOMATODO_FALLBACK_SUBJECT;
  return isTomatodoSubject(subject) ? subject : TOMATODO_FALLBACK_SUBJECT;
}

/**
 * 归一化用户在 FocusLink 里填写的番茄 Todo 记录标题。
 * 返回 null 表示“没有自定义标题”，此时记录名回落到学科名 —— 这是与旧行为完全一致的默认。
 */
export function normalizeTomatodoRecordName(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null;
  // PCRecord.name 是单行字段：换行/制表符/tab 会让番茄 Todo 自己的列表错行，先压成空格。
  const collapsed = name.replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;
  return collapsed.slice(0, TOMATODO_RECORD_NAME_MAX_LENGTH);
}

/**
 * 解析某 segment 最终写入 PCRecord.name 的字符串。
 * 自定义标题优先；未设置时严格等于学科名，保持“记录名 == 学科”的历史行为。
 */
export function resolveSegmentRecordName(
  segment: { tomatodoRecordName?: string | null },
  subject: TomatodoSubject,
): string {
  return normalizeTomatodoRecordName(segment.tomatodoRecordName) ?? subject;
}

/**
 * 解析某会话最终写入 PCRecord.name 的字符串。
 * 2026-10-13 起番茄记录的粒度是会话，所以学科与标题都以会话为准。
 */
export function resolveSessionRecordName(
  session: { tomatodoRecordName?: string | null },
  subject: TomatodoSubject,
): string {
  return normalizeTomatodoRecordName(session.tomatodoRecordName) ?? subject;
}

/**
 * 从标题、任务正文或标签等候选文本中推断六大学科。没有足够明确的词时返回 null，
 * 由调用方使用配置的兜底学科；不会把不确定文本强行归到任一学科。
 */
export function inferTomatodoSubject(
  candidateText: TomatodoSubjectCandidateText,
  ...additionalCandidates: TomatodoSubjectCandidateText[]
): Exclude<TomatodoSubject, '学习'> | null {
  for (const rawText of [candidateText, ...additionalCandidates]) {
    if (!rawText || !rawText.trim()) continue;
    const text = rawText.toLocaleLowerCase();

    // 明确学科名优先：例如“函数物理”仍应按“物理”而非泛化的“函数”判断。
    const explicit = findFirstRuleMatch(text, 'aliases');
    if (explicit) return explicit;

    const keyword = findFirstRuleMatch(text, 'keywords');
    if (keyword) return keyword;
  }
  return null;
}

function findFirstRuleMatch(
  text: string,
  field: 'aliases' | 'keywords',
): Exclude<TomatodoSubject, '学习'> | null {
  let best:
    { subject: Exclude<TomatodoSubject, '学习'>; index: number; keywordLength: number } | undefined;

  for (const rule of SUBJECT_KEYWORD_RULES) {
    for (const rawKeyword of rule[field]) {
      const keyword = rawKeyword.toLocaleLowerCase();
      const index = text.indexOf(keyword);
      if (index < 0) continue;
      if (
        !best ||
        index < best.index ||
        (index === best.index && keyword.length > best.keywordLength)
      ) {
        best = { subject: rule.subject, index, keywordLength: keyword.length };
      }
    }
  }
  return best?.subject ?? null;
}

/** 片段级 marker：v1.6.1 之前每条 PCRecord 对应一个 focus_segment，历史记录仍是这种形状。 */
export function getTomatodoMarker(segmentId: string): string {
  return `[FocusLink:tomatodo:segment:${segmentId}]`;
}

export function parseSegmentIdFromMarker(s1: string | null | undefined): string | null {
  if (!s1) return null;
  const match = /\[FocusLink:tomatodo:segment:([^\]]+)\]/.exec(s1);
  return match ? match[1] : null;
}

/**
 * 会话级 marker：一条 PCRecord 对应一次专注会话（`focus_sessions` 一行）。
 * 产品路径自 2026-10-13 起只写这种 marker；片段级 marker 仅用于识别历史记录。
 */
export function getTomatodoSessionMarker(sessionId: string): string {
  return `[FocusLink:tomatodo:session:${sessionId}]`;
}

export function parseSessionIdFromMarker(s1: string | null | undefined): string | null {
  if (!s1) return null;
  const match = /\[FocusLink:tomatodo:session:([^\]]+)\]/.exec(s1);
  return match ? match[1] : null;
}

export type TomatodoMarkerKind = 'segment' | 'session';

export interface ParsedTomatodoMarker {
  kind: TomatodoMarkerKind;
  id: string;
}

/**
 * 识别一条 PCRecord 是 FocusLink 写的哪一级记录。
 * 同时要能读两种 marker：库里 442 条历史记录都是片段级，重传与新写入是会话级。
 */
export function parseTomatodoMarker(s1: string | null | undefined): ParsedTomatodoMarker | null {
  const sessionId = parseSessionIdFromMarker(s1);
  if (sessionId) return { kind: 'session', id: sessionId };
  const segmentId = parseSegmentIdFromMarker(s1);
  if (segmentId) return { kind: 'segment', id: segmentId };
  return null;
}

export interface TomatodoSegmentLike {
  id: string;
  endedAt: number | null;
  activeElapsedMs: number;
}

export function shouldSyncSegmentToTomatodo(segment: TomatodoSegmentLike): boolean {
  return segment.endedAt !== null && segment.activeElapsedMs > 0;
}

export interface TomatodoPCRecord {
  id: number;
  name: string;
  time: number;
  startDate: number;
  createDate: number;
  i1: number;
  i2: number;
  i3: number;
  i4: number;
  i5: number;
  i6: number;
  i7: number;
  i8: number;
  i9: number;
  s1: string;
  s2: string;
  s3: string;
  s4: string;
  s5: string;
  s6: string;
  s7: string;
  s8: string;
  s9: string;
  isComplete: number;
  isSynced: number;
  isTransfer: number;
  boundDeviceId: null;
}

export interface BuildTomatodoRecordInput {
  segmentId: string;
  subject: TomatodoSubject;
  /**
   * 可选的记录标题（用户在 FocusLink 里自定义的番茄 Todo 记录名）。
   * 省略或为空时，记录名严格等于 subject —— 即旧版本的“记录名 == 学科”。
   */
  recordName?: string | null;
  startedAt: number;
  endedAt: number;
  activeElapsedMs: number;
}

export function buildTomatodoRecord(input: BuildTomatodoRecordInput): Omit<TomatodoPCRecord, 'id'> {
  const minutes = Math.max(0.1, round(Number(input.activeElapsedMs) / 60000, 6));
  return {
    // 记录名承载番茄 Todo 里显示的标题；学科仍然决定统计口径，两者不再强绑定。
    name: normalizeTomatodoRecordName(input.recordName) ?? input.subject,
    time: minutes,
    startDate: input.startedAt,
    createDate: input.endedAt,
    i1: 0,
    i2: 1,
    i3: 0,
    i4: 0,
    i5: 0,
    i6: 0,
    i7: 0,
    i8: 0,
    i9: 0,
    s1: getTomatodoMarker(input.segmentId),
    s2: '',
    s3: '',
    s4: '',
    s5: '',
    s6: '',
    s7: '',
    s8: '',
    s9: TOMATODO_CLOUD_V053_MARKER,
    isComplete: 1,
    // 新记录必须保持待同步；只有番茄 Todo 的云上传接口确认成功后才能置 1。
    isSynced: 0,
    isTransfer: 0,
    boundDeviceId: null,
  };
}

export function buildTomatodoRecordFromSegment(
  segment: FocusSegment,
  subject: TomatodoSubject,
): Omit<TomatodoPCRecord, 'id'> | null {
  if (!shouldSyncSegmentToTomatodo(segment)) return null;
  return buildTomatodoRecord({
    segmentId: segment.id,
    subject,
    recordName: segment.tomatodoRecordName ?? null,
    startedAt: segment.startedAt,
    endedAt: segment.endedAt as number,
    activeElapsedMs: segment.activeElapsedMs,
  });
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * FocusLink 界面显示给用户的分钟数 —— 与 `formatMinutes` 用同一个 `Math.round(ms / 60000)`。
 * 番茄记录必须写这个数，不能写毫秒真值：番茄 To-do 自己按截断显示小数，两边会给出不同结果。
 */
export function tomatodoRecordMinutes(activeElapsedMs: number): number {
  const ms = Number(activeElapsedMs);
  if (!Number.isFinite(ms) || ms <= 0) return TOMATODO_MIN_RECORD_MINUTES;
  return Math.max(TOMATODO_MIN_RECORD_MINUTES, Math.round(ms / 60_000));
}

export interface BuildTomatodoSessionRecordInput {
  sessionId: string;
  subject: TomatodoSubject;
  /** 可选自定义标题；省略或为空时记录名严格等于 subject。 */
  recordName?: string | null;
  startedAt: number;
  /** 该会话的累计专注毫秒（不含暂停）。 */
  activeElapsedMs: number;
}

/**
 * 一次专注会话 → 一条番茄记录。
 *
 * 与片段级 `buildTomatodoRecord` 的关键区别：
 * - marker 是会话 id，幂等判据变成「这次专注是否已经写过一条」；
 * - time 取界面显示的整数分钟，createDate 由「起点 + 显示时长」算出，
 *   会话中间的暂停既不进 time 也不推到终点，两边口径才一致。
 */
export function buildTomatodoSessionRecord(
  input: BuildTomatodoSessionRecordInput,
): Omit<TomatodoPCRecord, 'id'> {
  const minutes = tomatodoRecordMinutes(input.activeElapsedMs);
  return {
    name: normalizeTomatodoRecordName(input.recordName) ?? input.subject,
    time: minutes,
    startDate: input.startedAt,
    createDate: input.startedAt + minutes * 60_000,
    i1: 0,
    i2: 1,
    i3: 0,
    i4: 0,
    i5: 0,
    i6: 0,
    i7: 0,
    i8: 0,
    i9: 0,
    s1: getTomatodoSessionMarker(input.sessionId),
    s2: '',
    s3: '',
    s4: '',
    s5: '',
    s6: '',
    s7: '',
    s8: '',
    s9: TOMATODO_CLOUD_V053_MARKER,
    isComplete: 1,
    // 新记录必须保持待同步；只有番茄 To-do 的云上传接口确认成功后才能置 1。
    isSynced: 0,
    isTransfer: 0,
    boundDeviceId: null,
  };
}

export interface TomatodoSessionSourceSegment {
  id: string;
  startedAt: number;
  title?: string | null;
  tomatodoSubject: TomatodoSubject | null;
  tomatodoRecordName?: string | null;
}

export function shouldSyncSessionToTomatodo(session: {
  endedAt: number | null;
  activeElapsedMs: number;
}): boolean {
  return session.endedAt !== null && session.activeElapsedMs > 0;
}

/**
 * 专注结束后是否可以**自动**写入番茄 Todo。
 *
 * 2026-10-13 起番茄记录的标题由用户逐场批准，因此自动写入默认关闭：
 * 只有 `enabled` 与 `autoSyncEnabled` 同时为真才允许后台自动写。
 * 老设置里没有 `autoSyncEnabled` 字段，按「关闭」处理（不能因为字段缺失就恢复自动写）。
 * 手动入口（用户在界面上的同步按钮、IPC `tomatodo:sync-session`）不走这里。
 */
export function shouldAutoSyncTomatodoSession(
  config: { enabled?: boolean; autoSyncEnabled?: boolean } | null | undefined,
): boolean {
  return config?.enabled === true && config.autoSyncEnabled === true;
}

/**
 * 决定整条会话记录用谁的学科与标题。
 *
 * 优先级：带自定义标题的片段 → 手动选过学科的片段 → 最早开始的片段。
 * 这条规则保证用户在任何一条片段上做过的显式选择都能生效，而不是被「最早片段」吃掉。
 */
export function pickTomatodoSessionSourceSegment<T extends TomatodoSessionSourceSegment>(
  segments: readonly T[],
): T | null {
  if (segments.length === 0) return null;
  const ordered = [...segments].sort(
    (a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id),
  );
  const withRecordName = ordered.find(
    (segment) => normalizeTomatodoRecordName(segment.tomatodoRecordName) !== null,
  );
  if (withRecordName) return withRecordName;
  const withManualSubject = ordered.find(
    (segment) =>
      (segment.tomatodoSubject as string | null) === '杂' ||
      isTomatodoSubject(segment.tomatodoSubject),
  );
  return withManualSubject ?? ordered[0];
}

export function hasTomatodoSessionMarker(
  record: { s1?: string | null },
  sessionId: string,
): boolean {
  return (record.s1 ?? '').includes(getTomatodoSessionMarker(sessionId));
}

export function collectSyncedSessionIds(
  records: ReadonlyArray<{ s1?: string | null }>,
): Set<string> {
  const ids = new Set<string>();
  for (const r of records) {
    const sid = parseSessionIdFromMarker(r.s1);
    if (sid) ids.add(sid);
  }
  return ids;
}

export function hasTomatodoMarker(record: { s1?: string | null }, segmentId: string): boolean {
  const marker = getTomatodoMarker(segmentId);
  return (record.s1 ?? '').includes(marker);
}

export function collectSyncedSegmentIds(
  records: ReadonlyArray<{ s1?: string | null }>,
): Set<string> {
  const ids = new Set<string>();
  for (const r of records) {
    const sid = parseSegmentIdFromMarker(r.s1);
    if (sid) ids.add(sid);
  }
  return ids;
}

export function resolveSegmentSubject(
  segment: { tomatodoSubject: TomatodoSubject | null; title?: string | null },
  _defaultSubject: TomatodoSubject,
  ...candidateTexts: TomatodoSubjectCandidateText[]
): TomatodoSubject {
  // 手动选择永远是最高优先级；兼容旧库中的“杂”并迁移为“学习”。
  if ((segment.tomatodoSubject as string | null) === '杂') return TOMATODO_FALLBACK_SUBJECT;
  if (segment.tomatodoSubject && isTomatodoSubject(segment.tomatodoSubject)) {
    return segment.tomatodoSubject;
  }
  const inferred = inferTomatodoSubject(segment.title, ...candidateTexts);
  if (inferred) return inferred;
  return TOMATODO_FALLBACK_SUBJECT;
}
