---
phase: 02-single-queued-swipe-end-to-end
plan: 02
subsystem: queue-core
tags: [vitest, unit-tests, state-machine, pure-modules, fake-bridge]

# Dependency graph
requires:
  - phase: 02-single-queued-swipe-end-to-end
    plan: 01
    provides: src/st-bridge.js, src/appender.js, src/ui.js (stub click handler), loadable extension skeleton
provides:
  - src/fingerprint.js — buildFingerprint()/fingerprintMatches() pure target-identity utilities (GUARD-04)
  - src/store.js — in-memory queue Store with DEFAULT_MAX_QUEUE/HARD_MAX_QUEUE cap enforcement (QUEUE-02)
  - src/runner.js — idle-gated single-flight scheduler (createRunner) with injected generate()/append() (GEN-01)
  - vitest@^5.0.5 devDependency + "test": "vitest run" script
  - test/fingerprint.test.js, test/store.test.js, test/runner.test.js (34 passing assertions)
affects: [02-03-single-queued-swipe-end-to-end, 02-04-single-queued-swipe-end-to-end, 02-05-single-queued-swipe-end-to-end]

# Tech tracking
tech-stack:
  added: ["vitest@^5.0.5 (devDependency only, never shipped in the extension's manifest.json/js entry)"]
  patterns:
    - "Pure/injectable modules (store, fingerprint, runner) take bridge/generate/append as parameters so they are Vitest-unit-testable without a live ST instance (D-10)"
    - "setTimeout-driven polling (never recursion) for both the idle-wait retry and the park-then-flush append retry, so the call stack cannot grow unbounded on a long-paused queue"
    - "fingerprintMatches() always calls bridge.ctx() fresh internally rather than accepting a pre-fetched context object"

key-files:
  created:
    - src/fingerprint.js
    - src/store.js
    - src/runner.js
    - test/fingerprint.test.js
    - test/store.test.js
    - test/runner.test.js
    - .gitignore
  modified:
    - package.json
    - package-lock.json
    - src/ui.js
    - index.js

key-decisions:
  - "drop(id, reason) sets item.status='failed' uniformly (not a separate 'cancelled' status) and records the specific reason string on item.reason — 'cancelled' remains an available status value in the item shape for Phase 3's explicit cancel feature, not used by this plan's drop paths (stale/api-error/empty-reply)"
  - "store.js accepts a bridge parameter but does not read from it in this plan — reserved for Phase 4's chat_metadata persistence wrapper per the plan's explicit 'design the function signatures so Phase 4 can add persistence without changing this public shape' instruction"
  - "generate(item) receives the full queue item (not just the fingerprint) so a future real adapter has access to attempts/createdAt if needed; the stub ignores its argument"
  - "Added .gitignore (node_modules/, .vitest/) — did not exist in the repo before this plan and was required to avoid committing the new vitest devDependency's installed tree and the RTK test-output artifact directory"

patterns-established:
  - "runner.js's wake()/loop() shape: a single running flag gates re-entrancy for the whole processing session (including append-retry waits), and every wait (idle-retry, append-defer-retry) uses setTimeout, never recursion"
  - "Fail-soft per item: generate() rejection or a resolved typed-error object ({ error: 'empty' }) both route through the same store.drop(id, reason) + onItemFailed({id, reason}) path, never throwing out of wake()"

requirements-completed: [QUEUE-02, GUARD-04, GEN-01]

