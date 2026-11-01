---
status: resolved
trigger: "The bug is still there. When I page back on a previous swipe, the clock disapears."
created: 2026-11-01
updated: 2026-11-01
---

# Debug: clock control disappears after paging to a previous swipe

## Symptoms

- **Expected:** The clock control (`.qs-queue-control`) stays on the latest message while the user pages between existing swipes.
- **Actual:** Paging back to a previous swipe removes the clock. It stays gone until a queue change, new message or chat change.
- **Errors:** None reported.
- **Timeline:** Reported 2026-11-01. Still present after syncing the installed extension to repo commit `4f8da30`. Commit `e5b57f5` fixed the same removal for the generation path only.
- **Reproduction:** Open a chat whose latest AI message has several swipes in Chrome. Swipe left to a previous page, with no generation running.

## Current Focus

reasoning_checkpoint:
  hypothesis: "ST emits MESSAGE_SWIPED while swipeState is 'swiping', so the listener's immediate render sees canQueue() false and removes the control. Paging fires no later event, so it stays gone."
  confirming_evidence:
    - "script.js:9995 sets SWIPING, :10315 awaits the MESSAGE_SWIPED emit, :10099 clears it only in endSwipe, after the swipe-in animation."
    - "src/ui.js:320 runs render on that emit and :76-78 removes the control when canQueue() is false."
    - "script.js:2572-2579 reuses the message element on a swipe, and no ST CSS rule targets the control, so ST itself does not remove or hide it."
  falsification_test: "A test that replays this event order against current src/ui.js and still finds the control after the swipe ends. A browser check where the clock still vanishes after the fix would also refute it."
  fix_rationale: "Stop rendering synchronously inside the swipe and wait for it to finish. Keep waiting for as long as ST reports 'swiping', because emit awaits every listener serially and a slow listener can outlast the 5s retry budget."
  blind_spots: "Not observed at runtime, because the debugger cannot attach to Chrome. The test uses a fake DOM and a simulated ST swipe sequence."
- next_action: none; the user confirmed the fix in the browser

## Evidence

- timestamp: 2026-11-01
  source: `E:\SillyTavern\public\script.js`
  finding: `swipe()` sets `swipeState = SWIPING` at line 9995, emits `MESSAGE_SWIPED` at line 10315 and resets the state in `endSwipe()` at line 10099.
- timestamp: 2026-11-01
  source: `E:\SillyTavern\public\script.js:9162-9173`
  finding: `isSwipingAllowed()` requires `swipeState === SWIPE_STATE.NONE`.
- timestamp: 2026-11-01
  source: `src/ui.js:76-78`, `src/ui.js:320`
  finding: The `MESSAGE_SWIPED` listener calls `render`, which removes the control when `canQueue()` is false.
- timestamp: 2026-11-01
  source: `src/ui.js:326-339`
  finding: The retry poller runs only on `GENERATION_ENDED` and `GENERATION_STOPPED`, and neither fires when paging between existing swipes.
- timestamp: 2026-11-01
  source: runtime
  finding: Not confirmed at runtime. Chrome has no remote debugging port, so the debugger cannot attach. The user reproduces the symptom manually.

- timestamp: 2026-11-01
  source: `E:\SillyTavern\public\lib\eventemitter.js:146`, `E:\SillyTavern\public\script.js:10315`
  finding: `emit` awaits each listener in turn and `swipe()` awaits `emit`. A slow listener from another extension therefore holds `swipeState` at `swiping` past the 5s retry budget. The proposed fix alone would have removed the clock at give-up and left it gone, which is the same symptom.
- timestamp: 2026-11-01
  source: `E:\SillyTavern\public\script.js:10039-10046`, `:10317-10320`
  finding: On an overswipe, `endSwipe` awaits the generation, so `swiping` lasts for the whole generation. Dropping the immediate render alone would have left a clickable-looking clock that does nothing for up to 5s of native generation.
- timestamp: 2026-11-01
  source: `E:\SillyTavern\public\script.js:10099-10101`
  finding: `swipeState = NONE` and `showSwipeButtons()` run with no await between them, so a timer tick cannot land between the two.
- timestamp: 2026-11-01
  source: `src/ui.js:345-351` (before the fix), `test/ui.test.js`
  finding: A queue change during a swipe is safe. With the control present, `refresh` only updates its state. With it absent, `render` hits the `canQueue()` gate and does nothing. The later retry finds the existing control and does not inject a second one.
