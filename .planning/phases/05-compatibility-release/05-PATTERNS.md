# Phase 5: Compatibility & Release - Pattern Map

**Mapped:** 2026-10-28
**Files analyzed:** 11 (4 code/test new, 3 code/test modified, 4 docs/config)
**Analogs found:** 7 / 11 (docs and live-session artifacts have no code analog)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/st-bridge.js` (modify: add `autoSwipeEnabled`, `squashEnabled`, `activeInterceptors`, `activeGaps`) | utility (ST bridge) | request-response (sync read) | `promptInspectorEnabled()` in same file, lines 100-115 | exact |
| `src/gapWarning.js` (new) | utility (pure module, injected deps) | transform + session-gate | `src/toastAccumulator.js` (pure, factory, no ST deps) | role-match |
| `src/queueActions.js` (modify: call warner in `enqueue()`) | service | request-response | itself, `enqueue()` lines 22-46 | exact |
| `index.js` (modify: build warner with `sessionStorage`, pass to `configureQueueActions`) | config / wiring | event-driven | `index.js` lines 92-115 (localStorage try/catch, `configureQueueActions`) | exact |
| `test/gapWarning.test.js` (new) | test | transform | `test/toastAccumulator.test.js` | role-match |
| `test/noCascade.test.js` (new) | test | request-response | `test/runner.test.js` (vi.mock adapter, makeBridge) | exact |
| `test/queueActions.test.js` (extend) | test | request-response | itself (`makeFakeBridge`, `configureQueueActions`) | exact |
| `README.md` (new) | docs | n/a | none (spike/README.md is internal only) | no analog |
| `manifest.json` (modify: version, homePage) | config | n/a | itself | exact |
| `LICENSE` (new, user decision) | docs | n/a | none | no analog |
| `05-COMPAT-MATRIX.md`, `04-HUMAN-UAT.md` update | docs / evidence | n/a | `04-HUMAN-UAT.md` result format | role-match |

## Pattern Assignments

### `src/st-bridge.js` additions (utility, sync ST read)

**Analog:** `promptInspectorEnabled()`, `src/st-bridge.js` lines 100-115. It is the only place that reads ST/extension state, always try/catch failing to the "inactive" value.

**Already-imported symbols to reuse** (lines 17-19): `oai_settings`, `extensionNames`, `getExtensionManifest`, `extension_settings`.

**Core pattern** (lines 105-115):
```js
export function promptInspectorEnabled() {
  try {
    if (localStorage.getItem('promptInspectorEnabled') !== 'true') return false;
    const disabled = extension_settings.disabledExtensions ?? [];
    return (extensionNames ?? []).some(
      (n) => getExtensionManifest(n)?.display_name === 'Prompt Inspector' && !disabled.includes(n),
    );
  } catch {
    return false;
  }
}
```

**Fresh-context accessor** (line 50): `export const ctx = () => SillyTavern.getContext();` - read `ctx().powerUserSettings?.auto_swipe` and `ctx().mainApi` through it (never cache across await). Mirror `connectionSnapshot()` lines 88-98 for the `c.mainApi === 'openai'` gate.

**Apply:** `autoSwipeEnabled()` = `ctx().powerUserSettings?.auto_swipe === true`; `squashEnabled()` = `ctx().mainApi === 'openai' && oai_settings.squash_system_messages === true` (or `ctx().chatCompletionSettings`); `activeInterceptors()` per RESEARCH lines 103-117 (filter `disabledExtensions`, check `typeof globalThis[key] === 'function'`); `activeGaps()` returns `{ autoSwipe, interceptors[], squash }`, each in its own try/catch.

---

### `src/gapWarning.js` (pure module, factory with injected deps)

**Analog:** `src/toastAccumulator.js` - factory returning closures over private state, zero ST/DOM imports, JSDoc on each function, header comment stating purpose (lines 1-12, 51).

**Factory shape to copy** (lines 11-12, 51):
```js
export function createRunAccumulator() {
  let run = null; // private state
  ...
  return { noteActivity, recordDone, recordFailed, reset };
}
```

**Body to implement:** RESEARCH.md "Code Examples" lines 229-245 (`createGapWarner({ storage })` with in-memory fallback and try/catch around storage). Add `formatGapLines(gaps)` exported separately; escape `<>&"` in extension names (UI-SPEC rule: interpolated values never raw HTML, `04-UI-SPEC.md` line 93). Do NOT mark "shown" when no gap is active.

