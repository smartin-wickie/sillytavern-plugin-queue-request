---
phase: 02-single-queued-swipe-end-to-end
plan: 05
subsystem: ui
tags: [sillytavern, extension, dom-badge, css, live-verification]

# Dependency graph
requires:
  - phase: 02-single-queued-swipe-end-to-end
    plan: 01
    provides: src/ui.js (stub control), style.css placeholder, live-measured .swipe_right CSS values
  - phase: 02-single-queued-swipe-end-to-end
    plan: 02
    provides: src/store.js (createStore with pendingCount()/runningCount()/onChange())
  - phase: 02-single-queued-swipe-end-to-end
    plan: 04
    provides: src/runner.js onItemFailed(), GUARD-05 toast wiring already live
provides:
  - src/ui.js — renderBadge()/renderDisabledState() wired to store.onChange() and the existing DOM re-render events; onControlClick() re-checks the disabled condition before store.add()
  - src/store.js — getMaxQueueSize() (effectiveCap()), the single source both the disabled-state check and the click no-op guard read
  - style.css — finalized .qs-queue-control sizing (25px/25px/20px, pixel-parity with .swipe_right), .qs-queue-control--disabled, .qs-queue-badge corner-overlay positioning
  - Phase 2 close-out: all 19 requirement IDs implemented and live-verified (Text Completion generation and group-chat absence are documented residual gaps, not blockers — see "Known Gaps" below)
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Badge/disabled-state render functions look up the current `.qs-queue-control` element fresh on every call (never a cached reference) because injectControl() recreates the control on CHARACTER_MESSAGE_RENDERED/MESSAGE_SWIPED/CHAT_CHANGED"
    - "A single store-owned getter (getMaxQueueSize(), returning the same effectiveCap() add() enforces) is the one source of truth for every caller that needs to compare against the queue cap, rather than each caller deriving its own copy of the comparison"
    - "Badge content is always built from DOM nodes (createElement/createTextNode), never .innerHTML=, even for data that is always a small integer"

key-files:
  created: []
  modified:
    - src/ui.js
    - src/store.js
    - style.css

key-decisions:
  - "Added store.getMaxQueueSize() (not in the plan's literal <interfaces> list) so the disabled-class toggle (src/ui.js) and the click handler's no-op guard reference the exact same cap store.add() itself enforces, rather than a second independently-derived maxQueueSize value that could disagree once a future Phase 3 settings change pushes the configured value above HARD_MAX_QUEUE=20"
  - "Added position: relative to .qs-queue-control in style.css (not explicit in the plan's Task 2 action text) because .qs-queue-badge's position: absolute; top: -4px; right: -4px; corner-overlay only resolves against the control icon if the control itself is a positioned ancestor — without it the badge would anchor to whatever ancestor in the message row happens to be positioned, breaking the corner-notification effect"
  - "Badge/disabled-state subscribes to store.onChange() directly (fires on every store mutation: add/markRunning/markDone/drop) in addition to the existing DOM re-render events (CHARACTER_MESSAGE_RENDERED/MESSAGE_SWIPED/CHAT_CHANGED/APP_READY) — a click that fills the queue must disable the control immediately, not wait for the next unrelated re-render event to fire"

patterns-established:
  - "renderQueueState(store) is the single entry point injectControl() and the store.onChange() subscriber both call — it looks up the live `.qs-queue-control` element and calls renderBadge()/renderDisabledState() on it, so there is exactly one code path that keeps badge and disabled-state in sync with the store, never two"

requirements-completed: [QUEUE-01, QUEUE-02, UI-01]

# Metrics
duration: ~35min (Tasks 1-2 code) + orchestrator-run live checkpoint (Task 3, via claude-in-chrome)
completed: 2026-10-26
---

# Phase 2 Plan 05: Badge/Disable-at-Max UI Polish and Final Smoke Test Summary

