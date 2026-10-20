import { describe, expect, it } from 'vitest';

import {
  evaluateReleaseRecord,
  releaseDirectoryName,
} from '../scripts/release/verify-release-record.mjs';

const VERSION = '1.6.6';
const COMMIT = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const INSTALLER_SHA = '1'.repeat(64);
const PORTABLE_SHA = '2'.repeat(64);

function releaseNotes() {
  return [
    `# FocusLink v${VERSION}`,
    '',
    '> 发布日期：2026-10-17',
    '>',
    `> 对应提交：\`${COMMIT.slice(0, 7)}\``,
    '>',
    '> 发布类型：候选补丁（未创建公开 tag / GitHub Release）',
    '>',
    '> 验证状态：Windows 门禁全部通过',
    '',
    '## 下载与校验',
    '',
    '| 文件 | SHA256 |',
    '| --- | --- |',
    `| \`FocusLink-${VERSION}-x64.exe\` | \`${INSTALLER_SHA}\` |`,
    `| \`FocusLink-${VERSION}-x64-portable.exe\` | \`${PORTABLE_SHA}\` |`,
    '',
  ].join('\n');
}

type ReleaseRecordInput = {
  version: string;
  files: Record<string, string>;
  releaseDirEntries: string[] | null;
};

type ReleaseCheck = { name: string; ok: boolean; actual: string };

function validInput(): ReleaseRecordInput {
  return {
    version: VERSION,
    files: {
      packageJson: JSON.stringify({ version: VERSION }),
      packageLock: JSON.stringify({ version: VERSION, packages: { '': { version: VERSION } } }),
      sharedVersion: `export const APP_VERSION = '${VERSION}';\nexport const APP_RELEASE_DIR = '${releaseDirectoryName(VERSION)}';\n`,
      electronBuilder: `output: ../${releaseDirectoryName(VERSION)}\n`,
      gradle: `versionCode 1342\nversionName "${VERSION}"\n`,
      gradleTest: `assertEquals("${VERSION}", BuildConfig.VERSION_NAME);\n`,
      readme: `# FocusLink\n\n> 当前版本：v${VERSION}\n`,
      changelog: `# Changelog\n\n## v${VERSION} - 2026-10-17（交付管道与仓库清理）\n`,
      frontendReadme: `> 当前 Windows 版本：v${VERSION}（v1.6）\n`,
      backendReadme: `> 当前 Windows 版本：v${VERSION}（v1.6）\n`,
      notes: releaseNotes(),
    },
    releaseDirEntries: [
      `FocusLink-${VERSION}-x64.exe`,
      `FocusLink-${VERSION}-x64-portable.exe`,
      'SHA256SUMS.txt',
      'RELEASE_NOTES.md',
    ],
  };
}

function resultOf(input: ReleaseRecordInput, name: string): ReleaseCheck {
  const { results } = evaluateReleaseRecord(input) as { results: ReleaseCheck[] };
  const result = results.find((item) => item.name === name);
  expect(result, `missing check: ${name}`).toBeDefined();
  return result as ReleaseCheck;
}

describe('release record contract', () => {
  it('accepts a fully aligned record', () => {
    const { ok, results } = evaluateReleaseRecord(validInput());
    expect(results.filter((result) => !result.ok)).toEqual([]);
    expect(ok).toBe(true);
  });

  it('rejects a package.json version that does not match the release version', () => {
    const input = validInput();
    input.files.packageJson = JSON.stringify({ version: '1.6.5' });
    expect(resultOf(input, 'package.json version').ok).toBe(false);
    expect(evaluateReleaseRecord(input).ok).toBe(false);
  });

  it('rejects a package-lock root version drift', () => {
    const input = validInput();
    input.files.packageLock = JSON.stringify({
      version: VERSION,
      packages: { '': { version: '1.6.5' } },
    });
    expect(resultOf(input, 'package-lock.json version (top level + root package)').ok).toBe(false);
  });

  it('rejects a release directory name drift in shared/version.ts', () => {
    const input = validInput();
    input.files.sharedVersion = `export const APP_VERSION = '${VERSION}';\nexport const APP_RELEASE_DIR = 'release-v165';\n`;
    expect(resultOf(input, 'shared/version.ts APP_RELEASE_DIR').ok).toBe(false);
  });

  it('requires exactly one README current-version line', () => {
    const missing = validInput();
    missing.files.readme = '# FocusLink\n\n> 当前 Windows 候选：v1.6.6\n';
    expect(
      resultOf(missing, 'README current version line (exactly one, matches package.json)').ok,
    ).toBe(false);

    const duplicated = validInput();
    duplicated.files.readme = `> 当前版本：v${VERSION}\n> 当前版本：v${VERSION}\n`;
    expect(
      resultOf(duplicated, 'README current version line (exactly one, matches package.json)').ok,
    ).toBe(false);
  });

  it('rejects a CHANGELOG top entry that is not the released version', () => {
    const input = validInput();
    input.files.changelog = '# Changelog\n\n## v1.6.5 - 2026-10-15（小窗）\n';
    expect(resultOf(input, 'CHANGELOG top version').ok).toBe(false);
  });

  it('rejects release notes without a verification status', () => {
    const input = validInput();
    input.files.notes = releaseNotes().replace(/^> 验证状态：.*$/m, '> 状态：待填');
    expect(resultOf(input, 'release notes 验证状态').ok).toBe(false);
  });

  it('rejects release notes missing the portable executable SHA256 row', () => {
    const input = validInput();
    input.files.notes = releaseNotes()
      .split('\n')
      .filter((line) => !line.includes(`FocusLink-${VERSION}-x64-portable.exe`))
      .join('\n');
    expect(resultOf(input, 'release notes SHA256 row (x64-portable)').ok).toBe(false);
  });

  it('rejects a local release directory that is not the four-file set', () => {
    const input = validInput();
    input.releaseDirEntries = [
      `FocusLink-${VERSION}-x64.exe`,
      'SHA256SUMS.txt',
      'RELEASE_NOTES.md',
    ];
    expect(resultOf(input, `${releaseDirectoryName(VERSION)} local four-file set`).ok).toBe(false);
  });

  it('skips the local four-file check when the directory is absent (CI checkout)', () => {
    const input = validInput();
    input.releaseDirEntries = null;
    const { ok, results } = evaluateReleaseRecord(input);
    expect(results.some((result) => result.name.endsWith('local four-file set'))).toBe(false);
    expect(ok).toBe(true);
  });
});
