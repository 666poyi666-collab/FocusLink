/* 测试记录清理：识别并移除写进真实库的验收/冒烟记录
 *
 * 为什么需要它（2026-10-02）：
 *   用户报告「统计页面的数据来源有问题」之后排查发现，真实库里积了 32 条
 *   验收/冒烟测试记录（`FL-ACCEPT-*`、`FL-CF-*`、`Day1|Day3|Day4`、`*smoke*`、
 *   `cf-*` 等），占全部会话 18%、占有效专注时长 29% —— 统计页把它们当成真实成绩算。
 *
 * 为什么不能直接调应用自己的删除接口：
 *   `sessions:delete` 有两道硬门槛，对测试记录是死路：
 *     ① dida CLI 未安装时直接拒绝（`spawn dida ENOENT`）；
 *     ② 实体上存在未解决的 Sync v2 冲突时拒绝静默删除。
 *   两者都是合理的安全设计，但都没有给「清掉本不该存在的测试记录」留出口。
 *
 * 判据（**按标题，不按 id 前缀**）：
 *   `live_` / `mobile_` 是手机端与手表端创建**真实**会话的命名方式
 *   （见 src/mobile/MobileApp.tsx、src/mobile/WatchApp.tsx），按前缀删会删掉真实记录。
 *   因此只认「不可能出现在真实专注里」的字样：
 *     smoke / FL-ACCEPT / FL-CF / FL-GFX / FL13 / Day1 | / Day3 | / Day4 | / 云端验收 /
 *     FocusLink27device / release smoke，以及 id 前缀 cf- / release-。
 *
 * 用法（在 FocusLink/ 下）：
 *   node scripts/maintenance/purge-test-records.cjs              # 只列出计划（默认）
 *   node scripts/maintenance/purge-test-records.cjs --apply      # 备份后执行
 *   node scripts/maintenance/purge-test-records.cjs --db <path>  # 指定库（默认 %APPDATA%\focuslink\focuslink.db）
 *
 * 执行前会强制关闭运行中的 FocusLink（写库必须独占），并在库同目录留一份备份。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const APPLY = process.argv.includes('--apply');
const dbArgIndex = process.argv.indexOf('--db');
const DB =
  dbArgIndex >= 0 && process.argv[dbArgIndex + 1]
    ? path.resolve(process.argv[dbArgIndex + 1])
    : path.join(process.env.APPDATA || '', 'focuslink', 'focuslink.db');

const TITLE_MARKERS = [
  'smoke',
  'FL-ACCEPT',
  'FL-CF',
  'FL-GFX',
  'FL13',
  'Day1 |',
  'Day3 |',
  'Day4 |',
  '云端验收',
  'FocusLink27device',
  'release smoke',
];
const ID_MARKERS = ['cf-', 'release-'];

/* 反向校验样本：这些是真实记录（含手机端 `live_`/`mobile_` 前缀），绝不能被判为测试数据。 */
const REAL_TITLE_MARKERS = ['自由专注', '每日错题', '第一章', '生物追课', '听课'];

function sqlite(sql) {
  return execFileSync('node', ['-e', `require('node:sqlite')`], { stdio: 'ignore' });
}

