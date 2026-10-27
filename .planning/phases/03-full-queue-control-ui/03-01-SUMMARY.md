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

requirements-completed: [QUEUE-06, QUEUE-07]  # Validated end-to-end against a live ST 1.19.0 instance (Task 3).

# Metrics
duration: 35min + 25min (Task 3 live verification + fixes)
completed: 2026-10-26
---

# Phase 03 Plan 01: Runner Cancel Capability + Cancel Dropdown Summary

**Runner-owned AbortController exposing abortRunning()/onItemDone(), a shared cancelAll() helper, and a badge-anchored cancel dropdown with per-item/running/all cancel — live-verified against ST 1.19.0, with 3 CSS defects found and fixed during verification.**

## Performance

- **Duration:** ~35 min (Tasks 1-2) + ~25 min (Task 3 live verification + fixes)
- **Started:** 2026-10-26T20:15:00-06:00 (approx.)
- **Completed:** 2026-10-26T21:05:00-06:00 (approx.)
- **Tasks:** 3 of 3 completed
- **Files modified:** 7 (2 created, 5 modified) + 1 follow-up fix commit (style.css)

## Accomplishments
- Moved the per-item `AbortController` out of `index.js`'s private `generate()` closure into `runner.js`, which now owns `runningController` and exposes `abortRunning()` — the one new capability every cancel surface in this phase needs
- Added `onItemDone(cb)`/`offItemDone(cb)`, mirroring the existing `onItemFailed`/`offItemFailed` pair exactly, firing immediately after `store.markDone(item.id)`
- Created `src/queueActions.js` exporting `cancelAll(store, runner)` as the single shared cancel-all implementation this phase's other plans (wand menu, slash commands, progress bar) will also call
- Built the cancel dropdown (`src/ui.js` `renderDropdown`) anchored to `.qs-queue-badge`: live pending-item rows with per-item `×`, a `Cancel running` button, a `Cancel all` button, outside-click dismissal, and auto-close when pending+running reaches 0

## Task Commits

Each task was committed atomically:

1. **Task 1: Runner abortRunning()/onItemDone() + shared cancelAll() helper** - `ea372ed` (feat)
2. **Task 2: Cancel dropdown anchored to the queue badge** - `1275c24` (feat)
3. **Task 3: Live verification — cancel dropdown against a running ST 1.19.0 instance** - `2a8296c` (fix) — executed against a real ST 1.19.0 instance (localhost:8000) via browser automation; all 7 verification steps passed, plus 3 additional defects found and fixed (see below)

**Plan metadata:** (this commit, `docs(03-01): complete plan` — see final commit below)

## Task 3: Live Verification Results

Executed all 7 numbered verification steps from the plan against a real running SillyTavern 1.19.0 instance (not a simulation):

1. **Queue 3 swipes quickly** — PASS (after fix #1 and #2 below). Badge showed live pending+running count; clicking the badge opened a dropdown listing "Swipe request 1"/"Swipe request 2" plus "Cancel running"/"Cancel all".
2. **Per-item × cancel** — PASS. Clicking × on a pending row removed only that row; other rows and the running item were unaffected; badge count decremented.
3. **Cancel running** — PASS. The in-flight item disappeared cleanly with no partial/empty swipe appended to the chat; confirmed at the code level (not re-derived here) that `abortRunning()` delegates to `adapter.js`'s `abortOwn()` (`AbortController.abort()`), never ST's own `stopGeneration()` — consistent with the locked architecture decision.
4. **Cancel all (1+ pending, 1 running)** — PASS. Every row disappeared, badge disappeared, dropdown auto-closed.
5. **Natural drain while dropdown open** — PASS. Badge and dropdown both disappeared the instant the last running item completed, with no manual interaction.
6. **Click outside to close** — PASS. Clicking message text outside the dropdown closed it without cancelling the still-running item (badge count unchanged).
7. **Destructive-color variable** — CONFIRMED CORRECT, no change needed. `--crimson70a` resolves live to `rgba(100, 0, 0, 0.7)` and is ST core's own destructive/delete-button background variable (`public/style.css`, used by 5+ core delete controls) — the plan's placeholder guess was right the first time.

### 3 additional defects found and fixed (not in the original 7 steps, but block the same acceptance criteria)

These were found because the *first* verification attempt (step 1, real mouse clicks) silently failed to queue anything — forcing root-cause investigation rather than a pass/fail checkbox:

1. **Control was unclickable by a real mouse.** `.qs-queue-control` sits inside ST core's `.swipeRightBlock`, which sets `pointer-events: none` on itself (`public/style.css:1266`) and relies on children explicitly opting back in (as `.swipe_right`/`.swipes-counter` do). Our control never did, so every real click passed through it; only a programmatic `.click()` worked. **Fix:** added `pointer-events: auto` to `.qs-queue-control`.
2. **Badge covered the entire control, blocking a 2nd/3rd queue click.** `.qs-queue-badge` had no explicit font-size, so it inherited the control's 20px icon size; its computed bounding box (~29×50px) fully overlapped the clock icon underneath. Once one item was queued, every subsequent click hit the badge (which `stopPropagation()`s to toggle the dropdown) instead of the control's own add-to-queue handler — making "queue 3 swipes in a row," the plan's own step 1, impossible via mouse. **Fix:** gave the badge an explicit `font-size: 12px; line-height: 1` (matching UI-SPEC's "`.swipes-counter`-compact, corner-notification overlap" intent), shrinking it to its intended small corner size.
3. **Dropdown rendered completely invisible.** `.qs-queue-dropdown` opened downward (`top: 100%`). The control lives on `.last_mes` (the latest message), which `#chat` (`overflow: hidden scroll`) keeps pinned near the bottom of the viewport, just above the fixed composer bar. Opening downward pushed the panel past `#chat`'s clipped bottom edge, rendering it entirely hidden behind the composer — in the single most common scenario (interacting with the newest message). **Fix:** flipped the panel to open upward (`bottom: 100%`), which stays inside `#chat`'s visible scrolled region and overlays message text instead (standard dropdown-over-content pattern).

All 3 fixes are CSS-only (`style.css`), committed separately as `2a8296c` after the two Task 1/2 commits, with no production JS changes and no test changes (these are real-browser layout/stacking issues Vitest's jsdom-less unit tests cannot catch — confirming the plan's own "integration: manual, against a real ST instance" testing strategy was correct and necessary).

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

All 3 tasks are code-complete, committed, unit-tested (27/27 passing), and live-verified against a real running ST 1.19.0 instance. `node --check` passes on every modified/new `.js` file and every acceptance-criteria grep check in the plan passes. QUEUE-06/QUEUE-07 are validated end-to-end, not just code-complete. 03-02/03-03/03-04 can build on `cancelAll()`, `abortRunning()`, and the badge/dropdown DOM structure with confidence they work in a real browser, not just in unit tests.

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
- FOUND commit: 2a8296c (Task 3)
