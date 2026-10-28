---
phase: 04-lifecycle-persistence-spend-safety
plan: 08
subsystem: multi-tab read-only mirror
tags: [ownership, snapshot, mirror, read-only-ui, SAFE-04]
requires: [04-07]
provides:
  - "State snapshot build/parse, store completed counter and applySnapshot, cross-tab mirror"
  - "Read-only queue rendering in non-owner tabs with mutating actions gated"
affects: []
tech-stack:
  added: []
  patterns: [owner publishes snapshot via ownership state channel, non-owner applies it read-only]
key-files:
  created: [src/mirror.js, src/progressBar.js, test/mirror.test.js, test/snapshot.test.js, test/queueActions.readonly.test.js]
  modified: [index.js, src/commands.js, src/ownership.js, src/persistence.js, src/queueActions.js, src/store.js, src/ui.js, style.css, test/ownership.test.js]
key-decisions:
  - "Non-owner tabs display the owner's mirrored snapshot and refuse all mutating actions with a locked toast"
requirements-completed: [SAFE-04]
duration: n/a
completed: 2026-10-27
---

# Phase 4 Plan 08: Read-only mirror and live smoke Summary

Non-owner tabs now render the owner's queue read-only (lock, count, progress bar without Stop/Resume) and refuse mutating actions, fed by a snapshot mirror; verified live on ST 1.19.0 and two real bugs found and fixed during the smoke.

## Tasks

| Task | Commit | Result |
|------|--------|--------|
| 1 Snapshot build/parse, store completed counter, applySnapshot, mirror | b978b65 | tests pass |
| 2 Read-only UI, slash behavior, action gates | 5bf12db | tests pass |
| 3 Live smoke on ST 1.19.0 (human-verify) | approved | fixes 60714bc, e5b57f5 |

Verification: vitest suite, 231 tests passing after fixes. Live smoke run via Chrome automation against ST 1.19.0 (LM Studio, satyr-v0.1-4b, throwaway Assistant chat); user approved.

## Smoke results

1. PASS: popup count and model, in-flight item requeued, Esc keeps paused (badge, "Paused: restored after reload", Resume), Resume ran all 5, Discard clears with toast. Rapid-refresh lease not tested.
2. NOT TESTED as written (ST lands on welcome screen); popup did appear on first chat open after load.
3. PASS: Continue shows "Waiting for your generation to finish", keeps queue, cleared by GENERATION_ENDED; native Stop resumes with no toast (after e5b57f5); Send clears with one toast.
4. PASS: edit target, edit non-0 swipe, delete last, Regenerate each give exactly one Cleared toast, nothing generated after.
5. PASS (<1s and >2s): no failure toast, items preserved, popup on return, other chat has no queuedSwipes.
6. PASS: popup lists only changed fields; Keep paused persists; Continue proceeds; refresh with changed model gives one combined popup.
7. PASS: pauses at 3 failures, one warning, no retry; threshold change applies live.
8. PASS: control, wand, /queueswipe, Resume refuse with locked toast; enabling mid-queue pauses after current item.
9. PASS: read-only display and takeover on owner close (paused, toast, no popup). A real >10s suspension was not testable; a simulated foreign lease made the owner demote within 1s, discard the running item, with no late append.
10. PASS: chat_metadata.queuedSwipes holds only version, ids, createdAt, target, connection.

## Deviations from Plan

**1. [Rule 1 - Bug] "Illegal invocation" in ownership default timers** - src/ownership.js defaults `{ setInterval, clearInterval, setTimeout }` were invoked as `timers.setTimeout(...)`, which throws in browsers (Node allows it). claim() rejected, so every tab stayed read-only. Fixed with arrow-wrapped defaults; regression test added in test/ownership.test.js (fails without the fix). Commit 60714bc.

**2. [Rule 1 - Bug] Queue control vanished after a stopped native swipe** - MESSAGE_SWIPED fires while ST is busy, canQueue() is false, so the control was removed, and a stopped generation renders no message to restore it. src/ui.js now re-renders after GENERATION_ENDED/STOPPED by polling until canQueue() (250ms x 20), and store/runner change listeners re-inject a missing control. DOM-only, no unit test; verified live. Commit e5b57f5.

## Open issues / follow-ups (not fixed)

- After a simulated demote then takeover (fake foreign lease written from the same document), the tab became owner with no takeover toast and an empty in-memory store while chat_metadata still held 3 items. Possibly a simulation artifact; needs investigation.
- Failure/Prompt Inspector pause persists after "Cancel all": a newly queued swipe waits for manual Resume (design question).
- Label grammar: "1 failures in a row".
- During a native swipe generation the control is hidden, so "Waiting..." is visible only during Continue.

## Known Stubs
None.

## Self-Check: PASSED
Commits b978b65, 5bf12db, 60714bc, e5b57f5 exist.
