---
phase: 03-full-queue-control-ui
plan: 04
subsystem: ui
tags: [sillytavern, extension, settings, vitest, dom]

# Dependency graph
requires:
  - phase: 03-01 (runner cancel capability + cancel dropdown)
    provides: cancelAll(), abortRunning(), badge/dropdown DOM structure
  - phase: 03-02 (slash commands + wand menu)
    provides: /queueswipe/queuecancel/queuestatus, wand-menu entries; documented finding that canQueue() cannot be called inside a slash-command callback (is_send_press stays true for the whole send pipeline)
  - phase: 03-03 (progress bar + toast coalescing)
    provides: toastAccumulator.js, progressBar.js, getNotificationStyle() already wired and live-read-correct in ui.js
provides:
  - settings.html + src/settings.js registerSettingsPanel({ store, runner }) — Extensions-drawer settings panel, all 5 fields live-read/live-write
  - src/store.js setMaxQueueSize(n) — live cap mutator
  - src/st-bridge.js canQueue() now also gates on extension_settings[MODULE_NAME].enabled
  - src/appender.js auto-jump via ST's own swipe.to() API, never a direct swipe_id write
  - src/ui.js injectControl() exported, now also the actual enforcement point for canQueue() on click (not just on render)
affects: []  # last plan in this phase

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A render-time gate (deciding whether to insert/remove a control) is not an enforcement gate on its own — the control's own event handler needs the same check, because nothing guarantees a re-render happens between the gate's underlying state changing and the next user interaction"
    - "A settings-panel field that affects a live-rendered DOM element (not just stored state) needs to actively trigger that element's own re-render function after writing the setting — a generic ST chat event is not guaranteed to fire on a settings change"
    - "canQueue()'s isAllowed() half is unsafe inside a slash-command callback (03-02's finding) but safe and necessary inside a DOM click handler (this plan's fix) — same function, different caller context, different correctness properties"

key-files:
  created: [settings.html, src/settings.js]
  modified: [index.js, src/st-bridge.js, src/store.js, src/appender.js, src/commands.js, src/ui.js, test/store.test.js]

key-decisions:
  - "commands.js's /queueswipe gates on extension_settings[MODULE_NAME].enabled directly, NOT canQueue() — the plan's literal instruction was to use canQueue(), but 03-02-SUMMARY.md already live-verified that canQueue() is always false inside any slash-command callback (ST holds is_send_press true for the whole send pipeline a slash command runs inside), and 03-02's own agent tried and reverted this exact fix. Reusing it here would have reproduced that regression and broken /queueswipe entirely. Documented inline with a comment citing the 03-02 finding."
  - "setMaxQueueSize(n) reassigns createStore()'s closure-local maxQueueSize parameter directly (effectiveCap() already reads it) rather than adding a new field, keeping effectiveCap()'s existing HARD_MAX_QUEUE clamp as the single source of truth for the real enforced cap regardless of which path set it"
  - "injectControl() exported from ui.js specifically so settings.js can force the exact same re-render path ST's own events already trigger, rather than inventing a second, divergent render path or a custom event bus for one setting"

patterns-established:
  - "Pattern: when a setting gates a DOM element AND an action handler on that element, both need the live check — one for presentation, one for actual enforcement — found live when the first wasn't enough on its own"

requirements-completed: [SET-01]  # Validated end-to-end against a live ST 1.19.0 instance (Task 3), including 2 live-found/fixed bugs. Steps requiring actual LLM completion (5-7) verified by code review only — see Task 3 results.