**Live queue badge (hidden when empty, spinner+count while running) and disable-at-max control state with a live-numbered tooltip, both driven off a single `store.getMaxQueueSize()` source of truth; `style.css` finalized to 02-01's live-measured `.swipe_right` pixel values — live-verified end-to-end via Claude in Chrome against all 5 ROADMAP Phase 2 success criteria, closing out Phase 2 with two documented residual gaps (Text Completion generation and group-chat absence not re-live-tested this wave).**

## Performance

- **Duration:** ~35 min for Tasks 1-2 (code); Task 3's live checkpoint run and reported by the orchestrator via `claude-in-chrome`
- **Completed:** 2026-10-26
- **Tasks:** 3 of 3 complete
- **Files modified:** 3 (`src/ui.js`, `src/store.js`, `style.css`); 0 created

## Accomplishments

- Added `renderBadge(control, store)` to `src/ui.js`: computes `n = store.pendingCount() + store.runningCount()`; removes/hides the badge entirely when `n === 0` (never renders the character `0`, UI-01); when `n > 0` and `store.runningCount() > 0`, builds a `fa-spinner fa-spin` icon node followed by a text node for `n`; when `n > 0` and not running, sets just the integer text node. Built entirely from `createElement`/`createTextNode`/`textContent = ''` resets — no `.innerHTML =` assignment anywhere in the badge path (Security Domain V5, verified by grep during review).
- Added `renderDisabledState(control, store)`: toggles `qs-queue-control--disabled` and the control's `title` between `Queue a swipe` (idle) and `` `Queue full (${n}/${maxQueueSize})` `` (at cap) using live numbers, never a literal `"5/5"` string (D-06).
- Added `store.getMaxQueueSize()` to `src/store.js`, returning the exact `effectiveCap()` value `add()` itself enforces. Both `renderDisabledState()` and `onControlClick()`'s no-op guard call this same getter, so the visual disabled state and the actual enqueue-blocking behavior cannot independently drift apart — this closes the drift risk the plan's own acceptance criteria explicitly called out, extended one level further (store-vs-ui, not just ui-internal) since the alternative (passing a raw settings `maxQueueSize` into `ui.js`) would not have matched `store.add()`'s real HARD_MAX_QUEUE-clamped behavior in the one case where a future Phase 3 settings change exceeds 20.
- Rewired `onControlClick()` to re-check `pendingCount() + runningCount() >= store.getMaxQueueSize()` and return early (no-op) *before* calling `store.add()` — makes the "disabled control does nothing on click" guarantee an explicit, tested code path rather than an implicit side effect of `store.add()`'s own `{ ok: false }` return.
- `registerQueueControl()` now subscribes to `store.onChange(() => renderQueueState(store))` in addition to the existing DOM re-render events, and calls `renderQueueState(store)` once immediately after wiring — so badge/disabled-state is correct on first render and updates immediately on every queue mutation (add/markRunning/markDone/drop), not only on the next unrelated DOM-triggered re-render.
- Finalized `style.css`: `.qs-queue-control` set to `width: 25px; height: 25px; font-size: 20px; line-height: 25px;` (pixel-parity with 02-01's live-measured `.swipe_right` computed size) plus `position: relative` (anchors the badge). `.qs-queue-control--disabled { opacity: 0.5; cursor: not-allowed; }` (matches 02-01's measured disabled-icon opacity). `.qs-queue-badge { position: absolute; top: -4px; right: -4px; color: inherit; }` — no hex values, no new background/accent color. No TODO markers remain; no selector targets `.swipe_right`/`.swipe_left`/`.swipes-counter` (Pitfall 30).
- `node --check src/ui.js` and `node --check src/store.js` both pass. The plan's own style.css grep gate (`qs-`-prefix presence + no native-class selectors) passes. Full test suite `npx vitest run` — **50/50 passing**, unchanged from before this plan (D-11: this plan's badge/disable UI is DOM-only and verified live via Task 3, not unit-tested — no new test files were needed or added).
- **Task 3's live checkpoint passed all 5 ROADMAP Phase 2 success criteria**, run by the orchestrator via `claude-in-chrome` against the running local ST instance — see "Live Verification Results" below for the full per-criterion record.

