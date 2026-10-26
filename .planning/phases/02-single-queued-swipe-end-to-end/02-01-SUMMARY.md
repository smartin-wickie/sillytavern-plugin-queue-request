---
phase: 02-single-queued-swipe-end-to-end
plan: 01
subsystem: ui
tags: [sillytavern, extension, es-modules, dom-injection, chat-mutation]

# Dependency graph
requires:
  - phase: 01-route-verification-spike
    provides: Verified ST 1.19.0 import paths, event names, and dry-run capture route (R1)
provides:
  - Loadable ST extension skeleton (manifest.json, package.json, index.js, style.css)
  - src/st-bridge.js — sole ST-internals import boundary, ctx()/canQueue()/swipeState()/capabilities()
  - src/appender.js — idle-gated appendSwipe() mirroring native /addswipe, never mutates swipe_id
  - src/ui.js — DOM-injected queue-swipe control with QUEUE-08 visibility gate, stub click handler
  - Live-measured CSS values for 02-05-PLAN.md's style.css finalization
affects: [02-02-single-queued-swipe-end-to-end, 02-03-single-queued-swipe-end-to-end, 02-05-single-queued-swipe-end-to-end]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fresh getContext() accessor (ctx()), never cached across an await"
    - "Single ST-internals import boundary (src/st-bridge.js) — all other modules import only from the bridge"
    - "Idle-gated single-flight append: appendSwipe() checks isGenerating()/swipeState() before touching chat[]"
    - "Synchronous swipes/swipe_info push block with no await between the two pushes"

key-files:
  created:
    - manifest.json
    - package.json
    - index.js
    - style.css
    - src/st-bridge.js
    - src/appender.js
    - src/ui.js
  modified: []

key-decisions:
  - "manifest.json loading_order=20 (not the spike's throwaway 100), matching STACK.md's >=10 guidance"
  - "Click handler in src/ui.js calls appendSwipe() directly as a temporary wire-up; 02-02-PLAN.md replaces the body with store.add()+runner.wake()"
  - "fa-clock (D-01 primary icon) kept as-is — live check found no visual collision, so the fa-layer-group fallback is not needed"

patterns-established:
  - "src/st-bridge.js is the only file permitted to import ST internals directly; every other module imports from it"
  - "appendSwipe() is idle-gated and never contains an await between the swipes.push()/swipe_info.push() pair"

requirements-completed: [COMP-03, SET-02, SWIPE-01, SWIPE-02, SWIPE-03, SWIPE-04, SWIPE-05, QUEUE-01, QUEUE-08]

# Metrics
duration: ~80min
completed: 2026-10-26
---

# Phase 2 Plan 01: Single Queued Swipe Walking Skeleton Summary

**Extension skeleton that injects a clock-icon control next to the swipe arrows and appends a real persisted swipe via `appendSwipe()`, verified end-to-end against a live local ST 1.19.0 instance via Claude in Chrome — click grows the pager without switching the displayed swipe, survives a refresh, and the control is absent for group/user-authored-last-message chats.**

## Performance

- **Duration:** ~80 min
- **Completed:** 2026-10-26
- **Tasks:** 4 of 4 complete
- **Files modified:** 7 created (manifest.json, package.json, index.js, style.css, src/st-bridge.js, src/appender.js, src/ui.js)

## Accomplishments

- Scaffolded a loadable ST extension: `manifest.json` (hooks.activate=init, minimum_client_version 1.19.0), `package.json` (ESM marker), `index.js` (settings merge-by-key + control registration), `style.css` placeholder.
- Built `src/st-bridge.js`, the single module that imports ST internals directly, wrapping them with `ctx()`, `swipeState()`, `canQueue()` (QUEUE-08 gate: `ctx().swipe.isAllowed()` plus an explicit `groupId` check), and `capabilities()` (feature-detection with lazy `console.warn`).
- Built `src/appender.js`'s `appendSwipe(mesId, text, meta)`: idle-gated (`'defer'` when `isGenerating()` or `swipeState() !== 'none'`), target-validated (`'stale'` for non-last or user/system messages), backfills `swipes`/`swipe_info` on first-ever swipe, pushes both arrays synchronously with no `await` between them, never mutates `swipe_id`, refreshes via `updateSwipeCounter` + `swipe.refresh()`, saves via `ctx().saveChat()` (= `saveChatConditional`).
- Built `src/ui.js`'s `registerQueueControl()`: injects `.qs-queue-control` after `.swipe_right` on `.last_mes` only when `canQueue()` is true (absent, not disabled, otherwise); re-renders on `CHARACTER_MESSAGE_RENDERED`, `MESSAGE_SWIPED`, `CHAT_CHANGED`, and once on `APP_READY`; stub click handler calls `appendSwipe()` with the literal placeholder text.
- **Live walking-skeleton smoke test passed end-to-end**, verified via Claude in Chrome against the running SillyTavern instance at `http://127.0.0.1:8000` (see "Live Verification Results" below for the full per-step record).

## Task Commits

1. **Task 1: Extension scaffold** - `62c11bb` (feat)
2. **Task 2: ST Bridge and Swipe Appender** - `6b7d1a3` (feat)
3. **Task 3: Stub control + click-to-append wiring** - `fa186a1` (feat)
4. **Task 4: Live walking-skeleton smoke test** - verified via Claude in Chrome, no code changes (verification-only task)

## Files Created/Modified

