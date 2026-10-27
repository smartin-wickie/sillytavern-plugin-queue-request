---
phase: 03-full-queue-control-ui
plan: 01
subsystem: ui
tags: [sillytavern, extension, abortcontroller, vitest, dom]

# Dependency graph
requires:
  - phase: 02-queue-runner-adapter
    provides: store.js (add/drop/markRunning/markDone/getItems/pendingCount/runningCount/getMaxQueueSize), runner.js (wake/pause/resume/onItemFailed/offItemFailed), adapter.js (capture/send/cleanAndExtract/isSuccessful/abortOwn)
provides:
  - runner.abortRunning()/onItemDone()/offItemDone() — the per-item AbortController now lives in runner.js, not index.js's generate() closure
  - src/queueActions.js cancelAll(store, runner) — the one shared cancel-all implementation for this phase's remaining plans (wand menu, slash commands, progress bar)
  - Cancel dropdown anchored to .qs-queue-badge with per-item (x), Cancel running, Cancel all
affects: [03-02-wand-menu-and-slash-commands, 03-03-progress-bar, 03-04-settings-panel]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Runner owns the per-item AbortController (runningController), set immediately before generate() and cleared in a finally; abortRunning() delegates to adapter.js's abortOwn(), never ST's stopGeneration()"
    - "Dropdown panel element created once per control and persisted across re-renders; its row list is rebuilt fresh from store.getItems() on every render call, never cached"
    - "Per-item cancel re-checks live item status immediately before store.drop() to guard against a render/click race with the runner promoting the same item to running"

key-files:
  created: [src/queueActions.js, test/queueActions.test.js]
  modified: [src/runner.js, src/ui.js, style.css, index.js, test/runner.test.js]

key-decisions:
  - "Mocked ../src/adapter.js in test/runner.test.js (vi.mock) because adapter.js transitively imports st-bridge.js, which imports ST's own script.js via a path that only resolves inside a live ST install — unresolvable under plain Vitest. The mock reimplements abortOwn's exact abort()+signal.aborted contract so abortRunning()'s delegation is still faithfully exercised."
  - "Used native <button type=\"button\"> elements for Cancel running/Cancel all (not the icon-only pattern used elsewhere in ui.js) for semantic/keyboard accessibility; the per-item cancel stays an <i class=\"fa-xmark\"> icon per the Copywriting Contract's trailing-x convention."

patterns-established:
  - "Pattern: shared cancel-all helper (cancelAll(store, runner)) imported by every cancel-all surface rather than re-derived per caller"

requirements-completed: []  # QUEUE-06/QUEUE-07 implemented in this plan but not yet marked complete — Task 3 (live ST 1.19.0 verification) is the unexecuted checkpoint that confirms end-to-end behavior before these requirements are considered validated.

# Metrics
duration: 35min
completed: 2026-10-26
---

# Phase 03 Plan 01: Runner Cancel Capability + Cancel Dropdown Summary

**Runner-owned AbortController exposing abortRunning()/onItemDone(), a shared cancelAll() helper, and a badge-anchored cancel dropdown with per-item/running/all cancel — pending live ST 1.19.0 verification (Task 3 checkpoint).**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-10-26T20:15:00-06:00 (approx.)
- **Completed:** 2026-10-26T20:39:12-06:00
- **Tasks:** 2 of 3 completed (Task 3 is a `checkpoint:human-verify` requiring a live ST 1.19.0 instance; not executable in this environment)
- **Files modified:** 7 (2 created, 5 modified)

## Accomplishments
- Moved the per-item `AbortController` out of `index.js`'s private `generate()` closure into `runner.js`, which now owns `runningController` and exposes `abortRunning()` — the one new capability every cancel surface in this phase needs
- Added `onItemDone(cb)`/`offItemDone(cb)`, mirroring the existing `onItemFailed`/`offItemFailed` pair exactly, firing immediately after `store.markDone(item.id)`
- Created `src/queueActions.js` exporting `cancelAll(store, runner)` as the single shared cancel-all implementation this phase's other plans (wand menu, slash commands, progress bar) will also call
- Built the cancel dropdown (`src/ui.js` `renderDropdown`) anchored to `.qs-queue-badge`: live pending-item rows with per-item `×`, a `Cancel running` button, a `Cancel all` button, outside-click dismissal, and auto-close when pending+running reaches 0

## Task Commits

Each task was committed atomically:

1. **Task 1: Runner abortRunning()/onItemDone() + shared cancelAll() helper** - `ea372ed` (feat)
2. **Task 2: Cancel dropdown anchored to the queue badge** - `1275c24` (feat)
3. **Task 3: Live verification — cancel dropdown against a running ST 1.19.0 instance** - NOT EXECUTED (checkpoint reached; requires a live ST 1.19.0 instance and manual DevTools inspection, unavailable in this worktree-execution environment)

**Plan metadata:** (this commit, `docs(03-01): complete plan` — see final commit below)

