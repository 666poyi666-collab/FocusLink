import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const mobileAppSource = fs.readFileSync(
  path.join(process.cwd(), 'src', 'mobile', 'MobileApp.tsx'),
  'utf8',
);

function countOccurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

describe('mobile task write commit gate', () => {
  it('cancels every cloud task write on an account transition', () => {
    const writeCalls =
      mobileAppSource.match(/await (?:publishTaskSnapshot|mutateTaskSnapshot)\(/g) ?? [];
    expect(writeCalls.length).toBe(7);
    expect(countOccurrences(mobileAppSource, 'const write = beginTaskWrite();')).toBe(7);
    expect(countOccurrences(mobileAppSource, 'signal: write.signal,')).toBe(6);
    // The durable task-create worker combines its own lifecycle cancellation with the account lease.
    expect(mobileAppSource).toContain(
      "write.signal.addEventListener('abort', abort, { once: true });",
    );
    expect(mobileAppSource).toContain('signal: controller.signal,');
    expect(mobileAppSource).toContain('!controller.signal.aborted && write.canCommit()');
    expect(countOccurrences(mobileAppSource, '} finally {\n        write.finish();')).toBe(6);
    expect(countOccurrences(mobileAppSource, '      taskWrites.invalidate();')).toBe(1);
  });

  it('re-checks the account identity before committing a task write and its cache write', () => {
    expect(countOccurrences(mobileAppSource, 'if (!write.canCommit()) return;')).toBe(10);
    expect(
      countOccurrences(
        mobileAppSource,
        "if (!write.canCommit()) throw new Error('账号已切换，本次清单创建已取消');",
      ),
    ).toBe(1);
    expect(
      countOccurrences(
        mobileAppSource,
        'if (!write.canCommit()) return;\n            await writeCachedTaskSnapshot(',
      ),
    ).toBe(6);
    expect(mobileAppSource).toContain(
      'await writeCachedTaskSnapshot(reconciled.snapshot, localTaskScope);',
    );
  });

  it('derives the write gate from the shared request group lease', () => {
    expect(mobileAppSource).toContain('const lease = taskWrites.issue(connectionKey);');
    expect(mobileAppSource).toContain('requestCurrent: lease.isCurrent(),');
    expect(mobileAppSource).toContain('requestConnectionKey: connectionKey,');
    expect(countOccurrences(mobileAppSource, 'isMobileAccountRequestCommitCurrent({')).toBe(4);
  });

  it('guards the native ledger projection and the live snapshot cache write by identity', () => {
    expect(
      countOccurrences(
        mobileAppSource,
        'if (!isCurrent()) return;\n          setLedgerRejectedCount(v2Status?.rejected ?? 0);\n          await updateNativeAuthorityProjectionHistory(',
      ),
    ).toBe(1);
    expect(
      countOccurrences(
        mobileAppSource,
        'if (!canCommit()) return;\n            await writeCachedLiveFocusSnapshot(',
      ),
    ).toBe(1);
    expect(
      countOccurrences(mobileAppSource, 'connectionKeyRef.current !== sourceConnectionKey'),
    ).toBeGreaterThanOrEqual(2);
  });
});
