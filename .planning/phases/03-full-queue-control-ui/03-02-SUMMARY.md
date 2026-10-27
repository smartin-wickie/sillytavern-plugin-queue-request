---
phase: 03-full-queue-control-ui
plan: 02
subsystem: ui
tags: [sillytavern, extension, slash-commands, wand-menu, dom]

# Dependency graph
requires:
  - phase: 03-01 (runner cancel capability + cancel dropdown)
    provides: runner.abortRunning()/onItemDone()/offItemDone(), src/queueActions.js cancelAll(store, runner), badge/dropdown DOM structure plus 3 live-verified CSS fixes
provides:
  - src/commands.js registerCommands({ store, runner, cancelAll }) — /queueswipe [count], /queuecancel, /queuestatus registered via SlashCommandParser.addCommandObject
  - src/wandMenu.js registerWandMenu({ store, runner, cancelAll, canQueue }) — "Queue swipe"/"Cancel all queued" entries appended into #extensionsMenu
  - index.js wires both new modules into init()
affects: [03-03-progress-bar, 03-04-settings-panel]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Every new entry point (slash command, wand-menu click) is a thin caller into the existing store/runner/cancelAll primitives — clamp math and cancel-all logic are never re-derived per caller"
    - "/queueswipe re-reads store.pendingCount()/runningCount()/getMaxQueueSize() fresh inside the callback body on every single invocation, never cached across calls, so a scripted loop cannot enqueue past the cap"
    - "Wand-menu entry renders once on APP_READY only (no per-chat state, unlike the per-message badge control which re-renders on CHARACTER_MESSAGE_RENDERED/MESSAGE_SWIPED/CHAT_CHANGED)"

key-files:
  created: [src/commands.js, src/wandMenu.js]
  modified: [index.js]

key-decisions:
  - "Clamp math in /queueswipe mirrors ui.js's onControlClick exactly (room = max - current, computed inside the callback), per the plan's explicit interface contract — no divergent implementation"
  - "Wand-menu DOM markup (extension_container / list-group-item flex-container flexGap5 alignItemsCenter interactable) follows 03-RESEARCH.md's Code Examples snippet verbatim, flagged MEDIUM confidence pending live verification (Task 3)"

patterns-established:
  - "Pattern: new queue entry points (commands, menu items) import ctx()/buildFingerprint()/cancelAll() directly rather than re-deriving target-identity or cancel logic"

requirements-completed: [QUEUE-03, QUEUE-04, QUEUE-05]  # Validated end-to-end against a live ST 1.19.0 instance (Task 3).

# Metrics
duration: ~15min (Tasks 1-2) + ~20min (Task 3 live verification + a reverted fix attempt)
completed: 2026-10-27
---

# Phase 03 Plan 02: Slash Commands + Wand Menu Summary

**Three SlashCommandParser-registered commands (/queueswipe [count], /queuecancel, /queuestatus) and two #extensionsMenu wand entries ("Queue swipe", "Cancel all queued"), both wired to the same store/runner/cancelAll primitives the badge control and dropdown already use — live-verified against ST 1.19.0, all 8 steps pass; one `canQueue()` gap found in `/queueswipe` was investigated, fixed, found to break the command, and reverted (documented below).**

## Performance

- **Duration:** ~15 min (Tasks 1-2) + ~20 min (Task 3 live verification)
- **Tasks:** 3 of 3 completed
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- Created `src/commands.js` registering `/queueswipe [count]`, `/queuecancel`, `/queuestatus` via `SlashCommandParser.addCommandObject(SlashCommand.fromProps({...}))`, with clamp math computed fresh inside each callback (never cached) and feedback limited to `toastr` plus the command's string return value — no chat-visible system message
- Created `src/wandMenu.js` registering "Queue swipe" and "Cancel all queued" rows into ST's wand (`#extensionsMenu`) menu, rendered once on `APP_READY` with an idempotency guard, wired to the identical clamp-and-add sequence `ui.js`'s `onControlClick` already uses
- Wired both new modules into `index.js`'s `init()`, alongside the existing `registerQueueControl({ store, runner })` call
- Full `npx vitest run` suite (58 tests, 5 files) still passes with no regressions after these additions

## Task Commits

Each task was committed atomically:

