---
phase: 02-single-queued-swipe-end-to-end
reviewed: 2026-10-25T00:00:00Z
depth: standard
files_reviewed: 16
files_reviewed_list:
  - .gitignore
  - index.js
  - manifest.json
  - package.json
  - src/adapter.js
  - src/appender.js
  - src/fingerprint.js
  - src/guard.js
  - src/runner.js
  - src/st-bridge.js
  - src/store.js
  - src/ui.js
  - style.css
  - test/fingerprint.test.js
  - test/guard.test.js
  - test/runner.test.js
  - test/store.test.js
findings:
  critical: 1
  warning: 3
  info: 4
  total: 8
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-10-25T00:00:00Z
**Depth:** standard
**Files Reviewed:** 16
**Status:** issues_found

## Summary

The queue store, fingerprint, guard, and runner modules are well-tested and internally consistent with the project's own design docs (`ARCHITECTURE.md`/`PATTERNS.md`): idle-gating, FIFO scheduling, single-flight serialization, and the two-checkpoint fingerprint re-validation all match the documented design and are covered by focused unit tests. GUARD-01/02/03/06 (chat-change/edit/delete invalidation) are confirmed out of scope for this phase per `02-04-PLAN.md`, so their absence is not flagged below.

Two classes of real defects were found, however: (1) `src/ui.js` never removes a previously-injected `.qs-queue-control` element once the DOM's `.last_mes` moves to a different message, and every subsequent badge/disabled-state render uses an **unscoped** `document.querySelector('.qs-queue-control')` — once a second control exists in the document (which happens on the very next chat turn after the feature is used once), the live badge/disabled-state will silently start updating the wrong, stale element instead of the one the user can actually see and click. (2) `src/runner.js` wraps `generate()` in try/catch but not `append()` (inside `flushAppend`), so any exception thrown by `appendSwipe()` (a real, reachable path via `structuredClone(m.extra)` on the first-ever swipe of a message) leaves the item stuck in `'running'` forever and produces an unhandled promise rejection — directly contradicting the locked decision "Per-item errors must not block queue."

A handful of smaller robustness/quality gaps are listed under Warnings/Info, plus one file-naming convention deviation.

## Critical Issues

### CR-01: Stale `.qs-queue-control` elements break live badge/disabled-state once the chat advances past the first use