**Toast style:** static literals, `preventDuplicates`, non-modal (match `index.js` lines 112-113).

---

### `src/queueActions.js` (modify `enqueue()`)

**Analog:** itself. Injection point (lines 9-15) and refusal checks (lines 24-31):
```js
let configured = { bridge: null, toast: null };
export function configureQueueActions({ bridge, toast }) {
  configured = { bridge, toast };
}
...
  if (bridge?.promptInspectorEnabled?.()) {
    toast?.warning?.(INSPECTOR_REFUSE_TEXT);
    return { added: 0, requested: count, refused: 'inspector' };
  }
  // <-- insert gap warner call here: after refusals, before room/add; never blocks (D-07)
```
Extend `configureQueueActions({ bridge, toast, gapWarner })` and call `configured.gapWarner?.maybeWarn(bridge.activeGaps?.(), toast)` with optional chaining so the existing tests (fake bridge with only `ctx`) keep passing. Do not call from `resumeQueue()` or the runner/lifecycle (RESEARCH anti-patterns). Constants for text live at module top (lines 6-7).

---

### `index.js` (wiring)

**Analog:** `index.js` lines 92-115.
```js
  let storage = null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  ...
  configureQueueActions({
    bridge,
    toast: {
      info: (m) => toastr.info(m, '', { preventDuplicates: true }),
      warning: (m) => toastr.warning(m, '', { preventDuplicates: true }),
    },
  });
```
Copy the try/catch storage access using `window.sessionStorage`; add import beside line 18 (`import { createGapWarner } from './src/gapWarning.js';`). For the long gap toast, pass `timeOut: 10000` in a dedicated call (RESEARCH line 123) - either extend `toast.warning(m, opts)` or add `toast.gap`.

---

### `test/gapWarning.test.js` (pure unit test)

**Analog:** `test/toastAccumulator.test.js` (pure factory test, no mocks). Header imports follow `test/queueActions.test.js` line 1: `import { describe, expect, it, vi } from 'vitest';`. Cases per RESEARCH line 247: no gaps -> no toast and not marked; gaps -> one toast; second call none; throwing storage -> memory fallback; names escaped; later-enabled gap still warns.

---

### `test/noCascade.test.js` (COMP-02 unit proof)

**Analog:** `test/runner.test.js` lines 1-41 (adapter mock, bridge/ctx factories, fake timers).
```js
vi.mock('../src/adapter.js', () => ({
  abortOwn: vi.fn(async (ownController) => {
    ownController.abort();
    return { aborted: ownController.signal.aborted };
  }),
}));
function makeBridge(ctx, { generating = false, swipeState = 'none' } = {}) {
  return { ctx: () => ctx, isGenerating: () => generating, swipeState: () => swipeState };
}
...
const runner = createRunner({ bridge, store, generate, append });
await runner.wake();
```
Add `swipe: { right: vi.fn(), to: vi.fn() }` and `Generate: vi.fn()` on the fake ctx/bridge, drain 3 items, assert `swipe.right` and any non-dry `Generate` never called, no `#option_continue` click. Second test: `fs` source scan of `src/*.js` + `index.js` (no precedent in `test/`; RESEARCH A4) asserting no `triggerAutoContinue`, `option_continue`, `.right(`; and the only `Generate(` call in `src/adapter.js` (line 45: `await bridge.Generate('swipe', { signal }, true);`) matches `/Generate\('swipe',\s*\{[^}]*\},\s*true\)/`. Note adapter.js is mocked in the runner test, hence the scan covers the real call shape.

