# Phase 2: Single Queued Swipe End-to-End - Research

**Researched:** 2026-10-25
**Domain:** SillyTavern (ST) UI extension — serial background swipe-generation queue, appended to the latest AI message
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Phase Boundary:** User clicks a control next to the swipe arrows on the latest AI message to queue swipe requests, repeatably up to a max (default 5, hard max 20). Items run strictly serially in the background via the R1 route (dry-run capture + own transport + native cleanup helpers, locked in Phase 1). Each completed item appends as a normal swipe page without disturbing what the user is reading. Cancel UI, per-item list, slash commands, progress bar, and the settings panel remain Phase 3.

**Scope change made during discussion:** QUEUE-02 (add more requests while the queue is running, up to max) was moved from Phase 3 into Phase 2. Phase 2 is therefore a real serial multi-item queue, not a single-shot slice — only the *control surface* around it (cancel, slash commands, progress bar, settings UI) is deferred to Phase 3.

#### Control appearance & placement
- **D-01:** Icon = clock/stack icon (`fa-clock` primary; `fa-layer-group` is the locked fallback if `fa-clock` visually collides with another button in the row)
- **D-02:** Placed to the right of the right swipe arrow, after the swipe counter
- **D-03:** Tooltip text: "Queue a swipe"

#### Queue behavior
- **D-04:** Default max queue size = 5 (hardcoded default for Phase 2; configurable settings panel is Phase 3/SET-01). Hard max 20 per REQUIREMENTS.md SAFE policy, enforced even before the settings UI exists.
- **D-05:** Clicking the control while below max enqueues another request; items still run strictly one at a time (GEN-01 unaffected — only enqueue is concurrent with running, not execution)
- **D-06:** Control disables when queue is at max; tooltip changes to "Queue full (5/5)" (numbers are live: `pending+running` / `maxQueueSize`)
- **D-07:** No running indicator on the control icon itself (no spin/pulse) — the UI-01 badge alone shows pending/running count

#### Failure reporting (GUARD-05)
- **D-08:** Toast on item failure = generic message + reason category: `Queued swipe failed: API error` / `...: empty reply` / `...: cancelled` — never raw backend error text or stack traces
- **D-09:** `toastr.warning`, default timeout, `preventDuplicates: true`

#### Testing approach for this phase
- **D-10:** Pure modules (store, fingerprint, runner against a fake bridge, per `ARCHITECTURE.md` §4/§7) get automated Vitest unit tests written in this phase, not deferred
- **D-11:** Adapter/appender (need a live ST instance, not fake-able) are verified by manual smoke test using the `claude-in-chrome` MCP driving the local ST install + the extension, rather than a new automated browser harness (Playwright not adopted this phase)

### Claude's Discretion
- Exact module file layout and build order inside `src/` — already specified in `ARCHITECTURE.md` §4 (file list) and §7 (build order: bridge → store+fingerprint → appender → adapter → runner → guard → UI)
- Fingerprint composition (mesId + content hash + swipe count, per `ARCHITECTURE.md` §3.2/§3.3) — implement per the architecture doc unless it proves unworkable at the keyboard
- Exact toast wording beyond the "generic + reason category" rule (D-08)
- CSS for the disabled/queue-full control state

### Deferred Ideas (OUT OF SCOPE)
None new. QUEUE-02 was pulled **into** Phase 2 rather than deferred. Cancel UI, per-item list, slash commands (`/queueswipe`, `/queuecancel`, `/queuestatus`), wand menu entries, progress bar, toast coalescing, and the settings panel remain Phase 3 (QUEUE-03..07, UI-02, UI-03, SET-01).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| QUEUE-01 | Control next to swipe arrows adds one swipe request to the queue | §Architecture Patterns (control DOM injection point), 02-UI-SPEC.md |
| QUEUE-02 | Add more requests while queue is running, up to max | §Architecture §3.3 Data flow (enqueue is independent of run loop); §Common Pitfalls #7, #9 |
| QUEUE-08 | Control disabled/absent in group chats and chats with no AI message to swipe | §Common Pitfalls #20 (group/greeting gate); ARCHITECTURE.md §3.2 canQueue gate; reuse `isSwipingAllowed()`/`swipe.isAllowed()` |
| GEN-01 | Items run strictly one at a time; no concurrency, no overlap with native generation | §Architecture §5 (idle-gated single flight); §Common Pitfalls #6, #7 |
| GEN-02 | Each item uses same prompt context a native swipe would use at run time | §Architecture §2.2 Recommended pipeline (dry-run capture); SPIKE-REPORT.md criterion b |
| GEN-03 | No streaming into visible message, arrows/Send stay usable | §Architecture §2.1 route matrix; SPIKE-REPORT.md criterion a; §Common Pitfalls #14 |
| GEN-04 | Native-equivalent post-processing (stop strings, regex, trimming, reasoning) | §Architecture §1.8 (`cleanUpMessage`, `extractReasoningFromData`, `parseReasoningFromString`); §Common Pitfalls #15 |
| GEN-05 | Works with Chat Completion and Text Completion, user's current connection/preset | §Architecture §2.2 transport branch; SPIKE-REPORT.md return-shapes table |
| GEN-06 | Success judged by observable post-conditions, not resolved promise | §Common Pitfalls #5; §Architecture §2.2 |
| SWIPE-01 | Append to `swipes[]`/`swipe_info[]`, equal length, no holes | §Architecture §1.5, §2.2 Append helper; §Common Pitfalls #1, #24 |
| SWIPE-02 | Pager `k/total` updates live, no scroll/re-render disruption | §Architecture §1.6; §Common Pitfalls #18 |
| SWIPE-03 | Displayed `swipe_id` unchanged unless auto-jump + on newest | §Architecture §3.2 Appender responsibilities (auto-jump optional) |
| SWIPE-04 | Append only when idle; parked results flushed after | §Architecture §1.3 The append race; §Common Pitfalls #1 |
| SWIPE-05 | Save via ST save functions after each append | §Architecture §1.7; `saveChatConditional()` |
| GUARD-04 | Re-check chat identity token + fingerprint on every append/save; mismatch discards | §Architecture §3.3 Fingerprint; §Common Pitfalls #2, #19 |
| GUARD-05 | Failed item -> non-modal toast, dropped, queue continues | §Common Pitfalls #5, #13; D-08/D-09 |
| UI-01 | Badge shows pending/running count | 02-UI-SPEC.md Interaction Contract; §Common Pitfalls #26 |
| SET-02 | Settings persist in `extension_settings`, merge with defaults on load | §Common Pitfalls #28; STACK.md Settings table |
| COMP-03 | Installable via `manifest.json`, `minimum_client_version` 1.19.0 | STACK.md manifest schema table; SPIKE-REPORT.md environment |
</phase_requirements>