## Files Created/Modified
- `src/runner.js` - Owns `runningController` (fresh `AbortController` per item, cleared in `finally`); exports `abortRunning()`, `onItemDone()`, `offItemDone()`
- `src/queueActions.js` (new) - `cancelAll(store, runner)`: drops every queued item with reason `'cancelled'`, calls `runner.abortRunning()`, returns total cancelled count
- `index.js` - `generate(item, { signal } = {})` no longer constructs its own `AbortController`; receives the runner-owned signal instead
- `src/ui.js` - `renderDropdown(control, store, runner)`: badge-anchored cancel dropdown (per-item ×, Cancel running, Cancel all); badge click toggles it open; document-level outside-click closes it; force-closes at pending+running === 0
- `style.css` - New `qs-`-prefixed dropdown classes (`qs-queue-dropdown`, `qs-queue-dropdown--open`, `qs-dropdown-header`, `qs-dropdown-rows`, `qs-dropdown-row`, `qs-dropdown-cancel-item`, `qs-dropdown-cancel-running`, `qs-dropdown-cancel-all`); destructive color uses a placeholder `--crimson70a` variable flagged for live confirmation
- `test/runner.test.js` - Extended with `abortRunning()`/`onItemDone()`/`offItemDone()` coverage, plus a `vi.mock('../src/adapter.js', ...)` to keep the test graph out of the unresolvable `st-bridge.js` import chain
- `test/queueActions.test.js` (new) - Covers `cancelAll`'s three outcomes (nothing queued/running, pending only, pending + running)

## Decisions Made
- `test/runner.test.js` mocks `../src/adapter.js` rather than letting Vitest resolve the real module, because `adapter.js` → `st-bridge.js` → `../../../../../script.js` only resolves once this extension is deployed inside a live ST install. The mock's `abortOwn` reimplements the real function's exact contract (`controller.abort(); return { aborted: controller.signal.aborted }`), so `abortRunning()`'s delegation behavior is still genuinely exercised, not stubbed away.
- Cancel running/Cancel all render as native `<button type="button">` elements (not icon-only, unlike the existing badge/control icons) for keyboard/semantic accessibility; the per-item cancel keeps the icon-only `×` pattern specified by the Copywriting Contract.
- `style.css`'s destructive-color variable is a placeholder (`--crimson70a`) per the UI-SPEC's explicit "verify live, never guess from memory" rule for `--SmartTheme*`-family colors — left as a one-line comment pointing at Task 3's live-verification step, not silently guessed as final.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Mocked `../src/adapter.js` in `test/runner.test.js` to unblock `npx vitest run`**
- **Found during:** Task 1 (first test run after adding `import { abortOwn } from './adapter.js'` to `runner.js`)
- **Issue:** `runner.js` importing `adapter.js` transitively pulls in `src/st-bridge.js`, which imports ST's own `script.js`/`openai.js`/`reasoning.js`/`extensions.js`/`events.js` via relative paths (`../../../../../script.js`, etc.) that only resolve once this repo is deployed inside a live SillyTavern install's `public/scripts/extensions/third-party/<name>/` directory. Running `npx vitest run test/runner.test.js` outside that deployment context failed with `Error: Cannot find module '../../../../../script.js'`.
- **Fix:** Added `vi.mock('../src/adapter.js', () => ({ abortOwn: vi.fn(async (ownController) => { ownController.abort(); return { aborted: ownController.signal.aborted }; } ) }))` to `test/runner.test.js`, so the real `adapter.js`/`st-bridge.js` chain is never loaded by the test graph, while the mock's `abortOwn` still faithfully reproduces the real function's abort-then-report contract.
- **Files modified:** `test/runner.test.js`
- **Verification:** `npx vitest run test/runner.test.js test/queueActions.test.js` — 27/27 tests pass
- **Committed in:** `ea372ed` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to make the plan's own `<verify>` command (`npx vitest run test/runner.test.js test/queueActions.test.js`) actually runnable; no production code behavior changed by this fix — only the test file's import graph.

## Issues Encountered
None beyond the deviation documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Tasks 1 and 2 are code-complete, committed, and unit-tested (27/27 passing), with `node --check` passing on every modified/new `.js` file and every acceptance-criteria grep check in the plan passing. **Task 3 is an unexecuted `checkpoint:human-verify` (gate="blocking")**: it requires loading this extension into a live SillyTavern 1.19.0 instance, exercising all 7 numbered verification steps (queue 3 swipes, per-item cancel, cancel running, cancel all, auto-close-on-drain, click-outside-to-close, and DevTools inspection of the actual `--SmartTheme*` destructive-color variable), and either confirming or correcting `style.css`'s placeholder `--crimson70a` values. This plan is not fully done until that checkpoint passes — the orchestrator/user must run a continuation pass with access to a live ST instance to complete it.

## Self-Check: PASSED

- FOUND: src/queueActions.js
- FOUND: test/queueActions.test.js
- FOUND: src/runner.js
- FOUND: src/ui.js
- FOUND: style.css
- FOUND: index.js
- FOUND: test/runner.test.js
- FOUND: .planning/phases/03-full-queue-control-ui/03-01-SUMMARY.md
- FOUND commit: ea372ed (Task 1)
- FOUND commit: 1275c24 (Task 2)
