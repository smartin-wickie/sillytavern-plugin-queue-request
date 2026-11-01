# Phase 4: Lifecycle, Persistence & Spend Safety - Pattern Map

**Mapped:** 2026-10-27
**Files analyzed:** 20 (7 new src, 4 new tests, 9 modified)
**Analogs found:** 18 / 20 (ownership.js and popups.js are partial)

Repo is plain ESM JS, `src/*.js` camelCase files, Vitest in `test/`. All ST access only through `src/st-bridge.js`. Every module takes injected deps (`{ bridge, store, runner, ... }`) so it is unit-testable with a fake bridge.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/persistence.js` (NEW) | utility (pure serialize/load/validate) | transform | `src/fingerprint.js` | role-match |
| `src/connection.js` (NEW) | utility (pure diff) | transform | `src/fingerprint.js` / `src/toastAccumulator.js` | role-match |
| `src/lifecycle.js` (NEW) | service (event policy) | event-driven | `src/guard.js` | exact |
| `src/ownership.js` (NEW) | service (lease + heartbeat) | pub-sub (storage events) | `src/guard.js` (subscribe/stop shape) + `runner.js` (setTimeout polling) | partial |
| `src/popups.js` (NEW) | component (DOM popup) | request-response | `src/ui.js` (toastr / DOM) | partial |
| `src/store.js` (MOD) | model/store | CRUD + persistence | itself (header comment plans this) | exact |
| `src/runner.js` (MOD) | service (scheduler) | event-driven | itself | exact |
| `src/guard.js` (MOD) | service | event-driven | itself | exact |
| `src/st-bridge.js` (MOD) | utility (ST seam) | request-response | itself (`canQueue`, `ctx`) | exact |
| `src/queueActions.js` (MOD) | utility | CRUD | itself (`cancelAll`) | exact |
| `src/ui.js`, `src/progressBar.js`, `src/commands.js`, `src/wandMenu.js` (MOD) | component | event-driven | themselves | exact |
| `index.js` (MOD) | config/wiring | wiring | itself | exact |
| `test/persistence.test.js`, `connection.test.js` (NEW) | test | transform | `test/fingerprint.test.js` | exact |
| `test/lifecycle.test.js` (NEW) | test | event-driven | `test/guard.test.js` | exact |
| `test/ownership.test.js` (NEW) | test | pub-sub | `test/guard.test.js` (fake timers + fake emitter) | role-match |
| extend `test/runner.test.js`, `store.test.js`, `guard.test.js` | test | - | themselves | exact |

## Pattern Assignments

### `src/lifecycle.js` (service, event-driven) - analog `src/guard.js`

**Handler shape to copy** (guard.js 6-60): handlers never run inline; each hops via `setTimeout(0)` so they are never re-entered from `eventSource.emit` (emit awaits listeners; never await a popup/save inside it). Start/stop keep a `handlers` array.
```js
function schedule(fn) { setTimeout(fn, 0); }
function onGenerationStarted(_type, _params, dryRun) {
  if (dryRun === false) { schedule(() => runner.pause('native')); }
}
function start() {
  for (const key of WATCHED_EVENTS) {
    const evt = bridge.event_types[key];
    if (!evt) continue;
    const h = HANDLER_MAP[key];
    bridge.eventSource.on(evt, h);
    handlers.push([evt, h]);
  }
}
function stop() {
  for (const [evt, h] of handlers.splice(0, handlers.length)) bridge.eventSource.removeListener(evt, h);
}
```
Phase 4 changes: either extend `guard.js` WATCHED_EVENTS/HANDLER_MAP with `CHAT_CHANGED`, `MESSAGE_SENT`, `MESSAGE_EDITED`, `MESSAGE_DELETED`, `MESSAGE_RECEIVED` and forward to `lifecycle` (per RESEARCH), or make lifecycle a sibling with the same start/stop shape. The `if (!evt) continue;` guard tolerates missing event names. Change `onGenerationEnded/Stopped` from `runner.resume()` to `runner.resume('native')` (test `guard.test.js` asserts the call; update it). Same-chat dedupe on `CHAT_CHANGED` by chat key + integrity (RESEARCH "Same-chat vs switch dedupe" example, lines ~388-409). Re-fingerprint must run BEFORE `resume('native')` (D-04); use `buildFingerprint(bridge.ctx(), mesId)`.

### `src/runner.js` (MOD) - self-analog

**Current seam to change** (runner.js 28, 170-178): single boolean `paused`, `pause(reason)` ignores reason, `resume()` clears all.
```js
let paused = false;
function pause(reason) { paused = true; }
function resume() { paused = false; return wake(); }
```
Replace with a `Set<reason>` (RESEARCH Pattern 1); `resume(reason)` deletes just that reason, `resume()` with no arg = `resumeAll`. `loop()` (136-146) keeps `if (paused) return;` -> `if (pauseReasons.size) return;` and `wake()` (154) likewise. Add `onStateChange(cb)` using the same listener-Set pattern as `onItemFailed`/`onItemDone` (180-194):
```js
const failedListeners = new Set();
function onItemFailed(cb) { failedListeners.add(cb); }
function offItemFailed(cb) { failedListeners.delete(cb); }
```
**processNext reorder** (68-134): currently fingerprint check (103) occurs right after `generate()` and before idle; move to: generate -> park until `isIdle(bridge)` using `await new Promise(r => setTimeout(r, IDLE_RETRY_MS))` (same polling idiom as `flushAppend` 55-66) -> epoch check -> fingerprint -> owner check -> `flushAppend`. Add gates at top (owner, inspector, SAFE-02 connection diff, `fingerprintStatus` 'ok'|'chat'|'target') before `store.markRunning`. Keep `notifyFailed` rule that `'stale'` is silent (36-41), and keep the ordering comment: `notifyDone(item.id)` BEFORE `store.markDone(item.id)` (119-126). Breaker: increment only when `reason === 'api' || 'empty'`.
**abortRunning** (203-206) delegates to `abortOwn(runningController)`; extend with `{ disposition: 'cancel'|'requeue'|'discard' }`; never call `bridge.stopGeneration`.

### `src/store.js` (MOD) - self-analog

Header comment (1-4, 19-22) already reserves `bridge` for Phase 4 persistence. Existing mutators all end with `notify()`; follow that for any new mutator (`clear(reason)`, `rebind(items)`, `refingerprintAll(fp)`, `setConnectionAll`, `setReadOnly`/`applySnapshot`, `persistExcluding`). Excerpt:
```js
function add(fingerprint) {
  if (pendingCount() + runningCount() >= effectiveCap()) return { ok: false, reason: 'max' };
  const item = { id: nextId(), createdAt: new Date(), status: 'queued', attempts: 0, fingerprint };
  items.push(item); notify(); return { ok: true, item };
}
```
- `add` should also record `item.connection = bridge.connectionSnapshot?.()` (store already receives `bridge`; the 3 add sites need no change).
- `refingerprintAll` must mutate `item.fingerprint` in place (runner holds `item` reference).
- Persist: ALWAYS `bridge.ctx()` fresh (Pitfall 3), key-bound (RESEARCH Pattern 3). `nextId()` (11-17) is the UUID pattern; reuse for tab id.
- `getItems()` returns a shallow copy (92-95); keep.
- Note `drop`/`markDone` do not remove items, only set status (`done`/`failed`); `serialize` must filter to queued/running only and normalize to `queued`.
- Suppress spurious "0 completed" drain: `ui.js` 277-281 `store.onChange` -> `acc.noteActivity(active)` flushes on drain; bulk `clear`/`rebind` need an `acc.reset()` and `flush` must skip success toast when `completed === 0`.

### `src/persistence.js` (utility, transform) - analog `src/fingerprint.js`

Pure, no DOM, only args; import `hash` from `./fingerprint.js` (do not invent a hash, fingerprint.js 12-16). Reuse the field list from `buildFingerprint` (22-32) and the target match logic from `fingerprintMatches` (39-52):
```js
if (ctx.chat.length !== fp.chatLength) return false;
if (fp.mesId !== ctx.chat.length - 1) return false;
const m = ctx.chat[fp.mesId];
if (hash(m.swipes?.[0] ?? m.mes) !== fp.swipe0Hash) return false;
```
Add `fingerprintStatus(bridge, fp) -> 'ok'|'chat'|'target'` beside `fingerprintMatches` (keep `fingerprintMatches` as `status === 'ok'` so existing tests stay green). Note existing `fingerprintMatches` does NOT compare `name`; D-03/RESEARCH load step adds name compare. Export `SCHEMA_VERSION = 1`; `HARD_MAX_QUEUE` imported from `store.js`. Load validates untrusted data defensively (types, version, 24h expiry, cap 20).

### `src/connection.js` (utility, transform) - analog `src/toastAccumulator.js`

Pure factory/function module with JSDoc, no ST imports (toastAccumulator.js 1-15 style: "no ST/DOM dependencies, fully unit-testable"). Export `diffConnection(old, cur)` returning changed field names, skipping a field when either side is null/''. The ST read (`connectionSnapshot`) lives in `st-bridge.js`.

### `src/st-bridge.js` (MOD) - self-analog

Only module importing ST internals. `getGeneratingApi`/`getGeneratingModel` already imported and re-exported (10-11, 28-29); `extensionNames`, `getExtensionManifest`, `extension_settings` already imported (19). Add functions in the style of `canQueue()` (63-69):
```js
export const ctx = () => SillyTavern.getContext();
export function canQueue() {
  const c = ctx();
  if (c.groupId) return false;
  const settings = extension_settings[MODULE_NAME];
  if (settings && settings.enabled === false) return false;
  return Boolean(c.swipe?.isAllowed?.());
}
```
New: `connectionSnapshot()` (RESEARCH Pattern 5: `c.mainApi`, `c.chatCompletionSettings?.preset_settings_openai`, `c.textCompletionSettings?.preset`), `promptInspectorEnabled()` (localStorage flag AND extension present via `extensionNames`/`getExtensionManifest`, `extension_settings.disabledExtensions`), `chatKey(c)` (`characters[characterId].avatar/chatId`). If new ST exports are needed, add to BOTH the import block and the `export {}` block and to `capabilities()` probes (75-91) so a missing one warns. Keep `chatCompletionSettings`/popup functions read through `ctx()`, not imports.

### `src/queueActions.js` (MOD) - self-analog

Shared-helper pattern (10-15), injected `store, runner`, JSDoc'd, returns count:
```js
export function cancelAll(store, runner) {
  const pending = store.getItems().filter((i) => i.status === 'queued');
  for (const item of pending) store.drop(item.id, 'cancelled');
  const { aborted } = runner.abortRunning();
  return pending.length + (aborted ? 1 : 0);
}
```
Add `enqueue(store, runner, count)` here replacing the three duplicated add sequences: `ui.js` 217-236 (`canQueue()`, cap check, `buildFingerprint(c, c.chat.length - 1)`, `store.add`, `runner.wake()`), `wandMenu.js` 34-35, `commands.js` 54-62 (loop `store.add(target)` count times; `/queueswipe` keeps its own `enabled` check instead of `canQueue()`). Put read-only and Prompt Inspector refusal gates inside it. Add test mirroring `test/queueActions.test.js`; add a test that `cancelAll` never calls `bridge.stopGeneration` (GUARD-06).

### `src/ownership.js` (service, pub-sub) - partial analogs

No close analog (no storage/heartbeat code exists). Borrow: injected deps and start/stop from `guard.js`; `setTimeout` polling (not recursion) from `runner.js` `scheduleIdleRetry` (47-53):
```js
function scheduleIdleRetry() {
  if (idleRetryTimer) return;
  idleRetryTimer = setTimeout(() => { idleRetryTimer = null; wake(); }, IDLE_RETRY_MS);
}
```
Use `setInterval` for the 2s heartbeat with injected `storage`, `now`, `timers` so tests use fake timers. Use RESEARCH Pattern 4 and the "Lease tick" example. `tabId = crypto.randomUUID()` with fallback as in `store.js` `nextId()`. Fail open if localStorage throws (A4, needs user nod).

### `src/popups.js` (component) - partial analog `src/ui.js`

Thin DOM module, live-smoke only (no Vitest). Follow ui.js style: globals `$`/`toastr`, `ctx()` fresh from the bridge, build nodes with `textContent`. Use `callGenericPopup(el, POPUP_TYPE.CONFIRM, '', { okButton, cancelButton })` from `ctx()`; only `POPUP_RESULT.NEGATIVE` discards, null stays paused. Never await it inside an `eventSource` handler; schedule via `setTimeout(0)` and defer while `bridge.isGenerating()`. Copy strings verbatim from `04-UI-SPEC.md`.

### `src/ui.js` / `progressBar.js` / `commands.js` (MOD)

- `ui.js` 252 `store.onChange(() => renderQueueState(store, runner))`: add `runner.onStateChange(...)` subscription (store.onChange does not cover pause changes). Toast calls follow `toastr.*(msg, '', { preventDuplicates: true })` per UI-SPEC; existing toasts use `getNotificationStyle()` gating (ui.js 261-271).
- `progressBar.js` 14-15: `completed` is a closure variable; read-only tabs need it from the state snapshot.
- `commands.js` `/queueswipe` returns strings; add paused suffix to `/queuestatus`.

### `index.js` (MOD) - wiring only

Pattern (77-91): construct modules once in `init()`, pass `{ bridge, ... }`, `await` settings panel last. No logic here.
```js
const store = createStore({ bridge, maxQueueSize: extensionSettings[MODULE_NAME].maxQueueSize });
const runner = createRunner({ bridge, store, generate, append: appendSwipe });
const guard = createGuard({ bridge, runner });
guard.start();
```
Add ownership/lifecycle construction + `start()`, and an init-time and `APP_READY` catch-up call to the load path when `ctx().chatId` is already set (Pitfall 7). `DEFAULT_SETTINGS.circuitBreakerThreshold: 3` already present; settings merge is key-by-key `ensureSettings` (62-75). Inject `getThreshold` into runner reading `extension_settings[MODULE_NAME].circuitBreakerThreshold` live, clamp 1..10, fall back to 3.

### Tests (analogs)

**`test/lifecycle.test.js`, `ownership.test.js`** copy `test/guard.test.js`: fake event source + fake bridge + fake timers.
```js
function makeEventSource() { /* Map<evt, Set<h>>; on / removeListener / emit */ }
function makeBridge(eventSource) { return { eventSource, event_types: EVENT_TYPES }; }
function makeRunner() { return { pause: vi.fn(), resume: vi.fn() }; }
beforeEach(() => { vi.useFakeTimers(); });  afterEach(() => { vi.useRealTimers(); });
eventSource.emit(EVENT_TYPES.GENERATION_STARTED, 'normal', {}, false);
await vi.runAllTimersAsync();
expect(runner.pause).toHaveBeenCalledWith('native');
```
**`test/persistence.test.js`, `connection.test.js`** copy `test/fingerprint.test.js` (pure, `makeCtx`).
**runner/store tests**: runner.test.js 1-45 `vi.mock('../src/adapter.js', ...)` so `st-bridge.js` is never loaded under Node (also applies to any new test importing `runner.js`); `makeCtx`/`makeBridge(ctx, { generating, swipeState })` helpers. store.test.js uses `makeFakeBridge()` with `ctx()` returning `chat`, `saveChat: vi.fn()`; extend with `chatMetadata`, `saveMetadataDebounced: vi.fn()`, `chatId`. Any new module must not import `st-bridge.js` at top level (breaks Vitest); use injected bridge.

## Shared Patterns

### Fresh context, never cached
**Source:** `src/st-bridge.js` 49-50, `src/fingerprint.js` 39-41. **Apply to:** persistence, lifecycle, store persist, ownership, popups.
```js
export const ctx = () => SillyTavern.getContext();   // never cache across an await
const ctx = bridge.ctx();                            // fresh inside every check
```

### Event handlers hop off the emit stack
**Source:** `src/guard.js` 18-20. **Apply to:** all new event handlers, popups, saves.

### Listener-set subscription API
**Source:** `src/store.js` 97-103, `src/runner.js` 180-194 (`onX`/`offX` over a `Set`). **Apply to:** `runner.onStateChange`, ownership role-change callbacks.

### Silent stale vs user-visible failure
**Source:** `src/runner.js` 34-41 (`'stale'` never notifies). **Apply to:** lifecycle clears/discards (epoch discard, requeue abort) must not call `notifyFailed`; UI-SPEC says cleared items never enter the failure summary.

### Saving
**Source:** CLAUDE.md locked decision; `src/appender.js` uses `await c.saveChat()`. **Apply to:** store persist only: `c.saveMetadataDebounced()` normally, `c.saveChat()` immediately on enqueue; never `fetch('/api/chats/save')`. Persist-before-append so the appender's save carries the updated queue.

### Test isolation from ST
**Source:** `test/runner.test.js` 1-18. Pure modules take injected `bridge`; anything importing `adapter.js`/`st-bridge.js` needs `vi.mock`.

## Conventions

| Axis | Dominant | Share | Entropy | Status |
|---|---|---|---|---|
| File-name casing | camelCase (`queueActions.js`; only `st-bridge.js` is kebab) | 93% | 0.37 | named contract |
| Identifier casing | camelCase | 100% | 0 | named contract |
| Export style | ESM `export` | 100% | 0 | named contract |
| Import style | ESM `import` with explicit `.js` extension | 100% | 0 | named contract |

New files: camelCase names (`persistence.js`, `lifecycle.js`, `ownership.js`, `connection.js`, `popups.js`), named exports, relative imports with `.js`. Only `st-bridge.js` imports ST internals via the `../../../../../script.js` relative-path form.

**Contested hotspots (author's choice):** none within `src/`. The repo-wide CJS<->SDK dual resolver (`bin/lib/**` CJS vs `sdk/src/**` ESM) is the prototype intentional-contested split in the GSD tooling; it does not exist in this repo, so match this directory's local ESM style.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `src/ownership.js` (core lease logic) | service | cross-tab pub-sub | No localStorage/heartbeat code exists; use RESEARCH Pattern 4 |
| `src/popups.js` | component | request-response | No `callGenericPopup` usage yet; use RESEARCH Pattern 7 + UI-SPEC copy |

## Metadata

**Analog search scope:** `src/`, `test/`, `index.js` (all files read: store, guard, runner, fingerprint, st-bridge, queueActions, index; partial: ui, commands, progressBar, toastAccumulator, tests)
**Files scanned:** 34 tracked (non-planning) files
**Pattern extraction date:** 2026-10-27