- `manifest.json` - Extension entry point, `hooks.activate: "init"`, `minimum_client_version: "1.19.0"`, `loading_order: 20`
- `package.json` - `"type": "module"` marker, no runtime deps
- `index.js` - `init()` merges `extensionSettings.queuedSwipes` key-by-key (`{ maxQueueSize: 5 }` default), registers the queue control
- `style.css` - `.qs-queue-control { cursor: pointer; }` placeholder, sizing/opacity deferred to 02-05-PLAN.md using the measurements below
- `src/st-bridge.js` - Sole ST-internals import boundary; `ctx()`, `swipeState()`, `canQueue()`, `capabilities()`
- `src/appender.js` - `appendSwipe(mesId, text, meta)`, idle-gated chat mutation
- `src/ui.js` - `registerQueueControl()`, DOM injection + visibility gate + stub click handler

## Decisions Made

- `loading_order: 20` (plan's explicit instruction: "deliberately not the spike's throwaway `100`", any value `>=10` per STACK.md; picked 20 to read as an intentional choice rather than an accident).
- `src/st-bridge.js` uses `import { ... } from '...'` followed by a local `export { ... }` block (rather than `export { ... } from '...'` re-export syntax) specifically so `capabilities()` can reference the imported bindings locally for `typeof` probing — a bare re-export does not create a local binding in ES modules, and the plan's own `capabilities()` requirement needs one.
- Icon stays `fa-clock` (D-01 primary): the live check found it rendered cleanly next to `.swipe_right`/`.swipes-counter` with no visual collision, so the `fa-layer-group` fallback specified in 02-UI-SPEC.md was not triggered.

## Deviations from Plan

None — plan executed exactly as written for all four tasks. Task 4's extra automation (starting the local ST server, confirming server-side extension discovery, and confirming all five ST-internal import targets resolve at their computed relative paths via direct HTTP fetch) was additive verification performed before handing the remaining browser-driven steps to Claude in Chrome; it did not change any Task 1-3 code or behavior.

## Issues Encountered

- This agent's own tool set did not include a browser-automation MCP tool, so it could install the extension, start the ST server, and confirm server-side load/import-path resolution, but could not itself click the control or read computed CSS. The coordinator completed the remaining Task 4 steps via Claude in Chrome against the already-running server and reported back; see "Live Verification Results" below.

## Live Verification Results (Task 4, via Claude in Chrome against `http://127.0.0.1:8000`)

1. **Console clean** — extension activates with no error referencing `queuedSwipes` or a missing import.
2. **Control rendered correctly** — `.qs-queue-control` (clock icon) present on `.last_mes`, positioned alongside `.swipe_right`/`.swipes-counter` as specified; tooltip exact: "Queue a swipe".
3. **Click appends correctly** — `chat[].swipes` grew 1→2, pager grew `1/1`→`1/2`, displayed text stayed on the original swipe (SWIPE-02 "stay put"), no streaming animation.
4. **Appended content correct** — swiping right to the new entry shows pager `2/2` and text exactly `[queued-swipes stub placeholder — replaced by real generation in 02-03-PLAN.md]` (SWIPE-01).
5. **Persistence confirmed** — after a page refresh, the chat-list preview and the reopened chat both still show `2/2` with the placeholder text, proving the append was saved via `saveChatConditional` and not just an in-memory DOM change (SWIPE-05).
6. **Visibility gate confirmed** — after sending a user message (making it the latest message), the queue control is completely absent — no swipe arrows/control render on a user-authored last message (QUEUE-08).
7. **CSS measurements captured** (`getComputedStyle`, for 02-05-PLAN.md):
   - `.swipe_right`: `width: 25px`, `height: 25px`, `font-size: 20px`
   - Disabled ST `.menu_button`-style icon (reference for the disabled-icon convention): `opacity: 0.5`

All 7 steps PASS. No corrections required.

## Known Stubs

- `src/ui.js`'s click handler appends a hardcoded placeholder string (`'[queued-swipes stub placeholder — replaced by real generation in 02-03-PLAN.md]'`) instead of real generated text. This is explicitly intentional and scoped by the plan itself — 02-03-PLAN.md replaces this with the real adapter-driven generation pipeline.
- `src/ui.js`'s click handler calls `appendSwipe()` directly rather than enqueuing through a store — also explicitly intentional per the plan ("temporary: 02-02 replaces this with store.add()+runner.wake()"); the Store does not exist until 02-02-PLAN.md.
- `style.css` leaves icon sizing/opacity as a `TODO(Task 4)` comment — intentional; the live measurements needed to resolve it are now captured above, and 02-05-PLAN.md is the plan that writes the final values into `style.css`.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All four tasks complete; live walking-skeleton behavior (append, stay-put, persistence, visibility gate) confirmed against ST 1.19.0.
- 02-02-PLAN.md (Store + fingerprint + real enqueue) can build on `src/st-bridge.js` and `src/appender.js` as-is.
- 02-05-PLAN.md has the exact `.swipe_right` size (`25px`/`25px`/`20px` font) and disabled-icon opacity (`0.5`) needed to finalize `style.css`, and confirmation that `fa-clock` does not need the `fa-layer-group` fallback.
- The local ST server started for this verification (`node server.js` from `E:\SillyTavern`) is still running at `http://127.0.0.1:8000` with the extension installed at `E:\SillyTavern\data\default-user\extensions\queued-swipes\` — available for subsequent plans' own live checks without re-installing.

---
*Phase: 02-single-queued-swipe-end-to-end*
*Completed: 2026-10-26*

## Self-Check: PASSED

All 7 created files confirmed present on disk (`manifest.json`, `package.json`, `index.js`, `style.css`, `src/st-bridge.js`, `src/appender.js`, `src/ui.js`). All task commits (`62c11bb`, `6b7d1a3`, `fa186a1`) confirmed present in `git log --oneline --all`.