1. **Task 1: Slash commands — /queueswipe, /queuecancel, /queuestatus** - `f3e2748` (feat)
2. **Task 2: Wand menu entries + wiring into index.js** - `bf18d69` (feat)
3. **Task 3: Live verification — slash commands and wand menu against ST 1.19.0** - executed against a real ST 1.19.0 instance (localhost:8000) via browser automation; all 8 verification steps passed. No code changes were needed for the 8 steps themselves (unlike 03-01). A separate `canQueue()` fix attempt for `/queueswipe` was tried, found to break the command, and reverted — see "Investigated and reverted" below.

**Plan metadata:** this commit (`docs(03-02): complete plan` — final SUMMARY commit)

## Files Created/Modified
- `src/commands.js` (new) - Registers `/queueswipe [count]`, `/queuecancel`, `/queuestatus`; clamp math mirrors `ui.js`'s `onControlClick`; cancel delegates to the shared `cancelAll(store, runner)` helper from 03-01
- `src/wandMenu.js` (new) - Registers "Queue swipe"/"Cancel all queued" rows into `#extensionsMenu` on `APP_READY`, with an idempotency guard (`$('#qs-wand-entry').length`) and the identical clamp-and-add click handler as `ui.js`'s `onControlClick`
- `index.js` - Imports `registerCommands`, `registerWandMenu`, `cancelAll`; calls `registerCommands({ store, runner, cancelAll })` and `registerWandMenu({ store, runner, cancelAll, canQueue: bridge.canQueue })` inside `init()`, after the existing `registerQueueControl({ store, runner })` call

## Decisions Made
- `/queueswipe`'s clamp math (`room = Math.max(0, max - current)`) is computed fresh inside the callback body on every invocation, per the plan's explicit anti-cache requirement (Pitfall 4 / threat T-03-02-01) — a scripted `/times N {: /queueswipe :}` loop cannot enqueue past `getMaxQueueSize()`
- `src/wandMenu.js`'s DOM markup follows the 03-RESEARCH.md Code Examples snippet verbatim (MEDIUM-confidence, third-party-sourced convention) rather than inventing new selectors/classes, so that the live-verification checkpoint (Task 3) has a single, documented baseline to correct if the real ST 1.19.0 markup differs

## Deviations from Plan

None - plan executed exactly as written for Tasks 1-2. No bugs found, no missing critical functionality, no architectural changes needed.

## Issues Encountered

None for Tasks 1-2. `node --check` passed for every new/modified file on first attempt; all acceptance-criteria greps (addCommandObject count, pendingCount() placement inside the callback, canQueue() preceding store.add(), zero sendSystemMessage/addOneMessage/echo calls, zero duplicate store.drop(), registerCommands/registerWandMenu called exactly once each) passed without modification; full vitest suite (58/58) passed with no regressions.

## User Setup Required

None - no external service configuration required for Tasks 1-2.

## Task 3: Live Verification Results

Executed all 8 numbered verification steps from the plan against a real running SillyTavern 1.19.0 instance (localhost:8000, not a simulation), reusing the extension deployment and chat set up during 03-01's live-verification pass.

1. **Wand menu renders correctly** — PASS. Both "Queue swipe" (clock icon) and "Cancel all queued" (×) render styled identically to ST's native wand-menu rows (same `list-group-item flex-container flexGap5 alignItemsCenter interactable` markup as every other entry). The 03-RESEARCH.md markup snippet was correct the first time — no selector/class correction needed.
2. **"Queue swipe" with empty queue** — PASS. Badge showed 1 immediately; no visible menu-close glitch or error.
3. **"Cancel all queued" while running** — PASS. Badge and "Cancel running" button both disappeared; same end state as the dropdown's own Cancel all (03-01).
4. **`/queueswipe 3` with room for 3** — PASS. `toastr.info` read exactly "Queued 3 swipe(s)." (verbatim match to the plan's expected string), no chat-visible system message, badge went to 3.
5. **`/queueswipe 10` with 2 slots free** — PASS. `toastr.warning` read exactly "Queue full — added 2 of 10 requested." with the correct live numbers (requested=10, added=2).
6. **`/queuestatus`** — PASS. One-line toast read exactly "Queue: 1 running, 4 pending (5 max)." — correct format, no per-item breakdown.
7. **`/queuecancel`** — PASS. `toastr.info` read "Cancelled 4 queued swipe(s)." and the badge disappeared. A second toast, "Queued swipe failed: cancelled", also appeared for the aborted running item — this is 03-01's existing `FAILURE_MESSAGES.cancelled` per-item toast firing as designed (coalescing is 03-03's job, not a 03-02 defect).
8. **Group chat / non-swipeable message no-op** — PASS by source inspection, not by live reproduction. `src/wandMenu.js`'s click handler has `if (!canQueue()) return;` as its first line (grep-verified in the deployed file), using the exact same `canQueue` function reference already live-verified correct in 03-01 (same `ctx().groupId` / `ctx().swipe.isAllowed()` checks the badge control itself relies on). Did not force a live group-chat/non-swipeable reproduction — see "Investigated and reverted" below for why forcing this condition via `/queueswipe` specifically backfired, which is a different code path than the wand menu this step covers.

