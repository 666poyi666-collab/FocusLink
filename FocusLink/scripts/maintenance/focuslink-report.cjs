#!/usr/bin/env node
/**
 * FocusLink 专注日报（只读；不需要 Electron，也不需要构建，秒出）
 *
 * 用法（在 FocusLink/ 下）：
 *   node scripts/maintenance/focuslink-report.cjs              # 今天（本地零点起）
 *   node scripts/maintenance/focuslink-report.cjs --hours 72   # 回看 72 小时
 *   node scripts/maintenance/focuslink-report.cjs --json       # 机器可读
 *
 * 只读：不写 SQLite、不写番茄库、不启动任何应用。
 */
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const appData =
  process.env.APPDATA ?? path.join(process.env.USERPROFILE ?? '.', 'AppData', 'Roaming');
const dbPath = path.join(appData, 'FocusLink', 'focuslink.db');
const tomatodoDbPath = path.join(appData, 'tomatodo', 'tomatodo_db.json');
const DURABLE_KEY = 'tomatodo.pendingSessionIdsV161';

function parseArgs(argv) {
  let hours = 0;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--hours') {
      hours = Number(argv[i + 1]);
      i += 1;
    } else if (argv[i] === '--json') {
      json = true;
    }
  }
  return { hours, json };
}

function startOfLocalToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function clock(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function dateLabel(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function humanMinutes(minutes) {
  if (minutes < 60) return `${minutes} 分钟`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分钟`;
}

/** 简单显示宽度：CJK/全角算 2，其余算 1。 */
function width(text) {
  let total = 0;
  for (const ch of text) {
    total +=
      /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/.test(
        ch,
      )
        ? 2
        : 1;
  }
  return total;
}

function padEndWide(text, target) {
  return text + ' '.repeat(Math.max(1, target - width(text)));
}

function readPendingSessionIds(db) {
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(DURABLE_KEY);
    if (!row || typeof row.value !== 'string') return new Set();
    const parsed = JSON.parse(row.value);
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function readTomatodoRecords() {
  const map = new Map();
  const bySessionId = new Map();
  if (!fs.existsSync(tomatodoDbPath)) return { map, bySessionId };
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(tomatodoDbPath, 'utf8'));
  } catch {
    return { map, bySessionId };
  }
  for (const record of raw.PCRecord ?? []) {
    const match = /\[FocusLink:tomatodo:(session|segment):([^\]]+)\]/.exec(String(record.s1 ?? ''));
    if (!match) continue;
    const [, kind, id] = match;
    const entry = {
      recordId: record.id,
      kind,
      name: String(record.name ?? ''),
      minutes: Number(record.time ?? 0),
      isSynced: Number(record.isSynced) === 1,
    };
    map.set(`${kind}:${id}`, entry);
    if (kind === 'session') bySessionId.set(id, entry);
  }
  return { map, bySessionId };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const since = opts.hours > 0 ? Date.now() - opts.hours * 3600 * 1000 : startOfLocalToday();
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const pendingIds = readPendingSessionIds(db);
  const { bySessionId } = readTomatodoRecords();
  const sessions = db
    .prepare(
      'SELECT * FROM focus_sessions WHERE started_at >= ? OR ended_at IS NULL ORDER BY started_at ASC',
    )
    .all(since);
  db.close();

  const rows = sessions.map((session) => {
    const inProgress = session.ended_at === null;
    const activeMs = Number(session.active_elapsed_ms ?? 0);
    const minutes = Math.max(inProgress ? 0 : 1, Math.round(activeMs / 60000));
    const record = bySessionId.get(session.id) ?? null;
    const recordName = session.tomatodo_record_name ?? null;
    const subject = session.tomatodo_subject ?? null;
    const pending = pendingIds.has(session.id);
    // 「已上传」看番茄记录自己的 isSynced（上传已确认），不看到 durable 队列有没有清空：
    // 手机直连通道缺失时 durable 会长期留着 session id，不代表没上传，只代表手机投递没确认。
    let sync;
    if (record && record.isSynced) sync = '已上传';
    else if (record) sync = '未上传';
    else if (pending) sync = '待确认';
    else sync = '待批准';
    const phonePending = pending && Boolean(record && record.isSynced);
    return {
      sessionId: session.id,
      title: session.title ?? session.default_task_title ?? null,
      startedAt: Number(session.started_at),
      inProgress,
      minutes,
      subject,
      recordName: recordName ?? record?.name ?? subject,
      recordId: record?.recordId ?? null,
      sync,
      phonePending,
    };
  });

  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ since, rows }, null, 2)}\n`);
    return;
  }

  const active = rows.find((row) => row.inProgress) ?? null;
  const finished = rows.filter((row) => !row.inProgress);
  const totalMinutes = finished.reduce((sum, row) => sum + row.minutes, 0);

  const out = [];
  const windowLabel = opts.hours > 0 ? `最近 ${opts.hours} 小时` : `今天 ${dateLabel(Date.now())}`;
  out.push(`=== 专注日报 · ${windowLabel} · ${clock(Date.now())} ===`);
  out.push('');
  if (active) {
    out.push(
      `[进行中] ${clock(active.startedAt)} 起 · 已 ${humanMinutes(active.minutes)} ·「${active.title ?? '(无标题)'}」`,
    );
  } else {
    out.push('[进行中] 无');
  }
  out.push('');
  if (finished.length === 0) {
    out.push('已完成 0 场');
  } else {
    out.push(
      `已完成 ${finished.length} 场 · 合计 ${humanMinutes(totalMinutes)}（${totalMinutes} 分钟）`,
    );
    const titleWidth = Math.max(...finished.map((row) => width(`「${row.title ?? '(无标题)'}」`)));
    for (const row of finished) {
      const range = `${clock(row.startedAt)}–${clock(row.startedAt + row.minutes * 60000)}`;
      const label = padEndWide(`「${row.title ?? '(无标题)'}」`, titleWidth);
      out.push(
        `  ${range}  ${padEndWide(humanMinutes(row.minutes), 12)}${label}  → ${row.recordName ?? '—'}  ${row.sync}${
          row.phonePending ? '（手机通道待确认）' : ''
        }`,
      );
    }
    const byTask = new Map();
    for (const row of finished) {
      const key = row.title ?? '(无标题)';
      const item = byTask.get(key) ?? { count: 0, minutes: 0 };
      item.count += 1;
      item.minutes += row.minutes;
      byTask.set(key, item);
    }
    out.push('');
    out.push('按任务汇总');
    const taskWidth = Math.max(...[...byTask.keys()].map((key) => width(`「${key}」`)));
    for (const [key, item] of [...byTask.entries()].sort((a, b) => b[1].minutes - a[1].minutes)) {
      out.push(
        `  ${padEndWide(`「${key}」`, taskWidth)}  ${item.count} 场 · ${humanMinutes(item.minutes)}`,
      );
    }
  }
  const count = (state) => rows.filter((row) => row.sync === state).length;
  out.push('');
  out.push(
    `番茄同步：已上传 ${count('已上传')} · 待确认 ${count('待确认')} · 未上传 ${count('未上传')} · 待批准 ${count('待批准')}`,
  );
  process.stdout.write(`${out.join('\n')}\n`);
}

main();
