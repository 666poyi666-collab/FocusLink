/**
 * 番茄 To-do「用户批准后同步」运维入口（PC 端，一次性/定时核对用）。
 *
 * 背景（2026-10-13 用户决定）：番茄记录不再在专注结束时自动写入，改为
 *   1) 定时核对最近若干小时的专注会话；
 *   2) 把「哪一场 + 建议学科/标题 + 时长 + 起止」报给用户；
 *   3) 用户答复后才写入番茄 To-do。
 * 因此 `tomatodo.autoSyncEnabled` 默认关闭，本工具是唯一补写入口。
 *
 * 用法（在 FocusLink/ 下执行，必须用 Electron 运行，因为需要 userData 与 SQLite）：
 *   electron dist-selftest/tomatodo-approval-sync.cjs --check [--hours N]
 *     （默认窗口 = 今天本地零点起，只看今天和以后；`--hours 72` 可显式回看）
 *   electron dist-selftest/tomatodo-approval-sync.cjs --write --session <id> \
 *       [--subject 数学] [--name 数学错题回顾] [--launch] [--dry-run]
 *
 * 约定：
 * - `--check` 只读，不写 SQLite、不写番茄库、不启动外部应用。
 * - `--launch` 才允许启动番茄 To-do（用户主动触发路径）；没有这个开关时不会 Launch。
 * - 番茄 To-do 已在运行但没有 CDP 桥时，返回 `restart-required`，绝不杀用户进程。
 * - 无法独立回读云端，`cloudSyncUploadRecord` 成功只代表「上传已确认」。
 */
import path from 'node:path';
import { app } from 'electron';
import {
  getActiveSession,
  initDatabase,
  listSessions,
  setSessionTomatodoRecordName,
  setSessionTomatodoSubject,
} from '../../electron/db/index';
import {
  getTomatodoSyncStatus,
  setTomatodoRecordNameForSession,
  syncSessionToTomatodo,
} from '../../electron/sync/tomatodoSyncService';
import {
  ensureTomatodoBridge,
  getTomatodoBridgeStatus,
} from '../../electron/integrations/tomatodo/bridgeLifecycle';
import {
  getTomatodoSessionRecordState,
  resolveTomatodoDbPath,
} from '../../electron/integrations/tomatodo/localDb';
import {
  isTomatodoSubject,
  normalizeTomatodoRecordName,
  shouldSyncSessionToTomatodo,
} from '../../shared/tomatodoPolicy';
import { getSettings } from '../../electron/settingsStore';

// Electron 默认 userData 取自应用名，直接用 `electron <script>` 跑会落到 `%APPDATA%\Electron`，
// 那会让本工具读到另一个空库。必须在 initDatabase() 之前把路径钉到真实安装目录。
app.setPath('userData', path.join(process.env.APPDATA ?? app.getPath('appData'), 'FocusLink'));

