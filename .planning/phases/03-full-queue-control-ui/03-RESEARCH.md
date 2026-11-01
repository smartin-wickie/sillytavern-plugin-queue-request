# Phase 3: Full Queue Control & UI - Research

**Researched:** 2026-10-26
**Domain:** SillyTavern (ST) UI extension — browser-only front-end surfaces (dropdown, wand menu, slash commands, progress bar, settings drawer) wired onto an existing Phase 2 queue/runner/adapter pipeline
**Confidence:** HIGH for ST API surface and locked decisions (source-verified in Phase 1/2 research, re-confirmed this session); MEDIUM for exact wand-menu/progress-bar DOM markup (verified against a third-party competitor's source, not ST core docs — flag for live verification, same discipline the UI-SPEC already requires for colors)

## Summary

Phase 3 adds five new user-facing surfaces (cancel dropdown, wand-menu entries, three slash commands, a top-of-chat progress bar, a settings drawer panel) on top of the Phase 2 pipeline (`store.js`, `runner.js`, `adapter.js`, `ui.js`) without changing the generation route or the append mechanism. Nearly every new surface is a thin caller into existing Phase 2 primitives (`store.add`, `store.drop`, `runner.wake`) — the one genuine new capability this phase must build at the data layer is **cancelling the currently-running item**, and that requires a small, well-scoped refactor: the per-item `AbortController` that `index.js`'s `generate()` closure currently creates and keeps private must move to `runner.js` (where `ARCHITECTURE.md`'s original component table already said it belonged), so the runner can expose an `abortRunning()` call that the badge dropdown, the wand menu's "Cancel all queued", and `/queuecancel` can all reach. Everything else — per-item pending cancel, cancel-all's pending half, `/queueswipe`/`/queuestatus` feedback, the settings panel's live-read fields — reuses `store.drop(id, 'cancelled')` and `store.getMaxQueueSize()`-style live reads with no new store API required, contrary to one note in CONTEXT.md's Integration Points section (see Assumptions Log).

The toast model changes from "one `toastr.warning` per failed item" (Phase 2) to "one coalesced summary toast per queue run" (UI-03) — this means `ui.js`'s existing `runner.onItemFailed(...)` handler must be replaced, not just extended, by a run-boundary accumulator. Settings, slash commands, and the wand menu are all well-documented ST conventions (`SlashCommandParser.addCommandObject`, `renderExtensionTemplateAsync` + `inline-drawer` markup, both confirmed against official ST docs this session) with no viable alternative worth considering — this report is prescriptive, not exploratory, per CONTEXT.md's locked decisions.

**Primary recommendation:** Refactor AbortController ownership from `index.js`'s `generate()` into `runner.js` first (it is the one piece every cancel surface in this phase depends on); everything else is additive new files/functions calling existing `store`/`runner` methods.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cancel dropdown (D-01–D-04) | Browser/Client | — | Pure DOM UI anchored to the existing badge; mutates only the in-memory `store` |
| Wand menu entries (QUEUE-05) | Browser/Client | — | Appends into ST's own client-side `#extensionsMenu` DOM; no network call |
| Slash commands `/queueswipe` `/queuecancel` `/queuestatus` (QUEUE-03/04) | Browser/Client | — | Registered through ST's client-side `SlashCommandParser`; callback runs entirely in-browser against `store`/`runner` |
| Progress bar (UI-02) | Browser/Client | — | DOM element injected at top of chat; numerator/denominator come from the in-memory store/runner, never a server call |
| Toast coalescing (UI-03) | Browser/Client | — | `toastr` is a client-only notification library; the accumulator lives in a closure inside `ui.js` |
| Settings panel (SET-01) | Browser/Client | ST core backend (persistence) | Panel markup/logic is pure client; `saveSettingsDebounced()` eventually POSTs to ST's own settings-save endpoint, which this extension never calls directly (locked decision: ST save functions only) |
| Cancel-running wiring (abortRunning) | Browser/Client | — | The `AbortController` and its `signal` live in the browser tab; aborting it only cancels the extension's own `fetch`/`sendOpenAIRequest` call, never ST's global `stopGeneration()` (Phase 1 spike policy) |

This project has no server/API tier, no CDN tier, and no separate database tier — it is a single-tier browser extension that talks to ST's existing client runtime (`getContext()`) and, indirectly, ST's own backend via ST's own save functions. Every Phase 3 capability stays in the Browser/Client tier; nothing in this phase should touch `script.js`/ST backend endpoints directly (that would violate the CLAUDE.md "no secrets stored... reuse ST backend proxy" and "only ST public surface" constraints).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Cancel UI surface (QUEUE-06, QUEUE-07)**
- **D-01:** Clicking the existing badge (`.qs-queue-badge` in `src/ui.js`) opens a dropdown anchored to it — not a modal popup. Shows each pending item with a per-item cancel (×), plus "Cancel running" and "Cancel all" buttons in one surface.
- **D-02:** Cancel running item: call `adapter.js`'s existing `abortOwn(ownController)` (already spike-verified, never touches ST's global `stopGeneration()`), drop the item with reason `'cancelled'` (reuses the existing `FAILURE_MESSAGES.cancelled` toast string), runner immediately advances to the next pending item.
- **D-03:** "Cancel all" scope = pending + running. Drops every queued item via a new store removal path and aborts the running item via the same `abortOwn()` call as D-02.
- **D-04:** Per-item pending cancel (inside the dropdown list) drops just that one queued item — does not touch the running item or other pending items.

