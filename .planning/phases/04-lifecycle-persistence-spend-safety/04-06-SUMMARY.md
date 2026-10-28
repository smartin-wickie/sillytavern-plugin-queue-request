---
phase: 04-lifecycle-persistence-spend-safety
plan: 06
subsystem: queue-safety
tags: [connection, spend-safety, popup, runner-gate]
requires: [04-05]
provides:
  - diffConnection pure module
  - bridge.connectionSnapshot()
  - store.setConnectionAll
  - runner connection gate (pause reason 'connection') with onConnectionChanged listeners
  - showConnectionPopup and combined resume note
affects: [04-08]
tech-stack:
  patterns: [pure diff module, scheduled popup outside event handler]
key-files:
  created: [src/connection.js, test/connection.test.js]
  modified: [src/st-bridge.js, src/store.js, src/runner.js, src/popups.js, src/lifecycle.js, index.js, test/store.test.js, test/runner.test.js, test/lifecycle.test.js]
key-decisions:
  - "Preset recorded by name only (chat completion preset_settings_openai, textgen preset); in-place preset edits are not detected"
  - "Connection change never marks items stale; it pauses and asks"
metrics:
  tasks: 3
  completed: 2026-10-27
---

# Phase 4 Plan 06: Connection change safety Summary

Each queued item now records API, model and preset; the runner compares them right before spend and pauses with reason 'connection', and a consent popup (or the merged load-time resume popup) decides.

## What was built
- `src/connection.js`: `diffConnection(old, cur)` returns changed fields among api/model/preset, skipping null/undefined/'' on either side.
- `connectionSnapshot()` in st-bridge; `store.add` records a copy (so persisted items now carry real api/model/preset, closing the 04-03 carry-forward); `store.setConnectionAll` updates active items only, notifies once, persists debounced.
- Runner gate after the Prompt Inspector gate: pauses once, fires `onConnectionChanged({item, changed, old, current})`, starts nothing, leaves items untouched. Resume re-runs the gate, so the popup shows again while the connection differs.
- `showConnectionPopup`: textContent only, lists changed fields only, returns 'continue' only for OK ("Continue queue"); "Keep paused", Esc and close return 'keep'.
- Lifecycle: popup scheduled via setTimeout(0), not stacked, silent on chat change; Continue calls `setConnectionAll` then `resume('connection')`. On load a mismatch adds `connectionNote` to the single resume popup; Resume queue counts as consent and updates connections; items are never dropped for a mismatch.
- index.js passes `showConnection`.

## Verification (observed)
- `npx vitest run test/connection.test.js test/store.test.js`: 34 passed.
- `npx vitest run` (after tasks 2 and 3): 10 files, 183 tests passed.
- Acceptance greps: `pause('connection')` count 1, innerHTML in popups.js 0, "Keep paused" 1, "Continue queue" 1.
- Not verified: live popup behavior in SillyTavern (covered by plan 08 checkpoint item 6).

## Deviations from Plan
None of substance. Task 3 (index.js wiring) was applied while implementing task 2 and committed separately. One bug found during testing (chat key captured inside the scheduled task rather than at fire time) was fixed before commit.

## Known Stubs
None.

## Commits
- 8697263 feat(04-06): record connection per item and add diffConnection
- 74783b1 feat(04-06): connection gate, popup and lifecycle handling
- 5f4b192 feat(04-06): wire connection popup into init

## Self-Check: PASSED
