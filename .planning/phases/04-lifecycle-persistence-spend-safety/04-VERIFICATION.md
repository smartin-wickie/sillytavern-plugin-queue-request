---
phase: 04-lifecycle-persistence-spend-safety
verified: 2026-10-28T00:00:00Z
status: human_needed
score: 5/5 must-haves verified (automated + live smoke); 2 post-smoke fixes need live check
has_blocking_gaps: false
overrides_applied: 0
human_verification:
  - test: "CR-02 takeover: with the queue owned by tab A and a second tab B on the same chat, close A so B takes over. Watch network/saves."
    expected: "B calls reloadCurrentChat() without saving its stale chat first; chat_metadata.integrity is unchanged after the reload (no fall-through to the full release/re-claim/popup path); B stays paused with a takeover toast and the stored items; nothing runs until Resume."
    why_human: "Depends on ST 1.19.0 runtime behaviour of reloadCurrentChat and /api/chats/save integrity; unit tests use doubles. Fix committed c44e349 after the live smoke."
  - test: "CR-03 plain-HTTP ids: open ST over plain HTTP on a LAN IP (insecure origin, no crypto.randomUUID). Queue several swipes, reload, queue more, resume."
    expected: "Every item has a unique id and runs exactly once; no repeated or looping generations."
    why_human: "Needs a real insecure-origin browser. Fix committed 3c47099 after the live smoke."
  - test: "Open issue from smoke (04-08): simulated demote then takeover left an empty in-memory store while metadata held 3 items."
    expected: "After CR-01/CR-02 fixes, takeover restores the stored items (paused) with a toast."
    why_human: "Possibly a simulation artifact; fixed paths are covered by unit tests only."
  - test: "Real >10 s tab suspension / background-tab throttling of the owner (WR-01)."
    expected: "Owner is not silently demoted mid-generation; no duplicate runner."
    why_human: "Timer throttling is not reproducible in Vitest fake timers; not tested in the smoke."
---

# Phase 4: Lifecycle, Persistence & Spend Safety Verification Report

**Phase Goal:** The queue reacts sensibly to what the user does in ST, survives refresh and chat switches without surprise API spend, and cannot run away.
**Status:** human_needed (no blocking gaps)
**Re-verification:** No, initial verification

## Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Manual send/swipe/continue parks the in-flight result, remaining items wait; native Stop differs from queue cancel | VERIFIED | `src/guard.js` (114 lines) wired in `index.js:125` with runner and lifecycle; reason-set pause in `src/runner.js`; tests pass; smoke step 3 (Continue shows "Waiting...", native Stop resumes with no toast, Send clears with one toast) |
| 2 | Edit/delete target or new message clears pending with a toast; chat switch aborts running item and keeps pending stored with original chat | VERIFIED | `src/lifecycle.js` handlers; smoke steps 4 and 5 (one Cleared toast each; no failure toast on switch; items preserved; other chat has no `queuedSwipes`) |
| 3 | Refresh or return starts paused with resume/discard popup (count and model); stale items dropped with notice; no prompts stored | VERIFIED | `src/persistence.js` writes only version, ids, timestamps, hashes, names, connection (no prompt field); `src/popups.js`; smoke steps 1, 10 (metadata inspected) |
| 4 | Pause after N consecutive failures (no retry), on API/model/preset change, and while Prompt Inspector enabled | VERIFIED | `circuitBreakerThreshold` setting (`src/settings.js:36,71`, `settings.html:24`), `src/connection.js` diff, `inspector` reason in lifecycle/runner; smoke steps 6, 7, 8 |
| 5 | Same chat in two tabs: only one runs, other read-only | VERIFIED | `src/ownership.js` (lease), `src/mirror.js`, read-only gates in `src/queueActions.js` and `src/ui.js`; smoke step 9 (read-only display, takeover on close, simulated foreign lease demoted owner within 1 s with no late append) |

**Score:** 5/5. Test run by me: `npx vitest run` gives 15 files, 252 tests passing.

