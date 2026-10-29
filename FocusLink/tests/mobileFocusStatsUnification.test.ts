import fs from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  FocusConsole,
  FocusSetupSheet,
  type FocusConsoleProps,
  type FocusSetupSheetProps,
} from '../src/mobile/FocusConsole';
import { DashboardView } from '../src/mobile/DashboardView';
import { idleLiveFocusSnapshot, type LiveFocusSnapshotLike } from '../src/mobile/runtimeModel';
import type { CachedBundle } from '../src/mobile/cache';
import type { SyncedTask } from '../shared/sync/taskSnapshotProtocol';

/**
 * 专注页 / 统计页统一后的验收锁定：
 * 1. 专注页三条入口（选任务 / 输入名字 / 直接开始）各有一个动作；
 * 2. 待开始 / 运行 / 暂停三态的主控制位置与顺序不变；
 * 3. 统计页折叠区之前就能回答「今天做了什么 / 各任务投入 / 暂停与空档」；
 * 4. 空态给一句人话提示。
 */

const now = new Date(2026, 6, 21, 12, 0, 0, 0).getTime();
const consoleSource = fs.readFileSync(
  new URL('../src/mobile/FocusConsole.tsx', import.meta.url),
  'utf8',
);

describe('mobile focus console entries', () => {
  it('offers task selection, a name input and a nameless start in one setup sheet', () => {
    const markup = renderSheet({});

    expect(markup).toContain('class="m-sheet focus-sheet"');
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');

    // 入口一 · 选任务：最近任务一行一个可选按钮 + 「全部任务」通往完整清单。
    expect(markup).toContain('最近任务');
    expect(markup.match(/class="focus-task-row focus-sheet-task[^"]*"/g)).toHaveLength(3);
    expect(markup).toContain('整理化学错题');
    expect(markup).toContain('全部任务');

    // 入口二 · 输入名字：唯一一个输入框 + 一个「用这个名字开始」。
    expect(markup).toContain('输入这次专注的名字');
    expect(markup.match(/<input/g)).toHaveLength(1);
    expect(markup).toContain('用这个名字开始');
    // 名字为空时不能开始，避免发出一次「自由专注」。
    expect(tagWith(markup, 'focus-sheet-name-apply')).toContain('disabled');

    // 入口三 · 直接开始：不写名字也立刻可用。
    expect(markup).toContain('直接开始，不写名字');
    expect(tagWith(markup, 'focus-sheet-free')).not.toContain('disabled');
  });

  it('lets the typed name start the session without a trip back to the main control', () => {
    const markup = renderSheet({ titleDraft: '整理化学错题' });

    expect(tagWith(markup, 'focus-sheet-name-apply')).not.toContain('disabled');
    expect(markup).toContain('用这个名字开始');
    // 面板里的名字键直接发 start；直接开始走「清空后 start」的既有路径。
    expect(consoleSource).toContain('const startWithName = () => {');
    expect(consoleSource).toContain("onCommand('start');");
    expect(consoleSource).toContain('onStartWithName={startWithName}');
    expect(consoleSource).toContain('onStartWithoutName={startWithoutName}');
    expect(consoleSource).toContain('onChooseTask={chooseTask}');
    // 首屏只保留一行任务入口，点开才是三条。
    expect(consoleSource.match(/className="focus-task-entry"/g)).toHaveLength(1);
    expect(consoleSource).not.toContain('<select');
  });
});

describe('mobile focus console control stability', () => {
  it('keeps the primary control in slot one and the finish control in slot two in every phase', () => {
    stubWindow();
    const idle = actionRow(renderConsole('idle'));
    const running = actionRow(renderConsole('running'));
    const paused = actionRow(renderConsole('paused'));

    for (const row of [idle, running, paused]) {
      expect(row).toHaveLength(2);
      expect(row[1]).toBe('focus-action finish-action');
    }
    expect(idle[0]).toBe('focus-action primary start-action');
    expect(running[0]).toBe('focus-action primary pause-action');
    expect(paused[0]).toBe('focus-action primary resume-action');
    // 未开始时结束键禁用，但仍在第二格占位：整行宽度不随状态变化。
    expect(tagWith(renderConsole('idle'), 'finish-action')).toContain('disabled');
  });

  it('keeps task entry, readout, controls, ribbon and three metrics in one fixed order', () => {
    stubWindow();
    const sequences = (['idle', 'running', 'paused'] as const).map((phase) =>
      regionSequence(renderConsole(phase)),
    );

    // 五个区块都真实存在，且每态都按任务入口 → 读数 → 控制 → 时间之带 → 三时间的顺序出现。
    expect(sequences[0]).toEqual(REGION_MARKERS);
    // 三态的结构顺序完全一致：换状态只换字与颜色，不搬块。
    expect(sequences[1]).toEqual(sequences[0]);
    expect(sequences[2]).toEqual(sequences[0]);

    // 三条时间读数在任何状态都在。
    for (const phase of ['idle', 'running', 'paused'] as const) {
      const markup = renderConsole(phase);
      expect(markup).toContain('本轮三时间');
      expect(markup).toContain('累计专注');
      expect(markup).toContain('累计暂停');
      expect(markup).toContain('总时长');
      expect(markup).toContain('时间之带');
    }
  });
});

describe('mobile stats page answers', () => {
  it('answers what was done today, per-task time and where pauses and gaps were', () => {
    const markup = renderStats();
    const detailsIndex = markup.indexOf('<details');
    expect(detailsIndex).toBeGreaterThan(-1);
    const surface = markup.slice(0, detailsIndex);

    // 三块结论都在折叠区之前，不用先展开「更多明细」。
    expect(surface).toContain('做了什么');
    expect(surface).toContain('任务投入');
    expect(surface).toContain('暂停与空档');
    expect(surface).toContain('精确空档');

    // 问题一 · 今天做了什么：今天几段、总共多久、每段的时间/名字/时长。
    expect(surface).toContain('今天 2 段 · 55分钟');
    expect(surface).toContain('>今天<');
    expect(surface).toContain('10:30');
    expect(surface).toContain('整理化学错题');
    expect(surface).toContain('30分钟');

    // 问题二 · 各任务投入多久：构成带 + 排序后的时长行。
    expect(surface).toContain('任务专注时间构成，整理化学错题 55%，函数复习 45%');
    expect(surface).toContain('25分钟');
    expect(surface).toContain('按投入从多到少');

    // 问题三 · 暂停与空档在哪：损耗/次数/总时长 + 逐段起止 + 百分比构成。
    expect(surface).toContain('暂停损耗');
    expect(surface).toContain('5分钟');
    expect(surface).toContain('1 次');
    expect(surface).toContain('空档时长');
    expect(surface).toContain('09:30');
    expect(surface).toContain('10:30');
    expect(surface).toContain('1小时');
    expect(surface).toContain('专注 46%，暂停 4%，空档 50%');
    // 空档必须解释清楚，不能只给一个数字。
    expect(surface).toContain('两轮专注之间既没计时也没暂停的时间');
  });

  it('explains an empty surface in one plain sentence and keeps the start entry', () => {
    const empty = renderToStaticMarkup(
      createElement(DashboardView, {
        records: [],
        ready: true,
        configured: true,
        lastSyncAt: null,
        cursor: null,
        tasks: null,
        referenceNow: now,
        onStartFocus: () => undefined,
      }),
    );

    expect(empty).toContain('还没有任何专注记录');
    expect(empty).toContain('今天做了什么、每个任务花了多久都会记在这里');
    expect(empty).toContain('开始专注');
    expect(empty).not.toContain('dashboard-more');

    const outOfRange = renderToStaticMarkup(
      createElement(DashboardView, {
        records: [
          makeSession({
            id: 'old',
            title: '去年的专注',
            startedAt: new Date(0, 0, 2, 9, 0).getTime(),
          }),
        ],
        ready: true,
        configured: true,
        lastSyncAt: now,
        cursor: null,
        tasks: null,
        referenceNow: now,
        onStartFocus: () => undefined,
      }),
    );
    expect(outOfRange).toContain('这个时间范围里没有结束的专注');
    expect(outOfRange).toContain('换一个范围');
  });
});

function stubWindow(width = 412, height = 915): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      innerWidth: width,
      innerHeight: height,
      matchMedia: () => ({ matches: false }),
    },
  });
}

