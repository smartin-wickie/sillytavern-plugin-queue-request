---
phase: 04-lifecycle-persistence-spend-safety
plan: 05
subsystem: runner-safety
tags: [sillytavern, extension, circuit-breaker, prompt-inspector, vitest]

requires:
  - phase: 04-lifecycle-persistence-spend-safety
    provides: runner pause reasons, resumeQueue, lifecycle chat switch
provides:
  - runner circuit breaker (consecutive api/empty failures, live clamped threshold, no retries)
  - runner Prompt Inspector gate and bridge.promptInspectorEnabled probe
  - shared enqueue(store, runner, count) and configureQueueActions
  - always-shown breaker and inspector toasts, disabled control state
affects: [04-06, 04-08]

key-files:
  modified: [src/runner.js, src/st-bridge.js, src/queueActions.js, src/ui.js, src/wandMenu.js, src/commands.js, src/lifecycle.js, index.js, test/runner.test.js, test/queueActions.test.js, test/lifecycle.test.js]

key-decisions:
  - "Runner exposes getFailureCount as an alias of getConsecutiveFailures so the 04-04 'failures' label shows the real count"
  - "resume('failures') also zeroes the counter (lifecycle chat switch and Resume both reset)"
  - "Inspector gate runs only between items, so an in-flight item is never aborted"

requirements-completed: [SAFE-01, SAFE-03]
completed: 2026-10-27
---

# Phase 4 Plan 05: Circuit breaker and Prompt Inspector gate Summary

The runner now pauses with reason 'failures' after N consecutive api/empty failures (default 3, clamped 1..10, read live) and with reason 'inspector' when Prompt Inspector is on, and all add paths and Resume share one gate.

## Tasks

1. Runner breaker and inspector gate, bridge probe: 3bcb05a
2. Shared enqueue, inspector gates on add and resume: 86c0352
3. Toasts, disabled control state, counter reset on chat switch, wiring: a862bf0

## Verification

`npx vitest run`: 9 files, 161 tests passed (observed). Runner tests cover counting rules, trip, resume reset, threshold clamp/live change, inspector pause once with no abort. Not verified live in SillyTavern (forced failures and Prompt Inspector refuse/pause are covered by the plan 08 smoke checkpoint).

## Deviations from Plan

- [Rule 3] Reworded a ui.js comment that contained the text "store.add()" so the acceptance grep (zero `store.add(` in ui.js) holds.
- Added `getFailureCount` alias and `runner.resetCounters?.()` optional call in lifecycle (fake runners without it keep working).

## Carry-forward

- Read-only-tab popup gating is still not addressed (no read-only state introduced here).
- The Prompt Inspector toggle emits no event, so the disabled control state can lag until the next render; enforcement is click-time in enqueue and the runner gate.

## Known Stubs

None.

## Self-Check: PASSED

Commits 3bcb05a, 86c0352, a862bf0 exist; modified files present.