**Wand menu (QUEUE-05)**
- **D-05:** Two entries: "Queue swipe" (same `store.add()` + `runner.wake()` call as clicking the control) and "Cancel all queued" (same action as the badge dropdown's "Cancel all" button, D-03). No separate "cancel running only" entry in the wand menu.

**Slash commands (QUEUE-03, QUEUE-04)**
- **D-06:** `/queueswipe [count]` — count defaults to **1** when omitted (same effect as one control click). When clamped to remaining capacity, feedback is `toastr.info`/`toastr.warning` only — **no chat-visible system message** (user explicitly chose this over echoing to chat).
- **D-07:** `/queuecancel` — no confirmation popup. Clears immediately (same pending+running scope as D-03) and reports the cancelled count via toast/command return value, matching slash-command scripting conventions (synchronous, no blocking dialog).
- **D-08:** `/queuestatus` — one-line summary format: `"Queue: 1 running, 3 pending (5 max)."` No per-item detail line.

**Settings panel (SET-01)**
- **D-09:** Notification style is a single setting controlling verbosity across both failure toasts (GUARD-05) and completion/coalesced toasts (UI-03) — not independent per-event-type toggles. Values: e.g. "All" / "Errors only" / "Off".
- **D-10:** Circuit-breaker threshold ships as a plain number input (range 1–10, suggested default 3) in this phase's settings panel, saved to `extension_settings[MODULE_NAME]` via the existing SET-02 merge-by-key pattern. It is stored only — no enforcement runs until Phase 4's GUARD-06 reads the same setting key.
- **D-11:** Max queue setting is a plain number input, 1–20, client-side clamped to `store.js`'s `HARD_MAX_QUEUE` (20) before saving — not a dropdown of presets.
- **D-12:** All settings panel values take effect live, with no reload or chat-switch required — store/runner/UI re-read `extension_settings[MODULE_NAME]` on every relevant check, following the same live-read pattern `store.getMaxQueueSize()` already uses.

### Claude's Discretion
- Progress bar (UI-02) and toast coalescing (UI-03) visual/implementation design — not discussed this session; follow the roadmap's stated acceptance criteria and existing badge/toast patterns in `src/ui.js`.
- Exact dropdown CSS/positioning for the cancel UI (D-01).
- Auto-jump setting's exact wording/values in the settings panel.
- Enable/disable toggle wording and placement within the settings panel.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope. UI-02 and UI-03 are in-scope per the roadmap but were not selected for discussion; they are Claude's-discretion work, not deferred.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| QUEUE-03 | `/queueswipe [count]` clamps to remaining capacity, feedback shown | `SlashCommandParser.addCommandObject` pattern (Code Examples); existing `store.add()`/`getMaxQueueSize()` clamp math already proven in `ui.js`'s `onControlClick` |
| QUEUE-04 | `/queuecancel` (all) and `/queuestatus` (summary) | Reuses the same cancel-all code path as D-03/wand-menu; `store.pendingCount()`/`runningCount()`/`getMaxQueueSize()` already expose everything `/queuestatus` needs |
| QUEUE-05 | Queue or cancel from the wand menu | `#extensionsMenu` append pattern (MEDIUM confidence, verify live) — see Code Examples and Open Questions |
| QUEUE-06 | Cancel running item or all items from the badge | Requires the AbortController-ownership refactor (Architecture Patterns, Code Examples) — the one real new capability this phase adds |
| QUEUE-07 | Per-item list, cancel individual pending items | `store.drop(id, 'cancelled')` already exported and sufficient; no new store method needed (Assumptions Log) |
| UI-02 | Progress bar with stop control | Competitor precedent (SwipePregen) verified for placement/markup pattern; stop = same action as Cancel all (D-03) |
| UI-03 | Coalesced completion/error toasts | Requires replacing `ui.js`'s existing per-item `onItemFailed` toast handler with a run-boundary accumulator (Common Pitfalls, Code Examples) |
| SET-01 | Settings panel: enable, max queue, auto-jump, notification style, circuit-breaker | `renderExtensionTemplateAsync` + `inline-drawer` markup confirmed against official ST docs this session (Code Examples) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- UI extension only, no server plugin (v1) — nothing in this phase may require a new server endpoint.
- Never start a non-dry `Generate`; never fire concurrent `Generate('swipe')` — unaffected by this phase (no new generation calls), but **cancel must never call ST's global `stopGeneration()`** (Phase 1 spike policy, reaffirmed by D-02/D-03).
- Append on completion only; never pre-reserve empty swipe slots — unaffected by this phase.
- Persist only via ST save functions (`saveChatConditional()`, `saveSettingsDebounced()`); never write files directly. The new settings fields (D-09–D-11) must go through `saveSettingsDebounced()`, same as SET-02.
- Settings in `extension_settings[MODULE_NAME]`; ST APIs via `getContext()`, `eventSource`, `event_types`. No new API surface is needed outside what `getContext()` already exposes plus `SlashCommandParser`/`SlashCommand` (also on context, confirmed below).
- Must coexist with Deep-Swipe, UserSwipes, Prompt Inspector — this phase's new CSS classes must follow the existing `qs-` prefix convention (PITFALLS.md #30) to avoid colliding with those extensions' DOM.
- `minimum_client_version` 1.19.0 already set in `manifest.json` — no change needed unless a Phase 3 API (e.g. wand-menu structure) is found to require a newer version during live verification.

## Standard Stack

### Core (runtime — no new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|---------------|
| `SillyTavern.getContext()` globals | ST 1.19.0+ | `SlashCommandParser`, `SlashCommand`, `SlashCommandArgument`, `ARGUMENT_TYPE`, `renderExtensionTemplateAsync`, `extensionSettings`, `saveSettingsDebounced` | [CITED: docs.sillytavern.app/for-contributors/writing-extensions] — all confirmed present on context in this session's doc fetch; same source Phase 1/2 already used |
| jQuery (`$`) / `toastr` | bundled, page globals | DOM injection for dropdown/wand-entry/progress-bar; toast feedback | [CITED: STACK.md] already locked in Phase 1/2; "do not ship own copies" rule unchanged |
| Font Awesome (`fa-solid`) | bundled | `fa-xmark` (cancel), `fa-stop` (progress-bar stop) — already specified in `03-UI-SPEC.md` | [CITED: 03-UI-SPEC.md Design System] |

No new npm packages are required for this phase. `vitest@^5.0.5` is already installed (`package.json`) and sufficient for the new pure-logic unit tests this phase needs (runner abort wiring, toast-coalescing accumulator logic extracted into a testable function).

### Supporting (ST APIs new to this phase, all via `getContext()`)

| API | Purpose | When to Use |
|-----|---------|-------------|
| `SlashCommandParser.addCommandObject(SlashCommand.fromProps({...}))` | Register `/queueswipe`, `/queuecancel`, `/queuestatus` | [VERIFIED: docs.sillytavern.app] HIGH — official docs example fetched this session matches `STACK.md`'s prior citation from `connection-manager/index.js` |
| `SlashCommandArgument.fromProps({ typeList: [ARGUMENT_TYPE.NUMBER], defaultValue: '1', isRequired: false })` | Parse `/queueswipe [count]`'s optional numeric argument | [CITED: STACK.md] — avoids hand-rolling text parsing of the raw command string |
| `renderExtensionTemplateAsync('third-party/<folder>', 'settings', data)` | Load `settings.html` into the Extensions drawer | [VERIFIED: docs.sillytavern.app] HIGH — official docs example fetched this session; exact function signature confirmed |
| `#extensions_settings2` + `inline-drawer`/`inline-drawer-toggle`/`inline-drawer-header`/`inline-drawer-content` CSS classes | Settings panel markup | [VERIFIED: docs.sillytavern.app] HIGH — exact markup quoted in Code Examples below |
| `#extensionsMenu` (wand menu) jQuery append | Wand-menu entries (QUEUE-05) | [ASSUMED] MEDIUM — confirmed only against a third-party competitor's source (SwipePregen), not ST core docs or source this session; **verify live before finalizing** (see Open Questions) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `store.drop(id, 'cancelled')` for per-item/bulk cancel | A new dedicated `store.remove(id)` / `store.cancelAll()` API (as CONTEXT.md's Integration Points note suggests) | `drop()` already achieves the correct observable behavior (item excluded from `pendingCount()`/`runningCount()`) with zero new code and is the exact mechanism D-02 names explicitly ("drop the item with reason 'cancelled'"). A new method would be redundant unless the team later wants array-level removal (e.g. for a bounded items list) — not needed for Phase 3's success criteria. See Assumptions Log A2. |
| Runner-owned `AbortController` | Keep the controller inside `index.js`'s `generate()` closure and have cancel calls go through a callback injected at construction time | Keeping it in `index.js` means `runner.js` has no handle to abort, so QUEUE-06/07's "cancel running" cannot be implemented without *some* refactor; moving ownership to `runner.js` matches `ARCHITECTURE.md`'s original component table ("Runner / Scheduler owns... per-item AbortController") and is the smaller, more conventional change. |
| `toastr` for coalesced summaries | `callGenericPopup`/`Popup` for a non-blocking summary | `toastr` is already the project's locked notification primitive (STACK.md, Phase 2); a popup would be modal-adjacent and contradicts D-07's "no confirmation popup, treat cancel as low-stakes" philosophy carried into UI-03's toast design. |