# Metrics
duration: ~45min (session time; Task 1's checkpoint wait is excluded)
completed: 2026-10-25
---

# Phase 2 Plan 02: Store, Fingerprint, and Runner (Single Queued Swipe End-to-End) Summary

**Real serial multi-item queue — a Store enforcing the 5/20 max-cap, a djb2-hash Fingerprint utility for target-identity re-validation, and an idle-gated single-flight Runner driven by setTimeout polling — all pure/injectable and Vitest-unit-tested against a fake bridge, replacing 02-01's single-click-single-append stub.**

## Performance

- **Duration:** ~45 min of active work this session (Task 1's checkpoint-wait is excluded from this figure; see Checkpoint section below)
- **Completed:** 2026-10-25
- **Tasks:** 2 of 2 complete (Task 1 was a verification-only checkpoint gate, no files modified)
- **Files modified:** 7 created (src/fingerprint.js, src/store.js, src/runner.js, test/fingerprint.test.js, test/store.test.js, test/runner.test.js, .gitignore), 4 modified (package.json, package-lock.json, src/ui.js, index.js)

## Accomplishments

- Independently re-verified the `vitest` package-legitimacy evidence live (`npm view vitest version/repository.url/time.created/scripts`), corroborating the plan's research before the human-approval checkpoint; installed `vitest@^5.0.5` as a devDependency only after explicit approval.
- Built `src/fingerprint.js`: `hash()` (exact djb2-variant reused from `spike/index.js`), `buildFingerprint(ctx, mesId)`, and `fingerprintMatches(bridge, fp)` — pure functions, no DOM/bridge access beyond the passed-in `ctx`/`bridge`, always re-fetching `bridge.ctx()` fresh rather than trusting a stale snapshot.
- Built `src/store.js`: `createStore({ bridge, maxQueueSize })` with `add()`/`peekNext()`/`markRunning()`/`markDone()`/`drop()`/`pendingCount()`/`runningCount()`/`getItems()`/`onChange()`/`offChange()`. The hard ceiling (`HARD_MAX_QUEUE=20`) is clamped independently of whatever `maxQueueSize` the caller configures, so a future settings bug can't exceed it.
- Built `src/runner.js`: `createRunner({ bridge, store, generate, append })`, an idle-gated single-flight state machine. A `running` flag prevents re-entrant `wake()` calls; both the idle-wait and the park-then-flush append-retry use `setTimeout` polling, never recursion. Stale items (fingerprint mismatch) are dropped without calling `generate()`; a successful `generate()` result is appended and, on `'ok'`, the item is marked done; on `'defer'` the append is retried every ~250ms; on `'stale'` the generated text is discarded and the item is dropped; `generate()` rejection or a typed error-object result both drop the item and continue without throwing out of `wake()`. An `onItemFailed`/`offItemFailed` subscriber hook is wired for 02-04-PLAN.md's toast integration.
- Rewired `src/ui.js`'s click handler to call `store.add(buildFingerprint(...))` + `runner.wake()` instead of calling `appendSwipe()` directly; `appendSwipe()` is now only invoked from inside `runner.js`.
- Updated `index.js` to construct one `bridge`/`store`/`runner` instance per loaded chat inside `init()` (not one per click), wired with a 50ms-delay stub `generate()` standing in for the real Generation Adapter, and pass them into `registerQueueControl({ store, runner })`.
- Wrote `test/fingerprint.test.js` (12 assertions), `test/store.test.js` (11 assertions), and `test/runner.test.js` (11 assertions) against a fake-bridge shape — **34 total assertions, all passing** (`npx vitest run` — observed output: `total=34 passed=34 failed=0 success=true`).
- Ran an informal, non-committed smoke script driving the real `createStore`/`createRunner`/`buildFingerprint` modules end-to-end with a fake bridge and the stub generator: simulated 6 rapid "clicks" — the first 5 returned `add() -> ok:true` and the 6th returned `ok:false` (queue full at the default cap of 5); all 5 queued items ran strictly one at a time and reached `status: 'done'`; the fake chat's `swipes` array grew from 1 to 6 (one original + 5 appended), confirming the 5-item cap and serial execution behave correctly end-to-end through the production code paths, not just through mocked unit assertions.

## Task Commits

1. **Task 1: Package legitimacy gate for vitest** — checkpoint, approved by the coordinator with explicit confirmation ("vitest is the real vitest-dev/vitest package; the `[SUS]` flag is a false positive from name similarity to 'vite'"); no files modified.
2. **Task 2: Vitest setup + Fingerprint + Store** — `185a677` (feat)
3. **Task 3: Runner (stub generator) + wire into ui.js/index.js** — `1689ecb` (feat)

## Files Created/Modified

- `src/fingerprint.js` - `hash()`, `buildFingerprint(ctx, mesId)`, `fingerprintMatches(bridge, fp)` — pure, Vitest-tested
- `src/store.js` - `createStore({ bridge, maxQueueSize })`, `DEFAULT_MAX_QUEUE=5`, `HARD_MAX_QUEUE=20`
- `src/runner.js` - `createRunner({ bridge, store, generate, append })`, idle-gated single-flight scheduler
- `test/fingerprint.test.js` - 12 assertions covering hash determinism, buildFingerprint field mapping, and every fingerprintMatches mismatch case
- `test/store.test.js` - 11 assertions covering cap enforcement (default and hard ceiling), FIFO peekNext, status transitions, getItems() copy-safety, onChange/offChange
- `test/runner.test.js` - 11 assertions covering idle-gating, single-flight re-entrancy, fingerprint-drop, success/append-ok, park-then-flush, append-stale-discard, generate-reject, typed-error-object, and the onItemFailed/offItemFailed hook
- `package.json` - added `vitest@^5.0.5` devDependency and `"test": "vitest run"` script
- `package-lock.json` - created (npm install lockfile)
- `.gitignore` - created (`node_modules/`, `.vitest/`)
- `src/ui.js` - click handler now calls `store.add()` + `runner.wake()`; `appendSwipe` import removed (no longer called from this file)
- `index.js` - constructs `bridge`/`store`/`runner` once in `init()`, defines the stub `generate()`, passes `{ store, runner }` into `registerQueueControl()`

## Decisions Made

- `drop(id, reason)` sets `item.status = 'failed'` uniformly for every current drop path (stale, API error, empty reply) and records the specific category on `item.reason`; the item shape's `'cancelled'` status value is reserved for Phase 3's explicit cancel feature and not produced by anything in this plan.
- `store.js` accepts the `bridge` parameter in its constructor but does not read from it anywhere in this plan's implementation — this matches the plan's explicit instruction to keep the Store in-memory-only while shaping the signature so Phase 4 can wrap `add`/`markDone`/`drop` with `chat_metadata` persistence later without a breaking change.
- `runner.js`'s `generate` is called with the full queue `item` (not just `item.fingerprint`) — gives a future real adapter access to `attempts`/`createdAt` if it ever needs them; the stub generator in `index.js` ignores its argument entirely.
- Added `.gitignore` (did not exist in the repo before this plan) listing `node_modules/` and `.vitest/` — required once `vitest` was installed, since the repo had no dependency-management ignore rules yet; `.vitest/` is a JSON test-report artifact directory produced by this environment's `rtk` command wrapper on every `vitest run`, not a vitest built-in cache folder.

## Deviations from Plan

None — plan executed exactly as written for both code tasks. Task 1's checkpoint followed the Package Legitimacy Gate protocol exactly: independently re-verified the npm registry evidence live before the coordinator's explicit approval, and no `npm install` ran until that approval was received.

## Issues Encountered

- Mid-execution, the orchestrator merged this plan's git worktree back into the main repository and removed the worktree before Task 1's checkpoint was approved; execution resumed directly against the main repo's `master` branch (the project's `git.branching_strategy` is `"none"`, and all prior Phase 1/Phase 2 plan commits are already on `master`, so this is consistent with the existing convention, not a deviation from it). The `vitest` devDependency and its `node_modules`/`package-lock.json` had already been installed into the working tree by the time control returned, matching the exact version (`^5.0.5`) and evidence the plan called for; this was verified (not assumed) via `npm view vitest version` and inspecting `node_modules/vitest/package.json` before proceeding.
- The `rtk` (Rust Token Killer) shell wrapper configured in this environment intercepts `npx vitest run` and prints a terse `[RTK:PASSTHROUGH] ... parser: All parsing tiers failed` line instead of vitest's normal console reporter output, writing a full JSON report to `.vitest/json/output.json` instead. Test results were verified by reading that JSON report directly (`numTotalTests`/`numPassedTests`/`numFailedTests`/`success` fields and the per-assertion `status` fields), not by eyeballing console text — this is a tooling-output quirk of the sandboxed shell, not a vitest or test-code problem.

## Live Verification Results

- **Automated (observed, not assumed):** `npx vitest run` — final full-suite run reported `total=34 passed=34 failed=0 success=true` (read directly from `.vitest/json/output.json` after each run, including the final full-suite run after both task commits).
- **Informal/manual (per plan's verification line, not a formal live-ST checkpoint):** An uncommitted smoke script (written to the repo, run, then deleted — never part of the git history) drove the actual `createStore`/`createRunner`/`buildFingerprint` production modules with a fake bridge and the stub generator, simulating 6 rapid clicks. Observed output: `add() results for 6 rapid clicks: [ true, true, true, true, true, false ]`, `swipes length after run: 6`, `item statuses: [ 'done', 'done', 'done', 'done', 'done' ]` — confirming the 5-item default cap, serial one-at-a-time execution, and successful completion of all 5 queued items through the real (non-mocked) module wiring.
- **Not done this plan (explicitly deferred):** No live-ST-instance click-through via `claude-in-chrome` — the plan's `<verification>` line describes that live click sequence as informal/optional for this plan, with the formal live checkpoint deferred to 02-03-PLAN.md once the stub generator is replaced by the real Generation Adapter.

## Known Stubs

- `index.js`'s `stubGenerate()` still returns the canned placeholder text after a 50ms delay instead of calling the real Generation Adapter — explicitly intentional and scoped by this plan itself; 02-03-PLAN.md replaces this with the dry-run-capture + own-transport pipeline without touching `runner.js`'s control flow.
- `onControlClick()` in `src/ui.js` silently ignores a full queue (`store.add()` returning `{ ok: false }`) rather than updating any disabled-state UI — explicitly intentional per the plan ("the disabled-state UI/tooltip for a full queue is 02-05-PLAN.md's job, not this plan's").
- `runner.js`'s `onItemFailed` hook is wired and unit-tested but nothing in the live wiring (`index.js`/`src/ui.js`) subscribes to it yet — explicitly intentional per the plan ("wire the hook now even though nothing calls it with a real failure reason until the Adapter exists"); 02-04-PLAN.md adds the toast subscriber.

## User Setup Required

None — no external service configuration required. `vitest` is a dev-only devDependency, never shipped in the extension's `manifest.json`/`js` entry.

## Next Phase Readiness

- Both code tasks complete; `npx vitest run` passes 34/34 across all three new test files.
- QUEUE-02's multi-item-while-running behavior and the hard max-cap are real and unit-tested; GUARD-04's fingerprint mechanism exists and is unit-tested; GEN-01's single-flight guarantee is real (the other half of GEN-01, "no overlap with native generation", is not enforced until 02-04-PLAN.md's Guard, per the plan's own success criteria).
- 02-03-PLAN.md can swap `index.js`'s `stubGenerate` for the real Generation Adapter without touching `runner.js`'s control flow, per this plan's explicit design intent.
- 02-04-PLAN.md can subscribe to `runner.onItemFailed()` to drive the GUARD-05 toast wiring.
- 02-05-PLAN.md can use `store.add()`'s `{ ok: false, reason: 'max' }` result to drive the disabled-state UI/tooltip.

---
*Phase: 02-single-queued-swipe-end-to-end*
*Completed: 2026-10-25*

## Self-Check: PASSED

All 7 created files confirmed present on disk (`src/fingerprint.js`, `src/store.js`, `src/runner.js`, `test/fingerprint.test.js`, `test/store.test.js`, `test/runner.test.js`, `.gitignore`). Both task commits (`185a677`, `1689ecb`) confirmed present in `git log --oneline --all`. Full test suite re-run confirmed `34/34` passing immediately before writing this summary.
