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

patterns-established:
  - "src/st-bridge.js is the only file permitted to import ST internals directly; every other module imports from it"
  - "appendSwipe() is idle-gated and never contains an await between the swipes.push()/swipe_info.push() pair"

requirements-completed: []  # Code implementing COMP-03/SET-02/SWIPE-01..05/QUEUE-01/QUEUE-08 is written and passed all automated checks, but the plan's own success criteria require the Task 4 live checkpoint to pass before these are truly validated end-to-end. Checkpoint is pending human verification (see below) — do not mark complete until that happens.

# Metrics
duration: ~65min (Tasks 1-3 + automation for Task 4; live click-through still pending)
completed: 2026-10-26
---

# Phase 2 Plan 01: Single Queued Swipe Walking Skeleton Summary

**Extension skeleton that injects a clock-icon control next to the swipe arrows and appends a placeholder swipe via `appendSwipe()`; server-side load and all five ST-internal import paths confirmed live against a local ST 1.19.0 instance, but the actual click-to-append-and-persist behavior still needs a human to drive the browser and report back.**

## Performance

- **Duration:** ~65 min (Tasks 1-3 complete; Task 4 automation completed, live click-through pending)
- **Completed:** 2026-10-26T02:46:13Z (code tasks); Task 4 checkpoint still open
- **Tasks:** 3 of 4 complete (Task 4 is a `checkpoint:human-verify` and cannot be closed without a human driving a browser)
- **Files modified:** 7 created (manifest.json, package.json, index.js, style.css, src/st-bridge.js, src/appender.js, src/ui.js)

## Accomplishments

- Scaffolded a loadable ST extension: `manifest.json` (hooks.activate=init, minimum_client_version 1.19.0), `package.json` (ESM marker), `index.js` (settings merge-by-key + control registration), `style.css` placeholder.
- Built `src/st-bridge.js`, the single module that imports ST internals directly, wrapping them with `ctx()`, `swipeState()`, `canQueue()` (QUEUE-08 gate: `ctx().swipe.isAllowed()` plus an explicit `groupId` check), and `capabilities()` (feature-detection with lazy `console.warn`).
- Built `src/appender.js`'s `appendSwipe(mesId, text, meta)`: idle-gated (`'defer'` when `isGenerating()` or `swipeState() !== 'none'`), target-validated (`'stale'` for non-last or user/system messages), backfills `swipes`/`swipe_info` on first-ever swipe, pushes both arrays synchronously with no `await` between them, never mutates `swipe_id`, refreshes via `updateSwipeCounter` + `swipe.refresh()`, saves via `ctx().saveChat()` (= `saveChatConditional`).
- Built `src/ui.js`'s `registerQueueControl()`: injects `.qs-queue-control` after `.swipe_right` on `.last_mes` only when `canQueue()` is true (absent, not disabled, otherwise); re-renders on `CHARACTER_MESSAGE_RENDERED`, `MESSAGE_SWIPED`, `CHAT_CHANGED`, and once on `APP_READY`; stub click handler calls `appendSwipe()` with the literal placeholder text.
- **Live automated verification performed** against the local SillyTavern install at `E:\SillyTavern`:
  - Extension copied into `E:\SillyTavern\data\default-user\extensions\queued-swipes\`.
  - Started the ST server (`node server.js`); confirmed `SillyTavern 1.19.0` in the startup log, matching `minimum_client_version`.
  - Server's extension discovery log lists `{ type: 'local', name: 'third-party/queued-swipes' }` — manifest parsed successfully, no extension-related error in the server log (the only logged error is an unrelated `ECONNREFUSED` to a local text-completion backend on port 8080, not configured, unrelated to this extension).
  - Fetched `src/st-bridge.js` through the ST webserver at `http://127.0.0.1:8000/scripts/extensions/third-party/queued-swipes/src/st-bridge.js` — served correctly (200, 3271 bytes).
  - Fetched all five computed relative-import targets directly from the webserver and confirmed each resolves at exactly the path `src/st-bridge.js`'s relative imports compute to: `/script.js`, `/scripts/openai.js`, `/scripts/reasoning.js`, `/scripts/extensions.js`, `/scripts/events.js` — all returned `200`. This is strong evidence the import depth (one level deeper than `spike/st-imports.js`, per the plan's `<interfaces>` block) is correct.

## Task Commits

1. **Task 1: Extension scaffold** - `62c11bb` (feat)
2. **Task 2: ST Bridge and Swipe Appender** - `6b7d1a3` (feat)
3. **Task 3: Stub control + click-to-append wiring** - `fa186a1` (feat)
4. **Task 4: Live walking-skeleton smoke test** - checkpoint, not yet closed (see below)

_No plan-metadata commit yet — see Self-Check / Known Stubs for why this SUMMARY is being committed ahead of full plan completion._

## Files Created/Modified

- `manifest.json` - Extension entry point, `hooks.activate: "init"`, `minimum_client_version: "1.19.0"`, `loading_order: 20`
- `package.json` - `"type": "module"` marker, no runtime deps
- `index.js` - `init()` merges `extensionSettings.queuedSwipes` key-by-key (`{ maxQueueSize: 5 }` default), registers the queue control
- `style.css` - `.qs-queue-control { cursor: pointer; }` placeholder, sizing/opacity deferred to the live measurement step
- `src/st-bridge.js` - Sole ST-internals import boundary; `ctx()`, `swipeState()`, `canQueue()`, `capabilities()`
- `src/appender.js` - `appendSwipe(mesId, text, meta)`, idle-gated chat mutation
- `src/ui.js` - `registerQueueControl()`, DOM injection + visibility gate + stub click handler