**Installation:** None — no `npm install` needed for this phase.

## Package Legitimacy Audit

Not applicable. This phase introduces zero new npm packages. All five new surfaces (dropdown, wand menu, slash commands, progress bar, settings panel) are built exclusively from SillyTavern's already-bundled runtime (`jQuery`, `toastr`, `SlashCommandParser`, Font Awesome) accessed through `SillyTavern.getContext()`, which Phase 1/2 already locked in as the project's only allowed API surface. `vitest@^5.0.5` (already installed) is reused for new unit tests; no version bump is required by anything in this phase's scope.

## Architecture Patterns

### System Architecture Diagram

```
                     ┌─────────────────────────── Browser/Client (this extension) ───────────────────────────┐
                     │                                                                                        │
  User click ───────►│  Badge (.qs-queue-badge)                                                               │
  (existing, P2)     │        │ click                                                                        │
                     │        ▼                                                                               │
                     │  Cancel Dropdown (NEW D-01)──────┐                                                     │
                     │   ├─ per-item ×  (D-04) ──────┐  │                                                     │
                     │   ├─ Cancel running (D-02) ─┐ │  │                                                     │
                     │   └─ Cancel all (D-03) ───┐ │ │  │                                                     │
                     │                            │ │ │  │                                                    │
  User click ───────►│  Wand menu entries (NEW QUEUE-05)                                                       │
  (#extensionsMenu)  │   ├─ "Queue swipe" ────────────────────────────┐                                       │
                     │   └─ "Cancel all queued" ─┐                    │                                       │
                     │                            │                    │                                       │
  /queueswipe N  ────┤  Slash commands (NEW QUEUE-03/04)               │                                       │
  /queuecancel   ────┤   ├─ enqueue(N) ───────────────────────────────┤                                       │
  /queuestatus   ────┤   ├─ cancelAll() ─┐                            │                                       │
                     │   └─ statusText() ─────────► (reads only) ─────┼───────────────┐                       │
                     │                    │                            │               │                       │
                     │                    ▼                            ▼               │                       │
                     │         ┌──────────────────────┐    ┌──────────────────────┐    │                       │
                     │         │   Queue Store (P2)   │◄───┤  runner.wake()       │    │                       │
                     │         │ add/drop/getItems/    │    │  runner.abortRunning()│   │                       │
                     │         │ pendingCount/running  │    │  (NEW this phase)     │   │                       │
                     │         └──────────┬───────────┘    └──────────┬────────────┘    │                       │
                     │                    │ onChange                  │ onItemFailed     │                       │
                     │                    ▼                            ▼                 │                       │
                     │         ┌──────────────────────────────────────────────┐          │                       │
                     │         │   UI render layer (ui.js, extended)          │◄─────────┘                       │
                     │         │  - renderBadge/renderDisabledState (P2)      │                                  │
                     │         │  - renderDropdown (NEW)                      │                                  │
                     │         │  - renderProgressBar (NEW UI-02)             │                                  │
                     │         │  - toast coalescing accumulator (NEW UI-03) │                                  │
                     │         └──────────────────────────────────────────────┘                                  │
                     │                                                                                            │
                     │         ┌──────────────────────────────────────────────┐                                  │
                     │         │   Settings panel (settings.js + settings.html, NEW SET-01)                      │
                     │         │   reads/writes extension_settings[MODULE_NAME] live (D-12)                      │
                     │         └──────────────────────────────────────────────┘                                  │
                     │                                                                                            │
                     │  Runner (processNext loop, P2 + abort wiring NEW) ──► Adapter (capture/send/clean, P2,     │
                     │                                                        unchanged) ──► Appender (P2,        │
                     │                                                        unchanged) ──► ST Bridge ──► ST     │
                     └────────────────────────────────────────────────────────────────────────────────────────────┘
```

The only new data-flow edge this phase adds at the *generation* layer is `runner.abortRunning() → adapter.abortOwn(controller)`. Everything above the Queue Store line is new UI wiring; everything below the Store/Runner line (capture → send → clean → append) is Phase 2 and is untouched by this phase.

### Recommended Project Structure (additions to Phase 2's layout)

```
src/
├── st-bridge.js        # unchanged
├── store.js            # unchanged API surface — drop() already sufficient (see Assumptions Log)
├── fingerprint.js       # unchanged
├── runner.js            # MODIFIED: owns the per-item AbortController, exposes abortRunning()
├── adapter.js            # unchanged — abortOwn(controller) already correct, just needs a caller
├── appender.js           # unchanged
├── ui.js                 # MODIFIED: cancel dropdown render/wire-up; REPLACE onItemFailed toast
│                          #           handler with the UI-03 run-boundary accumulator
├── commands.js            # NEW: /queueswipe, /queuecancel, /queuestatus registration
├── wand-menu.js            # NEW: two #extensionsMenu entries (or fold into ui.js — either is fine,
│                           #      a separate file keeps ui.js focused on the .last_mes control)
├── progress-bar.js          # NEW: top-of-chat progress bar (UI-02), subscribes to store.onChange
└── settings.js               # NEW: settings panel wiring (SET-01), reads/writes extension_settings live
settings.html                 # NEW: rendered via renderExtensionTemplateAsync into #extensions_settings2
index.js                      # MODIFIED: wire the four new modules; pass `{ signal }` into generate()
```

