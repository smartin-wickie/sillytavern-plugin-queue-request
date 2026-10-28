---
phase: 04-lifecycle-persistence-spend-safety
plan: 04
subsystem: lifecycle-ui
tags: [sillytavern, extension, popup, paused-state, vitest]

requires:
  - phase: 04-lifecycle-persistence-spend-safety
    provides: runner pause reasons and onStateChange, lifecycle handleChatChanged
provides:
  - src/popups.js showResumePopup (DOM-node content, exact NEGATIVE discards)
  - src/pauseLabels.js pauseReasonLabel/statusLineFor
  - lifecycle resume-prompt flow (deferred, once per load, key-checked)
  - queueActions.resumeQueue shared Resume entry point
  - paused rendering on badge, dropdown, progress bar, /queuestatus
affects: [04-05, 04-06, 04-08]

key-files:
  created: [src/popups.js, src/pauseLabels.js, test/pauseLabels.test.js]
  modified: [src/lifecycle.js, src/queueActions.js, src/ui.js, src/progressBar.js, src/commands.js, style.css, index.js, test/lifecycle.test.js, test/queueActions.test.js]

key-decisions:
  - "Discard also releases the 'restored' pause so later manual queuing is not stuck paused"
  - "Failure count for the 'failures' label is read via optional runner.getFailureCount (not yet present, shows 0 until a later plan adds it)"

requirements-completed: [PERS-02, PERS-03]
completed: 2026-10-27
---

# Phase 4 Plan 04: Resume prompt and paused UI Summary

On load with stored items the user is asked "Resume queued swipes?" (count plus recorded model); Resume releases the restored pause, Discard clears the stored items with a toast, Esc/close keeps everything paused. Every pause reason now renders on the badge (pause icon and tooltip), dropdown (status line and neutral Resume button), progress bar (paused fill, "Paused · n / m", Resume button) and `/queuestatus`.

## Tasks and commits

1. pauseLabels, popups, lifecycle prompt flow: e28acb7
2. resumeQueue and paused states on all surfaces: cf81b1b
3. Wire popup into index.js: 8c20c79

## Verification (observed)

- Full `npx vitest run`: 9 files, 148 tests passed (new: pauseLabels, resume/discard/dismiss variants, deferral while generating, chat-key abort, once-per-load, zero items, resumeQueue).
- Greps: `innerHTML` count in popups.js is 0; no hex colors in style.css.
- Not verified: live popup rendering, Esc vs Discard distinction, and paused UI visuals (popups.js and DOM code are not unit-testable); deferred to plan 08 checkpoint items 1 and 2.

## Deviations from Plan

**1. [Rule 1 - Bug] Discard releases the 'restored' pause.** Plan only said clear the store; leaving 'restored' set would keep any later-added items paused with no prompt. Added `runner.resume('restored')` after discard.

Read-only-tab gating of the popup is not implemented (no read-only concept exists yet); it belongs to the plan that introduces takeover/read-only state.

## Known Stubs

None. `runner.getFailureCount` is an optional lookup; the 'failures' label shows "0 failures in a row" until a later plan provides it (that reason cannot occur yet).

## Self-Check: PASSED