- timestamp: 2026-11-01
  source: `test/ui.test.js` against `git show HEAD:src/ui.js`
  finding: 6 of 10 tests fail on the unfixed code, including "is still there after paging to a previous swipe". This reproduces the removal in a simulated event order, not in a browser.
- timestamp: 2026-11-01
  source: temporary mutants of the fixed `src/ui.js`, since restored
  finding: Applying the retry limit mid-swipe fails 2 tests. Removing the hide during generation fails 1 test. Both branches of the fix are covered.
- timestamp: 2026-11-01
  source: `npx vitest run`
  finding: 18 files and 281 tests pass, in 3 consecutive runs after the fix. No linter exists in this project (no lint script, no config, no ESLint in node_modules), so lint was not run.
- timestamp: 2026-11-01
  source: `cmp` against `E:\SillyTavern\data\default-user\extensions\queued-swipes`
  finding: All 27 approved files are identical after the sync. The installed `src/` has no file without a repo counterpart.

## Eliminated

- hypothesis: ST removes the control itself when it rebuilds the message on a swipe.
  evidence: `script.js:2572-2579` reuses the existing message element for `type === 'swipe'`, and the control is removed by `src/ui.js`.
  timestamp: 2026-11-01
- hypothesis: CSS hides the clock on a non-last swipe.
  evidence: ST's rules at `style.css:1351-1359` target only `.swipe_left`, `.swipe_right` and `.swipes-counter`. Nothing in the extension's rules for `.qs-queue-control` depends on `last_swipe` or `swipes_visible`.
  timestamp: 2026-11-01
- hypothesis: The installed extension is stale, or another extension removes the clock.
  evidence: `cmp` showed all 27 files matched the repo before the fix. A search of both extension directories for `qs-queue` and `queuedSwipes` found no other extension.
  timestamp: 2026-11-01

## Proposed Fix

Register `MESSAGE_SWIPED` with the existing retry poller in `registerQueueControl` (`src/ui.js:326-339`), renamed `renderWhenIdle`, and add a regression test. `src/ui.js` has no test file yet.

## Post-fix Steps

The user approved syncing repo files to `E:\SillyTavern\data\default-user\extensions\queued-swipes` after the fix. Copy `index.js`, `manifest.json`, `package.json`, `settings.html`, `style.css` and `src/*.js`, then verify with `cmp`. Do not drive the user's Chrome or swipe their real chats. The user verifies in the browser after a reload.

## Resolution

- root_cause: `src/ui.js` ran `injectControl` synchronously on `MESSAGE_SWIPED`. ST emits that event while `swipeState` is `swiping` (`script.js:9995`, `:10315`) and clears it only in `endSwipe` (`:10099`), so `canQueue()` was false and the control was removed. Paging between existing swipes fires no later event, and the retry poller ran only on `GENERATION_ENDED` and `GENERATION_STOPPED`. Found from source and a simulated event order. The debugger never attached to Chrome, so the mid-swipe state was not observed directly. The user's browser check supports the cause: the clock stays once this path is fixed.
- fix: `MESSAGE_SWIPED` now uses the retry poller, renamed `renderWhenIdle`, instead of an immediate render, so the clock stays in place during the swipe. While ST reports `swiping`, the poller has no retry limit, so a slow listener cannot make it give up. If a generation runs inside the swipe, it hides the clock and keeps polling, so the clock returns when the swipe ends. The 5s limit still applies to all other blocked states, such as group chats.
- verification: The user confirmed on 2026-11-01, in Chrome against ST 1.19.0, that the fix works. The unit tests show, with a fake DOM and a simulated ST event order, that the control survives paging, a swipe held 10 minutes, overlapping swipes and queue changes during a swipe, and that it hides and returns around a generating swipe. Those other scenarios were not separately checked in a browser. Test suite: 281 of 281 pass. Lint: none configured, not run. The installed extension is synced and matches the repo under `cmp`.
- files_changed: src/ui.js, test/ui.test.js (commit 01cdaf5; also synced to the installed extension)
- known_gaps: If ST stays in `swiping`, for example through the early return at `script.js:10002-10005`, one 250ms timer keeps running until reload. If a block other than a swipe outlasts the 5s retry limit, the clock stays gone until the next event.