## Summary

Phase 2 builds the first real (non-spike) version of the extension: a production `manifest.json` + `index.js` + `src/` module tree, implementing the full R1 route approved in Phase 1 — dry-run `Generate('swipe', {}, true)` prompt capture, an own-transport send, native cleanup/reasoning helpers, and a manual append that mirrors ST's built-in `/addswipe`. Nothing in this phase is exploratory: Phase 1's spike already proved the route against a live ST 1.19.0 instance (all hard-blocker criteria a/c/d passed 4/4), and `ARCHITECTURE.md` already specifies the component boundaries, data flow, event policy, and persistence schema in detail. The job of this phase's plan is to turn that research into working code, in the build order `ARCHITECTURE.md` §7 prescribes (bridge → store+fingerprint → appender → adapter → runner → guard-subset → UI), while extending the original single-item design to the user's explicit QUEUE-02 multi-item-while-running requirement.

The two hardest correctness properties to get right are (1) **the append race** — a completed background result must never be written to `chat[]` while a native generation or swipe is in flight, because `saveReply`'s `swipe_id`-indexed write will silently overwrite it (§Architecture §1.3; Pitfall #1) — and (2) **identity/fingerprint re-validation** — the queue targets "the latest AI message" by a stable key, not an index, and must re-check that key immediately before every capture and again before every append, because chat switches, edits, deletes, and new user messages can all invalidate the target without a timely event (Pitfall #2, #19; GUARD-04). Both are solved by patterns Phase 1's architecture research already worked out: idle-gated single flight with park-then-flush, and a fingerprint object re-read from a fresh `getContext()` at every decision point.

**Primary recommendation:** Build strictly in the ARCHITECTURE.md §4/§7 order (bridge, store+fingerprint, appender, adapter, runner, guard-subset, UI), reuse the spike's `capture()`/`send()` logic as the adapter's pattern (not the file — Phase 1 D-09 freezes `spike/index.js` as evidence), and write Vitest unit tests for store/fingerprint/runner against a fake bridge as each module lands, per D-10.

## Architectural Responsibility Map