function tagWith(markup: string, marker: string): string {
  const match = new RegExp(`<(?:button|input|div|section)\\b[^>]*${marker}[^>]*>`).exec(markup);
  expect(match, `missing ${marker}`).not.toBeNull();
  return match?.[0] ?? '';
}

function actionRow(markup: string): string[] {
  const start = markup.indexOf('<div class="focus-actions">');
  expect(start).toBeGreaterThan(-1);
  const row = markup.slice(start, markup.indexOf('</div>', start));
  return [...row.matchAll(/<button[^>]*class="([^"]*)"/g)].map((match) => match[1].trim());
}

const REGION_MARKERS = [
  'class="focus-task-entry',
  'class="focus-readout"',
  'class="focus-actions"',
  'class="ribbon-area"',
  'class="runtime-metrics"',
] as const;

/** 按实际出现位置排出区块顺序，用来锁「同一 DOM 位置/顺序」。 */
function regionSequence(markup: string): string[] {
  const located = REGION_MARKERS.map((marker) => ({ marker, at: markup.indexOf(marker) }));
  for (const entry of located) expect(entry.at, `missing ${entry.marker}`).toBeGreaterThan(-1);
  return located.sort((left, right) => left.at - right.at).map((entry) => entry.marker);
}

function renderSheet(overrides: Partial<FocusSetupSheetProps>): string {
  const props: FocusSetupSheetProps = {
    recentTasks: [
      task('函数复习', 'task-1'),
      task('整理化学错题', 'task-2'),
      task('预约体检', 'task-3'),
    ],
    selectedTaskId: 'task-1',
    titleDraft: '',
    pendingCommand: null,
    dialogRef: { current: null },
    onChooseTask: () => undefined,
    onTitleChange: () => undefined,
    onStartWithName: () => undefined,
    onStartWithoutName: () => undefined,
    onOpenTasks: () => undefined,
    ...overrides,
  };
  return renderToStaticMarkup(createElement(FocusSetupSheet, props));
}