## Task Commits

1. **Task 1: Badge + disable-at-max + live tooltip** - `8a88855` (feat)
2. **Task 2: Finalize style.css from live-measured values** - `e56898e` (feat)
3. **Task 3: Final comprehensive Phase 2 smoke test** - verified via Claude in Chrome against the running SillyTavern instance (all 5 success criteria PASS); no code changes (verification-only task). See "Live Verification Results" below.

## Files Created/Modified

- `src/ui.js` - `renderBadge()`, `renderDisabledState()`, `renderQueueState()` (shared entry point); `onControlClick()` now re-checks the cap before `store.add()`; `registerQueueControl()` subscribes to `store.onChange()` and renders once immediately
- `src/store.js` - added `getMaxQueueSize()` returning `effectiveCap()`
- `style.css` - finalized `.qs-queue-control` sizing/position, `.qs-queue-control--disabled`, `.qs-queue-badge`

## Decisions Made

- `store.getMaxQueueSize()` is a net-new export beyond the plan's literal `<interfaces>` list (which named only `pendingCount()`/`runningCount()`/`getItems()`/`onChange()` as newly-consumed) — added because the alternative (deriving `maxQueueSize` independently in `ui.js` from the raw settings value passed through `index.js`) would reproduce exactly the "two independently-written comparisons that could drift" bug class the plan's own acceptance criteria warn against, just one level removed (store vs. UI instead of UI-internal).
- `position: relative` on `.qs-queue-control` is a necessary consequence of the plan's own `.qs-queue-badge { position: absolute; top: -4px; right: -4px; }` instruction — without a positioned ancestor, the badge's absolute offset resolves against an unrelated ancestor, not the control icon. Not separately called out in the plan's Task 2 text but required for the corner-overlay to render as specified.
- Badge/disabled-state is recomputed by element lookup (`document.querySelector('.qs-queue-control')`) on every render call rather than a cached element reference, matching the existing `injectControl()` pattern of recreating the control element on each DOM re-render event — a cached reference would silently stop updating after the next `CHARACTER_MESSAGE_RENDERED`/`MESSAGE_SWIPED` recreation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Added `store.getMaxQueueSize()` as the single source of truth for the disabled-state/no-op-click comparison**
- **Found during:** Task 1
- **Issue:** The plan's acceptance criteria require the disabled-class toggle and the click handler's no-op guard to reference "the same `pendingCount() + runningCount() >= maxQueueSize` condition (not two independently-written comparisons that could drift)." `src/store.js` had no getter exposing the cap `add()` itself enforces (`effectiveCap() = Math.min(maxQueueSize, HARD_MAX_QUEUE)`); passing a raw settings `maxQueueSize` into `ui.js` would have reproduced the exact drift risk the plan was warning against, in the one case where a configured value exceeds `HARD_MAX_QUEUE=20`.
- **Fix:** Added `getMaxQueueSize()` to `src/store.js`, returning the internal `effectiveCap()`. `renderDisabledState()` and `onControlClick()` both call this same getter.
- **Files modified:** `src/store.js`, `src/ui.js`
- **Commit:** `8a88855`

**2. [Rule 2 - Missing critical functionality] Added `position: relative` to `.qs-queue-control`**
- **Found during:** Task 2
- **Issue:** The plan specifies `.qs-queue-badge { position: absolute; top: -4px; right: -4px; }` as a corner-overlay on the control icon, but does not separately state that `.qs-queue-control` needs `position: relative` to be the positioned ancestor the badge anchors against. Without it, the badge would position relative to whichever ancestor element in the message row happens to be positioned (or the viewport), not the control icon — breaking the intended corner-notification effect entirely.
- **Fix:** Added `position: relative` to `.qs-queue-control` in `style.css`.
- **Files modified:** `style.css`
- **Commit:** `e56898e`

