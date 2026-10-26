# Phase 2: Single Queued Swipe End-to-End - Pattern Map

**Mapped:** 2026-10-25
**Files analyzed:** 14 (manifest + index + style + 8 `src/` modules + 3 test files)
**Analogs found:** 14 / 14 — **0 real in-repo production analogs** (repo is pre-implementation). Every row below maps to either (a) the frozen Phase 1 spike code (`spike/*`, pattern-reference only per Phase 1 D-09 — never copy the file, never grow it), or (b) a concrete pseudocode sketch already written and source-verified in `.planning/research/ARCHITECTURE.md`. Treat (b) sketches as load-bearing as if they were real files — they were written against direct ST 1.19.0 source reads, not invented.

**Repo state note:** `git status`/`find` confirms the working tree has no `package.json`, no `manifest.json` outside `spike/`, and no `src/`/`test/` trees yet. `spike/` is explicitly frozen evidence (Phase 1 D-09) — the production extension is a sibling tree at the repo root, not a copy of `spike/`.

## File Classification

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|-----------------|---------------|
| `manifest.json` | config | request-response (load-time) | `spike/manifest.json` | exact (schema identical; only fields change) |
| `index.js` | controller (wiring) | event-driven | `spike/index.js` `init()`/`export async function init()` | role-match (same hook shape, far less logic) |
| `style.css` | config (presentation) | — | none in repo | no analog — new |
| `src/st-bridge.js` | utility (infra boundary) | request-response | `spike/st-imports.js` | exact (same import set + pattern, same depth) |
| `src/store.js` | store/model | CRUD | none in repo | sketch-only — `ARCHITECTURE.md` §3.2 (Queue Store row), §3.5 (persistence schema) |
| `src/fingerprint.js` | utility | transform | none in repo | sketch-only — `ARCHITECTURE.md` §3.3 fingerprint shape, RESEARCH.md "Fingerprint shape" code example |
| `src/runner.js` | service (state machine) | event-driven | none in repo | sketch-only — `ARCHITECTURE.md` §2.2 pipeline + §5 Pattern 1; RESEARCH.md Pattern 1 `runNextItem` sketch |
| `src/adapter.js` | service (transport) | request-response | `spike/index.js` `capture()`/`send()`/`abortOwn()` | role-match, strong — spike functions are the exact pattern, verified live in Phase 1 |
| `src/appender.js` | service (chat mutation) | CRUD | none in repo (native `addSwipeCallback` in ST core, not in this repo) | sketch-only — `ARCHITECTURE.md` §2.2 `appendSwipe` sketch, §1.5/§1.6 |
| `src/guard.js` | middleware (event policy) | event-driven | `spike/index.js` `startEventLog()` (subscribe/unsubscribe shape) + `ARCHITECTURE.md` §3.4 policy table | role-match (listener lifecycle), sketch for policy |
| `src/ui.js` | component (DOM) | event-driven | none in repo | sketch-only — `02-UI-SPEC.md` Interaction Contract + RESEARCH.md integration points (DOM selectors) |
| `test/store.test.js` | test | — | none in repo | no analog — new (Vitest is new dev dependency) |
| `test/fingerprint.test.js` | test | — | none in repo | no analog — new |
| `test/runner.test.js` | test | — | none in repo | no analog — new |

## Pattern Assignments

### `manifest.json` (config)

**Analog:** `spike/manifest.json` (read in full, 9 lines)

```json
{
  "display_name": "QS Route Spike",
  "loading_order": 100,
  "js": "index.js",
  "author": "seant",
  "version": "0.0.1",
  "minimum_client_version": "1.19.0",
  "hooks": { "activate": "init" }
}
```