function renderConsole(phase: 'idle' | 'running' | 'paused'): string {
  return renderToStaticMarkup(createElement(FocusConsole, focusProps(snapshotOf(phase))));
}

function focusProps(snapshot: LiveFocusSnapshotLike): FocusConsoleProps {
  return {
    snapshot,
    connection: 'live',
    connectionNotice: null,
    titleDraft: '',
    pendingCommand: null,
    commandNotice: null,
    localDeviceId: 'device-local',
    tasks: [],
    selectedTaskId: '',
    onTaskChange: () => undefined,
    onTitleChange: () => undefined,
    onCommand: () => undefined,
    onOpenConnection: () => undefined,
    onOpenTasks: () => undefined,
    snapshotSource: 'server',
    nativeSystemControls: {
      available: true,
      immersiveSystemBars: false,
      pictureInPictureSupported: true,
      pictureInPictureActive: false,
      busy: null,
    },
    onToggleImmersiveSystemBars: () => undefined,
    onEnterPictureInPicture: () => undefined,
    localOfflineMode: false,
    authorityMode: 'cloud-live',
    allowOfflineStart: false,
    timerStyle: 'standard',
    runtimeReady: true,
  };
}

function snapshotOf(phase: 'idle' | 'running' | 'paused'): LiveFocusSnapshotLike {
  const base = idleLiveFocusSnapshot(1, now, now);
  if (phase === 'idle') return base;
  return {
    ...base,
    state: phase,
    sessionId: 'session-1',
    startedAt: now,
    currentStateStartedAt: now,
    title: '整理化学错题',
    taskId: 'task-2',
    taskSource: 'ticktick',
    taskTitle: '整理化学错题',
    activeElapsedMs: phase === 'running' ? 25 * 60_000 : 30 * 60_000,
    wallElapsedMs: 32 * 60_000,
  };
}

