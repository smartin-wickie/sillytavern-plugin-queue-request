# Phase 3: Full Queue Control & UI - Pattern Map

**Mapped:** 2026-10-26
**Files analyzed:** 12 (4 modified, 7 new, 1 CSS modified)
**Analogs found:** 9 / 12 (3 genuinely new ST surfaces have no in-repo analog)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `src/runner.js` (modify: add `abortRunning()`, `onItemDone`/`offItemDone`, move `AbortController` ownership in) | service/scheduler | event-driven | `src/runner.js` itself (existing `onItemFailed`/`offItemFailed` listener-set pattern, existing `processNext()` loop) | exact (self-extension) |
| `src/adapter.js` (no code change — just gains a caller) | service | request-response | `src/adapter.js`'s own `abortOwn()` | exact (already correct) |
| `src/ui.js` (modify: cancel dropdown render/wire-up; replace `onItemFailed` toast with run-boundary accumulator) | component | event-driven + request-response | `src/ui.js`'s own `injectControl`/`renderBadge`/`renderDisabledState`/`registerQueueControl` | exact (self-extension) |
| `src/commands.js` (NEW) | controller (command handler) | request-response | `src/ui.js`'s `onControlClick` (clamp math) + `src/guard.js`'s `createGuard({...})` factory shape | role-match |
| `src/wand-menu.js` (NEW) | component | request-response | `src/ui.js`'s `injectControl`/`registerQueueControl` (DOM-inject-on-event pattern) | role-match (no true analog — new ST surface, see No Analog Found) |
| `src/progress-bar.js` (NEW) | component | event-driven | `src/ui.js`'s `renderBadge` (store.onChange-driven live re-render) | role-match (no true analog — new DOM insertion point) |
| `src/settings.js` (NEW) | provider/config | CRUD | `index.js`'s `ensureSettings()` (merge-by-key pattern) + `src/store.js`'s `getMaxQueueSize()` (live-read pattern) | role-match |
| `settings.html` (NEW) | template | n/a | none in-repo (no template file exists yet) | no analog — use RESEARCH.md's verbatim `inline-drawer` markup |
| `index.js` (modify: wire 4 new modules, pass `{ signal }` into `generate()`) | config/wiring | event-driven | `index.js` itself (existing `init()`/`generate()` wiring) | exact (self-extension) |
| `style.css` (modify: add dropdown/progress-bar/wand-menu `qs-` classes) | config (styling) | n/a | `style.css`'s own `.qs-queue-control`/`.qs-queue-badge` rules | exact (self-extension) |
| `test/runner.test.js` (extend: `abortRunning()`, `onItemDone`) | test | event-driven | `test/runner.test.js`'s existing `makeBridge`/`vi.fn()` fixture style | exact (self-extension) |
| `test/commands.test.js` or `test/ui.test.js` (NEW, optional) | test | request-response | `test/store.test.js`'s fixture/assertion style | role-match |

## Pattern Assignments

### `src/runner.js` (service/scheduler, event-driven) — MODIFY

**Analog:** itself (existing `processNext()`/`onItemFailed` machinery) — RESEARCH.md's Pattern 1 already derived the exact diff from reading this file this session; reconfirmed here against the live source.

**Current listener-registration pattern to mirror for the new `onItemDone`/`offItemDone` pair** (lines 164-170):
```javascript
function onItemFailed(cb) {
  failedListeners.add(cb);
}

function offItemFailed(cb) {
  failedListeners.delete(cb);
}
```
Add a second `Set` (`doneListeners`) and a matching `notifyDone(id)` called at the exact point `store.markDone(item.id)` currently runs (line 110), mirroring `notifyFailed` (lines 31-38).