This mirrors `ARCHITECTURE.md` §4's original recommended structure (which already listed `commands.js` and `settings.js` as planned files not yet built in Phase 2).

### Pattern 1: Move AbortController ownership into the Runner (required refactor)

**What:** Today, `index.js`'s `generate()` closure creates its own `AbortController` per item and never exposes it. `runner.js`'s `processNext()` calls `await generate(item)` with no signal passed in. Nothing outside `index.js`'s closure can reach that controller, so `abortOwn()` (Phase 1-verified, in `adapter.js`) has no caller for "cancel running."

**When to use:** Before implementing any of QUEUE-06, QUEUE-07's running-item case, D-02, D-03, or the progress bar's stop control — all five converge on this one capability.

**Example:**
```javascript
// src/runner.js (processNext, modified)
let runningController = null;

async function processNext() {
  const item = store.peekNext();
  if (!item) return false;
  if (!fingerprintMatches(bridge, item.fingerprint)) { /* unchanged stale-drop path */ }

  store.markRunning(item.id);

  runningController = new AbortController();
  let result;
  try {
    result = await generate(item, { signal: runningController.signal });
  } catch (err) {
    /* unchanged error handling */
  } finally {
    runningController = null;
  }
  /* unchanged result handling below — send() already resolves {aborted:true} on AbortError
     rather than throwing, so generate() already returns {error:'cancelled'} for an aborted
     item with ZERO further changes needed in this function's error-handling branches */
}

// NEW exported function — the one new capability QUEUE-06/07 need
function abortRunning() {
  if (!runningController) return { aborted: false };
  return abortOwn(runningController); // from adapter.js, per D-02's explicit instruction
}

return { wake, pause, resume, onItemFailed, offItemFailed, abortRunning };
```
```javascript
// index.js (generate, modified — only the signature changes)
async function generate(item, { signal }) {
  const started = new Date();
  let sent;
  try {
    const captured = await capture({ signal });
    sent = await send(captured, signal);
  } catch (err) {
    return { error: 'api' };
  }
  /* rest unchanged */
}
```
Source: derived from reading `src/runner.js`, `src/adapter.js`, `index.js` directly (this session), and `ARCHITECTURE.md` §3.2's original component table ("Runner / Scheduler owns... per-item `AbortController`").

**Why this is safe and small:** `adapter.js`'s `send()` already treats an aborted signal as a normal, non-throwing outcome (`{ aborted: true, getMessage: '', reasoning: '' }`), and `generate()` already maps that to `{ error: 'cancelled' }`. `runner.js`'s existing `processNext()` error-handling branch (`store.drop(item.id, reason); notifyFailed(item.id, reason); return true;`) already runs unmodified for this case — the loop in `wake()` already advances to the next item afterward (`while (true) { ... const hadItem = await processNext(); if (!hadItem) return; }`). **No change to the loop or the error-handling branches is needed — only exposing the controller.**

### Pattern 2: Reuse `store.drop()` for every cancel surface — do not add new store methods

**What:** `store.drop(id, reason)` already sets `item.status = 'failed'`, which is exactly what `pendingCount()`/`runningCount()` need to exclude a cancelled item. D-02 explicitly instructs "drop the item with reason `'cancelled'`."

**When to use:** Per-item cancel (D-04): `store.drop(itemId, 'cancelled')`. Cancel-all's pending half (D-03): iterate `store.getItems().filter(i => i.status === 'queued').forEach(i => store.drop(i.id, 'cancelled'))`, then call `runner.abortRunning()` for the running half.

**Example:**
```javascript
// cancel-all, callable from the dropdown's "Cancel all" button, the wand menu's
// "Cancel all queued" entry, and /queuecancel — one function, three callers
function cancelAll(store, runner) {
  const pending = store.getItems().filter((i) => i.status === 'queued');
  for (const item of pending) store.drop(item.id, 'cancelled');
  const { aborted } = runner.abortRunning(); // no-op {aborted:false} if nothing running
  return pending.length + (aborted ? 1 : 0); // count for toast/command return value
}
```
Source: derived from reading `src/store.js` directly this session; `store.drop`/`store.getItems`/`store.pendingCount`/`store.runningCount` are already exported with no changes needed.

### Pattern 3: Toast-coalescing accumulator keyed to the "run boundary"

**What:** UI-03 requires exactly one summary toast per "run" (queue goes empty → non-empty → empty again), not one per item. `ui.js`'s current `runner.onItemFailed(...)` handler fires a toast per failure — this must be replaced, not extended.

**When to use:** Anywhere a completion or failure needs to surface to the user.

**Example:**
```javascript
// src/ui.js (replaces the current runner.onItemFailed(...) block)
function registerToastCoalescing(store, runner, getNotificationStyle) {
  let run = null; // null when idle; { completed:0, failures:Map<reason,count> } while a run is active

  function currentlyActive() {
    return store.pendingCount() + store.runningCount() > 0;
  }

  store.onChange(() => {
    const active = currentlyActive();
    if (active && !run) {
      run = { completed: 0, failures: new Map() }; // run started
    } else if (!active && run) {
      flush(run);
      run = null; // run drained — reset for next run
    }
  });

  runner.onItemFailed(({ reason }) => {
    if (!run) run = { completed: 0, failures: new Map() };
    run.failures.set(reason, (run.failures.get(reason) ?? 0) + 1);
  });
  // a "completed" counter needs a parallel success hook — see Open Questions:
  // runner.js currently has no onItemDone()/onItemSucceeded() callback; this phase
  // must add one (mirrors onItemFailed's existing shape) for the coalesced
  // success count and for the progress bar's numerator.

  function flush({ completed, failures }) {
    const style = getNotificationStyle(); // live read — D-09/D-12
    if (style === 'Off') return;
    if (failures.size === 0) {
      if (style === 'All') toastr.success(`${completed} queued swipe(s) completed.`);
      return;
    }
    const reasons = [...failures.keys()].map((r) => FAILURE_MESSAGES[r] ?? r).join(', ');
    toastr.warning(`${completed} completed, ${[...failures.values()].reduce((a, b) => a + b, 0)} failed (${reasons}).`);
  }
}
```
Source: derived from reading `src/ui.js`'s existing `FAILURE_MESSAGES`/`onItemFailed` wiring this session, plus the exact coalescing rule in `03-UI-SPEC.md`'s Interaction Contract section.

**Key new requirement surfaced by this pattern:** `runner.js` currently has `onItemFailed`/`offItemFailed` but no success-side callback. This phase must add a matching `onItemDone(cb)` (fired where `store.markDone(item.id)` currently runs, with no payload needed beyond the item id) so the coalescing accumulator and the progress-bar numerator both have a hook into successful completions, not just failures.