---

### `test/queueActions.test.js` (extend)

**Analog:** itself, lines 1-15 (`makeFakeBridge`, `fp()`), plus `test/queueActions.readonly.test.js` for `configureQueueActions` use. Add cases: gap warner called once on first successful `enqueue`, not called when refused (readonly/inspector), enqueue still adds when warner throws or gaps active.

---

### `manifest.json`

Current (lines 1-10): `version "0.1.0"`, `author "seant"`, no `homePage`. Keep `loading_order`, `hooks.activate`. Version, homePage, license are user decisions (checkpoint:decision); do not guess.

---

### `04-HUMAN-UAT.md` update and `05-COMPAT-MATRIX.md`

**Analog:** `04-HUMAN-UAT.md` format: front-matter `status: partial`, `## Tests` with `### N. Title`, `expected:`, `result: [pending]`. Replace each `result:` line, update Summary counts and front-matter status. Matrix columns (D-04): extension | version/commit | case (baseline/solo/combined) | result | notes | evidence (relative path under `evidence/`).

---

## Shared Patterns

### Bridge-only ST access
**Source:** `src/st-bridge.js` header lines 1-3. Only this file imports ST internals; all other modules get them via injected `bridge`. New detection code lives here; `gapWarning.js` receives plain data.

### Fail-safe detection
**Source:** `src/st-bridge.js` lines 105-115. try/catch returning the inactive value; never throws into the queue path.

### Injected-dependency pure modules + Vitest
**Source:** `src/toastAccumulator.js`, `test/runner.test.js`. Modules take `{ bridge, store, ... }`; tests use fake bridges and `vi.mock('../src/adapter.js')` because `st-bridge.js` cannot resolve under Node.

### Toasts
**Source:** `index.js` lines 109-115. `toastr.<level>(m, '', { preventDuplicates: true })`, non-modal; interpolated third-party strings escaped.

### Conventions (derived with `gsd-tools verify conventions --scope src`)

| Axis | Dominant | Share | Entropy | Status |
|------|----------|-------|---------|--------|
| File-name casing | camelCase (`queueActions.js`; 1 kebab outlier) | 95% | 0.28 | named contract |
| Identifier casing | camelCase | 100% | 0 | named contract |
| Export style | ESM `export` | 100% | 0 | named contract |
| Import style | ESM `import` | 100% | 0 | named contract |

**Contested hotspots (author's choice):** none within this extension's `src/`. Repo-wide, the CJS<->SDK dual resolver (`bin/lib/**` CJS `module.exports`/`require` vs `sdk/src/**` ESM) is the prototype intentional split; it does not exist in this repo. Match the directory's local style (ESM, camelCase file names such as `gapWarning.js`, `.js` extension in relative imports).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `README.md` | docs | n/a | None exists (only `spike/README.md`, internal). Use RESEARCH "README content inventory" (10 sections). Read `src/commands.js`, `src/ui.js`, `src/pauseLabels.js`, `src/settings.js`, `settings.html` at write time for exact names/defaults. Acceptance: `! grep -i cache README.md`. |
| `LICENSE` | docs | n/a | User decision; ask before choosing. |
| Live-session artifacts (`evidence/`, matrix rows) | evidence | n/a | Produced by the Claude-in-Chrome session. UserSwipes is not installed at E:\SillyTavern; needs a user decision before COMP-01 can be met. |
| source-scan test style | test | n/a | No precedent in `test/` (RESEARCH A4). |

## Metadata

**Analog search scope:** `src/`, `test/`, `index.js`, `manifest.json`, phase 4 UAT doc
**Files scanned:** ~12 read, 45 tracked files listed
**Pattern extraction date:** 2026-10-28