**Current `processNext()` call site to modify** (lines 61-73, 120-130):
```javascript
async function processNext() {
  const item = store.peekNext();
  if (!item) return false;

  if (!fingerprintMatches(bridge, item.fingerprint)) {
    store.drop(item.id, 'stale');
    notifyFailed(item.id, 'stale');
    return true;
  }

  store.markRunning(item.id);

  let result;
  try {
    result = await generate(item);
  } catch (err) {
    ...
```
Insert a module-level `let runningController = null;`, set it to `new AbortController()` immediately before `generate(item)`, pass `{ signal: runningController.signal }` into `generate()`, and reset to `null` in a `finally`. Export a new `abortRunning()` that calls `adapter.js`'s `abortOwn(runningController)` (per D-02's explicit instruction) and no-ops with `{ aborted: false }` when nothing is running. **No change needed to the existing error-handling branches** — `send()` already resolves `{ aborted: true }` for an aborted signal rather than throwing (confirmed in `src/adapter.js` lines 95-100), so the existing `catch`/`'error' in result` branches already produce the `'cancelled'` drop path unmodified.

**Return object to extend** (line 172):
```javascript
return { wake, pause, resume, onItemFailed, offItemFailed };
```
→ add `abortRunning, onItemDone, offItemDone`.

---

### `src/adapter.js` (service, request-response) — NO CODE CHANGE

**Analog:** itself. `abortOwn()` is already implemented and spike-verified (lines 131-140):
```javascript
export async function abortOwn(ownController) {
  if (!ownController) throw new Error('no own request in flight');
  ownController.abort();
  return { aborted: ownController.signal.aborted };
}
```
This phase's only job regarding `adapter.js` is to give `runner.js` a reference to call this with — do not duplicate or re-derive this function.

---

### `src/ui.js` (component, event-driven + request-response) — MODIFY

**Analog:** itself. Three sub-patterns to extend:

**1. DOM-inject-on-event pattern for the new cancel dropdown** (mirrors `injectControl`, lines 23-53, and `registerQueueControl`'s event wiring, lines 129-143):
```javascript
export function registerQueueControl({ store, runner }) {
  const render = () => injectControl(store, runner);
  eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, render);
  eventSource.on(event_types.MESSAGE_SWIPED, render);
  eventSource.on(event_types.CHAT_CHANGED, render);
  eventSource.on(event_types.APP_READY, render);

  store.onChange(() => renderQueueState(store));
  renderQueueState(store);
  ...
```
The dropdown should attach a click listener to the already-existing `.qs-queue-badge` element (rendered by `renderBadge`, lines 68-92) rather than creating a new trigger element — open/close state lives in the dropdown module, re-rendering its row list on every `store.onChange()` exactly like `renderQueueState` already does for the badge.

**2. DOM built from nodes, never `innerHTML` with dynamic data** (lines 83-91, Security Domain V5 precedent):
```javascript
badge.textContent = '';
if (store.runningCount() > 0) {
  const spinner = document.createElement('i');
  spinner.className = 'fa-solid fa-spinner fa-spin';
  badge.appendChild(spinner);
}
badge.appendChild(document.createTextNode(String(n)));
```
Apply the same discipline to the dropdown's per-item rows (ordinal labels only, per UI-SPEC's copy contract — no model/prompt text ever reaches this surface anyway).