**File:** `src/ui.js:23-46` (injection/removal) and `src/ui.js:52-57` (unscoped lookup used by every re-render)
**Issue:**
`injectControl()` only ever removes the queue control from the DOM when `!canQueue()` is true for the *current* `.last_mes` element (line 28: `lastMes?.querySelector('.${CONTROL_CLASS}')?.remove();`). It never removes a control that was injected into a message that has since **stopped** being `.last_mes` — which happens on literally every subsequent chat turn (a new user message, or a new AI reply that is not produced by this extension's own `appendSwipe()`, which never changes `chat.length` or fires `MESSAGE_SWIPED`). The registered re-render events (`CHARACTER_MESSAGE_RENDERED`, `MESSAGE_SWIPED`, `CHAT_CHANGED`, `APP_READY`) don't include `USER_MESSAGE_RENDERED`/`MESSAGE_SENT` either, so the stale control can outlive even a new user message with no re-render pass at all.

Once a second AI message arrives, `injectControl()` finds no control on the (new) `.last_mes` and injects a brand-new one — leaving **two** `.qs-queue-control` elements in the document: the orphaned one on the old message, and the live one on the new `.last_mes`. Every subsequent render path (`renderQueueState`, called from `injectControl`, from `store.onChange()`, and once at registration) looks the element up with a document-wide, unscoped selector:

```js
function renderQueueState(store) {
  const control = document.querySelector(`.${CONTROL_CLASS}`); // first match in DOM order
  ...
}
```

`document.querySelector` returns the first match in document order. In a chat log rendered oldest-message-first, that is the **stale, orphaned** control, not the one the user currently sees on `.last_mes`. From that point on, the badge count (UI-01) and the disabled/full-queue state (D-06) silently stop reflecting reality for the control the user can actually interact with, for the rest of the session on that chat.

Clicking still works correctly (the click handler re-derives its own cap check independently), but the visual feedback this phase is explicitly required to ship (UI-01 badge, D-06 disabled styling/tooltip) breaks reproducibly after the very first full exchange — not an edge case.

**Fix:**
Scope every control lookup to the current `.last_mes`, and clean up orphans when a new one is created, e.g.:

```js
function currentControl() {
  return document.querySelector('.last_mes')?.querySelector(`.${CONTROL_CLASS}`) ?? null;
}

function renderQueueState(store) {
  const control = currentControl();
  if (!control) return;
  renderBadge(control, store);
  renderDisabledState(control, store);
}
```

And in `injectControl()`, before (or after) creating the new element, remove any other `.qs-queue-control` found elsewhere in the document:

```js
document.querySelectorAll(`.${CONTROL_CLASS}`).forEach((el) => {
  if (el !== swipeRightEl?.nextElementSibling) el.remove();
});
```

## Warnings

### WR-01: `append()` failures are unhandled — items can get stuck in `'running'` forever and raise an unhandled rejection

**File:** `src/runner.js:48-59` (`flushAppend`), compare with `src/runner.js:73-81` (`generate()`'s try/catch)
**Issue:** `processNext()` wraps the call to `generate()` in a try/catch and drops the item on any thrown error:

```js
try {
  result = await generate(item);
} catch (err) {
  const reason = extractReason(err);
  store.drop(item.id, reason);
  notifyFailed(item.id, reason);
  return true;
}
```

`flushAppend()` has no equivalent protection around `append()`:

```js
async function flushAppend(mesId, text, meta) {
  while (true) {
    const outcome = await append(mesId, text, meta); // unguarded
    if (outcome === 'defer') { ... continue; }
    return outcome;
  }
}
```

`appendSwipe()` (`src/appender.js:28`) can throw — e.g. `structuredClone(m.extra)` throws `DataCloneError` if `extra` ever holds a non-cloneable value (a real, reachable path on the very first swipe of any message, and `extra` is a grab-bag other extensions also write to). If that happens here, the item was already marked `'running'` (`store.markRunning(item.id)` in `processNext()`) and is never subsequently marked `'done'` or `'failed'` — it stays `'running'` permanently, permanently consuming one queue slot, and the exception propagates unhandled out of `wake()`/`resume()` (both are fire-and-forget at every call site: `runner.wake()` in `src/ui.js:116`, `onStart`-driven `runner.resume()` in `src/guard.js`), producing an unhandled promise rejection. This directly contradicts the locked decision "Per-item errors must not block queue."
**Fix:** Mirror the `generate()` guard around `append()`:
```js
let appended;
try {
  appended = await flushAppend(mesId, result.text, result.meta);
} catch (err) {
  const reason = extractReason(err);
  store.drop(item.id, reason);
  notifyFailed(item.id, reason);
  return true;
}
```

### WR-02: Hard queue cap is not safe against a non-numeric `maxQueueSize`

**File:** `src/store.js:41-43`
**Issue:**
```js
function effectiveCap() {
  return Math.min(maxQueueSize, HARD_MAX_QUEUE);
}
```
The comment directly above this function states the intent explicitly: "a future settings bug (Phase 3 SET-01) cannot grow the effective cap past 20." If `maxQueueSize` is ever `NaN` (e.g. corrupted `settings.json`, or a future settings-panel bug that writes a non-numeric value before validation lands), `Math.min(NaN, 20)` is `NaN`, and every `>=` comparison against `NaN` in `add()` (`pendingCount() + runningCount() >= effectiveCap()`) is `false` — meaning `add()` never refuses, and the documented hard-cap safety net is completely defeated rather than merely degraded.
**Fix:** Sanitize at the boundary:
```js
function effectiveCap() {
  const configured = Number.isFinite(maxQueueSize) ? maxQueueSize : DEFAULT_MAX_QUEUE;
  return Math.min(configured, HARD_MAX_QUEUE);
}
```

### WR-03: `structuredClone(m.extra)` in the appender contradicts the project's own stated avoidance of `structuredClone` for ST-sourced data

**File:** `src/appender.js:28`, compare `src/adapter.js:8-15`
**Issue:** `src/adapter.js`'s `jsonClone()` has an explicit, emphatic comment explaining that `structuredClone()` is unsafe to use on ST-originated data because it can carry non-cloneable values (a function property, in that case) and that this is "load-bearing, not a style choice." `src/appender.js:28` uses `structuredClone(m.extra)` on another piece of ST-originated, extension-writable data (`message.extra`, which third-party extensions routinely attach arbitrary fields to) without the same caution. Per WR-01, an exception here is currently unguarded by the runner and will permanently wedge the affected queue item.
**Fix:** Use the same JSON round-trip helper (or a try/catch with a safe fallback) for `m.extra` as is already used for `generate_data`:
```js
extra: JSON.parse(JSON.stringify(m.extra ?? {})),
```

## Info

### IN-01: Duplicated default queue size constant (`5`) in two places

**File:** `index.js:12-14`, compare `src/store.js:6`
**Issue:** `index.js`'s `DEFAULT_SETTINGS.maxQueueSize = 5` is a second, independent source of truth for the same default value already exported as `DEFAULT_MAX_QUEUE` from `src/store.js`. Nothing keeps them in sync if one changes.
**Fix:** `import { DEFAULT_MAX_QUEUE } from './src/store.js';` and use it in `DEFAULT_SETTINGS`.

### IN-02: Several `src/st-bridge.js` re-exports (and its `capabilities()` function) are dead code

**File:** `src/st-bridge.js:9,14,17,19,69-92`
**Issue:** `stopGeneration`, `isStreamingEnabled`, `oai_settings`, `extensionNames`, `getExtensionManifest`, and `extension_settings` are imported and re-exported but never consumed by any module in `src/` or `index.js`. The `capabilities()` function itself (whose stated purpose is to `console.warn` on a missing ST API "at call time") is likewise never invoked anywhere, so its feature-detection never actually runs. This is the same pattern flagged in the Phase 1 review (`01-REVIEW.md`) against the spike's `index.js`, reintroduced here in the new bridge module.
**Fix:** Remove the unused re-exports (or call `capabilities()` once from `init()` if the feature-detection warning is actually wanted), and drop imports that have no current consumer.

### IN-03: Unused `err` binding in `index.js`'s `generate()`

**File:** `index.js:33-35`
**Issue:** `catch (err) { return { error: 'api' }; }` — `err` is bound but never read, discarding the underlying failure detail (even for console logging) with no explanation.
**Fix:** Either use `catch {}`  (no binding) or log the error for diagnostics: `catch (err) { console.warn('[queuedSwipes] generate failed', err); return { error: 'api' }; }`.

### IN-04: `adapter.js`'s `abortOwn()` is exported but never called from anywhere in `src/` or `index.js`

**File:** `src/adapter.js:136-140`
**Issue:** No cancel path exists yet in this phase (confirmed Phase 3 scope per `02-RESEARCH.md`), so `abortOwn()` is currently unreachable dead code. Likely intentional scaffolding for Phase 3's cancel feature, but worth a comment saying so explicitly (the module comment references the spike's `abortOwn()` lineage, not why this one is unused yet).
**Fix:** Either add a one-line comment noting it is reserved for Phase 3's cancel UI, or remove it until that phase actually wires a caller.

## Convention

### CV-01: `src/st-bridge.js` filename casing deviates from the dominant file-naming convention

**File:** `src/st-bridge.js:1`
**Deviation:** File name casing is kebab-case (`st-bridge`).
**Convention:** The reviewed file set's dominant (>=70%) naming convention is camelCase basenames (`adapter.js`, `appender.js`, `fingerprint.js`, `guard.js`, `runner.js`, `store.js`, `ui.js`).
**Fix:** Consider renaming to `stBridge.js` for consistency, or, if `st-bridge.js` is a deliberate one-off (e.g. to visually set apart "the one module that touches ST internals directly"), note that rationale in `CLAUDE.md`'s Conventions section so it reads as an intentional exception rather than drift. Advisory only — does not block merge.

---

_Reviewed: 2026-10-25T00:00:00Z_
_Reviewer: Claude (bm-code-reviewer)_
_Depth: standard_