**Apply:** Same schema. Change `display_name` to the product name, `js` stays `index.js`, `minimum_client_version` stays `"1.19.0"` (verified, SPIKE-REPORT.md), keep `"hooks": {"activate": "init"}` (STACK.md: "Recommend the hook form ... keep init fast (<5s)"). Add `css: "style.css"` (new field, not in spike manifest since spike had no CSS). `loading_order`: STACK.md recommends `>= 10` to load after core bundled extensions (quick-reply=12, connection-manager=1); do not reuse the spike's throwaway `100` without reconsidering — any value `>=10` is safe per that guidance, pick something that doesn't look accidental (e.g. `10` or `20`).

---

### `index.js` (controller, wiring only)

**Analog:** `spike/index.js` lines 426-450 (`export async function init()`)

```javascript
export async function init() {
  const api = { capture, send, abortOwn, armNative, overlap, status, note, pending: null,
    snapshot: async () => { ... }, dump: async (name, obj) => { ... }, guard };
  window.qsSpike = api;
  console.log('[qsSpike] ready, ST', ctx().version ?? 'unknown');
}
```

**Apply:** Same hook export shape (`export async function init()`), but production `index.js` does none of the spike's debug/dump work — per `ARCHITECTURE.md` §3.2 UI row and §4, it only: constructs the bridge, store, and the other modules; registers the UI control on `.last_mes`; starts the Guard's event subscriptions. Keep `init()` fast (<5s timeout per STACK.md); defer any heavy work (first `CHAT_CHANGED`-triggered resume-prompt) to the event itself, not to `init()` directly — mirrors `ARCHITECTURE.md` §3.4's `APP_READY` row ("Register UI, slash command; first `CHAT_CHANGED` follows when a chat opens").

**Error handling:** Spike's module-level `fail(err)` helper (lines 58-61) is a logging passthrough: `console.error('[qsSpike]', err); return err;`. Production modules should keep the same shape (log + return/rethrow typed error) rather than inventing a new error-wrapper convention, since no other convention exists in this repo yet.

---

### `src/st-bridge.js` (utility, infra boundary)

**Analog:** `spike/st-imports.js` (full file, 20 lines) — this one is near-identical to what production needs, not just a pattern reference, since Phase 1 D-09 proved the exact import list resolves live.

```javascript
// Internal ST imports used by the spike, resolved from third-party/<name>/ depth.
// Request headers and power-user settings come from SillyTavern.getContext() instead.
export {
    Generate,
    isGenerating,
    cleanUpMessage,
    extractMessageFromData,
    stopGeneration,
    getGeneratingApi,
    getGeneratingModel,
    ensureSwipes,
    updateSwipeCounter,
    isStreamingEnabled,
    getGenerateUrl,
} from '../../../../script.js';
export { sendOpenAIRequest, oai_settings } from '../../../openai.js';
export { extractReasoningFromData, parseReasoningFromString } from '../../../reasoning.js';
export { extensionNames, getExtensionManifest, extension_settings } from '../../../extensions.js';
export { eventSource, event_types } from '../../../events.js';
```