This project has no classic client/server split — it is a single-process browser extension that calls into ST's own in-page functions and ST's own backend. The tiers below map to the extension's internal layering, which plays the same separation-of-concerns role.

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Queue-swipe control icon + badge (DOM) | Browser / Client | — | Pure DOM injection into `.last_mes`; no logic, subscribes to Store events (ARCHITECTURE.md §3.2 UI row) |
| Failure/notice toasts | Browser / Client | — | `toastr` is a page global; UI-owned, reads Store state only |
| Queue Store (item list, state, fingerprint target) | Extension Module (business logic) | Persistence | Pure except for bridge metadata read/write; the in-browser equivalent of an API/backend layer in this architecture |
| Runner/Scheduler (idle gate, single flight, park/flush) | Extension Module (business logic) | ST Bridge (idle check) | Owns the state machine; must never touch DOM or trigger a second `Generate` |
| Generation Adapter (dry-run capture, transport, parse, clean) | Extension Module (business logic) | ST Backend (external) | Talks to ST's own generation endpoints via `sendOpenAIRequest`/`fetch`; this is the closest thing to an "API client" in this app |
| Swipe Appender (chat mutation, pager refresh, save) | Extension Module (business logic) | Persistence / Browser (DOM counter text) | The only code allowed to mutate `message.swipes`/`swipe_info`; writes through ST's own save path |
| ST Bridge (all ST internal imports, `getContext()`) | Extension Module (infrastructure boundary) | — | Isolates every ST-version-sensitive import behind one module (Pitfall #23) |
| Persistence (`chat_metadata[MODULE_NAME]`, `extension_settings[MODULE_NAME]`) | Persistence / Storage | ST Backend (file save) | ST's own `saveChatConditional()`/`saveSettingsDebounced()` are the only write path (locked decision) |
| ST generation backend (Chat/Text Completion providers) | ST Backend (external, not built here) | — | Reached only via native request builders/transport; this phase never builds a server |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vanilla ES modules (browser-native JS) | ES2023 | Extension runtime code | ST loads the `js` entry via dynamic `import()`; no build step. [CITED: docs.sillytavern.app, project CLAUDE.md "Core (runtime)"] |
| `SillyTavern.getContext()` | ST 1.19.0 | Primary ST API surface | Stable, documented API; verified live against the installed ST 1.19.0 in Phase 1's spike [VERIFIED: live ST instance, Phase 1 spike] |
| Direct `script.js`/`openai.js`/`reasoning.js`/`events.js`/`extensions.js` imports, isolated in `st-bridge.js` | matches installed ST 1.19.0 (commit `06bde939f`) | Access to internals not on `getContext()` (`isGenerating`, `cleanUpMessage`, `updateSwipeCounter`, `sendOpenAIRequest`, `extractReasoningFromData`, etc.) | Proven working import set — `spike/st-imports.js`'s 20 imports all resolved cleanly against the live install (`check-exports.mjs`: 20 OK, 0 MISSING) [VERIFIED: live ST instance, Phase 1 spike] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | `5.0.5` (latest on npm, verified this session) | Unit tests for pure modules (store, fingerprint, runner against a fake bridge), per D-10 | Dev-only dependency; native ESM, zero config needed for this project's plain-ESM test targets [VERIFIED: npm registry, `npm view vitest version` = 5.0.5, repo `github.com/vitest-dev/vitest`] |

Training-data note: `STACK.md` (written earlier this project) recommended "^3 or later (verify at install)" for Vitest — that estimate is stale. The registry now serves 5.0.5 as latest; 5.x is a current major, not a prerelease. Pin `^5.0.5` (or `^5.0.0` with a caret) rather than copying the `^3` figure from `STACK.md`.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Vitest | Jest | ESM friction (`--experimental-vm-modules` or transforms needed); ST's own server tests already work around this with `transform: {}`. Not worth it for a pure-ESM extension (STACK.md "Alternatives Considered") |
| Manual smoke test via claude-in-chrome (D-11) | Playwright against live ST | Higher setup cost; explicitly deferred this phase per D-11 |

**Installation:**
```bash
npm install -D vitest
```

**Version verification:** confirmed live this session —
```
npm view vitest version   # -> 5.0.5
```
Published date for 5.0.5 was not independently re-checked beyond the registry's own listing; treat the exact patch as a snapshot and re-verify at actual install time if this research goes stale (>30 days).

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|--------------|-----------|-------------|
| `vitest` | npm | ~4 years (`time.created` 2021-12-03) | very high (companion to Vite; not independently re-pulled this session, but 5.x is an actively maintained major with a long version history) | `github.com/vitest-dev/vitest` | **[SUS]** (slopcheck flagged "suspiciously close to 'vite'") | Flagged — see note below, but kept as Approved given corroborating evidence |

**Note on the slopcheck [SUS] verdict:** `slopcheck install vitest --ecosystem npm` flagged `vitest` as a possible typosquat of `vite` ("suspiciously close to 'vite'. Could be a typosquat"). This is a known false-positive pattern for this specific package: `vitest` and `vite` are both real, both maintained by the same organization (`vitest-dev` / `vitejs`), and `vitest` is the standard test runner that pairs with Vite — not a squat of it. Cross-checked independently via `npm view vitest repository.url` (`git+https://github.com/vitest-dev/vitest.git`) and `npm view vitest time.created` (2021-12-03, ~4 years old) — both corroborate a long-lived, legitimate package, not a recently-registered slopsquat. Per the Package Legitimacy Protocol, a `[SUS]` verdict is normally kept with an inline warning rather than auto-approved; the planner should still add a `checkpoint:human-verify` before the `npm install -D vitest` step, even though the evidence strongly supports legitimacy. No packages were rated `[SLOP]` (none removed).

**Packages removed due to slopcheck [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** `vitest` — planner should add a lightweight `checkpoint:human-verify` before the install step (low-risk given the corroborating registry/repo evidence above, but required by protocol since the automated tool did not clear it as `[OK]`).

No runtime/production npm packages are installed by this phase — the shipped extension is plain ES modules loaded directly by ST with no bundler (locked decision, CLAUDE.md "What NOT to Use": no bundled copies of jQuery/toastr/lodash/DOMPurify). `vitest` is the only new package, and it is dev-only (never shipped in the extension's `manifest.json`/`js` entry).

## Architecture Patterns

### System Architecture Diagram

```
 User click (.last_mes control)                   ST native event stream
         │                                               │
         ▼                                               ▼
 ┌─────────────┐  enqueue           ┌─────────────┐  invalidate/pause
 │     UI      │ ───────────────►   │ Event Guard │ ◄──────────────────┐
 │ (DOM, badge)│                    │ (subset:    │                    │
 └──────┬──────┘ ◄─ change events   │ CHAT_CHANGED,│                   │
        │                           │ GUARD-04/05 │                    │
        │ subscribe                 │ re-validate)│                    │
        ▼                           └──────┬──────┘                    │
 ┌─────────────────────────────┐           │ pause/clear               │
 │          Queue Store         │ ◄─────────┘                           │
 │ items[], status, fingerprint │                                       │
 │ persists to chat_metadata     │                                       │
 └──────┬───────────────▲───────┘                                       │
        │ wake           │ state                                       │
        ▼                │                                             │
 ┌─────────────────────────────────────────────────────────┐           │
 │              Runner / Scheduler (state machine)          │           │
 │  idle-gate → capture → send → clean → park → append      │           │
 │  one in-flight item; AbortController per item            │───────────┘
 └──────┬───────────────────────────────┬────────────────────┘  GENERATION_STARTED(dryRun=false)
        │ prompt+request                │ text+meta               pauses runner
        ▼                                ▼
 ┌───────────────────┐            ┌──────────────────────┐
 │ Generation Adapter │            │   Swipe Appender      │
 │ dryRun capture,    │            │ push swipes/info,     │
 │ own transport,      │            │ fingerprint re-check  │
 │ native cleanup/     │            │ (GUARD-04), counter   │
 │ reasoning extract   │            │ refresh, save          │
 └─────────┬───────────┘            └──────────┬────────────┘
           │                                    │
           ▼                                    ▼
 ┌───────────────────────────────────────────────────────────┐
 │              ST Bridge (single module, all ST imports)       │
 │  getContext(), isGenerating, Generate(dry), cleanUpMessage,  │
 │  sendOpenAIRequest, updateSwipeCounter, ensureSwipes, ...    │
 └──────────────────────────┬────────────────────────────────┘
                             ▼
                   ST's own backend / provider
                 (Chat Completion / Text Completion)
```

A single swipe request traces: click → Store.add (validates target, fingerprint, cap) → Runner.wake → idle-gate → Adapter.capture (dry run) → Adapter.send (own transport) → Adapter.parse+clean → Runner parks result → (idle again) → Appender re-validates fingerprint → Appender.append (swipes/swipe_info push, counter refresh, save) → UI updates from Store events.

### Recommended Project Structure
```
queued-swipes/                     # extension folder, third-party/<name>/
├── manifest.json                  # display_name, js, css, author, version, minimum_client_version=1.19.0
├── index.js                       # wiring only: init, register UI control, start Guard
├── style.css                      # disabled/queue-full control state (Claude's discretion)
└── src/
    ├── st-bridge.js                # ONLY file importing ST internals; feature detection
    ├── store.js                    # queue state + persistence (pure except bridge metadata calls)
    ├── fingerprint.js               # target hashing / matching (pure)
    ├── runner.js                    # scheduler state machine
    ├── adapter.js                   # capture + transport + parse + clean
    ├── appender.js                  # chat mutation + pager refresh + save
    ├── guard.js                     # event subscriptions -> store/runner commands (GUARD-04/05 subset this phase)
    └── ui.js                        # control + badge + toasts (this phase); cancel/list/slash cmds are Phase 3
test/
    ├── store.test.js
    ├── fingerprint.test.js
    └── runner.test.js               # against a fake bridge object, no live ST needed
```
Source: `ARCHITECTURE.md` §4, adapted to drop Phase-3-only files (`commands.js`, `settings.js` beyond the SET-02 merge-on-load logic, which can live inline in `index.js` for now).

### Pattern 1: Idle-gated single flight + park-then-flush
**What:** Every state transition re-checks `isGenerating() === false && getContext().swipe.state() === 'none'` before starting a capture or an append. Network completion and chat mutation are decoupled: a finished result is held in memory ("parked") until the idle check passes, then flushed.
**When to use:** Every Runner transition (start next item) and every Appender invocation (SWIPE-04, GEN-01).
**Example:**
```javascript
// Source: ARCHITECTURE.md §1.3, §2.2, §5 (pattern), spike/index.js capture() (pattern, not copied verbatim)
async function runNextItem(store, bridge, adapter, appender) {
  if (bridge.isGenerating() || bridge.swipeState() !== 'none') return; // not idle, wait
  const item = store.peekNext();
  if (!item) return;
  const target = store.resolveFingerprint(item); // fresh getContext() read
  if (!bridge.fingerprintMatches(target)) { store.drop(item, 'stale'); return; }

  const captured = await adapter.capture();            // dry-run Generate('swipe', {signal}, true)
  const result = await adapter.send(captured, item.signal); // own transport
  const cleaned = adapter.cleanAndExtract(result);     // cleanUpMessage + reasoning

  // park until idle again before touching chat[]
  while (bridge.isGenerating() || bridge.swipeState() !== 'none') {
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!bridge.fingerprintMatches(target)) { store.drop(item, 'stale'); return; } // re-check (GUARD-04)
  await appender.append(target.mesId, cleaned.text, cleaned.meta);
  store.markDone(item);
}
```

### Pattern 2: Fresh `getContext()` per access, never cache `chatMetadata`
**What:** Call `getContext()` (or a one-line accessor) at the point of use every time; never hold `chatMetadata`, `chat` length, or `streamingProcessor` across an `await`.
**When to use:** Store reads/writes, fingerprint comparisons, every Guard handler.
**Example:**
```javascript
// Source: ARCHITECTURE.md §1.7, Pitfall #3
const ctx = () => SillyTavern.getContext();
function persistQueue(state) {
  ctx().chatMetadata[MODULE_NAME] = state;   // re-fetch chatMetadata fresh, never module-cached
  ctx().saveMetadataDebounced();
}
```

### Pattern 3: Append mirrors the built-in `/addswipe`, never touches `swipe_id`
**What:** The Appender is a superset of ST's own `addSwipeCallback`: backfill `swipes`/`swipe_info` if missing, push the new entries as a single synchronous block (no `await` between the two pushes, per Pitfall #24/#25), refresh the counter, save — and never mutate `swipe_id`.
**When to use:** Every completed item (SWIPE-01, SWIPE-03, SWIPE-05).
**Example:**
```javascript
// Source: ARCHITECTURE.md §2.2 Append helper (sketch), mirrors slash-commands.js:addSwipeCallback
async function appendSwipe(mesId, text, meta, bridge) {
  const ctx = bridge.getContext();
  const m = ctx.chat[mesId];
  if (bridge.isGenerating() || ctx.swipe.state() !== 'none') return 'defer';
  if (!m || mesId !== ctx.chat.length - 1 || m.is_user) return 'stale';
  bridge.ensureSwipes(m); // backfill if this message never swiped before
  m.swipes.push(text);
  m.swipe_info.push({
    send_date: new Date().toISOString(),
    gen_started: meta.started,
    gen_finished: new Date(),
    extra: { api: bridge.getGeneratingApi(), model: bridge.getGeneratingModel(),
              reasoning: meta.reasoning ?? '', reasoning_duration: null,
              reasoning_signature: meta.signature ?? null },
  }); // single synchronous block, no await between the two pushes
  ctx.chatMetadata.tainted = true;
  await bridge.updateSwipeCounter(mesId, { message: m });
  ctx.swipe.refresh();
  await ctx.saveChat(); // = saveChatConditional
  return 'ok';
}
```

### Anti-Patterns to Avoid
- **Calling non-dry `Generate('swipe')` for queued items:** hijacks the visible message, blocks arrows, and overwrites the current slot if `swipe_id` is not pre-staged. Always dry-run capture + own transport.
- **Pre-staging `swipe_id = swipes.length` and swapping back afterward:** inconsistent state is saveable at any `await`; flickers; fires `MESSAGE_RECEIVED` side effects. Never touch `swipe_id`.
- **Caching `getContext().chatMetadata`:** the object is reassigned on chat load/`updateChatMetadata`; a cached reference silently writes into an orphaned object.
- **Treating `MESSAGE_UPDATED` as "content changed":** it also fires on edit-cancel. Use `MESSAGE_EDITED` + the fingerprint check instead.
- **Relying on `GENERATION_ENDED` alone to detect idle:** it only fires if the native stop button was ever shown. Poll `isGenerating()` as a backup wake source.
- **Saving `chat_metadata` on every queue progress tick:** each metadata save re-uploads the whole chat file. Persist only on enqueue/cancel/complete.
- **Treating a resolved `Generate()`/adapter promise as success:** many ST early-exits resolve with nothing produced. Success = an observable post-condition (`swipes.length` grew by one, non-empty text), per GEN-06.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Swipe post-processing (stop strings, regex, trimming, reasoning parse) | A custom cleanup/parsing pipeline | `cleanUpMessage()`, `extractMessageFromData()`, `extractReasoningFromData()`, `parseReasoningFromString()` (exported from `script.js`/`reasoning.js`, imported via the bridge) | These are the exact functions native `onSuccess` calls; re-implementing them risks silent divergence from native swipes (GEN-04) and was explicitly the reason the project chose the "native pipeline" route over a fully custom one |
| Pager counter refresh | Custom DOM text manipulation of `.swipes-counter`/re-render | `updateSwipeCounter(mesId, {message})` + `getContext().swipe.refresh()` | Exact sequence the built-in `/addswipe` uses; re-rendering via `addOneMessage`/`reloadCurrentChat` resets scroll and loses edit/reasoning UI state (Pitfall #18) |
| Message array normalization (`swipes`/`swipe_info` backfill) | A bespoke "ensure arrays exist and are aligned" helper | `ensureSwipes(message)` (exported from `script.js`) | ST core itself has shipped multiple bugs around desynced `swipes`/`swipe_info` (issues #5033, #4717); the exported function is the canonical fix, already hardened against those cases (Pitfall #24) |
| Prompt capture | Re-deriving the swipe prompt manually (character card + WI + chat + presets) | `Generate('swipe', {}, true)` dry run, captured via `GENERATE_AFTER_DATA` | Verified byte-identical to a native swipe prompt in Phase 1's spike for every baseline combination; a hand-built prompt assembler would re-introduce every fidelity edge case ST's own code already handles |
| Idle/single-flight detection | A custom "is ST busy" heuristic from DOM state alone | `isGenerating()` (imported) as primary signal, `getContext().swipe.state()` as secondary, `body.dataset.generating` only as a last-resort fallback | `isGenerating()` is the exact check native `swipe()`/`isSwipingAllowed()` use; DOM-only heuristics are coarser and miss edge cases (ARCHITECTURE.md §1.2) |

**Key insight:** Nearly every "obvious" custom implementation in this domain (cleanup, pager refresh, array normalization, idle detection) already exists as an exported ST function that native code itself depends on. The entire R1 route's value proposition is reusing those functions instead of reimplementing them — hand-rolling any of them reintroduces exactly the fidelity gaps this project exists to avoid.

## Common Pitfalls

> Full detail in `.planning/research/PITFALLS.md` (30 pitfalls). The subset most load-bearing for Phase 2's scope is below; see that file for Phase 3/4-scoped pitfalls (cancel UI, persistence resume UX, compatibility matrix) not yet in play.

### Pitfall: Swipe slot overwrite via the append race (Pitfall #1 / #1.3)
**What goes wrong:** If the appender writes to `swipes[]` while a native generation or swipe is staged (`swipe_id = N`, `swipes.length = N`), `saveReply`'s trailing `swipes[swipe_id] = mes` silently overwrites the just-appended swipe, leaving a sparse hole that serializes as `null`.
**Why it happens:** `saveReply` always writes unconditionally to the current `swipe_id` index; it has no concept of a concurrent background append.
**How to avoid:** Gate the Appender on `!isGenerating() && swipe.state() === 'none'`; park results otherwise and flush once idle (Pattern 1 above). Never append speculatively.
**Warning signs:** A swipe page showing the wrong text after a background item lands; `swipes.length !== swipe_info.length` after a completion; `null` entries in the saved chat JSON.

### Pitfall: Target invalidation detected too late or not at all (Pitfall #19, GUARD-04)
**What goes wrong:** The queue targets "the latest AI message" by position/content, not a message UUID (ST has none). Edits, deletes, new user messages, message reorders, and swipe deletions can all invalidate the target without a timely or unambiguous event (`MESSAGE_UPDATED` fires on edit-cancel too; `MESSAGE_DELETED`'s payload is the new chat length, not an id).
**Why it happens:** ST's event model was not designed for a background process holding a stale reference to "the last message."
**How to avoid:** Identify the target by a fingerprint (`{chatId, integrity, mesId, chatLength, swipe0Hash, name}` per ARCHITECTURE.md §3.3), re-check it immediately before every capture and again before every append (GUARD-04) — never trust the event stream alone as the sole gate.
**Warning signs:** A queued swipe attached to a different message after an edit/send; a toast firing for the wrong reason category.

### Pitfall: Resolved promise treated as success (Pitfall #5, GEN-06)
**What goes wrong:** ST's `Generate()`/transport calls can resolve with nothing produced (no backend connection, interceptor abort, empty reply) without throwing. A runner that only checks "did the promise resolve" will report false success or loop.
**Why it happens:** ST signals many failure modes via toasts/side effects, not exceptions.
**How to avoid:** Define success as `swipes.length` increased by one with a non-empty string, and `swipe_info.length` matching. Anything else is a failure: toast (D-08/D-09), drop, continue (GUARD-05).
**Warning signs:** Badge says "done" but pager total unchanged.

### Pitfall: Event re-entrancy / no reliable completion signal (Pitfall #6)
**What goes wrong:** `eventSource.emit` awaits listeners serially; an event handler that `await`s starting the next queue item runs inside the previous `Generate`'s own event emission, risking deadlock or an accidental concurrent `Generate` that corrupts single-flight state. `GENERATION_ENDED` is not a reliable completion event (only fires if the stop button was ever shown).
**Why it happens:** ST provides no per-generation "done" event; chaining the queue directly off events is the natural-looking but wrong approach.
**How to avoid:** Drive the queue from the Runner's own awaited promise chain; event handlers only schedule a microtask/`setTimeout(0)`, never call `Generate` inline. Use `isGenerating()` polling as a backup wake source, not events alone (GEN-01).
**Warning signs:** UI frozen on "Stop"; duplicate "Generate entered" logs.

### Pitfall: Concurrent user action vs. the running queue (Pitfall #7)
**What goes wrong:** While the native pipeline considers a generation in progress (even our own dry-run moment), the user's Send button and native swipe arrows can appear dead or blocked, since `is_send_press`-style guards are global. A manual send/swipe mid-queue-run needs defined behavior.
**Why it happens:** ST's single-flight state is global, not per-caller; this phase's "queued generation... does not lock swipe arrows or Send" success criterion (criterion 2) is only true because R1's dry-run approach (verified in Phase 1, criterion a) doesn't set `is_send_press` — but the preflight check before starting a capture must still confirm no manual generation, edit, or swipe animation is in progress.
**How to avoid:** Before every capture attempt, check `!isGenerating()`, no open message editor, no swipe-in-progress (`swipe.state() !== 'none'`). If any is true, wait rather than force.
**Warning signs:** "I can't send a message" while the queue runs (should not happen under R1, but verify empirically in the D-11 smoke test).

### Pitfall: Group chats and the swipeable-message gate (Pitfall #20, QUEUE-08)
**What goes wrong:** The control must not appear (not just be disabled) in group chats or on chats where the latest message isn't a swipeable AI message (small-sys, user message, swipes globally disabled).
**Why it happens:** `isSwipingAllowed()`/`isMessageSwipeable()` already encode this logic natively; reimplementing it risks missing an edge case (greeting-only chats, `extra.isSmallSys`).
**How to avoid:** Reuse `getContext().swipe.isAllowed()`/the bridge's exposed equivalent as the single `canQueue()` gate, per 02-UI-SPEC.md's explicit instruction not to re-derive this condition independently.
**Warning signs:** Control visible in a group chat or on a greeting-only chat.

## Code Examples

### Idle-gated dry-run capture (verified pattern, Phase 1 spike)
```javascript
// Source: spike/index.js capture() — pattern reference per Phase 1 D-09, not copied verbatim into production
async function captureSwipePrompt(bridge) {
  const c = bridge.getContext();
  if (bridge.isGenerating() || c.swipe?.state?.() !== 'none') throw new Error('not idle');
  let armed = false, captured = null;
  const onStart = (type, _params, dryRun) => { if (type === 'swipe' && dryRun === true) armed = true; };
  const onData = (data, dryRun) => { if (armed && dryRun === true) { captured = structuredClone(data); armed = false; } };
  c.eventSource.on(c.eventTypes.GENERATION_STARTED, onStart);
  c.eventSource.makeLast(c.eventTypes.GENERATE_AFTER_DATA, onData);
  const ownController = new AbortController();
  try {
    await c.generate('swipe', { signal: ownController.signal }, true);
  } finally {
    c.eventSource.removeListener(c.eventTypes.GENERATION_STARTED, onStart);
    c.eventSource.removeListener(c.eventTypes.GENERATE_AFTER_DATA, onData);
  }
  if (!captured) throw new Error('capture failed: no dry-run GENERATE_AFTER_DATA seen');
  return { captured, ownController };
}
```

### Transport handling both return shapes (verified, Phase 1 spike return-shapes table)
```javascript
// Source: ARCHITECTURE.md §2.2 (type='swipe', not 'quiet' — preserves Claude prefill, multi-swipe n)
async function sendCaptured(ctx, captured, signal) {
  if (ctx.mainApi === 'openai') {
    const r = await ctx.sendOpenAIRequest('swipe', captured.prompt, signal); // may be JSON or generator fn
    if (typeof r === 'function') {
      let last = { text: '', state: {} };
      for await (const chunk of r()) last = chunk; // streaming: keep the last yielded chunk
      return { getMessage: last.text ?? '', reasoning: last.state?.reasoning ?? '' };
    }
    return { getMessage: ctx.extractMessageFromData(r), reasoning: ctx.extractReasoningFromData(r) ?? '' };
  }
  // Text-completion APIs: plain fetch, JSON response (non-streaming unless generate_data.stream was set upstream)
  const res = await fetch(ctx.getGenerateUrl(ctx.mainApi), {
    method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify(captured), signal,
  });
  if (!res.ok) throw new Error(`generation failed: ${res.status}`);
  const json = await res.json();
  return { getMessage: ctx.extractMessageFromData(json), reasoning: ctx.extractReasoningFromData(json) ?? '' };
}
```

### Fingerprint shape (not yet code, per ARCHITECTURE.md §3.3)
```javascript
// Source: ARCHITECTURE.md §3.3 — stable key for "is this still the same target message"
function buildFingerprint(ctx, mesId) {
  const m = ctx.chat[mesId];
  return {
    chatId: ctx.chatId ?? null,                 // or getCurrentChatId() via bridge
    integrity: ctx.chatMetadata?.integrity ?? null,
    mesId,
    chatLength: ctx.chat.length,
    swipe0Hash: hash(m.swipes?.[0] ?? m.mes),    // cheap hash, not cryptographic
    name: m.name,
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| 01-architecture-analysis.md's "serial through ST's native generation pipeline" | "native prompt building + native request builders + native cleanup helpers, serialized by our own scheduler" (R1) | Reworded after Phase 1 spike (2026-10-25) | The project's own vocabulary changed; Phase 2 should not describe the route as calling non-dry `Generate('swipe')` anywhere, including in code comments or UI copy |
| Assumed "swipe pushes a new empty slot" | Verified: `swipe()` sets `swipe_id = swipes.length`; `saveReply` does `swipes.length++`, creating a sparse hole only if `swipe_id` was pre-staged | Verified against source in `ARCHITECTURE.md` §1.1 | Confirms the appender must never touch `swipe_id`, and must push both arrays synchronously |
| `STACK.md`'s "Vitest ^3 or later (verify at install)" | Vitest `5.0.5` is current on npm as of this session | Verified live this session | Pin `^5.0.5`, not `^3.x`, when scaffolding `package.json` |

**Deprecated/outdated:** `registerSlashCommand`, `callPopup`, `showLoader/hideLoader`, `renderExtensionTemplate` (sync), `registerHelper`, `getTokenCount` — all `@deprecated` per `st-context.js` (project STACK.md); not used by this phase anyway since slash commands and the settings template are Phase 3.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `vitest` download/popularity figures described as "very high" | Standard Stack / Package Legitimacy Audit | Low — not load-bearing for correctness, only context for the legitimacy note; package identity (repo URL, creation date) was independently verified via `npm view`, not assumed |
| A2 | Exact published date of `vitest@5.0.5` | Standard Stack | Low — version number itself was verified live (`npm view vitest version`); only the precise publish timestamp is unverified |

**All other claims in this research were verified against the live Phase 1 spike evidence (SPIKE-REPORT.md, runtime-tested), the source-read `ARCHITECTURE.md`/`PITFALLS.md` (HIGH confidence per those docs' own headers), or verified live this session (`npm view`, `slopcheck`). No claim about ST's generation/swipe/save internals in this document is `[ASSUMED]`** — Phase 1's spike already converted every relevant `[Recall]` claim to VERIFIED or documented gap.

## Open Questions

1. **Exact DOM selector for "is this message swipeable" and the live computed icon size for the new control**
   - What we know: `isSwipingAllowed()`/`swipe.isAllowed()` exist on the bridge and should be reused (02-UI-SPEC.md explicit instruction); the control must pixel-match `.swipe_right`/`.swipe_left`/`mes_button` sizing.
   - What's unclear: The exact computed CSS values (icon size, disabled opacity token name) are not in any doc — 02-UI-SPEC.md explicitly defers this to a live D-11 smoke-test check rather than a guessed value.
   - Recommendation: Confirm via the claude-in-chrome smoke test against the local ST install (`E:\SillyTavern`) before finalizing `style.css`, per 02-UI-SPEC.md's own instruction. Do not hardcode a size/opacity from memory.

2. **Multi-item enqueue-while-running interaction with the single in-flight Runner slot**
   - What we know: ARCHITECTURE.md's Runner is designed as "one in-flight item" with a queue of pending items; QUEUE-02 (add while running) is naturally satisfied by this design since enqueue only appends to `Store.items`, independent of the Runner's current execution — no architecture change needed, just confirmation this holds under the hard max=20 cap check at enqueue time.
   - What's unclear: Whether the max-queue-size check at enqueue time should count only `queued` items or `queued + running` (D-04/D-06 UI copy implies `pending+running` against `maxQueueSize`).
   - Recommendation: Count `pending + running` against `maxQueueSize` for the enqueue gate and the "Queue full (N/N)" tooltip math, matching 02-UI-SPEC.md's Copywriting Contract ("pending count including the one currently running").

3. **Whether `getContext()` exposes `getCurrentChatId()`/`chatId` directly, or whether the bridge needs a direct import for the fingerprint's `chatId` field**
   - What we know: `ARCHITECTURE.md` §1.8 lists `getContext()`'s exposed surface and does not explicitly list `chatId`/`getCurrentChatId` among the confirmed-exposed properties, though `chatId` appears as a context property name used informally in §3.3's fingerprint sketch.
   - What's unclear: Whether `ctx.chatId` (if it exists on context) is live or a snapshot like `chatMetadata`, and whether a direct `getCurrentChatId()` import is needed instead.
   - Recommendation: Resolve during the bridge module's build step (ARCHITECTURE.md §7 step 1) with a quick live check against the local ST install before writing `fingerprint.js`; low risk either way since the bridge isolates the choice.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Running Vitest unit tests (D-10) | ✓ | v22.17.0 | — |
| npm | Installing `vitest` devDependency | ✓ | 10.9.2 | — |
| `vitest` (npm registry) | Unit tests for store/fingerprint/runner | ✓ | 5.0.5 (latest) | — |
| Local SillyTavern install (`E:\SillyTavern`) | Manual smoke test (D-11) for adapter/appender | ✓ | 1.19.0 `release` (06bde939f), confirmed present with an empty `third-party` extensions folder ready for this extension | — |
| `claude-in-chrome` MCP | Driving the local ST install during the D-11 manual smoke test | Not independently probed this session (MCP tool availability is session-scoped, not filesystem-probable) | — | If unavailable at execution time, fall back to a manual (human-driven) smoke test against the same local ST install — the CONTEXT.md decision names the tool but the underlying need (a live-ST smoke test of adapter/appender) survives either way |
| `python`/`pip` + `slopcheck` | Package legitimacy check (this research step only, not part of the shipped extension) | ✓ | slopcheck 0.6.1 installed this session | — |

**Missing dependencies with no fallback:** none identified.

**Missing dependencies with fallback:** `claude-in-chrome` MCP tool availability was not verified in this research session (no way to probe MCP tool registration from a filesystem/shell check); if absent at execution time, the plan should fall back to a human-driven manual smoke test against the already-confirmed-present local ST install, which satisfies the same underlying verification need as D-11.

## Security Domain

This phase ships no server component and introduces no new authentication/session surface — it is a browser-side UI extension that calls ST's own existing backend proxy with ST's own existing credentials. The relevant ASVS categories are narrow.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No | Extension does not handle credentials; reuses ST's existing session/connection (locked decision, CLAUDE.md "Security: No secrets stored; reuse ST backend proxy") |
| V3 Session Management | No | No session state of its own; ST session already applies |
| V4 Access Control | No | Single-user local tool; no access-control surface introduced |
| V5 Input Validation | Yes (narrow) | Toast/badge text must never render raw model output or backend error text as HTML — use `textContent`/toastr's own escaping, never `.html()` with model/chat text (per PITFALLS.md "Security Mistakes": XSS via crafted card or reply) |
| V6 Cryptography | No | No cryptographic operations introduced by this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| XSS via model-generated text rendered into the badge/toast without escaping | Tampering / Elevation of Privilege | Always use `textContent` or toastr's default (non-HTML) rendering for any text derived from chat content or backend responses; never `.html()` model text into the control/badge (PITFALLS.md Security Mistakes) |
| Secret leakage via `chat_metadata` persistence | Information Disclosure | Persist only `{version, target, items:[{id, createdAt, status, attempts}], paused}` — ids and timestamps only, never prompts, API keys, or headers (locked decision; ARCHITECTURE.md §3.5 persistence schema; PITFALLS.md Pitfall #10) |
| Direct unauthenticated writes to the chat file bypassing integrity checks | Tampering | Only ever call `saveChatConditional()`/`saveMetadataDebounced()`; never `fetch('/api/chats/save', ...)` directly (locked decision, enforced by the ST Bridge being the only module with that capability) |
| A stray `postinstall` script on a slopsquatted devDependency | Tampering | N/A this phase — `vitest` has no postinstall script risk flagged, and is dev-only, never shipped |

## Sources

### Primary (HIGH confidence)
- `.planning/research/ARCHITECTURE.md` — full read, source-verified against SillyTavern `release` branch 1.19.0 (`public/script.js`, `scripts/st-context.js`, `scripts/events.js`, `scripts/extensions.js`, `scripts/openai.js`, `scripts/reasoning.js`, `scripts/slash-commands.js`, etc.), researched 2026-10-25
- `.planning/research/PITFALLS.md` — full read, same evidence base plus Deep-Swipe/Prompt Inspector/UserSwipes source reads, researched 2026-10-25
- `.planning/phases/01-route-verification-spike/SPIKE-REPORT.md` — full read, live runtime verification against ST 1.19.0 + llama-server, 2026-10-25, Decision: R1 APPROVED
- `spike/index.js`, `spike/st-imports.js` — read directly, proven working reference implementation (20/20 imports resolved live)
- `npm view vitest version` / `repository.url` / `time.created` — run live this session, confirmed 5.0.5 / `github.com/vitest-dev/vitest` / 2021-12-03
- `python -m slopcheck install vitest --ecosystem npm` — run live this session

### Secondary (MEDIUM confidence)
- `.planning/research/STACK.md` (embedded in project CLAUDE.md) — Vitest version estimate ("^3 or later") found stale against the live npm registry check above; manifest schema and `getContext()` surface claims corroborated by `ARCHITECTURE.md`'s independent source read

### Tertiary (LOW confidence)
- None used as the basis for any claim in this document; all ST-behavior claims trace to the Phase 1 spike or the source-read architecture/pitfalls research.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — route (R1) is runtime-verified against a live ST 1.19.0 instance (SPIKE-REPORT.md); only the Vitest version number required a fresh registry check, which was performed
- Architecture: HIGH — `ARCHITECTURE.md`'s component boundaries, data flow, and build order were written against direct source reads and are the load-bearing design this phase implements, not a fresh hypothesis
- Pitfalls: HIGH — `PITFALLS.md`'s pitfalls are source-read (ST core) plus third-party extension code reads; several were independently runtime-confirmed by the Phase 1 spike (append race, auto-swipe cascade, interceptor skip)

**Research date:** 2026-10-25
**Valid until:** 2026-11-24 (30 days) for the architecture/pitfalls content, which is tied to ST 1.19.0 source and will drift if ST releases a new version; the Vitest version pin should be re-verified at actual `npm install` time regardless, since npm packages move faster than ST releases.
