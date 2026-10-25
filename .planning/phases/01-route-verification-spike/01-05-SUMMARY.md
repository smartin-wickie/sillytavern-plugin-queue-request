---
phase: 01-route-verification-spike
plan: 05
subsystem: spike-matrix
tags: [sillytavern, spike, route-evidence]
requires: [01-02, 01-04]
provides:
  - 4-combination capture matrix evidence (cc/tc x stream/nostream)
  - Criterion a/b/c verdicts (all PASS, zero gaps)
  - Draft-leakage check (Pitfall 9, PASS)
affects: [01-06, 01-07]
key-files:
  created:
    - .planning/phases/01-route-verification-spike/captures/MATRIX-RESULTS.md
    - .planning/phases/01-route-verification-spike/captures/qs-cc-stream-{queued,native,snapshot,transport}.json
    - .planning/phases/01-route-verification-spike/captures/qs-cc-nostream-{queued,native,snapshot,transport}.json
    - .planning/phases/01-route-verification-spike/captures/qs-tc-stream-{queued,native,snapshot,transport}.json
    - .planning/phases/01-route-verification-spike/captures/qs-tc-nostream-{queued,native,snapshot,transport}.json
  modified:
    - spike/index.js
key-decisions:
  - "Matrix run via Claude in Chrome against the operator's real browser session, not manual operator testing (deviation, see below)"
  - "No hard blockers on criteria a/c; criterion b passed with zero gaps in tested scope"
requirements-completed: [SPIKE-02]
duration: 55min
completed: 2026-10-25
---

# Phase 1 Plan 05: 4-Combination Capture Matrix Summary

All 4 combinations (CC/TC x stream/nostream) ran clean: dry-run capture had zero side effects, captured prompts matched native-swipe prompts exactly (strict diff none in all 4), both return shapes were handled, and the draft-input-leakage check passed.

## Tasks

| Task | Result | Commit |
|------|--------|--------|
| 1 (checkpoint:human-verify) | Resumed as Claude-in-Chrome-operated, not manual. Both servers restarted after a session break; CC multi-swipe bug found and fixed (n=4 -> 1) in the prior checkpoint; ran all 4 combos (capture/send/armNative+swipe) via browser automation. | fix 1b21eae (prior), fix 82e8e33 |
| 2 (auto) | Copied 16 dump files into captures/, verified no unredacted secrets, ran diff-captures.mjs for all 4 combos (all `STRICT DIFF: none`), checked draft-marker leak (none), wrote MATRIX-RESULTS.md with verdicts. | (this commit) |

## Deviations from Plan

- **[Rule 3 - Approach] Task 1 executed via Claude in Chrome, not the operator.** The plan wrote Task 1 as `checkpoint:human-verify` expecting the user to click through the UI and paste console output. Partway through, the user connected Claude in Chrome and asked the assistant to run the matrix itself. The assistant ran all console calls, UI clicks and swipe-arrow clicks through browser automation instead, with the user available to intervene. This is a materially different execution path than the plan specified (automation, not a human reading instructions), but it produced the same artifacts (same dump files, same JS calls) and the acceptance criteria were unaffected.
- **[Rule 1 - Bug] `qsSpike.capture()` threw `DataCloneError` on the TC/llama.cpp route.** `structuredClone()` cannot clone the `generate_data` params object for that route because ST's `buildParams()` (scripts/textgen-settings.js:1666-1828) leaves a `parseSequenceBreakers` function property on the object after using it, for every TC backend type including llama.cpp — this is never deleted. Fixed in `spike/index.js` (commit 82e8e33) by replacing `structuredClone` with a JSON round-trip clone (`jsonClone`), which drops non-serializable function properties the same way the JSON dump files already would. This is a genuine ST source quirk worth noting for anyone else inspecting `generate_data` for TC/llama.cpp.
- **[Rule 1 - Bug, found in prior checkpoint] CC "Multiple swipes per generation" was 4, llama-server only accepts 1.** Already fixed and recorded before this plan started; carried forward here since combo 1 depended on it.
- **Settings drift across the session break.** When the browser session resumed (new Claude Code session, servers restarted), CC temperature read 1.20 and max response length 2048/6048 instead of the 0/64 recorded in 01-04's ENVIRONMENT.md — the earlier operator-set values weren't what the live preset had. Re-set to temperature 0, response length 64 for both CC and TC before running the matrix; also found and disabled TC's "Dynamic Temperature" (0.5-3 range), which would have silently overridden TC's temperature=0 if left on.
- **One stray capture file excluded.** `qs-tc-stream-manual-snapshot.json` in `user/files/` was left over from the user's earlier manual `qsSpike.snapshot()` troubleshooting call (before the character-guard fix) and does not match the matrix's queued/native/snapshot/transport naming convention per combo. Not copied into captures/; noted here instead of silently dropped.

## Known Stubs
None.

## Self-Check: PASSED
16 `qs-*.json` files in captures/ (4 per combo x 4 combos); MATRIX-RESULTS.md has 4 table rows matching the required pattern, `## Draft leakage` and `## Criterion verdicts a/b/c` headings present; no unredacted `proxy_password` value found via grep.
