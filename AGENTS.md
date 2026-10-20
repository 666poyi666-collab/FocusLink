# FocusLink Project Rules

This file is for AI agents and maintainers working in this repository.

## Product Boundary

FocusLink is a desktop productivity tool:

- focus timer
- focus session / segment ledger
- dida / TickTick task association
- local-first sync queue

Do not turn it into a chat app, generic dashboard, or landing page.

## Iteration Preflight (Hard Gate)

- Before planning or changing any iteration, read the current-version entry and unresolved Bug records in `FocusLink/backend-design/IMPLEMENTATION_LOG.md`, the applicable stable error entries in `FocusLink/backend-design/SYNC_TROUBLESHOOTING.md`, and all of `FocusLink/backend-design/TEST_AND_RELEASE.md`.
- This read is a hard gate, not optional background material. Record new product-level Bug evidence and root cause in `IMPLEMENTATION_LOG.md`; put repeatable diagnosis under a stable `FL-SYNC-*` or `FL-INSTALL-*` entry. Do not create parallel Bug logs, one-off incident reports, or a new `docs/` tree.
- When a prior failure and the current probe disagree, preserve both facts with timestamps. Classify transport reachability, authentication, durable conflicts, and third-party delivery separately; a non-empty historical `lastError` must not by itself be presented as a current connection failure.

## Report Output Standard (报告输出规范)

Every user-facing report — analysis, audit, iteration summary, failure review — uses this exact skeleton, in this order, for both chat replies and documents committed to the repo.

1. `结论` — at most 3 lines: one judgement sentence plus a status word (`已完成` / `进行中` / `阻塞`).
2. `事实` — one table with exactly these columns: `序号 | 事实 | 证据位置 | 证据类型`. `证据位置` is `path:line`; `证据类型` is exactly one of `实测` / `证据记录` / `推断`.
3. `问题` — grouped `P0` / `P1` / `P2`, one line each: `级别 + 标题 — 影响 — 证据序号`.
4. `改动` — files changed (`path` + one phrase each; write `无` when nothing changed), then at most one open decision question.

Hard rules:

- Never present a revision of an earlier statement inside the body ("上一版说错了…"). The corrected version is the only version; list the delta as one line under `改动`.
- No repeated conclusions, no heading nesting deeper than 2 levels, no list item longer than 2 lines, no table longer than 10 rows.
- Never mix verified fact with inference: anything not actually run or read this round is `证据记录` or `推断`, never `实测`.
- `实测` means the command was run and its exit code or output read in that round; a document claim is never `实测`.
- No long URLs in the body; link with a short label only.
- Every number carries a unit and how it was obtained.
- Do not emit a report whose `事实` table repeats what the `问题` lines already say.

## Directory Ownership

- `FocusLink/src/`: renderer UI only.
- `FocusLink/src/mobile/`: the responsive Web/PWA/Capacitor renderer; it must not duplicate Electron business services or claim unavailable desktop capabilities.
- `FocusLink/electron/`: Electron main process, SQLite access, timer manager, dida CLI provider, sync queue.
- `FocusLink/shared/`: shared types, version constants, and pure policies.
- `FocusLink/cloud/`: FocusLink device-sync HTTP backend only. The current implementation is a loopback-first test backend, not a production identity service.
- `FocusLink/mobile/`: mobile/Web HTML entry and PWA static assets only; TypeScript UI stays in `src/mobile/`.
- `FocusLink/android/`: generated Capacitor Android shell and thin native integrations only; do not copy TypeScript product logic into Kotlin/Java.
- `FocusLink/frontend-design/`: the only product/UI/interaction documentation tree; begin at `FocusLink/frontend-design/README.md`.
- `FocusLink/backend-design/`: the only architecture/IPC/data/test/release documentation tree; begin at `FocusLink/backend-design/README.md`.
- `FocusLink/`: the only source workspace. Build, test, design, and development commands run from here.
- `.github/`: issue forms, the canonical GitHub Release notes template, and the release-record gate workflow only. The workflow verifies metadata and source gates; it never publishes.
- `release-v*/`: the local four-file delivery directory. Installers, portable executables and `SHA256SUMS.txt` **never enter Git**; only `RELEASE_NOTES.md` is tracked as that version's release record.