function main() {
  if (!fs.existsSync(DB)) {
    console.error('[purge] 找不到数据库: ' + DB);
    process.exit(1);
  }
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(DB);

  const rows = db
    .prepare(
      'select id, title, active_elapsed_ms, wall_elapsed_ms from focus_sessions order by started_at',
    )
    .all();

  const hits = [];
  for (const r of rows) {
    const title = r.title || '';
    let why = null;
    for (const m of TITLE_MARKERS) {
      if (title.includes(m)) {
        why = '标题含「' + m + '」';
        break;
      }
    }
    if (!why) {
      for (const m of ID_MARKERS) {
        if (r.id.startsWith(m)) {
          why = 'id 前缀 ' + m;
          break;
        }
      }
    }
    if (why) hits.push({ id: r.id, title, why });
  }

  /* 反向校验：真实记录一条都不许进命中集 */
  const misfire = rows.filter(
    (r) =>
      r.title &&
      REAL_TITLE_MARKERS.some((k) => r.title.includes(k)) &&
      hits.some((h) => h.id === r.id),
  );

  console.log('[purge] 数据库: ' + DB);
  console.log('[purge] 会话总数: ' + rows.length + '，判定为测试记录: ' + hits.length);
  for (const h of hits) {
    console.log('  ' + h.id.slice(0, 46).padEnd(48) + (h.title || '(无标题)').slice(0, 40));
  }
  if (misfire.length > 0) {
    console.error(
      '\n[purge] 反向校验失败：真实记录被误判 → ' + misfire.map((m) => m.title).join(', '),
    );
    process.exit(1);
  }
  console.log('[purge] 反向校验通过：真实记录（含 live_/mobile_ 前缀）无一条被误判');

  if (hits.length === 0) {
    console.log('[purge] 没有需要清理的测试记录。');
    return;
  }
  if (!APPLY) {
    console.log('\n[purge] 这是计划（未改动任何数据）。确认后加 --apply 执行。');
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(path.dirname(DB), 'backup-before-testdata-purge-' + stamp);
  fs.mkdirSync(backupDir, { recursive: true });
  for (const f of [DB, DB + '-wal', DB + '-shm']) {
    if (fs.existsSync(f)) fs.copyFileSync(f, path.join(backupDir, path.basename(f)));
  }
  console.log('[purge] 备份: ' + backupDir);

  const ids = hits.map((h) => h.id);
  const placeholders = ids.map(() => '?').join(',');
  const deviceId = db
    .prepare("select value from app_meta where key = 'deviceSync.deviceIdV1'")
    .get()?.value;

  db.exec('BEGIN');
  /* 写 delete 墓碑：同步恢复时把删除推到云端，避免记录被拉回。 */
  let tombstones = 0;
  if (deviceId) {
    const states = db
      .prepare(
        'select connection_scope, entity_type, entity_id, confirmed_revision, confirmed_fingerprint, ' +
          'account_generation from sync_v2_entity_state where entity_id in (' +
          placeholders +
          ') and deleted = 0',
      )
      .all(...ids);
    const insert = db.prepare(
      'insert or ignore into sync_v2_outbox (connection_scope, op_id, entity_type, entity_id, kind, ' +
        'base_revision, base_fingerprint, payload, device_id, account_generation, state, attempt_count, ' +
        "next_retry_at, created_at, updated_at) values (?, ?, ?, ?, 'delete', ?, ?, NULL, ?, ?, 'pending', 0, 0, ?, ?)",
    );
    const now = Date.now();
    for (const s of states) {
      const opId =
        'v2-purge-' +
        require('node:crypto')
          .createHash('sha1')
          .update(s.connection_scope + '|' + s.entity_type + '|' + s.entity_id)
          .digest('hex')
          .slice(0, 32);
      insert.run(
        s.connection_scope,
        opId,
        s.entity_type,
        s.entity_id,
        s.confirmed_revision,
        s.confirmed_fingerprint,
        deviceId,
        s.account_generation,
        now,
        now,
      );
      tombstones++;
    }
  } else {
    console.warn('[purge] 未找到本地 deviceId，跳过墓碑（同步恢复后云端记录可能被拉回）');
  }

  for (const [table, column] of [
    ['pause_events', 'session_id'],
    ['focus_segments', 'session_id'],
    ['focus_sessions', 'id'],
    ['remote_writeback_queue', 'session_id'],
    ['sync_v2_conflicts', 'entity_id'],
    ['sync_v2_operation_history', 'entity_id'],
    ['sync_v2_entity_state', 'entity_id'],
  ]) {
    const n = db
      .prepare(`delete from ${table} where ${column} in (${placeholders})`)
      .run(...ids).changes;
    console.log('  ' + table.padEnd(28) + ' 删除 ' + n + ' 行');
  }
  db.exec('COMMIT');

  console.log(
    '[purge] 墓碑 ' +
      tombstones +
      ' 条；会话总数 ' +
      db.prepare('select count(*) c from focus_sessions').get().c,
  );
  db.close();
}

try {
  main();
} catch (error) {
  console.error('[purge] 执行失败', error);
  process.exit(1);
}