function renderStats(): string {
  const first = makeSession({
    id: 'session-1',
    title: '函数复习',
    startedAt: new Date(2026, 6, 21, 9, 0, 0, 0).getTime(),
    taskId: 'task-1',
    activeMs: 25 * 60_000,
    pauseMs: 5 * 60_000,
    wallMs: 30 * 60_000,
  });
  const second = makeSession({
    id: 'session-2',
    title: '整理化学错题',
    startedAt: new Date(2026, 6, 21, 10, 30, 0, 0).getTime(),
    taskId: 'task-2',
    activeMs: 30 * 60_000,
    pauseMs: 0,
    wallMs: 30 * 60_000,
  });
  return renderToStaticMarkup(
    createElement(DashboardView, {
      records: [first, second],
      ready: true,
      configured: true,
      lastSyncAt: now,
      cursor: 'cursor-1',
      tasks: [task('函数复习', 'task-1'), task('整理化学错题', 'task-2')],
      referenceNow: now,
      onStartFocus: () => undefined,
    }),
  );
}

function makeSession(input: {
  id: string;
  title: string;
  startedAt: number;
  taskId?: string;
  activeMs?: number;
  pauseMs?: number;
  wallMs?: number;
}): CachedBundle {
  const activeMs = input.activeMs ?? 10 * 60_000;
  const pauseMs = input.pauseMs ?? 0;
  const wallMs = input.wallMs ?? activeMs + pauseMs;
  const segmentEndedAt = input.startedAt + activeMs;
  const pauseStartedAt = segmentEndedAt;
  const pauseEndedAt = pauseStartedAt + pauseMs;
  return {
    entityId: input.id,
    revision: 1,
    changeSeq: 1,
    sourceDeviceId: 'desktop-1',
    bundle: {
      session: {
        id: input.id,
        title: input.title,
        status: 'finished',
        startedAt: input.startedAt,
        endedAt: input.startedAt + wallMs,
        activeElapsedMs: activeMs,
        pauseElapsedMs: pauseMs,
        wallElapsedMs: wallMs,
        defaultTaskId: input.taskId ?? null,
        defaultTaskSource: input.taskId ? 'ticktick' : null,
        defaultTaskTitle: input.title,
        note: null,
        createdAt: input.startedAt,
        updatedAt: input.startedAt + wallMs,
      },
      segments: [
        {
          id: `segment-${input.id}`,
          sessionId: input.id,
          taskId: input.taskId ?? null,
          taskSource: input.taskId ? 'ticktick' : null,
          title: input.title,
          startedAt: input.startedAt,
          endedAt: segmentEndedAt,
          activeElapsedMs: activeMs,
          note: null,
          tomatodoSubject: null,
          createdAt: input.startedAt,
          updatedAt: segmentEndedAt,
        },
      ],
      pauses:
        pauseMs > 0
          ? [
              {
                id: `pause-${input.id}`,
                sessionId: input.id,
                segmentId: `segment-${input.id}`,
                pauseStartedAt,
                pauseEndedAt,
                durationMs: pauseMs,
                reason: null,
                createdAt: pauseStartedAt,
                updatedAt: pauseEndedAt,
              },
            ]
          : [],
    },
  };
}

function task(title: string, id: string): SyncedTask {
  return {
    id,
    source: 'ticktick',
    projectId: null,
    title,
    status: null,
    priority: null,
    startDate: null,
    dueDate: null,
    recurrence: null,
    tags: [],
    parentId: null,
    isCompleted: false,
    updatedAt: now,
  };
}
