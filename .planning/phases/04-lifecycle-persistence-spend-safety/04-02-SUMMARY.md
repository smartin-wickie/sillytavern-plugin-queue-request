---
phase: 04-lifecycle-persistence-spend-safety
plan: 02
subsystem: lifecycle
tags: [sillytavern, extension, lifecycle, store, vitest]

requires:
  - phase: 04-lifecycle-persistence-spend-safety
    provides: runner.invalidate/abortRunning dispositions, guard lifecycle hooks, fingerprintStatus
provides:
  - src/lifecycle.js createLifecycle (edit/delete/sent/received clear policy, Continue re-fingerprint)
  - store.clear(reason), refingerprintAll(fp), onReset/offReset
  - accumulator reset(), no zero-count success toast
affects: [04-03]

key-files:
  created: [src/lifecycle.js, test/lifecycle.test.js]
  modified: [src/store.js, src/toastAccumulator.js, src/ui.js, index.js, test/store.test.js, test/toastAccumulator.test.js]

key-decisions:
  - "MESSAGE_RECEIVED with id > target and type not swipe/continue clears as 'a new message was sent' (A6)"
  - "store.clear fires reset listeners before notify so the accumulator is zeroed before it sees the queue drain"

requirements-completed: [GUARD-02]
completed: 2026-10-27
---

# Phase 4 Plan 02: Lifecycle clear policy Summary

Editing the target, deleting it, or sending a new message clears queued/running swipes with one toast naming the count; native swipe, Continue, earlier-message edits and MESSAGE_UPDATED leave the queue alone, and a Continue re-keys fingerprints in place.

## Tasks and commits

1. Store clear/refingerprintAll/onReset + accumulator reset: 15e2fe0
2. lifecycle.js event policy: 521d821
3. Wire into index.js: 4f0da21

## Verification (observed)

- `npx vitest run test/store.test.js test/toastAccumulator.test.js`: 28 passed.
- `npx vitest run test/lifecycle.test.js`: 12 passed.
- Full `npx vitest run`: 7 files, 105 tests passed.
- lifecycle.js imports only ./fingerprint.js. Live ST smoke is not run here (deferred to plan 08).

## Deviations from Plan

None. Note: clear() runs reset listeners before notify (plan listed notify then reset); this ordering guarantees no "0 completed" or stale summary toast.

## Known Stubs

None.

## Self-Check: PASSED
