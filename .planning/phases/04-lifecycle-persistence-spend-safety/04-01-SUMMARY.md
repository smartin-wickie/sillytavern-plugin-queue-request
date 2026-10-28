---
phase: 04-lifecycle-persistence-spend-safety
plan: 01
subsystem: runner
tags: [sillytavern, extension, scheduler, guard, vitest]

requires:
  - phase: 03-full-queue-control-ui
    provides: runner.abortRunning/onItemDone, queueActions.cancelAll
provides:
  - Runner pause as a reason set (pause/resume(reason)/resumeAll/isPaused/getPauseReasons/getPrimaryReason/onStateChange)
  - runner.invalidate() epoch and abortRunning({ disposition }) cancel|requeue|discard
  - fingerprintStatus(bridge, fp) returning ok|chat|target
  - store.requeue(id)
  - createGuard({ bridge, runner, lifecycle }) native-only resume, lifecycle hooks, idle watchdog
affects: [04-02, 04-03]

tech-stack:
  added: []
  patterns: [reason-set pause, park-then-check before append, epoch invalidation]

key-files:
  modified: [src/fingerprint.js, src/store.js, src/runner.js, src/guard.js, test/fingerprint.test.js, test/store.test.js, test/runner.test.js, test/guard.test.js]

key-decisions:
  - "Parked results wait for both idle and the 'native' reason to clear, so a Continue re-fingerprint lands before validation (D-04)"
  - "Native generation pauses, never clears the queue (D-06); GENERATION_STOPPED only clears 'native'"

requirements-completed: [GUARD-01, GUARD-06]
completed: 2026-10-27
---

# Phase 4 Plan 01: Reason-set pause, park-then-check, native-only guard release Summary

Runner pause is now a set of reasons, finished results park until ST is idle and no native generation holds the queue before being re-validated and appended, and the guard releases only its own 'native' reason (with lifecycle hooks and an idle watchdog).

## Tasks and commits

1. fingerprintStatus + store.requeue: 392e556
2. Runner reason-set pause, epoch, park-then-check, abort dispositions: 3fcc47a
3. Guard native-only resume, lifecycle hooks, idle watchdog: 6dd4f99

## Verification (observed)

- `npx vitest run`: 6 files, 88 tests passed (final run after Task 3).
- Per-task runs passed: fingerprint+store 30 tests; runner 33 tests.
- Acceptance greps: no code use of stopGeneration in runner.js/guard.js (only a comment in adapter.js and bridge exports); `runner.resume()` with no args absent from guard.js; clearInterval present in guard.js.

## Deviations from Plan

**1. [Rule 1 - Bug] requeue disposition stops the loop.** The plan says processNext returns true after requeue; that would make the loop immediately re-pick and regenerate the same item. Returns false instead so the loop stops and the caller decides when to wake.

**2. [Rule 1 - Test update]** The existing "pause() does not abort an item mid-generate()" test asserted the first item completes while paused. Under the plan's park rule that result now waits for resume('native'); the test was rewritten to assert parking and the append after resume.

**3. Encoding slip, fixed.** An initial scripted edit rewrote src/runner.js with a Windows code page; it was repaired to valid UTF-8 LF before the runner commit.

## Known Stubs

None. The marker comment in processNext for later start gates (owner, Prompt Inspector, connection) contains no gate code, as the plan specified.

## Self-Check: PASSED

Commits 392e556, 3fcc47a, 6dd4f99 exist; modified files present; full suite green.