## Requirements Coverage

All 12 IDs appear in plan frontmatter and in REQUIREMENTS.md (marked complete, mapped to Phase 4). No orphans.

| Requirement | Plan | Status | Evidence |
|-------------|------|--------|----------|
| GUARD-01, GUARD-06 | 04-01 | SATISFIED | runner reason-set, guard native-only resume, smoke 3 |
| GUARD-02 | 04-02 | SATISFIED | lifecycle clears + toast, smoke 3/4 |
| GUARD-03, PERS-01, PERS-04 | 04-03 | SATISFIED | chat switch abort/requeue, metadata persistence, drop on load; smoke 5, 10 |
| PERS-02, PERS-03 | 04-04 | SATISFIED | resume/discard popup, smoke 1, 5 (Esc keeps paused, Discard clears) |
| SAFE-01, SAFE-03 | 04-05 | SATISFIED | breaker + Inspector gate, smoke 7, 8 |
| SAFE-02 | 04-06 | SATISFIED | connection diff popup, smoke 6 |
| SAFE-04 | 04-07, 04-08 | SATISFIED | ownership lease + read-only mirror, smoke 9 |

## Key Wiring

`index.js` constructs ownership, lifecycle, guard, and mirror and passes `ownership.isOwner` into the runner (`index.js:106-128`). No `TBD/FIXME/XXX` markers in `src/` or `index.js`. Persistence goes through ST save functions only.

## Code review findings

Fixed after the smoke: CR-01, CR-02, CR-03, WR-02, WR-03, IN-01 (commits b670d7f..549ed08, test count 231 to 252).

Unfixed findings assessed against must-haves (none breaks a roadmap truth in the tested paths, so none is blocking):

| ID | Assessment | Severity |
|----|------------|----------|
| WR-01 lease vs background throttling | Can flap ownership in a hidden tab and discard an in-flight result; spend-safe direction (no duplicate runs), but SC5 robustness is unproven. Listed for human check. | Warning |
| WR-04 `resume()` clears 'native' | Edge: Resume pressed during a native Continue could drop an item as stale. Narrow user action; SC1 main flow verified live. | Warning |
| WR-05 abort during dry-run capture reported as 'api' (confirmed in `index.js:43-48`) | A chat switch inside the capture window can show a failure toast and drop the item. Smoke step 5 (<1 s and >2 s) showed no failure toast, so the common path is fine; fix is a one-liner. | Warning |
| WR-06 append retry skips re-validation | Narrow window, robustness only. | Warning |
| WR-07 `isOwner()` true while role is null (`ownership.js:230`) | bfcache restore could run as owner without a lease, so doubled spend is possible in that case. Rare; recommend fixing before release. | Warning |
| WR-08 demotion does not pause | Relies on `isOwner` check; ties to WR-07. | Warning |
| WR-09 per-item immediate save | Efficiency only. | Info |
| WR-10 'inspector' pause never auto-clears | Safe direction (stays paused); matches smoke open issue 2 (design question). | Warning |
| IN-02..IN-06 | Cleanup or convention. | Info |

Known smoke follow-ups still open: "Cancel all" leaves failure/Inspector pause in place (design question); control hidden during native swipe generation.

## Anti-Patterns

None blocking. No stubs found; the 04-08 summary lists "Known Stubs: None".

## Human Verification Required

See frontmatter: CR-02 takeover reload (no save, integrity unchanged), CR-03 plain-HTTP LAN reload/queue/resume (each item runs once), the earlier demote-then-takeover empty-store observation, and real background-tab throttling (WR-01).

## Gaps Summary

No blocking gaps. All five success criteria and all 12 requirements are supported by code, 252 passing tests, and an approved live smoke on ST 1.19.0. Status is human_needed because two post-smoke fixes (CR-02, CR-03) have only unit-test evidence. Recommend fixing WR-05 and WR-07 (both small) before Phase 5 release.

---

_Verified: 2026-10-28_
_Verifier: Claude (bm-verifier)_