**3. Toast taxonomy to REPLACE, not extend** (lines 9-16, 144-150):
```javascript
const FAILURE_MESSAGES = {
  api: 'Queued swipe failed: API error',
  empty: 'Queued swipe failed: empty reply',
  cancelled: 'Queued swipe failed: cancelled',
};
...
runner.onItemFailed(({ reason }) => {
  const msg = FAILURE_MESSAGES[reason];
  if (!msg) return;
  toastr.warning(msg, undefined, { preventDuplicates: true });
});
```
Keep the `FAILURE_MESSAGES` lookup table (reuse its 3 string values inside the coalesced summary, per UI-SPEC's Copywriting Contract), but replace the `runner.onItemFailed(...)` block itself with RESEARCH.md's Pattern 3 run-boundary accumulator (hooks both the new `runner.onItemDone` and `runner.onItemFailed`, flushes one toast per `nonzero → 0` transition of `store.pendingCount() + store.runningCount()`).

---

### `src/commands.js` (controller, request-response) — NEW

**Analog:** no slash-command file exists yet in this repo; closest structural analogs are `src/ui.js`'s `onControlClick` clamp math (lines 114-123) and `src/guard.js`'s factory-function shape (`createGuard({ bridge, runner }) { ...; return { start, stop }; }`, lines 12-62) for the "accept injected deps, return named functions" convention this project uses everywhere (`createStore`, `createRunner`, `createGuard`).

**Clamp math to copy verbatim** (`src/ui.js` lines 114-123):
```javascript
function onControlClick(store, runner) {
  const n = store.pendingCount() + store.runningCount();
  if (n >= store.getMaxQueueSize()) return;

  const c = ctx();
  const target = buildFingerprint(c, c.chat.length - 1);
  const result = store.add(target);
  if (!result.ok) return;
  runner.wake();
}
```
`/queueswipe [count]` must re-derive `room = maxQueueSize - (pending+running)` fresh on every invocation (Pitfall 4) — never cache this across calls. RESEARCH.md's Code Examples section already has a complete `registerCommands({ store, runner, cancelAll })` draft using `SlashCommandParser.addCommandObject(SlashCommand.fromProps({...}))`; follow that shape, using `src/guard.js`'s factory-function-returns-named-functions convention (`return { wake, pause, ... }` style already used by `runner.js`/`store.js`/`guard.js`) for this module's own exports if it needs to expose `cancelAll` to `wand-menu.js` as well.

---

### `src/wand-menu.js` (component, request-response) — NEW

**Analog:** No analog exists in this repo for `#extensionsMenu` registration — flagged as genuinely new ST API surface (RESEARCH.md Open Question #1, MEDIUM confidence, third-party-source-only). Closest *structural* precedent in this repo is `src/ui.js`'s event-gated DOM injection (`injectControl`, called from `registerQueueControl`'s `eventSource.on(event_types.APP_READY, render)`, line 134) — register once on `APP_READY`, idempotently guard against double-insertion the same way `injectControl` sweeps/guards against orphaned controls (lines 30-32, 39).

**Idempotency guard pattern to copy** (`src/ui.js` lines 39-42):
```javascript
if (!swipeRightEl || lastMes.querySelector(`.${CONTROL_CLASS}`)) {
  renderQueueState(store);
  return;
}
```
Apply the same `if ($('#qs-wand-entry').length) return;` idempotency check (already drafted in RESEARCH.md's Code Examples) before appending into `#extensionsMenu`.

---

### `src/progress-bar.js` (component, event-driven) — NEW

**Analog:** No analog exists for a top-of-chat DOM insertion point in this repo — flagged as genuinely new (RESEARCH.md Open Question #2). Closest *structural* precedent is `src/ui.js`'s `renderBadge` (lines 68-92): subscribe to `store.onChange()` and recompute the live numerator/denominator on every call, hide-not-empty-render when the count is 0 (same UI-01 rule the badge already follows, lines 72-75):
```javascript
function renderBadge(control, store) {
  const n = store.pendingCount() + store.runningCount();
  let badge = control.querySelector(`.${BADGE_CLASS}`);

  if (n === 0) {
    badge?.remove();
    return;
  }
  ...
```
Mirror this exact "compute live, remove-not-hide at zero" shape for the progress bar's show/hide; wire its "stop" click to the same `cancelAll()` function `commands.js`/`wand-menu.js` call (per UI-SPEC: "performs the exact same action as Cancel all — not a separate cancellation code path"). Needs `runner.onItemDone`/`onItemFailed` (both, for the numerator) — same new runner hooks `ui.js`'s toast accumulator consumes.

---

### `src/settings.js` + `settings.html` (provider/config, CRUD) — NEW

**Analog:** `index.js`'s `ensureSettings()` merge-by-key pattern (lines 49-67):
```javascript
function ensureSettings(extensionSettings, saveSettingsDebounced) {
  extensionSettings[MODULE_NAME] ??= {};
  const settings = extensionSettings[MODULE_NAME];
  let changed = false;
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (!(key in settings)) {
      settings[key] = value;
      changed = true;
    }
  }
  if (changed) {
    saveSettingsDebounced();
  }
}
```
`settings.js`'s new `DEFAULT_SETTINGS` additions (`enabled`, `autoJump`, `notificationStyle`, `circuitBreakerThreshold` alongside the existing `maxQueueSize`) must extend this exact same object/function in `index.js`, not introduce a parallel merge path.

**Live-read pattern to copy** (`src/store.js` lines 108-110):
```javascript
function getMaxQueueSize() {
  return effectiveCap();
}
```
Every settings-panel field handler must re-read `SillyTavern.getContext().extensionSettings[MODULE_NAME]` fresh at the point of use (D-12) — never cache the settings object at panel-render time. RESEARCH.md's Code Examples section has a complete `registerSettingsPanel()` draft using `renderExtensionTemplateAsync` + `#extensions_settings2` + `inline-drawer` markup (verified against official ST docs this session) — no in-repo analog exists for the template file itself; use that draft verbatim as the starting shape.

**No analog in-repo** for `settings.html` — this is the first template file in the project. Use RESEARCH.md's verbatim `inline-drawer`/`inline-drawer-toggle`/`inline-drawer-content` markup (sourced from official ST docs, not guessed).

---

### `index.js` (config/wiring, event-driven) — MODIFY

**Analog:** itself. Current `init()`/`generate()` wiring (lines 24-47, 69-80) is the pattern to extend, not replace:
```javascript
async function generate() {
  const started = new Date();
  const ownController = new AbortController();
  const { signal } = ownController;

  let sent;
  try {
    const captured = await capture({ signal });
    sent = await send(captured, signal);
  } catch (err) {
    return { error: 'api' };
  }
  ...
```
Per RESEARCH.md Pattern 1, this closure's `AbortController` creation moves into `runner.js`'s `processNext()`; `generate()`'s signature changes to `async function generate(item, { signal })` and the local `ownController`/`signal` lines are deleted here. `init()`'s existing construction sequence (`createStore` → `createRunner` → `createGuard` → `guard.start()` → `registerQueueControl`, lines 74-79) gets four new calls appended in the same style: `registerCommands({...})`, `registerWandMenu({...})`, `registerProgressBar({...})`, `registerSettingsPanel()` — each a fire-and-forget registration call exactly like the existing `registerQueueControl({ store, runner })`.

---

### `style.css` (config/styling, n/a) — MODIFY

**Analog:** itself. Existing `qs-` prefix convention (all 4 lines):
```css
.qs-queue-control { ... }
.qs-queue-control--disabled { ... }
.qs-queue-badge { ... }
```
Every new class this phase introduces (dropdown panel, dropdown row, per-item ×, wand-menu entry wrapper, progress-bar container/fill, settings panel wrapper) must use this same `qs-` prefix — never a bare/native-ST-sounding class name (PITFALLS.md #30, UI-SPEC Design System). No hardcoded hex colors — reuse ST's `--SmartTheme*` variables (UI-SPEC Color section), consistent with this file's current total absence of literal colors.

## Shared Patterns

### Fresh-context, no caching across `await`
**Source:** `src/st-bridge.js` lines 45-46
```javascript
/** Fresh-context accessor. Never cache the return value across an `await`. */
export const ctx = () => SillyTavern.getContext();
```
**Apply to:** every new file that touches `extensionSettings`, `chat`, `chatMetadata`, or `SillyTavern.getContext()` — `commands.js`, `settings.js`, `wand-menu.js`, `progress-bar.js`.

### Listener-set registration (`onX`/`offX` pairs)
**Source:** `src/runner.js` lines 164-170, `src/store.js` lines 97-103
```javascript
function onChange(cb) {
  listeners.add(cb);
}

function offChange(cb) {
  listeners.delete(cb);
}
```
**Apply to:** `runner.js`'s new `onItemDone`/`offItemDone` pair — exact same `Set`-based shape as the existing `onItemFailed`/`offItemFailed`.

### Toast taxonomy — static strings only, never raw error text
**Source:** `src/ui.js` lines 9-16
```javascript
const FAILURE_MESSAGES = {
  api: 'Queued swipe failed: API error',
  empty: 'Queued swipe failed: empty reply',
  cancelled: 'Queued swipe failed: cancelled',
};
```
**Apply to:** the new toast-coalescing accumulator in `ui.js` (reuses these same 3 values, rolled into a summary string) and every slash-command toast in `commands.js` (per D-06/D-07's exact copy strings in UI-SPEC's Copywriting Contract).

### Settings merge-by-key (never replace the whole object)
**Source:** `index.js` lines 54-67 (`ensureSettings`)
**Apply to:** `settings.js`'s new default keys — extend `DEFAULT_SETTINGS` in `index.js`, do not create a second settings-initialization path.

### `qs-` CSS class prefix, no literal hex colors
**Source:** `style.css` (entire file), UI-SPEC Color section
**Apply to:** every new CSS rule this phase adds.

### Factory-function-returns-named-object construction style
**Source:** `src/store.js` (`createStore({...}) { ...; return {...}; }`), `src/runner.js` (`createRunner`), `src/guard.js` (`createGuard`)
**Apply to:** any new module that holds internal state and exposes behavior (e.g. a `cancelAll(store, runner)` helper shared by `commands.js`/`wand-menu.js`/the dropdown) should follow this same injected-deps, returned-named-functions shape rather than exporting bare mutable state.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/wand-menu.js` | component | request-response | No existing file registers into ST's `#extensionsMenu` — this is the project's first use of that surface. RESEARCH.md flags it MEDIUM confidence (third-party-source-only, not ST core docs); use RESEARCH.md's Code Examples draft and plan a live smoke-test step, per Open Question #1. |
| `src/progress-bar.js` | component | event-driven | No existing file inserts DOM at `#sheld`/top-of-chat — this project's first use of that insertion point. RESEARCH.md flags exact selector as MEDIUM confidence (Open Question #2); the `store.onChange`-driven live-recompute *shape* is well-established (`renderBadge`), only the DOM target is new. |
| `settings.html` | template | n/a | No template file exists yet in this repo (`renderExtensionTemplateAsync` has never been called). Use RESEARCH.md's verbatim `inline-drawer` markup, sourced from official ST docs this session, not an in-repo precedent. |

## Conventions

Derived via the shared `gsd-tools.cjs verify conventions --derive --scope src` module (majority-vote + entropy), scoped to `src/` (this phase's files all live in or alongside `src/`).

| Axis | Dominant | Share | Entropy | Status |
|------|----------|-------|---------|--------|
| File-name casing | camelCase | 87.5% (7/8) | 0.544 | named contract |
| Identifier casing | camelCase | 100% (55/55) | 0.0 | named contract |
| Export style | ESM (`export`) | 100% (7/7) | n/a | insufficient data (sample too small for a hotspot verdict, but no contrary variant observed — treat as named contract in practice) |
| Import style | ESM (`import`) | 100% (5/5) | n/a | insufficient data (same caveat as export style) |

**New files this phase must follow:** camelCase filenames (`commands.js`, `wandMenu.js`... — note: RESEARCH.md's own file list uses kebab-case `wand-menu.js`/`progress-bar.js`; the repo's 87.5%-dominant convention is camelCase, so prefer `wandMenu.js`/`progressBar.js` unless the planner has a specific reason to diverge — flag this discrepancy for the planner's file-naming decision). All identifiers (`runningController`, `abortRunning`, `onItemDone`) camelCase, ESM `import`/`export` throughout — both already 100% consistent with every file read this session (`store.js`, `runner.js`, `adapter.js`, `ui.js`, `guard.js`, `st-bridge.js`, `index.js`).

**Contested hotspots (author's choice):** None found at this repo's current size — every axis sampled is either a clear named contract (camelCase) or has zero observed variance (100% ESM). This repo is too small/young to have produced a genuine split like the CJS<->SDK dual-resolver pattern seen in larger GSD-tooling repos (where `bin/lib/**` is CJS `module.exports`/`require` and `sdk/src/**` is ESM `export`/`import`, each internally consistent per-directory, contested only repo-wide). If this project ever grows a second module-system boundary (e.g. a future server plugin reintroducing CJS), apply that same rule: match the directory's local style rather than forcing repo-wide uniformity.

## Metadata

**Analog search scope:** `src/`, `test/`, repo root (`index.js`, `style.css`, `manifest.json`)
**Files scanned:** `src/ui.js`, `src/runner.js`, `src/store.js`, `src/adapter.js`, `src/st-bridge.js`, `src/guard.js`, `index.js`, `style.css`, `manifest.json`, `test/runner.test.js`, `test/store.test.js`
**Pattern extraction date:** 2026-10-26