interface CliOptions {
  mode: 'check' | 'write';
  hours: number;
  sessionId: string | null;
  subject: string | null;
  recordName: string | null;
  launch: boolean;
  dryRun: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    mode: 'check',
    // 0 = 默认窗口「今天（本地零点起）」，只看今天和以后，不翻旧账。
    hours: 0,
    sessionId: null,
    subject: null,
    recordName: null,
    launch: false,
    dryRun: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} 缺少取值`);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--check':
        opts.mode = 'check';
        break;
      case '--write':
        opts.mode = 'write';
        break;
      case '--hours':
        opts.hours = Number(next());
        break;
      case '--session':
        opts.sessionId = next();
        break;
      case '--subject':
        opts.subject = next();
        break;
      case '--name':
        opts.recordName = next();
        break;
      case '--launch':
        opts.launch = true;
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--json':
        opts.json = true;
        break;
      default:
        throw new Error(`未知参数：${arg}`);
    }
  }
  if (opts.mode === 'write' && !opts.sessionId) throw new Error('--write 需要 --session <id>');
  return opts;
}

function formatClock(ts: number | null): string {
  if (ts === null) return '—';
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

interface CheckRow {
  sessionId: string;
  title: string | null;
  startedAt: number;
  endedAt: number | null;
  minutes: number;
  inProgress: boolean;
  eligible: boolean;
  state: string;
  subject: string;
  subjectSource: string;
  recordName: string;
  customRecordName: string | null;
  writtenLocally: boolean;
  cloudSynced: boolean;
  recordIsSynced: boolean;
  recordId: number | null;
  needsApproval: boolean;
  alreadyUploaded: boolean;
}

/** 本地零点（今天开始）——默认核对窗口，只看今天和以后，不翻旧账。 */
function startOfLocalToday(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/** 只读核对：把 SQLite 与番茄库的当前事实合起来，不做任何写操作。 */
function collectRows(hours: number): {
  rows: CheckRow[];
  activeRow: CheckRow | null;
  dbPath: string;
} {
  const settings = getSettings();
  const dbPath = resolveTomatodoDbPath(settings.tomatodo?.dbPath ?? '');
  const since = hours > 0 ? Date.now() - hours * 3600 * 1000 : startOfLocalToday();
  const sessions = listSessions(200).filter((session) => session.startedAt >= since);
  const rows: CheckRow[] = [];
  let activeRow: CheckRow | null = null;

  for (const session of sessions) {
    const status = getTomatodoSyncStatus(session.id);
    const inProgress = session.endedAt === null;
    // 原始 isSynced：status.cloudSynced 会在仍有 durable 意图时回落，这里要区分
    // 「真的没上传」和「已上传但手机通道缺失所以队列没清」。
    const rawState = getTomatodoSessionRecordState(dbPath, session.id);
    const row: CheckRow = {
      sessionId: session.id,
      title: session.title ?? null,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      minutes: status.minutes,
      inProgress,
      eligible: shouldSyncSessionToTomatodo(session),
      state: status.state,
      subject: status.subject,
      subjectSource: status.source,
      recordName: status.recordName,
      customRecordName: status.customRecordName,
      writtenLocally: status.writtenLocally,
      cloudSynced: status.cloudSynced,
      recordIsSynced: rawState.cloudSynced,
      recordId: rawState.recordId ?? null,
      // 需要用户批准 = 已结束、有有效时长、番茄里还没有这条会话记录。
      needsApproval: !inProgress && shouldSyncSessionToTomatodo(session) && !rawState.exists,
      alreadyUploaded: rawState.exists && rawState.cloudSynced,
    };
    if (inProgress) activeRow = row;
    rows.push(row);
  }
  return { rows, activeRow, dbPath };
}

function printCheck(
  hours: number,
  dbPath: string,
  rows: CheckRow[],
  activeRow: CheckRow | null,
): void {
  const finished = rows.filter((row) => !row.inProgress);
  const pending = finished.filter((row) => row.needsApproval);
  const synced = finished.filter((row) => row.alreadyUploaded);
  const other = finished.filter((row) => !row.needsApproval && !row.alreadyUploaded);

  const windowLabel = hours > 0 ? `最近 ${hours} 小时` : '今天（本地零点起）';
  process.stdout.write(`=== 番茄同步核对（${windowLabel}）${formatClock(Date.now())} ===\n`);
  process.stdout.write(`番茄库：${dbPath}\n`);

  if (activeRow) {
    process.stdout.write(
      `\n[进行中] ${formatClock(activeRow.startedAt)} 起 · 已累计 ${activeRow.minutes} 分钟 · 任务「${
        activeRow.title ?? '(无标题)'
      }」\n`,
    );
    process.stdout.write('        进行中不写番茄（时长未定），等结束后再走一遍流程。\n');
  } else {
    process.stdout.write('\n[进行中] 无\n');
  }

  process.stdout.write(`\n[等你批准] ${pending.length} 场\n`);
  for (const row of pending) {
    process.stdout.write(
      `  · ${row.sessionId}\n` +
        `      任务「${row.title ?? '(无标题)'}」 · ${formatClock(row.startedAt)} → ${formatClock(
          row.endedAt,
        )} · ${row.minutes} 分钟\n` +
        `      建议学科=${row.subject}（${row.subjectSource}） · 建议标题=${
          row.customRecordName ?? '(未设置 → 用学科名)'
        }\n`,
    );
  }

  process.stdout.write(`\n[已上传] ${synced.length} 场\n`);
  for (const row of synced) {
    process.stdout.write(
      `  · ${row.sessionId} ${row.minutes} 分钟 「${row.recordName}」记录 ${row.recordId ?? '-'}\n`,
    );
  }

  if (other.length > 0) {
    process.stdout.write(`\n[已写入但未确认上传] ${other.length} 场\n`);
    for (const row of other) {
      process.stdout.write(
        `  · ${row.sessionId} ${row.minutes} 分钟 「${row.recordName}」状态=${row.state}` +
          ` isSynced=${row.recordIsSynced ? 1 : 0} 记录 ${row.recordId ?? '-'}\n`,
      );
    }
  }

  process.stdout.write(
    `\n汇总：共 ${rows.length} 场（含进行中 ${activeRow ? 1 : 0}），待批准 ${pending.length}，已上传 ${synced.length}。\n`,
  );
  process.stdout.write(`JSON=${JSON.stringify({ dbPath, pending, synced, activeRow, rows })}\n`);
}

async function runWrite(opts: CliOptions): Promise<number> {
  const sessionId = opts.sessionId as string;
  if (!opts.subject || !isTomatodoSubject(opts.subject)) {
    throw new Error(
      `--subject 必须是合法学科（语文/数学/英语/物理/化学/生物/学习），收到：${opts.subject ?? '(未提供)'}`,
    );
  }
  const recordName = normalizeTomatodoRecordName(opts.recordName);
  const status = getTomatodoSyncStatus(sessionId);
  if (status.state === 'cloud-synced' || status.writtenLocally) {
    process.stdout.write(
      `会话 ${sessionId} 在番茄里已有记录（状态=${status.state}，记录 ${
        status.recordId ?? '-'
      }）。\n本工具只负责新建会话记录；已有记录请按文档做一次性就地迁移，避免产生重复记录。\n`,
    );
    return 3;
  }

  if (opts.dryRun) {
    process.stdout.write(
      `[dry-run] 将写入：会话=${sessionId} 学科=${opts.subject} 标题=${
        recordName ?? '(未设置 → 用学科名)'
      } 分钟=${status.minutes}\n`,
    );
    return 0;
  }

  // 1) 先落用户批准的归属（会话级），再写外部记录。
  setSessionTomatodoSubject(sessionId, opts.subject);
  setSessionTomatodoRecordName(sessionId, recordName);
  if (recordName !== null) {
    // 走产品自身的赋值同步路径：写名 + 触发云上传（桥可用时）。
    await setTomatodoRecordNameForSession(sessionId, recordName);
  }

  // 2) 桥可用性：只有显式 --launch 才允许启动用户的应用。
  let bridge = await getTomatodoBridgeStatus();
  if (!bridge.connected && opts.launch) {
    bridge = await ensureTomatodoBridge();
  }
  if (!bridge.connected) {
    process.stdout.write(
      `番茄 To-do 未连接（状态=${bridge.state}${
        bridge.error ? `，${bridge.error}` : ''
      }）。\n记录将只写入本机待传队列，等番茄启动后由用户手动上传；不会自动启动外部应用。\n`,
    );
  }

  // 3) 会话级写入（运行时走桥 + 云上传，未运行时写本地待传）。
  const result = await syncSessionToTomatodo(sessionId);
  const after = getTomatodoSyncStatus(sessionId);
  const rawAfter = getTomatodoSessionRecordState(after.dbPath, sessionId);
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: result.ok,
        total: result.total,
        synced: result.synced,
        failed: result.failed,
        sessionId,
        subject: opts.subject,
        recordName: recordName ?? opts.subject,
        minutes: after.minutes,
        stateAfter: after.state,
        recordId: rawAfter.recordId ?? null,
        recordExists: rawAfter.exists,
        recordIsSynced: rawAfter.cloudSynced,
        uploadConfirmed: result.results.some((entry) => entry.cloudSynced),
        phoneDeliveryConfirmed: result.results.some((entry) => entry.phoneSynced),
        bridgeState: bridge.state,
      },
      null,
      2,
    )}\n`,
  );
  return result.ok ? 0 : 1;
}

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  initDatabase();
  if (opts.mode === 'write') return runWrite(opts);
  const { rows, activeRow, dbPath } = collectRows(opts.hours);
  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ dbPath, activeRow, rows }, null, 2)}\n`);
  } else {
    printCheck(opts.hours, dbPath, rows, activeRow);
  }
  return 0;
}

void app.whenReady().then(async () => {
  let code = 1;
  try {
    code = await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
    );
  }
  app.exit(code);
});