### Investigated and reverted: `/queueswipe` has no `canQueue()` guard

While reading `src/commands.js` to prep step 8, noticed `/queueswipe`'s callback never checks `canQueue()`/`groupId`/`swipe.isAllowed()` at all — unlike the badge control (`ui.js`) and the wand menu (`wandMenu.js`, step 1 above), which both gate on it. This is not a deviation from the plan: 03-02-PLAN.md's Task 1 (slash commands) never specified this check; only Task 2 (wand menu) did. But it's a real asymmetry against QUEUE-08's stated intent that the whole surface area honor the same eligibility gate.

**Tried:** added `import { canQueue } from './st-bridge.js'` and `if (!canQueue()) { toastr.warning('Cannot queue a swipe right now.'); return '0'; }` as the first line of `/queueswipe`'s callback, mirroring `wandMenu.js` exactly. `node --check` passed, full `npx vitest run` suite stayed 58/58 green, deployed to the live instance.

**Live result: broke the command entirely.** Every `/queueswipe` call — even in the same chat, same swipeable AI message, where a manual `ctx().swipe.isAllowed()` check in the console returned `true` moments before and after — hit the new guard and returned "Cannot queue a swipe right now." Root cause, confirmed by reading ST core source (`public/script.js:9162`): `isSwipingAllowed()` returns `false` whenever `isGenerating()` is true, and `isGenerating()` is `is_send_press || is_group_generating`. ST sets `is_send_press = true` for the full duration of processing anything typed into the message box and submitted — including slash commands, since they go through the same send pipeline. So `canQueue()` is **always false** for the entire lifetime of any slash-command callback, by ST's own design — it is not a check that can be reused as-is outside a click-handler context. The wand-menu/badge-control uses of `canQueue()` work because those are DOM click handlers, never inside ST's send pipeline.

**Reverted in full** (`git diff` against the Task 1 commit is empty for `commands.js`) and redeployed; `/queueswipe` confirmed working again live (`toastr.info` "Queued 1 swipe(s)." on the next test). This closes the investigation for this plan — fixing the underlying QUEUE-08 gap for `/queueswipe` needs a different signal than `canQueue()` (e.g., checking the target message's eligibility directly via `buildFingerprint`'s own validation, or snapshotting `isSwipingAllowed()` before the command pipeline sets `is_send_press`), which is new design work out of scope for a Task 3 live-verification pass. Left as an open, documented gap rather than silently shipped or silently dropped.

## Next Phase Readiness

All 3 tasks are code-complete, committed, unit-tested (58/58 passing), and live-verified against a real running ST 1.19.0 instance. `node --check` passes on every modified/new `.js` file and every acceptance-criteria grep check in the plan passes. QUEUE-03/QUEUE-04/QUEUE-05 are validated end-to-end. One known, documented gap remains open: `/queueswipe` does not honor the QUEUE-08 eligibility gate (group chats / non-swipeable last message) the way the badge control and wand menu do — see "Investigated and reverted" above for why the obvious fix doesn't work and what a real fix would need.

## Self-Check: PASSED

- FOUND: src/commands.js
- FOUND: src/wandMenu.js
- FOUND: index.js (modified)
- FOUND: .planning/phases/03-full-queue-control-ui/03-02-SUMMARY.md
- FOUND commit: f3e2748 (Task 1)
- FOUND commit: bf18d69 (Task 2)

---
*Phase: 03-full-queue-control-ui*
*Completed: 2026-10-27*