## Decisions Made

- `loading_order: 20` (plan's explicit instruction: "deliberately not the spike's throwaway `100`", any value `>=10` per STACK.md; picked 20 to read as an intentional choice rather than an accident).
- `src/st-bridge.js` uses `import { ... } from '...'` followed by a local `export { ... }` block (rather than `export { ... } from '...'` re-export syntax) specifically so `capabilities()` can reference the imported bindings locally for `typeof` probing — a bare re-export does not create a local binding in ES modules, and the plan's own `capabilities()` requirement needs one.

## Deviations from Plan

None — plan executed exactly as written for Tasks 1-3. Task 4's automation (server start, extension discovery check, import-path resolution check via direct HTTP fetches) is additive automation performed to maximize what could be verified before handing off the remaining steps to a human; it does not change any Task 1-3 code or behavior.

## Issues Encountered

- This session's tool set does not include `claude-in-chrome` or any other browser-automation MCP tool, despite the plan noting that option. Per the plan's own instruction ("otherwise perform them manually and report back"), the browser-dependent steps (click the control, verify pager growth, verify persistence across refresh, verify absence in a group chat, measure computed CSS values) could not be executed by this agent and are deferred to a human, below.

## Checkpoint Pending: Task 4 Live Walking-Skeleton Smoke Test

**Automated so far (done by this agent, no action needed):**
1. Extension installed at `E:\SillyTavern\data\default-user\extensions\queued-swipes\` (manifest.json, package.json, index.js, style.css, src/).
2. ST server started (`node server.js` from `E:\SillyTavern`, backgrounded) and confirmed listening at `http://127.0.0.1:8000` (SillyTavern 1.19.0). **The server is still running** — no need to start it again.
3. Server-side extension discovery confirmed (`third-party/queued-swipes` listed, no load error).
4. All five ST-internal import targets used by `src/st-bridge.js` confirmed reachable at the exact computed relative paths via direct HTTP fetch.

**Still needs a human (or a future session with browser tools) to do, against the already-running server at `http://127.0.0.1:8000`:**
1. Open `http://127.0.0.1:8000` in a browser. Open devtools console. Confirm no error referencing `queuedSwipes` or a missing import.
2. Open (or create) a single-character chat with at least one AI reply as the latest message. Confirm a clock icon appears immediately to the right of the right swipe arrow, after the `k/total` counter. Hover it and confirm the tooltip reads "Queue a swipe".
3. Click it once. Confirm: the pager counter grows by one (e.g. `1/1` becomes `1/2`), the displayed swipe does NOT change, and no streaming/typing animation appears.
4. Use the swipe-right arrow to navigate to the new swipe; confirm its text is the literal placeholder string `[queued-swipes stub placeholder — replaced by real generation in 02-03-PLAN.md]`.
5. Refresh the page (or switch away and back to the chat). Confirm the new swipe is still there (proves `saveChatConditional` persisted it).
6. Open a group chat (or a chat whose last message is the user's). Confirm the clock icon control is completely absent (not present-but-disabled).
7. Via devtools, note the computed `width`/`height`/font-size of the existing `.swipe_right` icon and the computed `opacity` of any existing disabled `.mes_button`-style icon in this ST theme. These numbers finalize `style.css` in 02-05-PLAN.md and resolve whether `fa-clock` visually collides with another icon in the row (if so, `src/ui.js` should switch to `fa-layer-group`).

**Resume signal:** report pass/fail per numbered step above, plus the measured icon size/opacity values from step 7 (or confirm which steps failed and how).

## Known Stubs

- `src/ui.js`'s click handler appends a hardcoded placeholder string (`'[queued-swipes stub placeholder — replaced by real generation in 02-03-PLAN.md]'`) instead of real generated text. This is explicitly intentional and scoped by the plan itself — 02-03-PLAN.md replaces this with the real adapter-driven generation pipeline. Not a gap to fix in this plan.
- `src/ui.js`'s click handler calls `appendSwipe()` directly rather than enqueuing through a store — also explicitly intentional per the plan ("temporary: 02-02 replaces this with store.add()+runner.wake()"); the Store does not exist until 02-02-PLAN.md.
- `style.css` leaves icon sizing/opacity as a `TODO(Task 4)` pending the live measurement in step 7 above — intentional, per 02-UI-SPEC.md's explicit deferral to a live check rather than a guessed value.

## User Setup Required

None — no external service configuration required. The one remaining requirement is a human driving a browser against the already-running local ST server at `http://127.0.0.1:8000`, per "Checkpoint Pending" above.

## Next Phase Readiness

- Tasks 1-3's code is in place and passed every automated check the plan specifies (`node --check` on all four new/modified `.js` files, JSON validity on `manifest.json`/`package.json`, acceptance-criteria string/pattern checks).
- 02-02-PLAN.md (Store + fingerprint + real enqueue) can build on `src/st-bridge.js` and `src/appender.js` as-is once the Task 4 checkpoint closes.
- **Blocker for closing this plan:** Task 4's live click-through, persistence, and group-chat-absence checks, plus the CSS measurements 02-05-PLAN.md needs, are unverified. Do not mark Phase 2 Plan 01 complete in STATE.md/ROADMAP.md until a human (or a future session with browser automation) completes the "Checkpoint Pending" steps above and reports back.

---
*Phase: 02-single-queued-swipe-end-to-end*
*Completed: 2026-10-26 (Tasks 1-3; Task 4 checkpoint pending)*
