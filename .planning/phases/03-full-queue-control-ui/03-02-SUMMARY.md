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

requirements-completed: []  # QUEUE-03/04/05 are code-complete but NOT YET validated — Task 3 (live verification) is a checkpoint, not yet executed. Do not mark complete until the checkpoint passes.

# Metrics
duration: ~15min (Tasks 1-2); Task 3 checkpoint reached, not yet executed
completed: 2026-10-27
---

# Phase 03 Plan 02: Slash Commands + Wand Menu Summary

**Three SlashCommandParser-registered commands (/queueswipe [count], /queuecancel, /queuestatus) and two #extensionsMenu wand entries ("Queue swipe", "Cancel all queued"), both wired to the same store/runner/cancelAll primitives the badge control and dropdown already use — code-complete, live verification pending (checkpoint).**

## Performance

- **Duration:** ~15 min (Tasks 1-2)
- **Tasks:** 2 of 3 completed; Task 3 is a `checkpoint:human-verify` (gate="blocking") — reached, not executed
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
3. **Task 3: Live verification — slash commands and wand menu against ST 1.19.0** - NOT EXECUTED (checkpoint reached, this worktree agent will not be resumed; see below)

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

## Checkpoint Reached: Task 3 (Live Verification)

Task 3 is `type="checkpoint:human-verify" gate="blocking"` — it requires a live running SillyTavern 1.19.0 instance to verify both the wand-menu DOM markup (MEDIUM confidence per 03-RESEARCH.md Open Question #1, no live source this session) and all three slash commands' actual toast/return-value behavior. This worktree agent has no access to a live ST instance and will not be resumed (per the orchestrator's worktree-execution model); per the plan's own context note, the orchestrator has live ST 1.19.0 access via browser automation and a deployed copy of this extension, and will run this verification in a follow-up pass.

**What's built (ready for verification):**
- Three slash commands (`/queueswipe [count]`, `/queuecancel`, `/queuestatus`) in `src/commands.js`
- Two wand-menu entries ("Queue swipe", "Cancel all queued") in `src/wandMenu.js`
- Both wired into `index.js`'s `init()`

**How to verify (copied from PLAN.md Task 3, 8 numbered steps):**
1. Open the wand/extensions menu. Confirm "Queue swipe" and "Cancel all queued" both appear, styled consistently with ST's other menu entries. If the markup looks wrong, note the actual DOM structure ST renders so `src/wandMenu.js`'s selectors/classes can be corrected.
2. Click "Queue swipe" with the queue empty. Confirm one swipe is queued (badge shows 1) and the menu closes/behaves like any other wand-menu action.
3. With the queue running, click "Cancel all queued" from the wand menu. Confirm everything clears (same as the dropdown's Cancel all).
4. In the chat input, type `/queueswipe 3` with room for all 3. Confirm a `toastr.info` reading "Queued 3 swipe(s)." appears, no chat-visible system message is posted, and the badge count increases by 3.
5. Type `/queueswipe 10` when only, say, 2 slots remain. Confirm a `toastr.warning` reading "Queue full — added 2 of 10 requested." (numbers matching actual room).
6. Type `/queuestatus`. Confirm a one-line toast like "Queue: 1 running, 3 pending (5 max)." with no per-item breakdown.
7. Type `/queuecancel`. Confirm a `toastr.info` reading "Cancelled N queued swipe(s)." and the queue actually clears (badge disappears).
8. Open a group chat or a chat with no swipeable AI message. Confirm the wand menu's "Queue swipe" entry's click is a no-op (QUEUE-08 gate honored) — note whether it should also be hidden/disabled visually; if ST's own wand-menu convention expects a visible-but-no-op entry here, that's acceptable, just confirm no error is thrown.

**Resume signal:** Report pass/fail per numbered step, plus any wand-menu markup corrections needed from step 1.

## Next Phase Readiness

Tasks 1-2 are code-complete, committed, `node --check`-clean, and all plan acceptance-criteria greps pass. Full unit test suite (58/58) has no regressions. QUEUE-03/QUEUE-04/QUEUE-05 are NOT yet marked complete — they remain code-complete-pending-live-verification until Task 3's checkpoint is executed by the orchestrator against a real ST 1.19.0 instance (same two-pass pattern 03-01 used: code commits first, then a live-verification pass that may add CSS/markup fixes before the requirements are considered validated).

## Self-Check: PASSED

- FOUND: src/commands.js
- FOUND: src/wandMenu.js
- FOUND: index.js (modified)
- FOUND: .planning/phases/03-full-queue-control-ui/03-02-SUMMARY.md
- FOUND commit: f3e2748 (Task 1)
- FOUND commit: bf18d69 (Task 2)

---
*Phase: 03-full-queue-control-ui*
*Completed (Tasks 1-2): 2026-10-27*
*Task 3 (live verification): pending, checkpoint reached*
