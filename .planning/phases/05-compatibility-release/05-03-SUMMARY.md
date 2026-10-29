---
phase: 05-compatibility-release
plan: 03
subsystem: compatibility
tags: [cascade, uat, ownership, live-test]
requires: [05-02]
provides: [COMP-02 live proof, Phase 4 UAT results]
affects: [README known-gaps section (05-04)]
key-files:
  created: []
  modified:
    - .planning/phases/05-compatibility-release/05-COMPAT-MATRIX.md
    - .planning/phases/04-lifecycle-persistence-spend-safety/04-HUMAN-UAT.md
    - .planning/phases/05-compatibility-release/evidence/*.jpg
decisions:
  - "User deferred UAT #2 (CR-03 plain HTTP over LAN) on 2026-10-28: LAN support is low priority."
metrics:
  completed: 2026-10-28
status: complete
---

# Phase 5 Plan 03: Live Cascade Test and Phase 4 UAT Summary

The live test shows that queued swipes do not trigger ST's auto-swipe or auto-continue cascades (COMP-02). Three of the four pending Phase 4 HUMAN-UAT checks passed live. The fourth (LAN plain HTTP) was deferred by the user.

## Results

- **cascade-control: PASS.** With auto_swipe on (min length 20000), auto_continue on, and allow_chat_completions on, one native swipe cascaded from 25 to 32 swipes over 9 non-dry generations. Generation was stopped manually.
- **cascade-queued: PASS.** With the same arm, queueing 3 at N=32 gave a final count of 35 (exactly N+3). There were 0 non-dry GENERATION_STARTED events and 0 console errors. The gap toast showed the auto-swipe line once and did not block queueing.
- **UAT 1 (CR-02): passed.** The takeover reload made 0 chat saves, integrity was unchanged, and the tab landed paused with "taken over from another tab".
- **UAT 2 (CR-03): deferred.** ST is loopback only, and the user rated LAN support as low priority.
- **UAT 3 (demote then takeover): passed.** All 3 items were restored, and the takeover toast was captured.
- **UAT 4 (WR-01): passed.** The owner tab stayed hidden for 7 min. It kept ownership, and 3 results appended.
- **State restored:** auto-swipe and auto-continue are off, the extension list and model are back to the snapshot, and TTS is off. Checked after a reload.

## Deviations

- **Auto-swipe minimum length was 20000, not 5000.** At 5000, some replies from this model are long enough to skip auto-swipe. 20000 guarantees the control cascades.
- **The control was stopped by unticking auto-swipe and calling stopGeneration.** Auto-swipe was re-ticked before the queued test.
- **UAT 3 forced a stale lease with a 9 s main-thread block** instead of waiting for background throttling.
- **Tabs were made to leave by navigating them to `/favicon.ico`.** Unload releases the lease. Closing tabs had dropped the MCP tab group once.

## Follow-up (not fixed here)

- **WR-01 risk.** Chrome's intensive throttling let the hidden owner's lease go stale for up to ~48 s. If a second ST tab on the same chat took over at that moment, the owner would demote and abort its in-flight item with `discard`. This path was not exercised. Candidate fixes: a longer `LEASE_TIMEOUT_MS` for hidden owners, or keep (append) the in-flight result on demotion.

## Self-Check: PASSED

- The plan's verify scripts pass: the matrix has the cascade rows, and 04-HUMAN-UAT.md has 0 `[pending]` results and total 4.
