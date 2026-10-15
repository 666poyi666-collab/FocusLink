#!/usr/bin/env node
/**
 * FocusLink 会话补录（默认 dry-run，加 --apply 才写库）
 *
 * 用途：实时（云端托管）会话因为断网没有落进本地账本时，按已有证据补一条
 * 已结束会话 + 它的第一个片段。补完之后不需要手工入队：桌面端 Sync v2 的
 * collectEntities() 会枚举全部 finished 会话并在下次同步时上传。
 *
 * 用法（在 FocusLink/ 下）：
 *   node scripts/maintenance/backfill-session.cjs \
 *     --start "2026-10-15 14:02:02" --minutes 60 \
 *     --task-id <local task id> --task-title "第二章第五节" --subject 数学 \
 *     --note "断网补录（实时会话未落库）"
 *   加 --apply 才真正写库。
 *
 * 只写 focus_sessions + focus_segments 两行；不动番茄库、不动 sync_queue、
 * 不动 remote_writeback_queue，不启动 Electron。
 */
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const Database = require('better-sqlite3');

const appData =
  process.env.APPDATA ?? path.join(process.env.USERPROFILE ?? '.', 'AppData', 'Roaming');
const dbPath = path.join(appData, 'FocusLink', 'focuslink.db');
const MINUTE_MS = 60 * 1000;

function parseArgs(argv) {
  const options = { taskSource: 'local', apply: false, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--apply') options.apply = true;
    else if (key === '--force') options.force = true;
    else if (key.startsWith('--')) {
      options[key.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[i + 1];
      i += 1;
    }
  }
  return options;
}

/** 按本地时区解析 "YYYY-MM-DD HH:mm:ss"，避免 new Date(字符串) 的 UTC 歧义。 */
function parseLocalTime(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    String(text ?? ''),
  );
  if (!match) throw new Error(`--start 需要 "YYYY-MM-DD HH:mm:ss" 形式，收到 ${text}`);
  const [, y, mo, d, h, mi, s] = match.map(Number);
  return new Date(y, mo - 1, d, h, mi, s ?? 0, 0).getTime();
}

function stamp(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function startOfLocalToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.start) throw new Error('缺少 --start');
  const minutes = Number(options.minutes);
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('--minutes 需要正数');

  const startedAt = parseLocalTime(options.start);
  const endedAt = options.end ? parseLocalTime(options.end) : startedAt + minutes * MINUTE_MS;
  const activeElapsedMs = endedAt - startedAt;

  const session = {
    id: randomUUID(),
    title: options.taskTitle ?? null,
    status: 'finished',
    startedAt,
    endedAt,
    activeElapsedMs,
    pauseElapsedMs: 0,
    wallElapsedMs: activeElapsedMs,
    defaultTaskId: options.taskId ?? null,
    defaultTaskSource: options.taskId ? options.taskSource : null,
    defaultTaskTitle: options.taskTitle ?? null,
    tomatodoSubject: options.subject ?? null,
    note: options.note ?? null,
    createdAt: startedAt,
    updatedAt: endedAt,
  };
  const segment = {
    id: randomUUID(),
    sessionId: session.id,
    taskId: session.defaultTaskId,
    taskSource: session.defaultTaskSource,
    title: session.title,
    startedAt,
    endedAt,
    activeElapsedMs,
    createdAt: startedAt,
    updatedAt: endedAt,
  };

  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  const activeSessions = db
    .prepare("SELECT id, started_at FROM focus_sessions WHERE status = 'active'")
    .all();
  const sameStart = db.prepare('SELECT id FROM focus_sessions WHERE started_at = ?').get(startedAt);
  const todayBefore = db
    .prepare(
      'SELECT COUNT(*) AS count, COALESCE(SUM(active_elapsed_ms), 0) AS active FROM focus_sessions WHERE started_at >= ?',
    )
    .get(startOfLocalToday());

  console.log(`库：${dbPath}`);
  console.log(
    `今天已录入：${todayBefore.count} 场 / ${Math.round(todayBefore.active / 60000)} 分钟专注`,
  );
  console.log('将要补录：');
  console.log(
    `  ${stamp(startedAt)} → ${stamp(endedAt)}  ${Math.round(activeElapsedMs / 60000)} 分钟专注（无暂停）`,
  );
  console.log(
    `  任务：${session.defaultTaskTitle ?? '未关联'}${options.subject ? ` · ${options.subject}` : ''}`,
  );
  console.log(`  会话 id：${session.id}`);

  if (activeSessions.length > 0 && !options.force) {
    console.log(`\n拒绝写入：库里还有未结束会话 ${activeSessions.map((s) => s.id).join(', ')}`);
    process.exitCode = 1;
    return;
  }
  if (sameStart && !options.force) {
    console.log(
      `\n拒绝写入：已经有一场会话从同一时刻开始（${sameStart.id}），加 --force 才重复补录`,
    );
    process.exitCode = 1;
    return;
  }
  if (!options.apply) {
    console.log('\ndry-run：确认无误后加 --apply 才会写库');
    return;
  }

  const write = db.transaction(() => {
    db.prepare(
      `INSERT INTO focus_sessions
        (id, title, status, started_at, ended_at, active_elapsed_ms, pause_elapsed_ms,
         wall_elapsed_ms, default_task_id, default_task_source, default_task_title,
         tomatodo_subject, note, created_at, updated_at)
       VALUES (@id, @title, @status, @startedAt, @endedAt, @activeElapsedMs, @pauseElapsedMs,
         @wallElapsedMs, @defaultTaskId, @defaultTaskSource, @defaultTaskTitle,
         @tomatodoSubject, @note, @createdAt, @updatedAt)`,
    ).run(session);
    db.prepare(
      `INSERT INTO focus_segments
        (id, session_id, task_id, task_source, title, started_at, ended_at,
         active_elapsed_ms, note, cloud_focus_id, tomatodo_subject, tomatodo_record_name,
         created_at, updated_at)
       VALUES (@id, @sessionId, @taskId, @taskSource, @title, @startedAt, @endedAt,
         @activeElapsedMs, NULL, NULL, NULL, NULL, @createdAt, @updatedAt)`,
    ).run(segment);
  });
  write();

  const readback = db.prepare('SELECT * FROM focus_sessions WHERE id = ?').get(session.id);
  const todayAfter = db
    .prepare(
      'SELECT COUNT(*) AS count, COALESCE(SUM(active_elapsed_ms), 0) AS active FROM focus_sessions WHERE started_at >= ?',
    )
    .get(startOfLocalToday());
  console.log(`\n已写入 ${stamp(readback.started_at)} → ${stamp(readback.ended_at)}`);
  console.log(
    `今天现在：${todayAfter.count} 场 / ${Math.round(todayAfter.active / 60000)} 分钟专注`,
  );
  console.log('下一步：FocusLink 运行中且网络恢复后，Sync v2 会自动把这条会话上传到云端');
}

try {
  main();
} catch (error) {
  console.error(`补录失败：${error.message}`);
  process.exitCode = 1;
}
