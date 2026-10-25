---
phase: 01-route-verification-spike
plan: 06
subsystem: spike-behavior
tags: [sillytavern, spike, abort-safety, auto-swipe, stop]
requires: [01-02, 01-03, 01-05]
provides:
  - Criterion d verdict (PASS, with/without signal overlap)
  - Stop-with-partial policy confirmation (F1/F2/F3)
  - auto_swipe reachability and cascade evidence (G1)
  - Squash-ON fidelity gap confirmed and classified
  - World Info sticky activation confirmed (scope caveat documented)
  - Hard-blocker summary table, RECOMMEND R1
affects: [01-07]
key-files:
  created:
    - .planning/phases/01-route-verification-spike/captures/BEHAVIOR-RESULTS.md
    - .planning/phases/01-route-verification-spike/captures/qs-cc-stream-overlap-{signal,nosignal}-{queued,snapshot,overlap}.json
    - .planning/phases/01-route-verification-spike/captures/qs-cc-nostream-autoswipe-{queued,snapshot,transport}.json
    - .planning/phases/01-route-verification-spike/captures/qs-cc-nostream-squash-{queued,native,snapshot}.json
    - .planning/phases/01-route-verification-spike/captures/qs-cc-nostream-sticky-{queued,native,snapshot}.json
    - .planning/phases/01-route-verification-spike/captures/qs-notes.json
key-decisions:
  - "F1 (native stop mid-stream) recorded INCONCLUSIVE per explicit user decision, not retried further (local hardware too fast for automated mid-stream catch)"
  - "Sticky WI test scope caveat documented: only the activation turn was exercised, not the later-turn sticky-persistence gap the research actually flags"
  - "RECOMMEND: R1 (no hard-blocker criterion failed)"
requirements-completed: [SPIKE-03]
duration: 100min
completed: 2026-10-25
---

# Phase 1 Plan 06: Runtime Behavior Evidence Summary

Criterion d (own-signal overlap safety) passed cleanly in both conditions. Stop-with-partial and auto_swipe policies were confirmed by direct observation, including a real runaway auto-swipe cascade (23 swipes in a few seconds) that had to be stopped. Squash ON showed the one documented, source-predicted fidelity gap; World Info sticky showed no gap on the turn actually tested, with an honest scope caveat recorded for the untested later-turn case. Overall recommendation: R1.

## Tasks

| Task | Result | Commit |
|------|--------|--------|
| 1 (checkpoint:human-verify) | Resumed as Claude-in-Chrome-operated (user confirmed this continues from 01-05). D1/D2 overlap tests, F1/F2/F3 stop/abort tests all run via browser automation + console calls; notes recorded via qsSpike.note(). | (this commit) |
| 2 (checkpoint:human-verify) | G1 auto_swipe (own-transport unreachable, native cascade confirmed and stopped), G2 squash ON (capture+armNative+native swipe), G3 sticky WI (entry created since none existed from 01-04, activated, captured, removed after). | (this commit) |
| 3 (auto) | Copied 16 new dump files + qs-notes.json into captures/, ran diff-captures for squash and sticky, wrote BEHAVIOR-RESULTS.md with all required sections and RECOMMEND line. | (this commit) |

## Deviations from Plan

- **[Rule 3 - Approach] Both checkpoint tasks executed via Claude in Chrome, not the operator**, continuing the pattern established in 01-05 at the user's request.
- **[Rule 1 - Finding] F1 (native stop mid-stream) could not be cleanly tested via automation on this hardware.** Local llama-server + RTX 4090 completes CC replies in well under a second regardless of response-length cap (model hits a natural stop ~60-70 tokens on this raw-completion roleplay setup). Four attempts (delayed click, tight poll loop, synchronous `stopGeneration()` fired at `GENERATION_STARTED`) all landed after the response had already completed. Per explicit user decision (AskUserQuestion), recorded as an environmental finding (INCONCLUSIVE) rather than continuing to chase a clean catch; D1 part 2 (a related early-stop case under criterion d) did land one genuine native-stop observation (empty placeholder swipe retained) that partially substitutes.
- **[Rule 1 - Finding] `context.swipe.right(syntheticEvent, {source})` overwrote the existing swipe in place instead of adding a new slot**, unlike real UI clicks (which always added a new slot correctly across repeated tests). Documented as a source/DOM-context dependency, not a Stop-safety concern; switched to real UI clicks for all subsequent swipe-trigger tests.
- **[Rule 1 - Finding] F2's abort signal did not cut off an already-buffered fast local response** — `abortOwn()` reported `aborted:true` but `send()` still returned the full text, because the whole SSE response had already arrived in the browser before the abort call (sub-second local round trip). The safety property that matters (own-transport never appends to chat) held regardless. Documented as a design note for the real extension: application-level discard, not reliance on the abort actually stopping the network transfer.
- **[Rule 1 - Bug/gap] No sticky World Info entry existed from Phase 1-04's setup** (checked all 28 lorebooks, zero entries had `sticky > 0`) — the operator's Task 2 step 4 from `01-04-PLAN.md` was apparently not completed during that checkpoint. Created a temporary entry (`qstickytest`, sticky 3) on the character's bound world (`Eldoria`) for this task, removed it after. Also caused an ~27-second KV-cache-invalidation stall on first use (new content changed the prompt prefix, forcing a cold ~2091-token reprocess) — diagnosed via the llama-server log, not a bug, just an expected one-time cost.
- **[Rule 1 - Scope caveat] Sticky WI fidelity gap only partially tested.** The research's actual concern (sticky counter state across a dry-run on a later turn where the keyword has left context) was not exercised — only the direct keyword-activation turn was captured, which both paths handle identically via plain keyword-match scanning. `STRICT DIFF: none` on this run does not close the research's open question; documented explicitly in BEHAVIOR-RESULTS.md rather than overclaiming.
- Response length was temporarily raised to 300 and `amount_gen` reset to 64 multiple times during F1/D2 experimentation; restored to 64 before Task 2. Auto-swipe, squash, and the test WI entry were all restored/removed to baseline before finishing.

## Known Stubs
None.

## Self-Check: PASSED
`qs-notes.json` has all 5 required keys (`d_with_signal`, `d_no_signal`, `f_native_stop`, `f_own_abort`, `f_slash_abort`) plus `g_autoswipe`. BEHAVIOR-RESULTS.md has all 5 required headings and exactly one `RECOMMEND:` line. captures/ contains `qs-cc-nostream-squash-queued.json` and `qs-cc-nostream-sticky-queued.json`. No unredacted `proxy_password` found via grep across all 32 `qs-*.json` files in captures/.