### Anti-Patterns to Avoid

- **Adding a confirmation popup anywhere in this phase's cancel surfaces** — D-07 explicitly rejects this for `/queuecancel`, and the UI-SPEC extends "no confirmation popup, anywhere" to every cancel surface (dropdown ×, Cancel running, Cancel all, wand menu, progress-bar stop). Do not reach for `callGenericPopup`/`Popup` for any of these.
- **Caching `extension_settings[MODULE_NAME]` at settings-panel-open time** — violates D-12's live-apply requirement and the project's established "fresh `getContext()` per access" rule (`ARCHITECTURE.md` §5). Every settings field must re-read the live object at the point of use, mirroring `store.js`'s existing `getMaxQueueSize()` pattern.
- **Firing a per-item toast for cancellation** — contradicts UI-03's coalescing requirement; a cancelled item's `'cancelled'` reason must flow into the same run-boundary accumulator as `'api'`/`'empty'` failures, never a standalone toast.
- **Calling ST's global `stopGeneration()` for any cancel action** — Phase 1 spike policy, reaffirmed by D-02/D-03: cancel always means "abort our own controller and discard app-side," never ST's global abort.
- **Polling/guessing `#extensionsMenu`'s exact markup from memory** — verify live against ST 1.19.0 before shipping the wand-menu CSS (same discipline the UI-SPEC already requires for `--SmartTheme*` color variables).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Slash-command argument parsing (`/queueswipe 3`) | A regex/`split(' ')` parser on the raw command string | `SlashCommandArgument.fromProps({ typeList: [ARGUMENT_TYPE.NUMBER], ... })` | ST's own parser already handles quoting, named vs. unnamed args, and type coercion; `connection-manager`'s bundled extension and the official docs both use this exact pattern |
| Settings drawer markup/collapse behavior | Custom `<details>`/toggle JS | `inline-drawer`/`inline-drawer-toggle`/`inline-drawer-header`/`inline-drawer-content` CSS classes, confirmed verbatim in official docs this session | ST's own CSS/JS already wires the collapse behavior for any element with these classes inside `#extensions_settings2`; a custom implementation would look inconsistent with every other extension's settings section |
| Toast de-duplication/queueing | A custom toast stack/throttle | `toastr`'s own `{ preventDuplicates: true }` option, already used in Phase 2's `ui.js` | Reinventing toast management duplicates a solved problem and risks visual inconsistency with every other extension's toasts |
| Dropdown positioning relative to the badge | A positioning/popover library | Plain CSS `position: absolute` anchored to the badge's parent, matching the UI-SPEC's "pixel-parity with the existing sibling ST element" rule | The dropdown has exactly one anchor point and one open/close state — a library adds a dependency for a problem four lines of CSS solve |
| "Which item is currently running, and how do I cancel just that one" | A second parallel tracking structure outside `store`/`runner` | `runner.abortRunning()` (new, backed by the single `runningController` variable already proposed in Pattern 1) + `store.getItems().find(i => i.status === 'running')` for display purposes | `store` is already the single source of truth for item status; a second tracking structure risks drifting out of sync with it |

**Key insight:** every "Don't Hand-Roll" item in this phase has a pre-existing ST idiom or a pre-existing Phase 2 primitive that already solves it — the work is wiring, not invention.

## Common Pitfalls

### Pitfall 1: Per-item cancel racing with the runner promoting that same item to "running"

**What goes wrong:** The dropdown renders a snapshot of `store.getItems()` filtered to `status === 'queued'`. If the user clicks a per-item `×` in the same tick the runner's `processNext()` calls `store.markRunning(item.id)` on that same item, `store.drop()` has no status guard — it unconditionally sets `status = 'failed'`. If `generate()` for that item later succeeds, `store.markDone(item.id)` (also no status guard) overwrites it back to `'done'`, and the append proceeds despite the user's cancel click.

**Why it happens:** `store.drop()`/`store.markDone()` were written in Phase 2 for a single linear runner loop where races like this were not yet a concern (no UI called `drop()` on an item the runner might concurrently touch).

**How to avoid:** Either (a) have the dropdown's per-item cancel re-check `item.status === 'queued'` immediately before calling `drop()` and silently no-op (with the dropdown's live re-render) if it has already flipped to `'running'` — the user can then use "Cancel running" instead — or (b) add a guard inside `store.drop()`/`store.markDone()` that only applies if the item's current status is still the expected one. Option (a) is less invasive and keeps `store.js`'s API surface unchanged, consistent with the "reuse drop()" recommendation above.

**Warning signs:** A swipe appears after the user explicitly clicked × on it in the dropdown.

### Pitfall 2: Toast-coalescing run boundary mis-detected when items are added mid-run

**What goes wrong:** If "run" is naively defined as "from the first `store.onChange` after empty to the next empty," then a user who clicks the control again while 1 item is still running (extending the queue, per QUEUE-02) does not start a *new* run — the existing run's accumulator must simply keep collecting, and the denominator (`completed + pending + running`, per the UI-SPEC's progress-bar copy rule) must grow live. An implementation that flushes and resets the accumulator every time `pendingCount()+runningCount()` transitions through any value (not just 0) would fire multiple small toasts instead of one coalesced one.

**Why it happens:** It is tempting to hook the accumulator to every `store.onChange` event rather than specifically to the 0→nonzero and nonzero→0 transitions.