No other deviations — Tasks 1 and 2 otherwise executed per the plan's `<action>`/acceptance criteria literally.

## Issues Encountered

- **Tooling-only, not a code issue (reported by the orchestrator during Task 3):** the browser's ES-module cache for dynamic `import()` served stale code for `.qs-queue-control` even after full hard-reloads and brand-new tabs (the server itself always served fresh bytes via plain `fetch`, confirmed independently). Worked around by temporarily giving the *installed* copies at `E:\SillyTavern\...\queued-swipes\` cache-busted filenames (`index_cb3.js`, etc., with `manifest.json`'s `js` field repointed) until the browser loaded a never-before-seen URL; cleaned back to `index.js`/`ui.js`/`store.js` + the original `manifest.json` afterward. This touched only the live install directory, never this worktree's committed source — confirmed by this agent's own `git status --short` showing a clean tree before writing this summary.
- This agent has no live-ST or browser access from inside the sandboxed worktree; Task 3's live checkpoint was run and reported by the orchestrator via `claude-in-chrome`, not independently re-run by this agent.

## Live Verification Results (Task 3, via Claude in Chrome against `http://127.0.0.1:8000`, reported by the orchestrator)

**1. SC1 (visibility) — PASS, with one note:** Control renders on `.last_mes` next to `.swipe_right`. Absence on a user-authored last message re-confirmed (same `canQueue()` gate as 02-01, code unchanged this wave). **Group-chat absence was not re-live-tested this round** — no group chat was set up in this install; spot-checked via code instead (`canQueue()` still does `if (c.groupId) return false;`, unchanged since 02-01's live-verified version). Recorded as a residual gap, see "Known Gaps" below.

**2. SC2 (multi-enqueue + badge + usability) — PASS, fully live-verified:**
- 5 rapid clicks → `title="Queue full (5/5)"`, `qs-queue-control--disabled` class applied, badge content exactly `<i class="fa-solid fa-spinner fa-spin"></i>5`.
- 6th click confirmed a true no-op — still exactly "5/5", no 6th item enqueued.
- Badge count tracked live state correctly as items completed one at a time: `5`→`3`→`2`→...→hidden (not shown as `0`).
- The clock icon itself never received a spin class — only the `.qs-queue-badge` span's inner `<i>` spins (D-07 confirmed).
- Throughout: `#send_but` stayed enabled, `.swipe_right` stayed interactable, the displayed swipe never jumped mid-run.

**3. SC3 (pager growth + parity) — PASS on Chat Completion; Text Completion not live-tested this plan:** All queued items completed; `chat.swipes` grew 1→6 then 6→7 across the test session, each new swipe containing real coherent in-character text (not stub/empty content), `swipes.length === swipe_info.length` held throughout. **Text Completion backend was not live-tested** — no Text Completion connection profile was readily configured in this install and standing one up wasn't judged a good use of remaining checkpoint time. This is the same gap 02-03 already flagged for the Generation Adapter; it now also applies to this plan's own smoke test. See "Known Gaps" below.

**4. SC4 (discard safety) — PASS:**
- Queued an item on one character's chat, switched to a different character's chat before the item could complete. The new chat stayed clean (no stray append); back on the original chat, the swipe count matched the pre-switch count exactly — no wrong-chat append, no corruption, no toast fired for the discard (silent, as designed).
- Error-toast path (unreachable endpoint → exactly one `toastr.warning` reading `Queued swipe failed: API error`, no raw error text) was already instrumented and confirmed in 02-04's checkpoint on this unchanged code path; incidentally re-confirmed again here when a broken connection profile from an earlier test fired the same exact string.

**5. SC5 (save integrity) — PASS:** After the full test sequence, refreshed the page and reopened the chat: `swipes.length === swipe_info.length` (`7 === 7`) on the target message, no null/missing entries (`anyNull: false`).

All 5 ROADMAP Phase 2 success criteria PASS. No corrections required to the committed code — the only issues during this checkpoint were test-environment setup artifacts (a stale connection profile from an earlier wave's error-toast test, and the browser module-cache quirk above), not defects in `src/ui.js`, `src/store.js`, or `style.css`.

## Known Gaps

Two residual verification gaps remain open at Phase 2's close, neither blocking this plan's own acceptance criteria (both are explicitly flagged for whoever scopes Phase 2's final sign-off or a later phase):

- **GEN-05 ("works with Chat Completion and Text Completion ... with no extra configuration") is live-confirmed only for Chat Completion.** Text Completion's `send()` code path (the non-`openai` branch in `src/adapter.js`) is code-reviewed against the Phase 1 spike's verified pattern and exercised indirectly by `test/runner.test.js`'s error-normalization cases, but has never been run against a real Text Completion backend end-to-end — first flagged by 02-03's SUMMARY, still open after this plan's smoke test because no Text Completion connection profile was readily available in the test install.
- **QUEUE-08's group-chat absence was not re-live-tested this wave** (no group chat was set up in this install). The underlying `canQueue()` gate is unchanged since 02-01's live-verified version (`if (c.groupId) return false;`), so this is a low-risk spot-check-via-code result, not a from-scratch live confirmation.

## Known Stubs

None. This plan introduced no new stub placeholders — the badge/disabled-state is fully wired to live `store` data, and `style.css` has no outstanding TODO markers.

## User Setup Required

None — no external service configuration required. No new dependencies were added.

## Next Phase Readiness

- All 3 tasks complete: `src/ui.js`/`src/store.js` pass `node --check`; `style.css` passes the plan's grep gate; `npx vitest run` passes 50/50 (unchanged); Task 3's live checkpoint confirmed all 5 ROADMAP Phase 2 success criteria.
- UI-01 (live badge) and the full D-04/D-05/D-06/D-07 interaction contract are real and observed live. Combined with 02-01 through 02-04, all 19 of Phase 2's requirement IDs (COMP-03, SET-02, QUEUE-01/02/08, GEN-01..06, SWIPE-01..05, GUARD-04/05, UI-01) have been implemented and verified — with the two residual gaps above (Text Completion live-test, group-chat live re-test) explicitly documented rather than silently assumed closed.
- Phase 3 (Full Queue Control & UI — cancel, slash commands, progress bar, settings panel) can build directly on this plan's `store.getMaxQueueSize()`/`renderQueueState()` patterns without further changes to this plan's files.
- This agent did not touch `.planning/STATE.md`, `.planning/ROADMAP.md`, or `.planning/REQUIREMENTS.md` — per this plan's explicit instruction, the orchestrator owns those writes after this wave, including closing out Phase 2's progress tracking and recording the two documented gaps above wherever the orchestrator tracks residual items.

---
*Phase: 02-single-queued-swipe-end-to-end*
*Completed: 2026-10-26*

## Self-Check: PASSED

`src/ui.js`, `src/store.js`, and `style.css` confirmed present and modified on disk. Both task commits (`8a88855`, `e56898e`) confirmed present in `git log --oneline` on this worktree's branch (`worktree-agent-a3cfe5900f2ee4901`). Full test suite re-run immediately before finalizing this summary confirmed `50/50` passing across 4 files, matching the count before this plan (no new tests added, consistent with D-11). Task 3's live result (all 5 ROADMAP success criteria PASS, two residual gaps documented) is recorded above exactly as reported by the orchestrator's Claude-in-Chrome checkpoint run — not independently re-verified by this agent, which has no live-ST or browser access from inside the sandboxed worktree. `git status --short` confirmed a clean working tree (no stray files from the orchestrator's browser-cache workaround, which touched only the live install directory outside this worktree) immediately before writing this summary.