**Apply:** `src/st-bridge.js` should wrap (not just re-export) this same import list, per `ARCHITECTURE.md` §3.2 Bridge row ("Contain logic" is forbidden, but "capability probing (feature-detect each import, expose `bridge.capabilities`)" is required — the spike file does not do this, since it's throwaway evidence code). Also add `getContext` access as `const ctx = () => SillyTavern.getContext();` (spike line 44 pattern) and expose `isSwipingAllowed`/`swipe.isAllowed()` per QUEUE-08. Relative import depth `../../../../script.js` / `../../../openai.js` etc. is the exact proven path from `third-party/<name>/` root; do not recompute it — `src/st-bridge.js` sits one level deeper than `index.js` (inside `src/`), so **add one more `../`** relative to the spike's paths (spike's `st-imports.js` is at extension root, production's `st-bridge.js` is at `src/st-bridge.js`).

**Fresh-context pattern** (apply inside the bridge and everywhere else, `ARCHITECTURE.md` §1.7, §5, Pattern 2 of RESEARCH.md):
```javascript
const ctx = () => SillyTavern.getContext();
// never: const c = ctx(); ... await foo(); ... c.chatMetadata.x = 1;  (c may be stale after the await)
```

---

### `src/adapter.js` (service, capture + transport + clean)

**Analog:** `spike/index.js` `capture()` (lines 191-252) and `send()` (lines 254-333) — pattern reference only, Phase 1 D-09 freezes the file as evidence; mirror the logic, write new code.

**Idle-gate + capture pattern** (lines 191-227, strip the dump/snapshot/diagnostic code — keep the listener lifecycle and dry-run call):
```javascript
async function capture({ label, holdMs = 0, withSignal = true } = {}) {
  const c = guard();
  if (isGenerating() || c.swipe?.state?.() !== 'none') throw fail(new Error('not idle'));
  let armed = false, captured = null;
  const onStart = async (type, _params, dryRun) => { if (type === 'swipe' && dryRun === true) armed = true; };
  const onData = (data, dryRun) => { if (armed && dryRun === true) { captured = jsonClone(data); armed = false; } };
  eventSource.on(event_types.GENERATION_STARTED, onStart);
  eventSource.makeLast(event_types.GENERATE_AFTER_DATA, onData);
  try {
    await c.generate('swipe', withSignal ? { signal: ownController.signal } : {}, true);
  } finally {
    eventSource.removeListener(event_types.GENERATION_STARTED, onStart);
    eventSource.removeListener(event_types.GENERATE_AFTER_DATA, onData);
  }
  if (!captured) throw fail(new Error('capture failed: no dry-run GENERATE_AFTER_DATA seen'));
  return captured;
}
```
Note the spike uses `jsonClone` (`JSON.parse(JSON.stringify(value))`, lines 54-56) instead of `structuredClone` specifically because the textgen `generate_data` carries a non-cloneable `parseSequenceBreakers` function property — **reuse `jsonClone`, not `structuredClone`**, in the adapter (this is a load-bearing, previously-debugged detail, not a style choice).

**Transport pattern, both return shapes** (lines 254-333, and `ARCHITECTURE.md` §2.2 code block — these two are consistent with each other):
```javascript
if (c.mainApi === 'openai') {
  const r = await sendOpenAIRequest('swipe', captured.prompt, signal);
  if (typeof r === 'function') {
    let last = { text: '', state: {} };
    for await (const chunk of r()) last = chunk;   // streaming: keep the last yielded chunk
    getMessage = last.text ?? ''; reasoning = last.state?.reasoning ?? '';
  } else {
    getMessage = extractMessageFromData(r); reasoning = extractReasoningFromData(r) ?? '';
  }
} else {
  const res = await fetch(getGenerateUrl(c.mainApi), { method: 'POST', headers: c.getRequestHeaders(), body: JSON.stringify(captured), signal });
  if (!res.ok) throw new Error(`generation failed: ${res.status}`);
  const json = await res.json();
  getMessage = extractMessageFromData(json); reasoning = extractReasoningFromData(json) ?? '';
}
```
Use `type='swipe'` for `sendOpenAIRequest`, never `'quiet'` — `ARCHITECTURE.md` §2.2 explains why (prefill/multi-swipe `n` loss with `'quiet'`).

**Clean/error pattern:**
```javascript
const cleanedText = aborted ? '' : cleanUpMessage({ getMessage, isImpersonate: false, isContinue: false, displayIncompleteSentences: false });
```
Plus `parseReasoningFromString` when `power_user.reasoning.auto_parse` is on (`ARCHITECTURE.md` §1.8, §2.2). GEN-06 success criterion: success = observable post-condition (`cleanedText` non-empty and no abort), never "the promise resolved" — `aborted` is detected via `err?.name === 'AbortError' || signal.aborted` (spike line 308).

**Own-abort pattern** (lines 336-341):
```javascript
async function abortOwn() {
  guard();
  if (!state.ownController) throw fail(new Error('no own request in flight'));
  state.ownController.abort();
  return { aborted: state.ownController.signal.aborted };
}
```

---

### `src/appender.js` (service, chat mutation)

**Analog:** `ARCHITECTURE.md` §2.2 `appendSwipe` sketch (no real file in repo or in `spike/` — the spike never appends, by design, since it is read-only evidence code per its own file header comment: "It never appends swipes, never runs a non-dry Generate and never writes chat data.")

```javascript
async function appendSwipe(mesId, text, meta) {
  const ctx = getContext(), m = ctx.chat[mesId];
  if (isGenerating() || ctx.swipe.state() !== 'none') return 'defer';
  if (!m || mesId !== ctx.chat.length - 1 || m.is_user || m.is_system) return 'stale';
  if (!Array.isArray(m.swipes)) {
    m.swipe_id = 0; m.swipes = [m.mes];
    m.swipe_info = [{ send_date: m.send_date, gen_started: m.gen_started, gen_finished: m.gen_finished, extra: structuredClone(m.extra) }];
  } else { ensureSwipes(m); }
  m.swipes.push(text);
  m.swipe_info.push({ send_date: new Date().toISOString(), gen_started: meta.started, gen_finished: new Date(),
                      extra: { api: getGeneratingApi(), model: getGeneratingModel(), reasoning: meta.reasoning ?? '',
                               reasoning_duration: null, reasoning_signature: meta.signature ?? null } });
  ctx.chatMetadata.tainted = true;
  await updateSwipeCounter(mesId, { message: m });
  ctx.swipe.refresh();
  await ctx.saveChat();                    // = saveChatConditional
  return 'ok';                             // swipe_id untouched
}
```
**Critical constraints (not discretionary — GUARD-04/SWIPE-01/03):**
- The two `.push()` calls (`swipes`, `swipe_info`) must be a single synchronous block with **no `await` between them** (`ARCHITECTURE.md` §1.5, "It never touches `swipe_id`. Our appender should be a superset of this" — referring to native `/addswipe`'s `addSwipeCallback`).
- Idle-gate check (`!isGenerating() && ctx.swipe.state() === 'none'`) must happen immediately before the push, re-checked after any `await` (the append race, §1.3).
- Never mutate `swipe_id`.
- Refresh sequence is exactly `updateSwipeCounter(mesId, {message}) ` then `ctx.swipe.refresh()` — not `addOneMessage`/`updateMessageBlock` (§1.6: "do not use, because it would also show text from the current swipe_id ... and fires render side effects with no benefit").

---

### `src/fingerprint.js` (utility, pure)

**Analog:** `ARCHITECTURE.md` §3.3 fingerprint definition + RESEARCH.md "Fingerprint shape" code example (no real file):

```javascript
function buildFingerprint(ctx, mesId) {
  const m = ctx.chat[mesId];
  return {
    chatId: ctx.chatId ?? null,
    integrity: ctx.chatMetadata?.integrity ?? null,
    mesId,
    chatLength: ctx.chat.length,
    swipe0Hash: hash(m.swipes?.[0] ?? m.mes),   // cheap hash, not cryptographic
    name: m.name,
  };
}
```
**Apply:** Pure function, no bridge/DOM access beyond the `ctx` object passed in — this is exactly what makes it Vitest-unit-testable per D-10. The spike's own `hash()` helper (lines 99-103, a simple djb2-variant) is a reasonable "cheap hash" implementation to reuse for `swipe0Hash`:
```javascript
function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16) + ':' + str.length;
}
```
Open Question #3 in RESEARCH.md flags that `chatId`/`getCurrentChatId()` exposure on `getContext()` needs a quick live check during the bridge build step — resolve there before finalizing this field.

---

### `src/runner.js` (service, state machine)

**Analog:** RESEARCH.md Pattern 1 code sketch (`runNextItem`, sourced from `ARCHITECTURE.md` §1.3/§2.2/§5 and `spike/index.js capture()` pattern) — no real file in repo:

```javascript
async function runNextItem(store, bridge, adapter, appender) {
  if (bridge.isGenerating() || bridge.swipeState() !== 'none') return;
  const item = store.peekNext();
  if (!item) return;
  const target = store.resolveFingerprint(item);
  if (!bridge.fingerprintMatches(target)) { store.drop(item, 'stale'); return; }
  const captured = await adapter.capture();
  const result = await adapter.send(captured, item.signal);
  const cleaned = adapter.cleanAndExtract(result);
  while (bridge.isGenerating() || bridge.swipeState() !== 'none') {
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!bridge.fingerprintMatches(target)) { store.drop(item, 'stale'); return; }
  await appender.append(target.mesId, cleaned.text, cleaned.meta);
  store.markDone(item);
}
```
**Apply:** This is the core QUEUE-02 enabler — enqueue (`store.add`) is independent of this loop (RESEARCH.md Open Question #2: "no architecture change needed, just confirmation this holds under the hard max=20 cap check at enqueue time"). Count `pending + running` against `maxQueueSize` at the enqueue gate, matching D-04/D-06/UI-SPEC's live-numbers tooltip. One in-flight item only (`ARCHITECTURE.md` §3.2 Runner row: "Must not ... run two items concurrently"). This module is the primary Vitest target (D-10) — design it to take `bridge`/`adapter`/`appender` as injected parameters (as shown) so a fake bridge can drive it in tests, per STACK.md's `createQueue({ ctx })`-style injection recommendation.

---

### `src/guard.js` (event policy)

**Analog (listener lifecycle):** `spike/index.js` `startEventLog()` (lines 164-187) — subscribe/track/unsubscribe shape:
```javascript
function startEventLog() {
  const handlers = [];
  for (const key of LOG_EVENTS) {
    const evt = event_types[key];
    if (!evt) continue;
    const h = (...args) => { /* ... */ };
    eventSource.on(evt, h);
    handlers.push([evt, h]);
  }
  return { stop() { for (const [evt, h] of handlers) eventSource.removeListener(evt, h); } };
}
```
**Analog (policy):** `ARCHITECTURE.md` §3.4 Event Guard policy table — this is the authoritative behavior spec for Phase 2's guard subset (full table reproduced in RESEARCH.md "Open Questions"/"Architecture" context; key rows for this phase):

| Event | Action |
|-------|--------|
| `CHAT_CHANGED (chatId)` | Abort in-flight, drop parked result, `Store.loadFromMetadata()` in `awaiting-resume` state, no auto-run |
| `MESSAGE_SENT (id)` | Clear queue + toast |
| `MESSAGE_DELETED (newLength)` | Payload is new length, not an id — re-validate fingerprint |
| `MESSAGE_EDITED (id)` | If `id === target.mesId`, clear + toast |
| `MESSAGE_UPDATED (id)` | Do **not** clear on its own — fires on edit-cancel too |
| `GENERATION_STARTED (type, params, dryRun)` with `dryRun === false` | Runner enters `paused-by-native` |
| `GENERATION_ENDED` / `GENERATION_STOPPED` | Wake Runner to re-check idle (plus poll backup) |

**Apply:** Guard never holds queue state of its own (`ARCHITECTURE.md` §3.2) — it only translates events into Store/Runner method calls. Event handlers must never `await` a `Generate` call inline — schedule via microtask/`setTimeout(0)` (Pitfall: event re-entrancy, RESEARCH.md "Common Pitfalls" #6).

---

### `src/ui.js` (component, DOM)

**No code analog in repo or spike** (spike has zero DOM injection — it's a console-driven `window.qsSpike` API only). Pattern source is `02-UI-SPEC.md` (binding) + RESEARCH.md integration points:

- **DOM injection point:** `.last_mes` message block, control placed after `.swipe_right` / the `.swipes-counter` element (D-02, UI-SPEC "Placement").
- **Visibility gate (QUEUE-08):** reuse `getContext().swipe.isAllowed()` / bridge-exposed `isSwipingAllowed()` as the single `canQueue()` gate — do not re-derive group-chat/swipeable-message logic (UI-SPEC "Visibility gate" is explicit: "not independently re-derived here").
- **Tooltip:** native `title` attribute, not a custom tooltip lib (UI-SPEC Typography: "ST's own message buttons use `title`").
- **Icon:** `fa-clock` (fallback `fa-layer-group`), Font Awesome Free `fa-solid`, already bundled — do not ship a copy.
- **Disabled state:** `opacity: 0.5; cursor: not-allowed;` plus `title="Queue full (N/N)"` with live numbers (UI-SPEC Interaction Contract table) — confirm the *exact* opacity/size against the live ST instance per D-11 before finalizing `style.css`, rather than guessing a CSS variable name (UI-SPEC explicitly flags this as unverified without a live check).
- **Badge:** plain integer, `fa-spinner fa-spin` prefix when an item is actively running, hidden entirely (not `0`) when empty (UI-01, D-07, D-06).
- **Toast on failure (GUARD-05):** `toastr.warning(msg, undefined, { preventDuplicates: true })`, exactly 3 locked message variants (D-08/D-09, UI-SPEC Copywriting Contract): `Queued swipe failed: API error` / `...: empty reply` / `...: cancelled` — never raw backend text (Security Domain V5 in RESEARCH.md: never `.html()` model/backend text, always `textContent`/toastr default escaping).

---

### `test/*.test.js` (Vitest, D-10)

**No analog** — greenfield. Fallback pattern from project `CLAUDE.md`/STACK.md "Testing" section (already in scope, quoted verbatim since it is the only testing convention this project has written down):

```javascript
// Inject a fake ctx, do not import real ST code in unit tests:
const fakeCtx = {
  chat: [],
  eventSource: /* EventTarget-like emitter */,
  eventTypes,
  swipe: { state: () => 'none', isAllowed: () => true, refresh: () => {} },
  saveChat: vi.fn(),
};
```
Apply this shape to `store.test.js`, `fingerprint.test.js`, and `runner.test.js` per D-10 — `store`/`fingerprint`/`runner` must be written to accept an injected bridge/context object (see `src/runner.js` sketch above) specifically so this fake works. `adapter.js`/`appender.js` are explicitly **not** unit-tested this phase (D-11: manual smoke test via `claude-in-chrome` MCP against the local ST install, or human-driven fallback if the MCP tool is unavailable).

## Shared Patterns

### Idle-gated single flight + park-then-flush
**Source:** `ARCHITECTURE.md` §1.3, §5 Pattern 1; `spike/index.js` `capture()` lines 191-227 (idle check at function entry)
**Apply to:** `runner.js` (every transition), `appender.js` (every append call), `adapter.js` (capture entry)
```javascript
if (bridge.isGenerating() || bridge.swipeState() !== 'none') return; // or throw/park, per call site
```

### Fresh `getContext()` per access
**Source:** `ARCHITECTURE.md` §1.7, §5 Pattern 2
**Apply to:** `st-bridge.js`, `store.js`, `fingerprint.js`, `guard.js` — never hold `chatMetadata`/`chat` length/`streamingProcessor` across an `await`.

### Fail-soft per item + toast taxonomy
**Source:** D-08/D-09 (CONTEXT.md), `ARCHITECTURE.md` §5 ("adapter returns a result or a typed error; runner drops the item, toasts non-modally, continues")
**Apply to:** `adapter.js` (typed error returns, never throw raw backend text upward), `runner.js` (drop + continue), `ui.js` (toast rendering, exactly 3 copy variants).

### Fingerprint re-validation at two points (GUARD-04)
**Source:** `ARCHITECTURE.md` §3.3, §3.4 "Append-time re-validation"
**Apply to:** `runner.js` (before capture) and `appender.js` (before append, again) — "never trust the event stream alone as the sole gate."

### Manifest + bridge import conventions
**Source:** `spike/manifest.json`, `spike/st-imports.js`
**Apply to:** `manifest.json`, `src/st-bridge.js` — exact schema and exact resolved relative-import paths (adjusted one level deeper for `src/`).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `style.css` | config | — | No CSS exists anywhere in the repo; `02-UI-SPEC.md` explicitly defers exact values (icon size, disabled opacity) to a live D-11 smoke-test check rather than a guessed value — do not hardcode from memory |
| `src/store.js` | store/model | CRUD | No real queue-store implementation exists yet; built strictly from `ARCHITECTURE.md` §3.2/§3.5 (persistence schema, responsibilities), which is source-verified pseudocode, not a sketch guess |
| `test/*.test.js` | test | — | `vitest` is a brand-new devDependency (not yet installed); no existing test file/convention in this repo to copy from — use the fake-bridge injection shape from `CLAUDE.md`/STACK.md Testing section |
| `package.json` | config | — | Does not exist yet at repo root; needed to add `vitest` (`^5.0.5` per RESEARCH.md, not the stale `^3` figure); no in-repo precedent — follow STACK.md's dev-tooling table verbatim |

## Metadata

**Analog search scope:** repo root (`spike/`, `.planning/research/`, `.planning/phases/01-route-verification-spike/`, `.planning/phases/02-single-queued-swipe-end-to-end/`) — confirmed via `find`/`git status` that no other source directories exist.
**Files scanned:** `spike/index.js`, `spike/st-imports.js`, `spike/manifest.json`, `.planning/research/ARCHITECTURE.md` (full, 460 lines), `02-CONTEXT.md`, `02-RESEARCH.md`, `02-UI-SPEC.md`.
**Pattern extraction date:** 2026-10-25

## Conventions

Derived via the shared `gsd-tools.cjs verify conventions --derive` module, scoped to the full repo (the only source present is `spike/`, 5 files: `index.js`, `manifest.json`, `st-imports.js`, `tools/check-exports.mjs`, `tools/diff-captures.mjs`).

| Axis | Dominant | Share | Entropy | Status |
|------|----------|-------|---------|--------|
| File-name casing | — (camel:1, kebab:3) | — | — | insufficient-data (total=4, below reliable sample size) |
| Identifier casing | camel | 100% | 0 | **named contract** (total=23, share ≥70%) |
| Export style | esm (total=1) | — | — | insufficient-data |
| Import style | esm (total=3) | — | — | insufficient-data |

**Contested hotspots (author's choice):** None detected as contested this phase — the sample is too small (`spike/` only, 5 files) for any axis except identifier-casing to clear the derivation tool's reliability threshold; most axes report `insufficient-data` rather than a contested split. The one clear signal is **100% camelCase identifiers** (`captureSwipePrompt`, `ownController`, `mesId`, etc.) — new `src/*.js` files should follow this with no exception. File-name casing is genuinely mixed in the tiny existing sample (`index.js` vs. `st-imports.js`/`check-exports.mjs`/`diff-captures.mjs`), so there is no repo-wide mandate either way yet; `ARCHITECTURE.md` §4's own recommended tree (`st-bridge.js`, `fingerprint.js`, `appender.js`) is already kebab-case and should simply be followed as the de facto standard going forward, since it is the only concrete file-naming precedent this phase's planner has to work from. (This project has no CJS/ESM dual-resolver split like the generic GSD-tooling prototype case — it is 100% ES modules throughout, per CLAUDE.md's "Vanilla ES modules" lock — so there is no intentional-contested-split precedent to defer to here; the insufficient-data axes are a sample-size artifact of a pre-implementation repo, not an intentional author split.)