**How to avoid:** Track `run` as a variable that is only created on a `0 → nonzero` transition and only flushed/cleared on a `nonzero → 0` transition (exactly as shown in Pattern 3's `currentlyActive()` check) — never recreate it while the count is merely changing between nonzero values.

**Warning signs:** More than one summary toast appears for what the user experienced as a single continuous queue run.

### Pitfall 3: Wand-menu/progress-bar DOM not yet present when `init()` runs

**What goes wrong:** `manifest.json`'s `hooks.activate: "init"` can run before `#extensionsMenu` or `#sheld`/`#chat` exist in the DOM, depending on extension load order (PITFALLS.md #22, already documented for Phase 2's badge control — this phase's two new DOM targets are a fresh instance of the same class of bug).

**Why it happens:** Extension activation and full page DOM construction are not strictly ordered relative to each other across all ST startup paths.

**How to avoid:** Register the wand-menu entry and the progress-bar container the same way Phase 2's `registerQueueControl` already does for the badge control — on `event_types.APP_READY` (and re-render on `CHAT_CHANGED`), not at top-level `init()` time. The wand menu, unlike the per-message badge, does not need to re-render on every message event — register it once on `APP_READY` and never remove it (it has no per-chat state).

**Warning signs:** Wand menu entries silently missing on a fresh page load but present after a chat switch.

### Pitfall 4: Slash-command scripting loops bypassing the queue cap

**What goes wrong:** `/queueswipe` run N times in a Quick Reply/STscript loop (e.g. `/times 10 {: /queueswipe :}`) could enqueue items unboundedly if the clamp is computed once per call against a stale snapshot rather than live against `store`'s current counts. (PITFALLS.md #27 flags this generally; it is directly relevant here since D-06 requires live clamping.)

**Why it happens:** A naive implementation might clamp against "max minus the count at command-registration time" rather than re-reading `store.pendingCount()+runningCount()` on every invocation.

**How to avoid:** The clamp math must be identical to `ui.js`'s existing `onControlClick` pattern — read `store.pendingCount() + store.runningCount()` and `store.getMaxQueueSize()` fresh inside the slash-command callback itself (which already runs once per invocation, so this is automatic as long as the callback does not cache anything from a previous call).

**Warning signs:** A scripted loop enqueues more items than the configured max.

### Pitfall 5 (from PITFALLS.md #26/#30, reaffirmed): Toast storms and CSS collisions

Per-item toasts for a multi-item queue are noise (already being fixed by UI-03) — ensure the *replacement* accumulator doesn't reintroduce the same problem via a bug (Pitfall 2 above). Every new CSS class/id this phase introduces (dropdown panel, wand-menu entry wrapper, progress-bar container) must use the `qs-` prefix already established in Phase 2's `style.css`, never reusing a native ST class name like `.swipe_right` or `.swipes-counter` (Deep-Swipe had to remove a conflicting class for exactly this reason — PITFALLS.md #30).

## Code Examples

### Slash command registration (QUEUE-03/04)

```javascript
// src/commands.js (new file)
export function registerCommands({ store, runner, cancelAll }) {
  const { SlashCommandParser, SlashCommand, SlashCommandArgument, ARGUMENT_TYPE } = SillyTavern.getContext();

  SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'queueswipe',
    helpString: 'Queue N additional swipes for the last AI message (default 1).',
    returns: 'number of swipes actually queued',
    unnamedArgumentList: [SlashCommandArgument.fromProps({
      description: 'count',
      typeList: [ARGUMENT_TYPE.NUMBER],
      defaultValue: '1',
      isRequired: false,
    })],
    callback: async (_namedArgs, unnamed) => {
      const requested = Number(unnamed) || 1;
      const max = store.getMaxQueueSize();
      const current = store.pendingCount() + store.runningCount();
      const room = Math.max(0, max - current);
      if (room === 0) {
        toastr.warning(`Queue is already full (${max} max).`);
        return '0';
      }
      const toAdd = Math.min(requested, room);
      const c = SillyTavern.getContext();
      const target = buildFingerprint(c, c.chat.length - 1);
      let added = 0;
      for (let i = 0; i < toAdd; i++) {
        const result = store.add(target);
        if (!result.ok) break;
        added++;
      }
      if (added > 0) runner.wake();
      if (added < requested) {
        toastr.warning(`Queue full — added ${added} of ${requested} requested.`);
      } else {
        toastr.info(`Queued ${added} swipe(s).`);
      }
      return String(added);
    },
  }));

  SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'queuecancel',
    helpString: 'Cancel all queued and the currently running swipe.',
    returns: 'number of items cancelled',
    callback: async () => {
      const n = cancelAll(store, runner);
      toastr.info(n > 0 ? `Cancelled ${n} queued swipe(s).` : 'Queue is already empty.');
      return String(n);
    },
  }));

  SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'queuestatus',
    helpString: 'Report pending/running queue counts.',
    returns: 'one-line status string',
    callback: async () => {
      const running = store.runningCount();
      const pending = store.pendingCount();
      const max = store.getMaxQueueSize();
      const text = running + pending === 0
        ? 'Queue: empty.'
        : `Queue: ${running} running, ${pending} pending (${max} max).`;
      toastr.info(text);
      return text;
    },
  }));
}
```
Source: [VERIFIED: docs.sillytavern.app/for-contributors/writing-extensions] for the `SlashCommandParser.addCommandObject`/`SlashCommand.fromProps`/`SlashCommandArgument.fromProps` shape (fetched this session); clamp math pattern from direct read of `src/ui.js`'s `onControlClick` this session; copy strings from `03-UI-SPEC.md`'s Copywriting Contract.

### Settings panel (SET-01)

```html
<!-- settings.html (new file, rendered via renderExtensionTemplateAsync) -->
<div class="qs-settings">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>Queued Swipes</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
      <label class="checkbox_label">
        <input id="qs_enabled" type="checkbox" />
        <span>Enable queued swipes</span>
      </label>
      <label for="qs_max_queue">Max queue size</label>
      <input id="qs_max_queue" type="number" min="1" max="20" />
      <label class="checkbox_label">
        <input id="qs_auto_jump" type="checkbox" />
        <span>Jump to newest swipe on completion</span>
      </label>
      <label for="qs_notification_style">Notification style</label>
      <select id="qs_notification_style">
        <option value="all">All</option>
        <option value="errors">Errors only</option>
        <option value="off">Off</option>
      </select>
      <label for="qs_circuit_breaker">Pause after N consecutive failures</label>
      <input id="qs_circuit_breaker" type="number" min="1" max="10" />
    </div>
  </div>
</div>
```
```javascript
// src/settings.js (new file)
const MODULE_NAME = 'queuedSwipes';

export async function registerSettingsPanel() {
  const { renderExtensionTemplateAsync, extensionSettings, saveSettingsDebounced } = SillyTavern.getContext();
  const html = await renderExtensionTemplateAsync('third-party/<folder-name>', 'settings', {});
  $('#extensions_settings2').append(html);

  // Live-read on every field change — D-12. Never cache extensionSettings[MODULE_NAME]
  // at panel-render time; always read the live object at the point of use.
  $('#qs_max_queue').on('input', function () {
    const raw = Number($(this).val());
    const clamped = Math.min(20, Math.max(1, Number.isFinite(raw) ? raw : 1));
    SillyTavern.getContext().extensionSettings[MODULE_NAME].maxQueueSize = clamped;
    saveSettingsDebounced();
  });
  // ...same live-read-then-write pattern for qs_enabled, qs_auto_jump,
  // qs_notification_style, qs_circuit_breaker — each handler re-reads
  // getContext().extensionSettings fresh, matching store.js's getMaxQueueSize() idiom.

  // Initialize control values FROM the live settings object on panel render (not from a
  // module-level cached copy), so re-opening the drawer always shows current state.
  const current = SillyTavern.getContext().extensionSettings[MODULE_NAME];
  $('#qs_max_queue').val(current.maxQueueSize ?? 5);
  $('#qs_enabled').prop('checked', current.enabled !== false);
  // ...
}
```
Source: [VERIFIED: docs.sillytavern.app/for-contributors/writing-extensions] for the `inline-drawer` markup and `renderExtensionTemplateAsync` call shape, both fetched verbatim this session; live-read discipline from `ARCHITECTURE.md` §5 and `src/store.js`'s existing `getMaxQueueSize()`.

**Note (added in revision 1, bm-plan-checker blocker fix):** This snippet shows the live *read*/write of `extension_settings[MODULE_NAME].maxQueueSize` — necessary but not sufficient for `maxQueueSize` specifically. `store.js`'s `effectiveCap()`/`getMaxQueueSize()` compute their result from a value captured once as a `createStore({ maxQueueSize })` constructor parameter, not from `extension_settings` directly, so writing the new value to `extension_settings` alone does not change what the already-constructed `store` instance enforces. `03-04-PLAN.md` closes this gap with a `store.setMaxQueueSize(n)` mutator that the `#qs_max_queue` handler calls immediately after the write shown above — see `03-04-PLAN.md` Task 1.

### Wand menu entries (QUEUE-05) — verify live before shipping

```javascript
// src/wand-menu.js (new file) — MEDIUM confidence, verify #extensionsMenu structure
// live against ST 1.19.0 before finalizing selectors/classes (see Open Questions)
import { eventSource, event_types } from './st-bridge.js';

export function registerWandMenu({ store, runner, cancelAll, canQueue }) {
  function render() {
    if ($('#qs-wand-entry').length) return; // idempotent across repeated APP_READY-adjacent calls
    const entry = $(`
      <div id="qs-wand-entry" class="extension_container">
        <div id="qs-wand-queue" class="list-group-item flex-container flexGap5 alignItemsCenter interactable" tabindex="0">
          <i class="fa-solid fa-clock"></i>
          <span>Queue swipe</span>
        </div>
        <div id="qs-wand-cancel" class="list-group-item flex-container flexGap5 alignItemsCenter interactable" tabindex="0">
          <i class="fa-solid fa-xmark"></i>
          <span>Cancel all queued</span>
        </div>
      </div>
    `);
    entry.find('#qs-wand-queue').on('click', () => {
      if (!canQueue()) return;
      const n = store.pendingCount() + store.runningCount();
      if (n >= store.getMaxQueueSize()) return;
      const c = SillyTavern.getContext();
      const result = store.add(buildFingerprint(c, c.chat.length - 1));
      if (result.ok) runner.wake();
    });
    entry.find('#qs-wand-cancel').on('click', () => cancelAll(store, runner));
    $('#extensionsMenu').append(entry);
  }
  eventSource.on(event_types.APP_READY, render);
}
```
Source: [ASSUMED] MEDIUM — `#extensionsMenu` selector and the `extension_container`/`list-group-item flex-container flexGap5 alignItemsCenter interactable` class convention confirmed only via a WebFetch of a third-party competitor extension's source this session (`Nicoolodion/SillyTavern-SwipePregen`), cross-referenced against `FEATURES.md`'s prior citation of the same pattern from SwipePregen and ParallelSwipes. **Not confirmed against official ST docs or ST core source this session** — flag for live verification (Open Questions).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | `#extensionsMenu` accepts a `.append()`'d `<div class="extension_container">` containing `.list-group-item.interactable` rows, and this renders/behaves correctly as wand-menu entries in ST 1.19.0 | Standard Stack (Supporting), Code Examples (Wand menu) | If the actual markup/classes differ, QUEUE-05's two entries render with wrong styling or don't appear/click correctly — cosmetic/interaction bug, not a data-safety risk. Verify live before finalizing CSS (same discipline the UI-SPEC already requires for colors). |
| A2 | `store.drop(id, 'cancelled')` is sufficient for all cancel surfaces (D-02/D-03/D-04) and no new store-level "remove" method is needed, despite CONTEXT.md's Integration Points note suggesting otherwise | Architecture Patterns (Pattern 2), Standard Stack (Alternatives Considered) | If the planner builds a new `store.remove()`/`cancelAll()` method anyway, it is extra unneeded surface, not a correctness bug — low risk either way, but worth flagging so the plan doesn't duplicate working Phase 2 code. |
| A3 | A `0 → nonzero → 0` transition of `store.pendingCount() + store.runningCount()` is the correct, sufficient definition of a toast-coalescing "run boundary" (UI-03) | Architecture Patterns (Pattern 3), Common Pitfalls (#2) | If wrong, toasts could fire more or less often than intended — a UX bug, not a data-safety bug. The UI-SPEC's Interaction Contract text ("bounded by the queue going empty, not by a fixed batch size") directly supports this definition, so confidence here is actually closer to CITED than ASSUMED. |
| A4 | `#sheld`/`#chat` (ST's chat container) is the correct insertion point for the progress bar, inserted via `.before()`/`.prepend()` the way SwipePregen does it | Architecture Patterns (Pattern diagram), UI-SPEC cross-reference | If wrong, the progress bar renders in the wrong location or breaks ST's own chat layout — verify live (Open Questions). |

## Open Questions (RESOLVED)

1. **Exact `#extensionsMenu` DOM structure/classes in the live ST 1.19.0 release this project targets** — (RESOLVED: `03-02-PLAN.md` Task 3 live-verification checkpoint, step 1 — "Open the wand/extensions menu... Confirm 'Queue swipe' and 'Cancel all queued' both appear, styled consistently... If the markup looks wrong, note the actual DOM structure ST renders so `src/wandMenu.js`'s selectors/classes can be corrected.")
   - What we know: A third-party competitor (SwipePregen) appends `<div class="extension_container"><div class="list-group-item flex-container flexGap5 alignItemsCenter interactable">...` into `#extensionsMenu`, with a polling fallback for when the menu doesn't exist yet. ST's official extension-writing docs do not mention wand-menu registration at all (confirmed this session).
   - What's unclear: Whether this is truly ST core's documented convention or an undocumented idiom several extensions happen to share; exact ARIA/keyboard-interaction expectations for `interactable` rows.
   - Recommendation: Treat the Code Examples wand-menu snippet as a strong starting point, but have the executing plan include a live smoke-test step (open the wand menu in a real ST 1.19.0 instance, confirm the new entries render and click correctly) before considering QUEUE-05 done — consistent with the UI-SPEC's own "verify live, never guess from memory" rule for colors.
   - Resolution mechanism: `03-02-PLAN.md`'s own Task 3 checkpoint carries out exactly this live smoke test, with an explicit fallback instruction to correct the selectors/classes if the live DOM differs, before QUEUE-05 is marked done.

2. **Progress bar insertion point and show/hide mechanics** — (RESOLVED: `03-03-PLAN.md` Task 3 live-verification checkpoint, steps 1 and 6 — confirms the bar renders without clipping/overlap and has the executor report back the actual `#sheld`/`#chat`-equivalent selector and accent variable found in DevTools, correcting `src/progressBar.js`/`style.css` if the placeholder assumption was wrong.)
   - What we know: SwipePregen inserts a `<progress>`-based bar either `.before()` the chat container or `.prepend()`-ed into `#sheld`; `FEATURES.md` independently corroborates "top-of-chat bar with stop" as the competitor convention.
   - What's unclear: The precise selector (`#sheld` vs `#chat` vs some wrapper) in the current ST 1.19.0 release, and whether any existing ST or other-extension CSS would conflict with a `position: sticky`/`position: absolute` top-of-chat element.
   - Recommendation: Same live-verification step as above; the UI-SPEC already anticipates this ("exact value confirmed during implementation against the live ST layout, not guessed from memory" — Spacing Scale exceptions).
   - Resolution mechanism: `03-03-PLAN.md`'s own Task 3 checkpoint carries out exactly this live verification, with an explicit instruction to report the real selector/variable so the placeholder can be corrected, before UI-02 is marked done.

3. **`runner.js` needs a success-side callback (`onItemDone`) that does not exist yet** — (RESOLVED: implemented in `03-01-PLAN.md` Task 1 — `onItemDone`/`offItemDone` added to `runner.js`'s returned object, mirroring `onItemFailed`/`offItemFailed` exactly, firing immediately after the existing `store.markDone(item.id)` call inside `processNext()`.)
   - What we know: `runner.js` currently exposes `onItemFailed`/`offItemFailed` but nothing fires on a successful `store.markDone(item.id)`.
   - What's unclear: Nothing architecturally — this is a known, small gap, not an open design question. Flagging here so the plan explicitly includes adding it (needed by both the UI-03 toast accumulator's `completed` counter and the UI-02 progress bar's numerator).
   - Recommendation: Add `onItemDone(cb)`/`offItemDone(cb)` to `runner.js`'s returned object, mirroring the existing `onItemFailed` shape exactly, firing at the point `store.markDone(item.id)` currently runs in `processNext()`.
   - Resolution mechanism: `03-01-PLAN.md` Task 1's action and acceptance_criteria implement and verify exactly this (see its `grep -n "abortRunning, onItemDone, offItemDone" src/runner.js` check).

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No | This extension has no auth of its own; it rides ST's existing session |
| V3 Session Management | No | No new session state introduced |
| V4 Access Control | No | Single local user per browser tab; no multi-user access control surface |
| V5 Input Validation | Yes | `/queueswipe [count]`'s numeric argument must be validated/clamped (`Number(unnamed) || 1`, then `Math.min(requested, room)`) before use — never trust the raw string. Settings number inputs (`max queue`, `circuit-breaker threshold`) must be clamped client-side per D-10/D-11 before writing to `extension_settings` |
| V6 Cryptography | No | No secrets, tokens, or crypto operations in this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Unbounded enqueue via a scripted `/queueswipe` loop (Common Pitfalls #4) | Denial of Service (local, cost-based: unbounded API spend) | Clamp against the live `store.pendingCount()+runningCount()` and `getMaxQueueSize()` on every invocation, never a cached count — the existing Phase 2 `onControlClick` clamp pattern already does this correctly and must be mirrored exactly, not re-derived |
| Rendering item/model text into the dropdown or progress bar via `.innerHTML`/`.html()` | Tampering (DOM-based XSS if any future field carries model/user text) | This phase's dropdown rows carry no model output or user text per the UI-SPEC's copy contract ("Plain ordinal or short label... no prompt text, no model name") — but if that changes later, use `textContent`/DOM node construction exactly as `ui.js`'s existing `renderBadge` already does, never raw HTML interpolation |
| Settings fields accepting out-of-range or non-numeric input | Tampering (local state corruption, not a security boundary, but still a correctness risk) | Client-side clamp before every `saveSettingsDebounced()` call, per D-10 (1–10) and D-11 (1–20, further clamped to `HARD_MAX_QUEUE`) |

No new secrets, tokens, or network endpoints are introduced by this phase, so most ASVS categories are not applicable — this is consistent with the project's existing CLAUDE.md security posture ("No secrets stored; reuse ST backend proxy").

## Sources

### Primary (HIGH confidence)
- `docs.sillytavern.app/for-contributors/writing-extensions/` — fetched this session for `inline-drawer` settings markup, `renderExtensionTemplateAsync` signature, and `SlashCommandParser.addCommandObject`/`SlashCommand.fromProps` example
- Direct reads of this repo's existing source this session: `src/ui.js`, `src/store.js`, `src/runner.js`, `src/adapter.js`, `src/st-bridge.js`, `index.js`, `manifest.json`, `package.json`, `test/runner.test.js`
- `.planning/research/ARCHITECTURE.md`, `.planning/research/STACK.md`, `.planning/research/PITFALLS.md`, `.planning/research/FEATURES.md` (Phase 1/2 research, HIGH-confidence source-verified against ST `release` 1.19.0)
- `.planning/phases/03-full-queue-control-ui/03-CONTEXT.md`, `03-UI-SPEC.md`, `03-DISCUSSION-LOG.md` (this phase's locked decisions)

### Secondary (MEDIUM confidence)
- `raw.githubusercontent.com/Nicoolodion/SillyTavern-SwipePregen/main/index.js` — fetched this session for wand-menu (`#extensionsMenu`) and progress-bar DOM patterns; third-party competitor source, not ST core, so treated as MEDIUM and flagged for live verification in Open Questions

### Tertiary (LOW confidence)
- None — no unverified single-source claims remain; everything either traces to official docs, this session's direct source reads, or prior HIGH-confidence Phase 1/2 research.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every new ST API this phase needs (`SlashCommandParser`, `renderExtensionTemplateAsync`, `inline-drawer` markup) was confirmed against official docs this session
- Architecture: HIGH for the AbortController-ownership refactor and store/runner reuse patterns (derived from direct reads of this repo's actual Phase 2 code this session); MEDIUM for wand-menu/progress-bar exact DOM markup (third-party source only)
- Pitfalls: HIGH — all five pitfalls are either reaffirmed from the existing project-wide `PITFALLS.md` (source-verified) or newly discovered this session from direct reads of the actual Phase 2 code's race conditions/gaps

**Research date:** 2026-10-26
**Valid until:** 30 days (stable ST release-branch API surface; re-verify sooner if ST ships a 1.20.0 before planning executes)