Do not recreate `docs/`, `backend/`, `shared-contract/`, design archives, one-off fix reports, or parallel handoff documents. Reusable conclusions belong in one of the two specifications; version history belongs in root `CHANGELOG.md` and the matching release notes.

Do not add parallel source trees for the same feature.

## Dida Sync Rules

The dida CLI path has sharp edges. Preserve these rules:

- For dida CLI, write FocusLink sync records to task comments first.
- Fall back to task content only if comments fail.
- Checklist items are not normal tasks. Resolve the parent task and operate on the parent where dida requires it.
- Completing a checklist item means updating the parent task `items` array and setting the target item status to `2`.
- Use `execFile` / argument arrays for dida write operations. Do not build shell command strings for Chinese text, newlines, or JSON.
- Every synced segment must carry a stable marker like `[FocusLink:segment:<id>]`.
- Before writing, read existing comments/content and skip records whose marker already exists.
- Treat dida output `undefined` as failure, not success.

## TomaToDo Sync Rules

- Verify the TomaToDo CDP target by its title and required `electronAPI` methods before any read or write.
- User-triggered upload may launch a stopped standard TomaToDo installation with an argument array, loopback-only debugging, and port `0`; background retries must never launch an external app.
- If TomaToDo is already running without a verified bridge, return `restart-required`. Never terminate or silently restart the user's process.
- `cloudSyncUploadRecord` success means `上传已确认`; it is not independent cloud readback.
- The current client has no PCRecord remote-delete API. Keep cleanup labeled `local-record-only` and never claim remote cleanup was verified.

## UI Language Rules

Keep state labels precise:

- Use `已关联` / `未关联` only for local task association.
- Use `已同步` / `未同步` / `同步失败` only for cloud sync queue state.
- Do not use vague labels such as `可同步`.
- If a session has linked segments but no session default task, collapsed history rows must not say `未关联`.
- dida CLI sync should be described as `同步到滴答清单`; if fallback happens, mention task content only in diagnostics.

## Mini Window Rules

- Mini window has two fixed sizes: collapsed and expanded.
- `FocusLink/shared/miniWindowLayout.ts` is the only executable numeric size source. Do not duplicate sizes in Electron, CSS, settings, or tests; documentation may mirror current acceptance values but must change in the same patch as the constants.
- Do not reintroduce freeform resizing or a third size.
- Collapsed mode is a compact edge progress bar showing only progress/state, current time, and the expand affordance.
- Expanded mode is a dense control console showing the task, current time, cumulative focus/pause/total, and all current controls without nested cards.
- After a native drag is released near a display work-area edge, snap first and then auto-collapse. Never steal the pointer during drag.
- Expand toward the inside of the current display and clamp to its work area; cover multi-display and DPI behavior in layout tests and smoke tests.

## Three-Device Install Gate (硬性死命令, OPPO retired 2026-08-11)

- Every cross-device UI or behavior candidate must increment the patch version. Do not reuse an APK or Windows build number for another iteration.
- Every iteration ends by ACTUALLY INSTALLING the new build, not just packaging it:
  - Windows: silent overwrite install (`installer /S`) on this PC, then read back the uninstall-registry DisplayVersion and the installed `FocusLink.exe` file version, and relaunch the app.
  - The designated Xiaomi phone and the designated Huawei tablet: `adb install -r` the same-version APK and read back `versionName/versionCode`.
- OPPO OWW221 is retired from FocusLink development and release validation as of 2026-08-11; do not install, smoke, or claim support for the watch in new iterations. Preserve historical watch records as history only.
- Windows, Xiaomi and Huawei must run the same version before the iteration is marked complete, packaged, tagged, or released. Record the three-device install matrix; a missing, stale, or unreachable endpoint is a failed gate and must be reported as such — never claim an install that did not happen.
- Preserve the two-state Windows mini window, the active Huawei capsule layout module, and the Xiaomi system-surface path unless the current change explicitly replaces them and re-runs their acceptance tests. The retired OPPO renderer is frozen and out of scope.

## Verification Before Release

Run these from `FocusLink/` before packaging:

```bash
npm run format:check
npm run typecheck
npm run lint
npm test
npm run build
npm run dist
```

For dida sync changes, also run a real temporary dida task test:

- create a temporary task
- add a FocusLink comment with Chinese text and a marker
- list comments and verify the marker exists once
- repeat the write and verify it is skipped
- verify normal-task complete/uncomplete, and checklist parent-item mutation when those paths changed
- delete the temporary task

## Git LFS Disk Safety

- Since 2026-10-17 (user directive) release executables **never enter Git**: `release-v*/` tracks only `RELEASE_NOTES.md`, and installers/portables/`SHA256SUMS.txt` are distributed as GitHub Release assets. The ~2.6 GB of already-committed LFS objects stay in Git history, so an ordinary `git diff`, GUI change scan, or repeated status poll across historical `release-v*/FocusLink-*-x64*.exe` paths can still invoke `git-lfs filter-process` and fill `.git/lfs/tmp` with hundreds of gigabytes. Keep excluding those paths from read-only inspection.
- Never `git add` an installer, portable executable, or `SHA256SUMS.txt`, and never re-enable a directory-level `release-v*/` ignore rule: `.gitignore` must keep `release-v*/*` plus `!release-v*/RELEASE_NOTES.md`, otherwise Git cannot re-include the notes file.
- If `.git/lfs/tmp` grows unexpectedly, stop the repeating Git client/command and identify the parent process before deleting anything. Delete temporary files only after no `git-lfs` process is active; never delete `.git/lfs/objects` as if it were temporary storage.
- A local `.git/info/attributes` override may be used to stop a broken GUI watcher, but it must never be committed.
- Before and after packaging, record the size of `.git/lfs/tmp`. A non-empty or growing directory is a failed release hygiene check and must be resolved before continuing.
- Any script that launches the GUI must reap the instance it started and read the pid back as gone. A leftover "visible-looking" instance holds the Electron single-instance lock and makes the user's desktop icon appear dead (`FL-INSTALL-012`); use `npm run smoke:window-visible:launch` for scripted launches and never `Stop-Process` every `FocusLink.exe`.

## Release Rules

- User version cadence (2026-10-02): start the current UI iteration at `1.5.0`, then `1.5.1` through `1.5.9`, then `1.6.0`. Patch numbers are limited to `0`–`9`; do not continue `1.3.22` or produce `1.5.10`. Preserve old version entries as history.

- Follow `FocusLink/backend-design/TEST_AND_RELEASE.md`; its gates are mandatory.
- Push every change and every version to GitHub `main` as it lands. The former five-version (`0`/`5`) checkpoint cadence is removed (user directive, 2026-07-26); do not hold source back locally.
- Every patch still requires a completed CHANGELOG entry, the device install matrix, a four-file local release directory, `npm run release:verify` green on the release record, and a backed-up Android APK. Installers stay local files and GitHub Release assets; they are never Git objects.
- Formal GitHub Releases (public tag + uploaded executables) are created when the user explicitly asks for one; the remaining rules in this section govern that flow.
- Bump `FocusLink/package.json`, `FocusLink/package-lock.json`, `FocusLink/shared/version.ts`, `FocusLink/electron-builder.yml`, root README, root CHANGELOG, both design-spec versions, and release notes together.
- Use release directories like `release-v029` for `0.2.9` and `release-v0210` for `0.2.10`.
- Keep only the latest three release directories in the repo.
- Each release directory may contain only the installer, portable executable, `SHA256SUMS.txt`, and `RELEASE_NOTES.md`; remove `win-unpacked`, debug YAML, blockmaps, logs, screenshots, and test results. Only `RELEASE_NOTES.md` is tracked by Git.
- Generate the final artifacts from a clean commit, then verify installer/portable startup and recompute SHA256.
- Copy the completed `.github/RELEASE_NOTES_TEMPLATE.md` to the matching release directory and keep it consistent with the top CHANGELOG entry; a local candidate may say `候选补丁`, a public release must say `正式版` plus `验证状态：已通过`.
- `.github/workflows/release.yml` is a record-and-source gate only; it never publishes. Publishing is `npm run release:publish` (`FocusLink/scripts/release/publish.ps1`) run locally after the device gates pass: it creates the annotated tag, pushes `main` and the tag, creates the GitHub Release with the locally built assets, then reads the Release back.
- Git push or tag push alone is never a completed release. Read back the GitHub Release and verify its tag, target commit, body, asset names, sizes, and download links.
- If authenticated GitHub Release creation fails, report the release as blocked; do not claim it is published.