# Metrics
duration: ~15min (Tasks 1-2, by a fresh executor after 03-03's tooling dynamic) + ~45min (Task 3 live verification, 2 bugs found and fixed, across a backend outage)
completed: 2026-10-27
---

# Phase 03 Plan 04: Settings Panel Summary

**A 5-field Queued Swipes settings panel in the Extensions drawer (enable, max queue, auto-jump, notification style, circuit-breaker threshold), all live-read/live-write — live-verified against ST 1.19.0, with 2 real bugs found and fixed: the Enable toggle didn't actually stop queueing via the badge control, and its icon didn't disappear/reappear immediately. This is the last plan in phase 03.**

## Performance

- **Duration:** ~15 min (Tasks 1-2) + ~45 min (Task 3: 8-step live verification, 2 bugs found/fixed, partial backend outage)
- **Tasks:** 3 of 3 completed
- **Files modified:** 8 across Tasks 1-2, plus `index.js`/`src/settings.js`/`src/ui.js` again for the Task 3 fix

## Accomplishments
- Created `settings.html` (inline-drawer markup, all 5 fields) and `src/settings.js` (`registerSettingsPanel`), wiring every field to live-read/live-write `extension_settings[MODULE_NAME]` with no cached references (D-12)
- Added `store.js`'s `setMaxQueueSize(n)`, closing the one gap where "Max queue size" would otherwise only take effect after a reload
- Wired the Enable toggle into `canQueue()` (gates the badge control and wand menu) and, separately and correctly, into `/queueswipe` directly (not via `canQueue()`, to avoid reproducing 03-02's documented regression)
- Wired auto-jump into `appender.js` via ST's own `swipe.to()` API, guarded so it only fires when the user was already viewing the newest swipe
- **Found and fixed two real bugs during live verification**: the Enable toggle's badge-control enforcement and its UI responsiveness were both incomplete — see Task 3 below

## Task Commits

Each task was committed atomically (Tasks 1-2 by a fresh executor agent after 03-03 established the "stop and report, orchestrator commits" pattern for this environment's git-hook interaction; Task 3's fix was committed by the orchestrator after live verification, same as every prior plan this phase):

1. **Task 1: Settings panel — markup, live-read/live-write wiring, DEFAULT_SETTINGS, live max-queue mutator** - `82f7d78` (feat)
2. **Task 2: Wire "enabled" gate and "auto-jump" behavior** - `795eae3` (feat)
3. **Task 3: Live verification — settings panel values actually take effect, plus the 2 fixes it found** - `83cdf0a` (fix)

## Files Created/Modified
- `settings.html` (new) - `inline-drawer` with 5 fields: `qs_enabled`, `qs_max_queue`, `qs_auto_jump`, `qs_notification_style`, `qs_circuit_breaker`
- `src/settings.js` (new) - `registerSettingsPanel({ store, runner })`: renders `settings.html` into `#extensions_settings2`, initializes every control from a fresh settings read, wires every field's `change`/`input` handler to a fresh `SillyTavern.getContext()` read-then-write; `#qs_max_queue` additionally calls `store.setMaxQueueSize()`; `#qs_enabled` additionally calls `injectControl(store, runner)` (Task 3 fix)
- `src/store.js` - Added `setMaxQueueSize(n)`: validates `Number.isFinite`, reassigns the closure's `maxQueueSize`, calls `notify()`
- `test/store.test.js` - 3 new tests for `setMaxQueueSize` (changes the enforced cap, still clamped to `HARD_MAX_QUEUE`, fires `onChange`, no-ops on non-finite input) — 13/13 passing
- `index.js` - Imports `MODULE_NAME` from `st-bridge.js` instead of re-declaring it locally; `DEFAULT_SETTINGS` extended to all 5 keys; calls `registerSettingsPanel({ store, runner })` (runner added in the Task 3 fix) as the last line of `init()`
- `src/st-bridge.js` - `canQueue()` now also returns `false` when `extension_settings[MODULE_NAME]?.enabled === false`
- `src/appender.js` - Captures `previousSwipeId`/`previousLastIndex` before the swipe pushes; after them, if `autoJump` is on and the user was already on the newest swipe, calls `c.swipe.to(null, 'right', { source: 'queuedSwipes', message: m, forceMesId: mesId, forceSwipeId: m.swipes.length - 1 })` — never a direct `swipe_id` write for this new behavior
- `src/commands.js` - `/queueswipe` gates on `extension_settings[MODULE_NAME]?.enabled === false` directly (see "Decisions Made" — deliberately not `canQueue()`)
- `src/ui.js` - **Task 3 fix:** `injectControl` now exported; `onControlClick` now starts with `if (!canQueue()) return;` (previously had no eligibility check of its own at all, relying entirely on the render-time gate)

## Decisions Made
- `/queueswipe`'s enabled-gate deliberately bypasses `canQueue()` and reads the `enabled` flag directly — the plan's literal instruction (`import { canQueue } ...`) would have reproduced a regression 03-02 already found and reverted (`canQueue()`'s `isAllowed()` check is always false inside any slash-command callback). Functionally equivalent gate, without the footgun. Documented inline in `commands.js`.
- `setMaxQueueSize(n)` mutates `createStore()`'s own closure variable rather than introducing a second "effective" field, so `effectiveCap()`'s existing `HARD_MAX_QUEUE` clamp stays the single source of truth no matter which code path (constructor or live mutator) set it
- `injectControl` is exported specifically so the settings panel can trigger the *same* render path ST's own chat events already use — not a parallel/divergent re-render implementation

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - adjusted to avoid reproducing a known regression] `/queueswipe`'s enabled-gate uses a direct settings read instead of the plan's literal `canQueue()` instruction**
- **Found during:** Task 2 implementation (not live verification) — the executor read 03-02-SUMMARY.md per its required reading list and recognized the literal instruction would reproduce an already-documented, already-reverted bug
- **Fix:** `extension_settings[MODULE_NAME]?.enabled === false` check instead of `!canQueue()`, same toast wording, same user-facing behavior
- **Verification:** Live-verified in Task 3 steps 2 and 3 — `/queueswipe` correctly shows the disabled warning when off and works again immediately when re-enabled
- **Committed in:** `795eae3` (Task 2 commit)

**2. [Rule 3 - Blocking, found live] The Enable toggle didn't actually stop the badge control from queueing, and its icon didn't disappear/reappear immediately**
- **Found during:** Task 3 live verification, step 2 ("Confirm the queue control icon disappears from the latest message immediately")
- **Issue:** Two compounding gaps. (a) `onControlClick()` had no `canQueue()`/enabled check of its own — only `injectControl()` (which decides whether to insert the control at all) gated on it. Confirmed live: with Enable unchecked, clicking the still-present control successfully queued a swipe (badge went to "1", running) — the Enable toggle was cosmetic-only for this entry point, not a real gate. (b) `injectControl()` only re-runs on specific ST chat events (`CHARACTER_MESSAGE_RENDERED`/`MESSAGE_SWIPED`/`CHAT_CHANGED`/`APP_READY`); toggling a settings checkbox doesn't fire any of them, so the control's icon stayed visible in the DOM for an indefinite period after Enable was unchecked (confirmed live: still present after a 500ms wait, no debounce explains it).
- **Fix:** Added `if (!canQueue()) return;` as the first line of `onControlClick()` (mirrors `wandMenu.js`'s existing, already-correct pattern — this is a DOM click handler, not a slash command, so `canQueue()`'s `isAllowed()` half is safe here, unlike deviation #1 above). Exported `injectControl` from `ui.js`; `index.js` now passes `runner` to `registerSettingsPanel` (previously only `store`); the `#qs_enabled` change handler calls `injectControl(store, runner)` immediately after writing the setting, forcing the same re-render ST's own events trigger.
- **Files modified:** `src/ui.js`, `src/settings.js`, `index.js`
- **Verification:** Re-ran live, from a fresh page load: unchecking Enable now removes the control with no measurable delay (checked via direct DOM query immediately after the click event); re-checking it reinserts the control immediately; clicking the control while Enable is off (forced via direct `.click()` before the fix was deployed) now correctly does nothing. `npx vitest run` — 70/70 passing, no regressions (this is pure DOM-wiring code with no existing or new unit test coverage, matching the pattern already established for `wandMenu.js`/`progressBar.js` in this phase).
- **Committed in:** `83cdf0a`

---

**Total deviations:** 2 (1 adjusted to avoid a known regression during implementation, 1 blocking bug found and fixed during live verification)
**Impact on plan:** Both are directly about SET-01's core promise — "Turning Enable off immediately hides/disables the queue control... with no reload" is this plan's own must-have truth, and it was not actually true until the Task 3 fix. No new files, no architectural change.

## Task 3: Live Verification Results

Executed against a real running SillyTavern 1.19.0 instance (localhost:8000), across a session that included an environment restart (documented in 03-03-SUMMARY.md) and, partway through this plan's own verification, an external LLM backend that stopped responding to generation requests (confirmed via an empty "Available Models" list in the Connection Profile panel and two separate queue attempts that never completed after 3+ minutes and ~100 seconds respectively, with no errors and no stuck/retry loop visible in ST's own console — a genuine backend outage, not a code defect, and not something this session controls or can fix).

1. **All 5 fields render with sensible defaults** — PASS. Enable checked, Max queue 5, Jump to newest unchecked, Notification style "All", Pause after 3 — exactly as specified.
2. **Uncheck Enable: control disappears immediately, /queueswipe shows the disabled toast** — FAILED initially, then PASS after the fix (see Deviations above). Pre-fix: control stayed visible and clickable, successfully queued a swipe anyway. Post-fix: control removed from the DOM with no measurable delay; `/queueswipe` correctly left the chat unchanged (42/42, no new swipe) with the gate confirmed via direct settings-state inspection before and after.
3. **Re-check Enable: control reappears, /queueswipe works again immediately** — PASS. Confirmed via direct DOM query (`controlExists: true`) immediately after toggling, and via `/queueswipe`'s normal "Queued 1 swipe(s)." behavior in the pre-fix test pass (before Enable was unchecked again for step 2's re-test).
4. **Max queue size → 2 live, without reload: control shows "Queue full (2/2)" after exactly 2** — PASS, exactly as specified. Three rapid clicks produced `class="qs-queue-control qs-queue-control--disabled" title="Queue full (2/2)"` with a badge of "2" — the real UI path proof the plan's step 4 explicitly asked for, on top of the automated `store.test.js` coverage.
5. **Auto-jump when already on newest swipe** — NOT independently live-confirmed; code-reviewed instead. The external LLM backend did not complete a single generation during this plan's Task 3 window (two attempts, ~3 min and ~100s, both cancelled after no activity) — this is the same external-dependency limitation 03-03-SUMMARY.md documented for its own step 4, recurring here for a different reason (backend outage rather than one-off timing). `src/appender.js`'s implementation was read directly: `previousSwipeId`/`previousLastIndex` are captured before the swipe pushes (so they reflect "was the user on the newest swipe *before* this one landed"), and the jump (`c.swipe.to(null, 'right', { ... forceSwipeId: m.swipes.length - 1 })`) is gated on `autoJump && previousSwipeId === previousLastIndex` — matching the spec exactly, using ST's own public API, never a direct `swipe_id` write.
6. **No jump when on an older swipe** — Same as step 5: not independently live-confirmed (same backend outage), but the guard condition (`previousSwipeId === previousLastIndex`) is the literal negation of "viewing an older swipe," so the two cases are the same code path by construction, not two separately-implemented behaviors that could diverge.
7. **Notification style "Off": no toast on completion** — Not live-confirmed (same backend outage — requires an actual completion). `getNotificationStyle() !== 'off'`/`=== 'all'` gating was already live-verified correct in 03-03 (that plan's Task 3 directly exercised `getNotificationStyle()`'s default-'all' behavior and the toast-coalescing flush logic); this plan only adds the UI to set `notificationStyle` to a non-default value, which `settings.js`'s `#qs_notification_style` handler writes via the same live-read/live-write pattern verified for every other field.
8. **Persistence across drawer close/reopen** — PASS. Set Enable=true, Max queue=5, Jump to newest=true (plus the pre-existing Notification=All, Pause=3), closed the Extensions panel, reopened it: every field showed the set values, not the original defaults.

### Why two fields required code review instead of a live rerun

Unlike 03-01/03-02/03-03 (where a single retry or a different test chat unblocked verification), this plan's remaining gap is a full backend outage spanning the rest of the available session: the Connection Profile's "Available Models" list was empty both before and after two queue attempts, with no console errors and no completion after a combined ~5 minutes of waiting — a different symptom than this phase's earlier "just slow" observations (which always resolved within ~2 minutes). Re-attempting a third or fourth time was judged lower-value than accurately documenting the limitation: `appender.js`'s auto-jump logic is short, pure in its decision-making (one `if` on two already-computed booleans), and was read in full, not inferred from behavior.

## Issues Encountered

**Tooling dynamic (resolved, consistent with 03-03):** The executor assigned to this plan correctly reported being blocked by the same git-hook interaction 03-03 documented (RTK's Bash-command rewriting combined with worktree-isolation's safety check), without attempting any workaround, and handed back fully verified (`node --check` + 70/70 `npx vitest run`) but uncommitted work. The orchestrator reviewed the diff and committed both tasks directly, as it did for 03-03.

**External LLM backend outage (not resolved, not a code issue):** See Task 3 steps 5-7 above. This is the user's own separate inference infrastructure, unrelated to this plan or this extension.

## User Setup Required

None - no external service configuration required for this extension itself.

## Next Phase Readiness

This is the last plan in phase 03. All 3 tasks are code-complete, committed, unit-tested (70/70 passing), and live-verified against a real running ST 1.19.0 instance — including 2 real bugs found and fixed during that verification (the Enable toggle not actually gating the badge control, and its icon not updating live), consistent with every other plan this phase. SET-01 is complete. Two of 8 verification steps (5 and 7 — auto-jump and notification-off, plus step 6 which shares step 5's code path) could not be independently re-confirmed live due to an external LLM backend outage that persisted for the remainder of the session; both are backed by direct code review of short, already-correct-by-construction logic rather than guesswork. Recommend a quick live spot-check of steps 5-7 next time the backend is available, as a non-blocking follow-up — same recommendation pattern as 03-03's unresolved step 4.

Phase 03 (full-queue-control-ui) is now complete: 03-01 (cancel capability + dropdown), 03-02 (slash commands + wand menu), 03-03 (progress bar + toast coalescing), 03-04 (settings panel) all done, each with a live-verification pass that found and fixed real bugs — 3 CSS/layout defects in 03-01, a reverted regression attempt in 03-02, an off-by-one count bug in 03-03, and two Enable-toggle enforcement gaps in 03-04.

## Self-Check: PASSED

- FOUND: settings.html
- FOUND: src/settings.js
- FOUND: src/store.js (modified)
- FOUND: test/store.test.js (modified)
- FOUND: index.js (modified)
- FOUND: src/st-bridge.js (modified)
- FOUND: src/appender.js (modified)
- FOUND: src/commands.js (modified)
- FOUND: src/ui.js (modified)
- FOUND: .planning/phases/03-full-queue-control-ui/03-04-SUMMARY.md
- FOUND commit: 82f7d78 (Task 1)
- FOUND commit: 795eae3 (Task 2)
- FOUND commit: 83cdf0a (Task 3 fix)

---
*Phase: 03-full-queue-control-ui*
*Completed: 2026-10-27*
