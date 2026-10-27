# Phase 4: Lifecycle, Persistence & Spend Safety - Research

**Researched:** 2026-10-27
**Domain:** SillyTavern 1.19.0 UI-extension lifecycle events, chat_metadata persistence, spend guards, cross-tab ownership (vanilla ES modules, Vitest)
**Confidence:** HIGH on ST event/payload/persistence facts (read from the installed 1.19.0 tree), MEDIUM on cross-tab behavior (browser semantics, needs live smoke), MEDIUM on the Prompt Inspector and preset detection (see Assumptions)

All ST line numbers refer to `D:\repositories\SillyTavern\public\` (HEAD `06bde939f` = 1.19.0 + 1 commit, same tree the Phase 1 spike used) `[VERIFIED: codebase grep]`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Stored items expire after a **fixed 24h** age (from the item's creation timestamp). Expired items are dropped on load and are included in the PERS-04 "Dropped {n} saved queued swipe(s)..." notice. No new setting. The UI-SPEC adds no settings field.
- **D-02:** An item stored with status `running` (the page was refreshed mid-generation) is **demoted to `queued`** on load. It counts in the resume popup and runs again if the user resumes. This matches ARCHITECTURE.md §3.4.
- **D-03:** The on-load stale check is **existing fingerprint + 24h age**. The fingerprint is chat id, integrity, last-message index/chat length, swipe0 hash and name (see `src/fingerprint.js`). A connection change (api/model/preset) does **not** make an item stale. The resume popup shows the change and asks (UI-SPEC "Combined case").
- **D-04:** **Continue on the target message re-fingerprints the queue and keeps it.** It does not clear the queue. When the native Continue generation ends, every pending item and any in-flight or parked item adopts a fresh fingerprint of the target. This makes the append-time GUARD-04 check pass. Note: a swipe prompt does not include the target message, so a continuation does not change what queued items generate. Only the identity key needs a refresh. The queue still waits during Continue (GUARD-01). No toast. The planner must detect Continue specifically (generation type `continue` on the target index), so a real edit or delete is not re-fingerprinted by mistake.
- **D-05:** **Any `MESSAGE_EDITED` on the target index clears the queue** with the UI-SPEC "edited" toast, whichever swipe was edited (including swipes other than swipe 0). Edits of earlier messages leave the queue alone (ARCHITECTURE.md §3.4). `MESSAGE_UPDATED` alone never clears.
- **D-06:** **A manual native swipe on the target does not clear or reduce the queue.** The queue pauses during the native generation (GUARD-01), then resumes and appends its own pages. The fingerprint does not include swipe count, so it stays valid. The native swipe is not counted against pending items.
- **D-07:** **First tab wins.** The tab that opened a chat first owns that chat's queue. Any tab that opens the chat later is read-only until the owner goes away. A new tab never steals a running queue.
- **D-08:** **Ownership is per chat.** If the owner tab switches to a different chat but stays open, a tab still showing the original chat takes over, in the paused `takeover` state with the takeover toast. It never auto-runs and never opens the resume popup (UI-SPEC).
- **D-09:** **Takeover after a few seconds of silence.** Heartbeat roughly every 2s, takeover after roughly 5s without a heartbeat. A graceful close (`pagehide`/`beforeunload`) or a chat switch releases ownership immediately, so takeover happens at once. The exact mechanism (BroadcastChannel vs `localStorage` events) is the planner's choice. A throttled background owner may briefly look gone. This is acceptable because takeover is always paused.
- **D-10 (derived, required for safety):** A former owner that finds another tab has taken over (for example, after its timers were throttled) must **demote itself to read-only**. It must not run or write `chat_metadata` for the queue. Two tabs must never run the same chat's queue at once.
- **D-11:** **Default threshold stays 3** (shipped in Phase 3 D-10, used by the UI-SPEC). REQUIREMENTS.md SAFE-01 is updated from "default 2" to "default 3". Saved user values are kept by the existing merge-by-key logic. (Verified: REQUIREMENTS.md SAFE-01 already reads "default 3"; nothing left to reconcile.)
- **D-12:** **The consecutive-failure counter is in-memory only.** It resets to 0 on reload, chat switch, success and Resume. It is not persisted in `chat_metadata`. Counted reasons are `api` and `empty` only. `cancelled` and `stale` never count (UI-SPEC).

### Claude's Discretion
- Multi-tab transport (BroadcastChannel vs `localStorage` storage events), tab-id generation, and exact heartbeat/timeout numbers within D-09's "a few seconds".
- `chat_metadata[MODULE_NAME]` schema details beyond PERS-01 (ids, timestamps, fingerprint, recorded api/model/preset; no prompts). Start from ARCHITECTURE.md §3.5. Include a `version` field.
- Which preset identifier is recorded for SAFE-02 (CC preset name vs TC preset), and how api/model/preset are read via the bridge.
- Prompt Inspector detection method (PITFALLS.md: `localStorage.promptInspectorEnabled === 'true'`), plus the polling or event used to notice it turning on mid-queue.
- How GUARD-06 tells native Stop apart from queue cancel. Queue cancel already uses its own AbortController (`abortOwn`) and never calls `stopGeneration()`. Native Stop only resumes the queue via `GENERATION_STOPPED` (UI-SPEC: no toast).
- How GUARD-03 aborts the running item on chat switch without reporting it as a failure. The aborted item stays stored in the original chat, demoted to `queued`.

### Deferred Ideas (OUT OF SCOPE)
None. The discussion stayed within the phase scope.

(Also binding: `04-UI-SPEC.md` is approved. All copy, popups, toasts, state table and class names in it are locked.)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GUARD-01 | Manual send/swipe/continue: in-flight result parked, remaining items wait | Existing `guard.js` + `runner.js` already pause on non-dry `GENERATION_STARTED`; needs reason-aware pause, "park then check" reorder in `processNext`, idle watchdog (Pitfalls 4, 5, 6) |
| GUARD-02 | Edit/delete/new message clears pending + toast | Events `MESSAGE_EDITED(id)`, `MESSAGE_DELETED(newLength)`, `MESSAGE_SENT(id)`, plus filtered `MESSAGE_RECEIVED` (Event table); epoch invalidation of in-flight item |
| GUARD-03 | Chat switch aborts running item, pending stay with original chat | `CHAT_CHANGED` handler: pause first, abort with requeue disposition, rebind store; chat-key-bound persistence (Pitfalls 1, 2) |
| GUARD-06 | Native Stop vs queue cancel | Queue cancel never emits `GENERATION_STOPPED` (own AbortController); any `GENERATION_STOPPED` is foreign, so it only clears the `native` pause reason |
| PERS-01 | Queue in `chat_metadata`, ids/timestamps only | Schema v1 below; `saveMetadataDebounced` + immediate save on enqueue |
| PERS-02 | Load: paused + resume/discard popup (count, model) | `CHAT_CHANGED` load path, `callGenericPopup` result codes verified (1 / 0 / null) |
| PERS-03 | Returning to chat offers same prompt | Same load path runs on every distinct-chat `CHAT_CHANGED` |
| PERS-04 | Stale stored items dropped with notice | Target-part fingerprint revalidation + 24h expiry + schema validation |
| SAFE-01 | Pause after N consecutive failures | Runner counter, live threshold read, reasons api/empty only |
| SAFE-02 | Pause if API/model/preset changed | Per-item `connection` snapshot recorded at `store.add`, compared in `processNext` |
| SAFE-03 | Refuse/pause while Prompt Inspector on | `localStorage.promptInspectorEnabled` (+ extension presence), checked at every add path, Resume and per item |
| SAFE-04 | One tab runs a chat's queue | `localStorage` lease + heartbeat + `storage` events (`src/ownership.js`) |
</phase_requirements>

## Summary

The existing code is a good base. `guard.js`/`runner.js`/`store.js`/`fingerprint.js` already isolate the seams Phase 4 needs, and the bridge already exposes `getGeneratingApi`/`getGeneratingModel`. But four places in the current code are unsafe the moment persistence and chat switching enter the picture, and the planner must treat them as design constraints, not details:

1. **The store is a single in-memory instance, not per chat.** `openCharacterChat` replaces `chat_metadata = {}` and clears `chat` *before* `CHAT_CHANGED` fires (`script.js:7744-7750`, `clearChat` also cancels any pending debounced metadata save at `script.js:1587-1589`). In that window the runner's fingerprint checks fail and would currently drop every pending item as `stale`, and any persist call would write into the wrong (new or empty) metadata object. Fix: distinguish a chat-identity mismatch from a target mismatch (pause + keep, never drop), and bind every persist to the chat key the store was loaded for.
2. **`runner.pause(reason)` ignores the reason and `resume()` clears everything.** After Phase 4 the guard's `resume()` on `GENERATION_ENDED/STOPPED` would silently clear a `restored`, `failures`, `connection`, `inspector` or `takeover` pause. Pause must become a reason set, and the guard must only clear `native`.
3. **`processNext` checks the fingerprint right after `generate()` and before the idle wait.** With Continue (D-04) the target text is mutating during the check, so the parked result would be dropped as stale before the re-fingerprint can happen. The order must become: generate, park until idle, epoch check, fingerprint check, append.
4. **`store.onChange` drives toast flushing and the progress bar.** A bulk clear or a chat rebind drains the store and would flush a spurious "0 queued swipe(s) completed." toast.

Everything else is additive: a `lifecycle` policy module (pure, injected bridge/store/runner/notify), a `persistence` module (serialize/load/validate, pure), an `ownership` module (lease + heartbeat over `localStorage`, pure with injected storage/clock), a `connection` snapshot in the bridge, a Prompt Inspector probe in the bridge, and UI states that read from `store` plus a new `runner.onStateChange`.

**Primary recommendation:** Build it as four small pure modules (`persistence.js`, `lifecycle.js`, `ownership.js`, `connection.js`) plus targeted edits to `runner.js` (pause reasons, breaker, SAFE-02/03 gates, epoch + park reorder), `store.js` (bound-chat persistence, `clear(reason)`, `rebind`, `refingerprintAll`, `setReadOnly`/`applySnapshot`), `guard.js` (new events) and `st-bridge.js` (`connectionSnapshot`, `promptInspectorEnabled`). Use a `localStorage` lease with `storage` events for ownership (BroadcastChannel is a nice-to-have, Web Locks is unusable on plain-HTTP LAN installs).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Event policy (edit/delete/send/chat change/native gen) | Browser (extension `guard.js` + `lifecycle.js`) | — | Only the client sees `eventSource` events; no server plugin (locked) |
| Queue persistence | Browser, written through ST save functions | ST server (`/api/chats/save`, via `saveMetadataDebounced`/`saveChat`) | Locked: never write `chat.jsonl` directly; `chat_metadata` rides the chat file |
| Stale/expiry validation | Browser (`persistence.js`, pure) | — | Needs the live `chat` array |
| Circuit breaker, SAFE-02/03 gates | Browser (`runner.js`) | — | Per-item decision immediately before spend |
| Cross-tab ownership | Browser (`localStorage` + `storage` events) | — | Same-origin tabs only; no server involvement |
| Resume/connection popups | Browser (`callGenericPopup`) | — | UI-SPEC locked |
| Prompt Inspector detection | Browser (`localStorage` flag) | — | PI keeps its toggle only in `localStorage` + a module variable |

## Standard Stack

No new runtime dependencies. No new dev dependencies.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vanilla ES modules | browser-native | All new modules | Locked project stack |
| `SillyTavern.getContext()` via `src/st-bridge.js` | ST 1.19.0 | `chatMetadata`, `saveMetadataDebounced`, `saveChat`, `callGenericPopup`, `POPUP_RESULT`, `chatCompletionSettings`, `textCompletionSettings`, `mainApi` | All verified on the context object (`st-context.js:119-229`) |
| `localStorage` + `storage` event, `setInterval` | Web platform | Lease, heartbeat, state mirror | Works on insecure origins (see Pattern 4) |
| Vitest | ^5.0.5 (installed, 70 tests green on Node v22.23.4) | Unit tests with fake bridge/storage/timers | Existing convention |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `localStorage` lease + heartbeat | Web Locks API (`navigator.locks`) | Auto-releases on tab death with no heartbeat, immune to timer throttling. But MDN: **secure contexts only**; many ST installs are plain `http://<lan-ip>:8000` where `navigator.locks` is undefined `[CITED: developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API]`. Optional enhancement behind feature detection only. |
| `localStorage` lease | BroadcastChannel only | No persisted state, so a new tab must ping and wait for a reply; a missed reply means two owners. Same-origin only, no secure-context restriction stated on the MDN page `[CITED: developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel]`. Fine as an *accelerator* (instant release/takeover notices), not as the authority. |
| Name-only preset compare | Hash of preset contents | Catches in-place preset edits but costs complexity and false positives; stay name-only (documented limit). |

**Installation:** none.

## Package Legitimacy Audit

No external packages are installed or recommended in this phase. slopcheck not needed.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
 ST events (eventSource)                                   user actions
 CHAT_CHANGED  MESSAGE_SENT/EDITED/DELETED/RECEIVED         control click / wand / /queueswipe
 GENERATION_STARTED/ENDED/STOPPED                                  |
        |                                                          v
        v                                              enqueue gate (shared helper)
  guard.js (thin subscriber, setTimeout(0) hops)        readonly? -> toast, stop
        |                                               inspector? -> refuse toast, stop
        v                                               store.add(fp)  [records connection snapshot]
  lifecycle.js (pure policy)                                     |
   |  chat change: runner.pause('restored'); epoch++; abort(requeue);   v
   |     store.rebind(load(metadata)) ; ownership.claim(chatKey)    store (bound chatKey, readOnly flag)
   |  edit/delete/sent: store.clear(reason) ; epoch++ ; toast        |  persist(): bound key == live key ?
   |  continue end: store.refingerprintAll() BEFORE resumeNative     |    ctx().chatMetadata[KEY]=serialize
   |  native start/end: runner.pause/resume('native')                |    saveMetadataDebounced() / saveChat()
   v                                                                 v
  runner.js  loop: paused? idle? -> processNext                 chat_metadata (inside chat file, ST saves)
   gate 0 owner? -> gate 1 inspector? -> gate 2 connection same?
   -> fingerprint status (ok | chat | target)
   -> generate (dry capture + own transport, abortOwn)
   -> park until idle -> epoch ok? -> fingerprint ok? -> owner? -> append
   -> breaker counter (api/empty++, success=0, trip -> pause('failures'))
   emits: onStateChange, onItemFailed, onItemDone, onConnectionChanged
        |
        v
  ui.js / progressBar.js / commands.js  render: Running | Paused(reason) | Waiting | Read-only
  popups.js (callGenericPopup): resume/discard, connection changed

  ownership.js (localStorage)                  other tab
   lease key  qs:lease:<chatKey> {tabId, ts}  <-- storage event / 2s heartbeat read-back
   state key  qs:state:<chatKey> {tabId, snapshot}  --> read-only tab store.applySnapshot()
```

### Recommended Project Structure
```
src/
├── st-bridge.js      # + connectionSnapshot(), promptInspectorEnabled(), chatKey(), event passthrough already there
├── store.js          # + bound chat key, persist hook, clear(reason), rebind(items), refingerprintAll, demote, setReadOnly/applySnapshot
├── persistence.js    # NEW pure: serialize(items), load(raw, liveChat, now) -> { items, dropped }, SCHEMA_VERSION
├── lifecycle.js      # NEW pure policy: handleChatChanged/Edited/Deleted/Sent/Received/GenStarted/GenEnded
├── ownership.js      # NEW pure(ish): lease + heartbeat + storage events, injected storage/clock/timers
├── connection.js     # NEW pure: diffConnection(old, new) -> changed field list; labels
├── popups.js         # NEW DOM: resume popup, connection popup (callGenericPopup); thin, live-smoke only
├── guard.js          # + CHAT_CHANGED, MESSAGE_SENT/EDITED/DELETED/RECEIVED subscriptions, forwards to lifecycle
├── runner.js         # reason-set pause, breaker, SAFE-02/03 gates, epoch, park-then-check, abort disposition
├── queueActions.js   # + enqueue(store, runner, n) shared add gate (replaces 3 duplicated add sequences)
└── ui.js/progressBar.js/commands.js  # paused/read-only render states, /queuestatus suffix
test/  persistence.test.js lifecycle.test.js ownership.test.js connection.test.js (+ extend runner/store/guard tests)
```

### ST event reference (all verified in 1.19.0)

| Event | Constant -> string (`events.js`) | Payload | Emit site | Notes |
|-------|------|---------|-----------|-------|
| Chat change | `CHAT_CHANGED` = `'chat_id_changed'` | `getCurrentChatId()` (may be `undefined` when no chat open) | `script.js:7700` (inside `getChatResult`), `:1723` (neutral reload), `:10760` (closeCurrentChat), `:10913`, group `group-chats.js:318` | **Also fires for same-chat reloads** (`reloadCurrentChat`, e.g. after `MESSAGE_SENT` with `insertAt`, `script.js:5911`). Must be deduped by chat key. Fires AFTER `chat`/`chat_metadata` were already swapped. |
| Message sent (user) | `MESSAGE_SENT` | new message index (`chat.length-1`, or `insertAt`) | `script.js:5910, 5917`; slash `/send`-family in `slash-commands.js:6058-6149` | Emitted after `chat.push` and `saveChatConditional`. Not emitted for AI messages. |
| Message edited | `MESSAGE_EDITED` | `this_edit_mes_id` (index) | `script.js:8405` (messageEditDone), slash `/setmes`-style `slash-commands.js:5850, 5916` | Emitted on edit *done*. Edit cancel fires only `MESSAGE_UPDATED` (`script.js:8337`). |
| Message deleted | `MESSAGE_DELETED` | **new `chat.length`**, not an id | `script.js:1611` (deleteLastMessage), `:1699` (deleteMessage), `:4411` (regenerate removes last message), `:11734` (bulk delete) | Any deletion changes `chat.length`, so every stored fingerprint (which includes `chatLength`) goes stale. |
| Message received (AI) | `MESSAGE_RECEIVED` | `(messageId, type)` | `script.js:6691` etc; native **swipe** emits `(chat.length-1, 'swipe')`, **continue** emits `(chat.length-1, 'continue')` | Must filter: only `id > target.mesId` and `type` not in `swipe`/`continue` counts as "a new message". Our own appends do not emit it (`appender.js`). |
| Generation started | `GENERATION_STARTED` | `(type, params, dryRun)` | `script.js:4299` | Fires for every `Generate` call, including ones that later bail out. `type` is `normal/regenerate/swipe/continue/impersonate/quiet`. |
| Generation stopped | `GENERATION_STOPPED` | none | `script.js:5618` in `stopGeneration()` | No owner info. Our queue cancel never calls `stopGeneration()` (adapter `abortOwn`), so every occurrence is foreign (user Stop button, Prompt Inspector cancel, another extension). |
| Generation ended | `GENERATION_ENDED` | `chat.length` | `script.js:3536` inside `hideStopButton()` | Only fires if the stop button was visible (non-NOOP guard); can be missed. |
| Preset/API change (not needed) | `MAIN_API_CHANGED`, `CHATCOMPLETION_SOURCE_CHANGED`, `CHATCOMPLETION_MODEL_CHANGED`, `PRESET_CHANGED`, `OAI_PRESET_CHANGED_AFTER`, `CONNECTION_PROFILE_LOADED` | various | `events.js:35-96` | **Do not subscribe.** The UI-SPEC check is per item immediately before start; read the live values then. |

### Pattern 1: Reason-set pause in the runner
**What:** `paused` becomes `Set<reason>`. `pause(reason)` adds, `resume(reason)` removes just that reason, `resumeAll()` (user Resume after gates pass) clears the set. `isPaused()`, `getPauseReasons()`, `getPrimaryReason()` with a fixed priority for display: `takeover > restored > inspector > connection > failures > native`. Only `native` is cleared by the guard. Add `onStateChange(cb)` (fired on pause set change, owner change, breaker trip) so the UI re-renders; `store.onChange` does not cover pause changes.
**Why:** otherwise guard's end-of-generation `resume()` silently un-pauses `restored`/`failures`/etc (spend-safety bug).
```js
// Source: derived from src/runner.js + 04-UI-SPEC.md "Resume button behavior"
const pauseReasons = new Set();
function pause(reason) { pauseReasons.add(reason); emitState(); }
function resume(reason) { // guard path: only the native reason
  if (reason) { pauseReasons.delete(reason); } else { pauseReasons.clear(); }
  emitState();
  return wake();
}
```

### Pattern 2: Epoch invalidation + park-then-check (GUARD-01/02/04, D-04)
**What:** `let epoch = 0` in the runner (or store). `lifecycle` bumps it on every clear (edit/delete/sent) and chat switch via `runner.invalidate()`. `processNext` captures `const myEpoch = epoch` before `generate`, then:
1. `generate()`; failure branches unchanged.
2. **Park**: `while (!isIdle(bridge)) await sleep(IDLE_RETRY_MS)` (no fingerprint check yet, result is already paid for).
3. `if (myEpoch !== epoch) -> discard silently` (store item already cleared by lifecycle; no `notifyFailed`).
4. `fingerprintStatus(bridge, item.fingerprint)` (read `item.fingerprint` fresh off the item object; `store.refingerprintAll` mutates in place).
5. `ownership.isOwner()`; else discard (demoted tab must not write the chat, D-10).
6. Existing `flushAppend` defer loop (keeps the append-race protection).
**Why:** Continue mutates the target mid-flight; a check before idle drops a good result. The epoch gives GUARD-02 a way to discard a running or parked item without reporting a failure (UI-SPEC: cleared items never enter the coalesced failure summary).

### Pattern 3: Chat-bound persistence (PERS-01)
**What:** The store holds `boundKey` (chat key it was loaded for). Every persist is:
```js
// Source: derived from ARCHITECTURE.md 3.5 + ST script.js:7744-7750 (metadata replaced before CHAT_CHANGED)
function persist({ immediate = false } = {}) {
  if (readOnly) return;
  const c = bridge.ctx();                       // fresh every time (Pitfall 3)
  if (!boundKey || bridge.chatKey(c) !== boundKey) return;      // chat already switched
  if (c.chat.length === 0 || (c.chatMetadata?.integrity ?? null) !== boundIntegrity) return;
  const live = serialize(items);                // only queued/running, status normalized to 'queued'
  if (live.items.length === 0) delete c.chatMetadata[MODULE_NAME];
  else c.chatMetadata[MODULE_NAME] = live;
  if (immediate) return c.saveChat();           // saveChatConditional, whole chat incl. metadata
  c.saveMetadataDebounced();
}
```
- `chatKey` = `${characters[characterId].avatar}/${chatId}` (group chats are excluded by `canQueue()`, `st-bridge.js`). Do not key on `chatId` alone: chat file names are unique per character folder, not globally.
- **Immediate `saveChat()` on enqueue only.** `clearChat()` cancels a pending debounced metadata save (`script.js:1588`), so a debounced write made <1s before a chat switch is lost. Enqueue is the only mutation where silent loss defeats PERS-01. For cancel/clear/done the loss window (<=1s, `relaxed` = 1000ms, `constants.js:14`) only ever makes a cancelled or finished item reappear in the resume popup, which needs user consent.
- **Persist-before-append:** the runner calls `store.persistExcluding(item.id)` (writes metadata without that item, no save call) immediately before `append`, so the appender's own `await c.saveChat()` (`appender.js` end) carries the updated queue in one write. Today `notifyDone` then `markDone` run *after* the append save, leaving a stale item on disk for up to 1s.
- `saveMetadataDebounced` re-checks only `groupId` and `characterId` before saving, not chat id (`extensions.js:89-117`), so a debounced callback that survives a switch within the same character saves the *new* chat. Harmless, but another reason persist must be key-bound.

### Pattern 4: Cross-tab ownership (SAFE-04, D-07..D-10)
**Mechanism (prescriptive):** `localStorage` lease + heartbeat, `storage` events for instant reaction.
- Keys: `queuedSwipes:lease:<chatKey>` = `{ tabId, ts }`; `queuedSwipes:state:<chatKey>` = `{ tabId, ts, snapshot }`. `tabId = crypto.randomUUID()` per page load (store.js already has a randomUUID/fallback pattern). Do not use `sessionStorage` ids (duplicated tabs copy it).
- Constants: `HEARTBEAT_MS = 2000`, `LEASE_TIMEOUT_MS = 5000` (D-09 numbers), `CLAIM_VERIFY_MS = 100`.
- **Claim at CHAT_CHANGED** (after dedupe): read lease; if absent or `now - ts > LEASE_TIMEOUT_MS` -> write own lease, wait `CLAIM_VERIFY_MS`, re-read; if still own -> owner (fresh-load path: popup eligible). If a fresh lease belongs to another tab -> read-only (toast once per chat load). A stale lease at load means the old owner is gone: this is a normal first-owner load (popup eligible), not a takeover.
- **Heartbeat tick (every 2s, owner):** re-read lease first. If `lease.tabId !== me` -> demote (D-10), `runner.pause('takeover')`-style hard gate, stop persisting. Else write `ts = now`.
- **Read-only tick:** if lease missing or stale -> claim (verify as above) -> `takeover` path: owner, `runner.pause('takeover')`, toast, **no popup**, no auto-run (D-08).
- **Release:** on chat switch (before claiming the new chat), and `pagehide` (and optionally `beforeunload`): `removeItem` for lease + state keys if owned. A `storage` event with `key === lease key && newValue === null` in a read-only tab triggers an immediate claim attempt. MDN: `storage` fires only in *other* documents, never the writer `[CITED: developer.mozilla.org/en-US/docs/Web/API/Window/storage_event]`; `pagehide` is "not reliably fired" so the 5s timeout is the real backstop `[CITED: developer.mozilla.org/en-US/docs/Web/API/Window/pagehide_event]`.
- **State mirror:** owner writes `state:<chatKey>` on every `store.onChange`/pause change (small JSON: `{ items:[{id,status,createdAt}], completed, pauseReason, breakerN }`, validate numbers/strings on read). Read-only tabs call `store.applySnapshot(items)` (no persistence, `readOnly` flag set) so every existing UI read (`pendingCount`, `getItems`, ...) works unchanged. Progress-bar `completed` must come from the snapshot in read-only mode (it currently lives as a closure variable in `progressBar.js`).
- **Owner re-check before any chat write:** `ownership.isOwner()` is read in `processNext` (start and pre-append) and in `store.persist`. A throttled former owner that wakes mid-generation must discard its result instead of appending.
- **Fail mode:** if `localStorage` throws (disabled/quota), log once and run as owner (single-tab users must not be locked out). Flag for confirmation (A4).
- **Known limit:** Chrome intensive timer throttling of a long-hidden owner tab can exceed 5s between heartbeats; the other tab then takes over *paused* (acceptable per D-09) and the old owner demotes on wake (D-10). Optional later enhancement: add a Web Lock when `navigator.locks` exists.
- Housekeeping: on init, remove `queuedSwipes:*` keys whose `ts` is older than 1h (crashed tabs leave keys).

### Pattern 5: Connection snapshot (SAFE-02)
Record at `store.add` (the store already receives `bridge`, so the three add sites need no change) and compare in `processNext` before starting each item.
```js
// Source: ST script.js:7039-7070 (getGeneratingApi/Model), openai.js:412 (preset_settings_openai), textgen-settings.js:378 (preset)
export function connectionSnapshot() {
  const c = ctx();
  let preset = null;
  if (c.mainApi === 'openai') preset = c.chatCompletionSettings?.preset_settings_openai ?? null;
  else if (c.mainApi === 'textgenerationwebui') preset = c.textCompletionSettings?.preset ?? null;
  return { api: getGeneratingApi() ?? null, model: getGeneratingModel() ?? null, preset };
}
```
- Compare field by field; skip a field when either side is `null`/`''`. `diffConnection(old, cur)` returns the changed field names; the popup lists only those (UI-SPEC).
- `getGeneratingModel()` returns `online_status` for textgen/kobold, which becomes `'no_connection'` on a dropped backend: that reads as a model change and pauses, which is the safe outcome (the label may read oddly; acceptable).
- Name-only preset compare cannot see an in-place edit of a saved preset (documented limit, A2).
- `OK Continue queue` updates `item.connection` for all remaining items (`store.setConnectionAll(snapshot)`), then `resumeAll`. Persist after.

### Pattern 6: Prompt Inspector probe (SAFE-03)
- PI (installed at `data/<user>/extensions/Extension-PromptInspector`) keeps its toggle in the module variable `inspectEnabled`, initialised from `localStorage.getItem('promptInspectorEnabled') === 'true'` and written back on every toggle (`index.js:55-62`). The toggle does **not** emit an event, and `storage` events never fire in the same tab.
- Probe: `localStorage.getItem('promptInspectorEnabled') === 'true'` AND the extension is present and enabled: `extensionNames.some(n => getExtensionManifest(n)?.display_name === 'Prompt Inspector' && !extension_settings.disabledExtensions.includes(n))` (`disabledExtensions` default `[]` at `extensions.js:146`; the list uses the same names as `extensionNames`). The presence check prevents a stale flag from refusing forever after PI is uninstalled/disabled.
- Notice-it-turning-on: evaluate at (a) every add gate, (b) Resume, (c) per item in `processNext` (spec: pause *after* the current item), (d) render time, and (e) a 1s `setInterval` that only runs while the store has items (cheap `getItem`). No event exists to hook.
- **Observation for the planner (does not change the requirement):** PI skips dry runs (`index.js:64-72, 103-108`: `if (data.dryRun) return;`) and our transport never goes through a non-dry `Generate`, so PI would not actually pop its modal for queued items. SAFE-03 is therefore a conservative policy requirement (PITFALLS Pitfall 12 predates the dry-run design). Implement as specified; the false-negative cost of a missed detection is low.

### Pattern 7: Popup result handling (PERS-02, SAFE-02)
Verified in source: Resume button `data-result="1"` (`POPUP_RESULT.AFFIRMATIVE`), Cancel button `data-result="0"` (`POPUP_RESULT.NEGATIVE`), Esc and close resolve `null` (`POPUP_RESULT.CANCELLED`) (`popup.js:24-28, 602-611`; `index.html:6481-6482`). This resolves the UI-SPEC's "verify live" note: they are distinguishable.
```js
// Source: popup.js:24-28, 914-922; 04-UI-SPEC.md
const { callGenericPopup, POPUP_TYPE, POPUP_RESULT } = ctx();
const result = await callGenericPopup(contentEl, POPUP_TYPE.CONFIRM, '', { okButton: 'Resume queue', cancelButton: 'Discard queue' });
if (result === POPUP_RESULT.AFFIRMATIVE) { /* resume */ }
else if (result === POPUP_RESULT.NEGATIVE) { /* discard */ }
else { /* null or undefined: stay paused, keep items - never discard */ }
```
Only the exact `NEGATIVE` value discards. Build content from DOM nodes with `textContent`. **Never `await` a popup inside an `eventSource` handler**: `eventSource.emit` awaits listeners in order, so a popup opened in the `CHAT_CHANGED` handler would stall the entire chat load. Schedule it with `setTimeout(0)` and defer while `bridge.isGenerating()`.

### Persistence schema v1
```json
chat_metadata.queuedSwipes = {
  "version": 1,
  "items": [
    { "id": "uuid", "createdAt": 1761570000000,
      "target": { "mesId": 12, "chatLength": 13, "swipe0Hash": "1a2b3c:482", "name": "Alice" },
      "connection": { "api": "openai", "model": "gpt-x", "preset": "Default" } }
  ]
}
```
- No prompts, no text, no status (everything stored is `queued`; `running` is normalized on write, and D-02's demote-on-load still runs defensively for foreign/older writes), no `attempts`, no `paused`, no breaker counter (D-12).
- `chatId` and `integrity` are **not** stored: they are the containing chat's own identity. On load, rebuild the full in-memory fingerprint with the *live* `chatId`/`integrity` after validating the target part. This keeps a renamed chat (`renameChat`) valid.
- `createdAt` is epoch ms (the in-memory item uses a `Date`; convert both ways).
- `connection` is per item (UI-SPEC: "recorded on the item at queue time"; mixed values show the oldest).
- Delete the key when the queue is empty.

### Load algorithm (PERS-01..04, runs on distinct-chat `CHAT_CHANGED`)
1. `raw = ctx().chatMetadata?.[MODULE_NAME]`. Validate defensively (it is untrusted data inside an importable chat file): object, `version === 1` (unknown version -> ignore and leave untouched), `items` is an array, take at most `HARD_MAX_QUEUE` (20), each item must have string `id`, finite `createdAt`, `target` with finite `mesId`/`chatLength`, string `swipe0Hash`/`name`, `connection` object with string-or-null fields. Invalid items count as dropped.
2. Drop if `now - createdAt > 24h` (D-01) or `createdAt` is in the future by more than a small skew.
3. Drop if target part mismatches the live chat: `mesId === chat.length - 1`, `chatLength === chat.length`, `hash(m.swipes?.[0] ?? m.mes) === swipe0Hash`, `name === m.name`, message is not user/system (D-03).
4. Demote any stored `running` to `queued` (D-02). Rebuild full fingerprints with live `chatId`/`integrity`.
5. `dropped = rawCount - kept`. Persist the cleaned list immediately if anything was dropped (so the notice does not repeat on the next load).
6. UI order (UI-SPEC): `restored` pause first, then if `dropped > 0` the PERS-04 toast, then (if kept > 0 and owner and idle) the resume popup, deferred with `setTimeout(0)`; at most once per chat load.
7. Connection merge: if any kept item's `connection` differs from `connectionSnapshot()`, use the single combined popup (UI-SPEC "Combined case"); OK counts as SAFE-02 consent and updates the recorded connection.

### Lifecycle policy (GUARD-01/02/03/06, D-04..D-06)

| Trigger | Action |
|---------|--------|
| `CHAT_CHANGED` (key and integrity equal to bound) | Same-chat reload: do **not** abort, clear or re-prompt. Re-bind to the new `chatMetadata` object and call `store.persist()` so the in-memory queue overwrites whatever the server returned. |
| `CHAT_CHANGED` (different chat or `chatId` undefined) | In this order, synchronously: `runner.pause('restored')`; `runner.invalidate()` (epoch++); `runner.abortRunning({ disposition: 'requeue' })` (no failure report, item not counted); `ownership.release(oldKey)`; `store.rebind(null)`; if `chatId` defined: `ownership.claim(newKey)`, then load algorithm. Reset breaker counter, accumulator and `completed`. |
| `MESSAGE_EDITED(id)` where `id === target.mesId` | `store.clear('edited')`, `runner.invalidate()`, one toast with `n` = pending + running. Any swipe edited counts (D-05). Other ids: ignore. `MESSAGE_UPDATED`: ignore. |
| `MESSAGE_DELETED(newLength)` | If `fingerprintStatus` of the queue is no longer `ok` (always true after any deletion because `chatLength` changed): `store.clear('deleted')`, toast. This includes regenerate, which deletes the last message (`script.js:4411`); the "was deleted" copy is accurate for that case. |
| `MESSAGE_SENT(id)` | `store.clear('sent')`, toast. |
| `MESSAGE_RECEIVED(id, type)` with `id > target.mesId` and `type` not in `{swipe, continue}` | Recommended addition to CONTEXT: an empty-textarea "send" or other extensions can append an AI message with no `MESSAGE_SENT` (target is no longer last). Clear with the `sent` copy. Native swipe emits `MESSAGE_RECEIVED(target, 'swipe')` and continue emits `(target, 'continue')`; both must not clear (D-04, D-06). |
| `GENERATION_STARTED(type, _, dryRun === false)` | `runner.pause('native')`. If `type === 'continue'`, record `continueTarget = ctx.chat.length - 1`. |
| `GENERATION_ENDED` / `GENERATION_STOPPED` | In one scheduled task, in this order: (1) if `continueTarget != null` and the chat key, `mesId === chat.length - 1` and all non-content fingerprint fields still match -> `store.refingerprintAll(buildFingerprint(ctx, mesId))`, clear `continueTarget`; (2) `runner.resume('native')`. Re-fingerprint **must** precede resume or the resumed runner's check drops the queue. Treat STOPPED the same as ENDED (a Stopped Continue leaves partial text). |
| Idle watchdog | While `native` is in the pause set, poll `isIdle(bridge)` every 500ms; two consecutive idle polls clear `native`. Needed because `GENERATION_ENDED` can be missed and `GENERATION_STARTED` fires even for calls that bail before generating. |

GUARD-06: nothing special to implement beyond not calling `stopGeneration()` anywhere and letting `GENERATION_STOPPED` clear only `native`. Add a unit test that the queue-cancel path (`cancelAll`) never invokes the bridge's `stopGeneration`.

### Runner changes (summary of `processNext` order)
1. `isOwner()` else return without starting.
2. `promptInspectorEnabled()` -> `pause('inspector')`, emit toast event, return (current item already finished by construction).
3. SAFE-02: `diffConnection(item.connection, connectionSnapshot())` non-empty -> `pause('connection')`, emit `onConnectionChanged({ item, changed, old, current })`, return. UI shows the popup.
4. `fingerprintStatus` returns `'ok' | 'chat' | 'target'`. `'chat'` (chatId/integrity differ, i.e. a switch is in progress): `pause('restored')`, **leave items untouched**, return. `'target'`: existing stale drop.
5. `markRunning`, `generate`, then the Pattern 2 sequence.
6. Breaker (D-12): `reason === 'api' || 'empty'` -> `consecutive++`; if `>= threshold` -> `pause('failures')`, emit; `done` -> `consecutive = 0`; `cancelled`/`stale`/discard -> unchanged. Threshold read live each time (`extension_settings[MODULE_NAME].circuitBreakerThreshold`, injected as `getThreshold` for tests; clamp to 1..10, fall back to 3). `resumeAll()` zeroes it.
7. `abortRunning({ disposition })`: `'cancel'` (default, today's behavior) drops with `cancelled`; `'requeue'` flips the item back to `queued` with no notify (chat-switch); `'discard'` for lifecycle clears.

### Anti-Patterns to Avoid
- **Awaiting a popup, a save, or runner work inside an `eventSource` handler.** `emit` awaits listeners sequentially (`script.js` emit sites use `await eventSource.emit`). Always `setTimeout(0)` out, as `guard.js` already does.
- **Treating `CHAT_CHANGED` as "chat switched".** It also fires on same-chat reloads.
- **Persisting from a cached `chatMetadata`.** `ctx().chatMetadata` is replaced on switch and reload; always call `bridge.ctx()` fresh (Pitfall 3).
- **Auto-clearing any pause on `GENERATION_ENDED`.** Only `native`.
- **Subscribing to preset/API events to detect connection changes.** Per-item live compare is simpler and exact.
- **Three copies of the add sequence.** `ui.js onControlClick`, `wandMenu.js` and `commands.js` each duplicate clamp + `buildFingerprint` + `store.add` + `wake`. Adding the Prompt Inspector and read-only gates to three places will drift; extract `enqueue(store, runner, count)` in `queueActions.js` first (the `/queueswipe` path must keep its existing `enabled` check rather than `canQueue()`, per the comment in `commands.js`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Confirm dialogs | Custom modal | `ctx().callGenericPopup` + `POPUP_TYPE.CONFIRM` + `POPUP_RESULT` | Locked by UI-SPEC; result codes verified |
| Saving | `fetch('/api/chats/save')` or writing `chat.jsonl` | `ctx().saveMetadataDebounced()` / `ctx().saveChat()` | Locked decision |
| UUIDs | Custom id generator | `crypto.randomUUID()` (already in `store.js`, fallback present) | Already the project pattern |
| Target identity hash | New hash | `hash()` in `src/fingerprint.js` | Reuse; D-03 |
| Cross-tab lock via polling the chat file | Server-side lock | `localStorage` lease | No server plugin allowed |
| Toast dedupe | Own throttle | `toastr.*(msg, '', { preventDuplicates: true })` | UI-SPEC requires `preventDuplicates` |

**Key insight:** every "lifecycle" feature here is a *policy over events ST already emits*; the risk is almost entirely ordering (what happens before `CHAT_CHANGED`, what must run before `resume`) and state ownership (which chat's metadata, which tab), not missing APIs.

## Common Pitfalls

### Pitfall 1: Items dropped or persisted into the wrong chat during a switch
**What goes wrong:** `openCharacterChat` clears `chat`, sets `chat_metadata = {}` and cancels the debounced metadata save, *then* fetches the new chat (`script.js:7744-7750`, `1587-1589`); `CHAT_CHANGED` fires only at the end (`:7700`). In between, `fingerprintMatches` is false and `ctx().chatMetadata` is empty or new.
**Why:** one global store, runner checks fingerprint on every loop iteration.
**How to avoid:** `fingerprintStatus` `'chat'` = pause and keep; persist is key- and integrity-bound and refuses an empty chat; `CHAT_CHANGED` handler pauses *before* rebinding.
**Warning signs:** queue silently empty after switching back; another chat's metadata containing `queuedSwipes`.

### Pitfall 2: After abort, the loop starts the next chat's items
**What goes wrong:** the aborted `generate()` resolves later; the `loop()` continues and `peekNext()` now sees the rebound store's items, unpaused.
**How to avoid:** `pause('restored')` synchronously at the top of the chat-change handler; epoch check after generate; `loop()` already checks `paused` each iteration.

### Pitfall 3: Spurious "0 queued swipe(s) completed." toast on clear or rebind
**What goes wrong:** `ui.js` drain detection flushes when active goes to 0; with `completed === 0` and no failures it still calls `toastr.success`. Lifecycle clears and chat rebinds drain the store.
**How to avoid:** add `acc.reset()` (called on rebind/clear) and suppress the success toast when `completed === 0` and no failures. Add a regression test in `toastAccumulator.test.js`/UI flush logic if the flush is extracted.

### Pitfall 4: Parked result dropped as stale because of Continue
See Pattern 2 and the lifecycle table. Also remember `item.fingerprint` must be mutated in place so the already-captured `item` reference in `processNext` sees the refresh.

### Pitfall 5: Guard end-of-generation clears non-native pauses
See Pattern 1. Existing `guard.test.js` asserts `runner.resume` is called on ENDED/STOPPED; update to `resume('native')`.

### Pitfall 6: `native` pause stuck forever
`GENERATION_STARTED` fires for every `Generate` call even when it aborts early (comment at `script.js:4298`), and `GENERATION_ENDED` only fires if the stop button was visible (`script.js:3531-3537`). Without the idle watchdog the queue can wait on a generation that never existed.

### Pitfall 7: Initial `CHAT_CHANGED` may precede extension init
Extensions activate inside `getSettings` (`script.js:8024`) which runs before `getCharacters()` (`:759`) and `APP_READY` (`:790`), so the first chat load usually comes after init, but this ordering was not confirmed live. Make the load path idempotent (keyed on bound chat key) and also call it from `APP_READY` and at the end of `init()` when `ctx().chatId` is already set. Verify on a real refresh in live smoke.

### Pitfall 8: Resume popup inside the event handler / in a read-only tab / during native generation
See Pattern 7 and UI-SPEC "Never" list. Gate on `ownership.isOwner()`, `!isGenerating()`, and a per-load `popupShown` flag; defer with a retry timer while generating.

### Pitfall 9: Heartbeat throttling and simultaneous tab open
Two tabs opened within the same instant can both read "no lease". The 100ms write/verify re-read plus the heartbeat read-back demotion (D-10) resolves it; neither tab auto-runs (both are in the paused `restored` state until a human clicks), so the worst case is a briefly duplicated popup in the loser. Close the loser's popup on demotion if open.

### Pitfall 10: Regenerate deletes the target message
`Generate('regenerate')` removes the last message and emits `MESSAGE_DELETED` (`script.js:4411`). The queue clears with the "deleted" toast. This is correct (the old target is gone) but surprising; mention in the live smoke list.

### Pitfall 11: Capture window race
A native generation can start between the runner's idle check and the capture's dry-run `Generate`. This predates Phase 4 (Phase 2 scope) and is narrow; do not expand scope, but note it if a live smoke shows overlapping `Generate` calls.

## Code Examples

### Same-chat vs switch dedupe (lifecycle)
```js
// Source: derived from ST script.js:5911 (reloadCurrentChat after MESSAGE_SENT) and 7700
function handleChatChanged() {
  const c = bridge.ctx();
  const key = c.chatId ? bridge.chatKey(c) : null;
  const integrity = c.chatMetadata?.integrity ?? null;
  if (key && key === state.boundKey && integrity === state.boundIntegrity) {
    store.persist();               // same chat reloaded: our in-memory queue wins
    return;
  }
  runner.pause('restored');        // 1. stop anything new from starting
  runner.invalidate();             // 2. discard in-flight/parked result
  runner.abortRunning({ disposition: 'requeue' });   // 3. no failure report
  ownership.release();
  store.rebind(null);
  if (!key) return;
  state.boundKey = key; state.boundIntegrity = integrity;
  const owner = ownership.claim(key);              // may resolve after CLAIM_VERIFY_MS
  // ... then load algorithm; popup via setTimeout(0)
}
```

### Lease tick (ownership)
```js
// Source: derived from CONTEXT D-07..D-10, MDN storage event semantics
function tick() {
  const lease = readLease(key);
  if (role === 'owner') {
    if (!lease || lease.tabId !== tabId) return demote();          // D-10
    writeLease(key, { tabId, ts: now() });
  } else if (!lease || now() - lease.ts > LEASE_TIMEOUT_MS) {
    claim({ viaTakeover: true });                                   // paused, no popup
  }
}
window.addEventListener('storage', (e) => { if (e.key === leaseKey) tick(); });
window.addEventListener('pagehide', () => release());
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `callPopup` | `callGenericPopup` + `POPUP_RESULT` | already deprecated in 1.19 | Use only the new API |
| `chat_metadata` import from `script.js` | `ctx().chatMetadata`, replaced on every load | n/a | Fresh `ctx()` every access |
| `getContext().chatMetadata` assumed stable | New object on every chat load/reload (`script.js:7745`, `getChat` assigns from the server) | n/a | Never hold a reference |

**Deprecated/outdated:** PITFALLS Pitfall 12's premise (that queued items hit the PI modal) is outdated by the dry-run capture + own transport design; the policy requirement stands.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `pagehide` fires on same-tab reload in Chrome and Firefox (MDN says "not reliably fired" and does not mention reload) | Pattern 4 | A refreshed single tab shows read-only for up to 5s; then takes over paused with the takeover toast and **no resume popup**. Confirm in live smoke on desktop; mobile (Termux) browsers will hit this path more often. |
| A2 | Preset identity by name only: `oai_settings.preset_settings_openai` for chat completion, `textgenerationwebui_settings.preset` for text completion; other APIs record `null` and compare api+model only | Pattern 5 | In-place preset edits or kobold/novel preset changes are not detected. Confirm this is acceptable for v1. |
| A3 | Prompt Inspector presence is identified by manifest `display_name === 'Prompt Inspector'` (value seen in the installed manifest) | Pattern 6 | If a fork renames it, detection never triggers; low cost because PI skips dry runs anyway. |
| A4 | On `localStorage` failure, fail open (run as owner) | Pattern 4 | Two tabs could both run in a storage-disabled browser. Alternative is fail-closed read-only, which would lock out the only tab. Needs user confirmation. |
| A5 | Initial-load `CHAT_CHANGED` may fire before extension init, handled by the `APP_READY`/init-time catch-up | Pitfall 7 | If missed without the catch-up, no resume popup after refresh. Verify live. |
| A6 | `MESSAGE_RECEIVED` filter (`id > target`, type not swipe/continue) as an additional "new message" trigger beyond `MESSAGE_SENT` | Lifecycle table | If wrong, an AI message appended by an empty "send" is caught only silently by the stale fingerprint (no toast). Not in CONTEXT; flag for confirmation. |
| A7 | Immediate `saveChat()` on enqueue is safe (the control is only present while swipes are allowed, i.e. idle) | Pattern 3 | `/queueswipe` can run mid-send inside a slash callback (`is_send_press` true); a save then writes the in-progress chat state like any ST autosave. Low risk, but confirm via live smoke. |
| A8 | Chrome intensive throttling can delay a hidden owner's heartbeat past 5s | Pattern 4 | Spurious paused takeover. Accepted by D-09. |

## Open Questions

1. **Takeover toast with an empty queue**
   - What we know: UI-SPEC shows the takeover toast ("It is paused; resume from the queue badge") whenever a read-only tab becomes owner.
   - What's unclear: with 0 stored items there is nothing to resume.
   - Recommendation: show the toast only when `store` holds at least 1 item; otherwise become owner silently. Minor UI-SPEC deviation, needs a nod.
2. **Refresh with a missed `pagehide` (A1)**
   - Recommendation: ship the 5s-stale-lease-as-fresh-load rule; revisit with a BroadcastChannel liveness ping only if live smoke shows a problem.
3. **Progress-bar `completed` in read-only tabs**
   - `completed` is a closure variable in `progressBar.js`. Recommendation: owner includes it in the state snapshot; extract a tiny shared `runStats` or put it on the snapshot, whichever is smaller.
4. **Does `GENERATION_ENDED` reliably fire for native swipe/continue completion on 1.19.0?**
   - Mitigated by the idle watchdog; confirm in live smoke which path actually clears `native`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Vitest | yes | v22.23.4 | none needed |
| Vitest | unit tests | yes | 5.0.5 (70 tests pass) | none needed |
| Live SillyTavern 1.19.0 | manual smoke | yes | installed at `E:\SillyTavern` (git copy `D:\repositories\SillyTavern`, same commit `06bde939f`) | none; required for the multi-tab and popup smoke |
| claude-in-chrome | live smoke driver | per Phase 2 decision (D-11) | n/a | manual browser run |
| Prompt Inspector extension | SAFE-03 smoke | yes | installed (`Extension-PromptInspector`, manifest 1.1.0) | n/a |

**Missing dependencies with no fallback:** none.

## Validation Architecture

> `workflow.nyquist_validation` is `false` in `.planning/config.json`; included because the orchestrator explicitly requested it.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^5.0.5, `node` environment, fake timers |
| Config file | none (zero-config ESM); `package.json` `"test": "vitest run"` |
| Quick run command | `npx vitest run test/<file>.test.js` |
| Full suite command | `npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GUARD-01 | Native start pauses `native` only; end clears only `native`; parked result waits for idle then appends; watchdog clears stuck `native`; Continue re-fingerprint precedes resume | unit | `npx vitest run test/guard.test.js test/runner.test.js test/lifecycle.test.js` | partial (extend) / lifecycle Wave 0 |
| GUARD-02 | Edit on target clears + toast n; edit of earlier msg ignored; `MESSAGE_UPDATED` ignored; delete any -> clear; sent -> clear; `MESSAGE_RECEIVED` swipe/continue ignored, new id clears; epoch discards running item silently; n=0 no toast | unit | `npx vitest run test/lifecycle.test.js` | Wave 0 |
| GUARD-03 | Chat switch: pause before rebind, abort with requeue (no failure), items persisted for old key and not written to new; same-key `CHAT_CHANGED` is a no-op reload | unit | `npx vitest run test/lifecycle.test.js test/store.test.js` | Wave 0 / extend |
| GUARD-06 | `cancelAll` never calls `stopGeneration`; `GENERATION_STOPPED` clears only `native` | unit | `npx vitest run test/queueActions.test.js test/guard.test.js` | extend |
| PERS-01 | `serialize` has no prompt/text/status fields; add writes `chatMetadata[KEY]` and calls debounced/immediate save; empty queue deletes key; persist is skipped when bound key != live key or chat empty | unit | `npx vitest run test/persistence.test.js test/store.test.js` | Wave 0 / extend |
| PERS-02/03 | Load yields `restored` pause before popup; popup only once per load, not when read-only/0 items/native running; result 1 resumes, 0 discards, null stays paused | unit (popup logic with injected `showPopup`) + manual | `npx vitest run test/lifecycle.test.js` | Wave 0 |
| PERS-04 | Expired (>24h), target-mismatch, malformed, over-cap items dropped; `running` demoted; count correct; cleaned list persisted | unit | `npx vitest run test/persistence.test.js` | Wave 0 |
| SAFE-01 | Counter counts api/empty only, resets on success/Resume/chat switch; trips at live threshold; no retry; remaining items stay queued | unit | `npx vitest run test/runner.test.js` | extend |
| SAFE-02 | Snapshot recorded at add; per-item diff pauses `connection` and emits event; Continue updates all remaining items; null fields skipped | unit | `npx vitest run test/connection.test.js test/runner.test.js` | Wave 0 / extend |
| SAFE-03 | Probe true only if flag true and extension present/enabled; add gates refuse; per-item check pauses after current item; Resume refused | unit | `npx vitest run test/runner.test.js test/queueActions.test.js` | extend |
| SAFE-04 | First claim wins; second reads read-only; heartbeat; takeover after 5s paused with no popup; demotion when lease changes (D-10); release on chat switch/pagehide; stale lease at load = fresh owner; read-only never persists | unit (fake storage, fake timers, fake `storage` events) | `npx vitest run test/ownership.test.js` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run test/<touched>.test.js`
- **Per wave merge:** `npm test`
- **Phase gate:** full suite green, plus the manual live-smoke checklist below, before `/bm:verify-work`

### Manual live smoke (ST 1.19.0 at `E:\SillyTavern`, claude-in-chrome or manual)
1. Refresh with 2 queued items: queue starts paused, popup shows count + model line, Resume runs, Discard clears + toast, Esc keeps paused.
2. Initial page load straight into a chat (Pitfall 7): popup appears without a chat switch.
3. Native swipe / Continue / Send / Stop mid-queue: queue waits, resumes, Continue keeps the queue (D-04), Stop resumes with no toast.
4. Edit target (including edit of swipe != 0), delete last message, Regenerate (clears with "deleted"), send a message: one toast each, nothing generated afterwards.
5. Switch chat mid-run and back within <1s and after >2s: item aborted without failure toast, pending preserved, popup on return, no cross-chat metadata.
6. Change model/preset while queued, Resume: connection popup; Continue queue updates items.
7. Three consecutive forced failures (e.g. invalid key): paused `failures`, one toast, no retry.
8. Prompt Inspector on: control click / wand / `/queueswipe` / Resume refuse; turning it on mid-queue pauses after the current item.
9. Two tabs, same chat: second read-only; close first: second takes over paused with toast, no popup; throttle/suspend the first and verify it demotes on wake (D-10).
10. Inspect the saved chat JSON: `chat_metadata.queuedSwipes` contains no prompt or message text.

### Wave 0 Gaps
- [ ] `test/persistence.test.js` (PERS-01, PERS-04)
- [ ] `test/lifecycle.test.js` (GUARD-01/02/03, PERS-02/03 popup logic)
- [ ] `test/ownership.test.js` (SAFE-04)
- [ ] `test/connection.test.js` (SAFE-02)
- [ ] Extend `test/runner.test.js`, `test/store.test.js`, `test/guard.test.js`, `test/queueActions.test.js`
- Shared helper: a fake `localStorage`/`storage`-event emitter and a fake clock (no new framework needed)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | ST handles auth; no secrets stored |
| V3 Session Management | no | n/a |
| V4 Access Control | partial | Tab ownership prevents a second tab from acting on the same queue |
| V5 Input Validation | yes | Strict schema validation of `chat_metadata.queuedSwipes` and `localStorage` state snapshots; `textContent` only for any rendered model/api/preset string |
| V6 Cryptography | no | `crypto.randomUUID()` for ids only; no crypto decisions |

### Threat model inputs

| Threat | STRIDE | Standard Mitigation |
|--------|--------|---------------------|
| Imported or shared chat file carries a crafted `queuedSwipes` blob (oversized, wrong types, huge counts) | Tampering / DoS | Version check, type validation per field, cap at `HARD_MAX_QUEUE` (20), 24h expiry, target-part fingerprint match, **paused on load + explicit consent** before any spend |
| Same crafted blob to inject markup via model/api/preset strings in popups/dropdown | Tampering (XSS) | Render only via `textContent`; never `innerHTML` (UI-SPEC rule) |
| Queue persisted into the wrong chat during switch/reload | Tampering / Information disclosure | Chat-key + integrity bound persist; refuse when chat empty; pause-and-keep on identity mismatch |
| Surprise API spend: auto-run after refresh, takeover, connection change; runaway retries; two tabs running one queue | Elevation / Repudiation of spend | Paused-by-default for `restored`/`takeover`; per-item SAFE-02 check; breaker (default 3, no retries); lease + D-10 demotion + owner re-check before append; `HARD_MAX_QUEUE` |
| Other script or extension forges `localStorage` lease/state keys | Spoofing | Treated as untrusted: validate shapes/types, worst case is a read-only tab (DoS) or a wrong count display; the queue state of record is `chat_metadata`, never the mirror |
| Prompts or secrets leaking into the chat file (exportable) | Information disclosure | Persist ids, timestamps, hashes, names, api/model/preset names only; asserted by a unit test and live smoke step 10 |
| Late result from an aborted/old-epoch item appended to the wrong message or chat | Tampering | Epoch check + fingerprint check + owner check immediately before append; appender's own `mesId`/`is_user` checks remain |
| Timer/listener leaks after chat switch or disable | DoS | `ownership.stop()`, interval cleared on release; guard `stop()` already removes listeners |

## Sources

### Primary (HIGH confidence)
- ST 1.19.0 source, `D:\repositories\SillyTavern\public\`: `scripts/events.js` (names), `script.js` lines 1587-1589, 1611, 1699, 1723, 3531-3537, 4299, 4411, 5618, 5910-5919, 6691, 7039-7070, 7395-7440, 7640-7710, 7744-7750, 8337, 8405, 9408-9439, 10760, 10913, 11734; `scripts/st-context.js` 119-229; `scripts/extensions.js` 75-117, 146; `scripts/popup.js` 24-28, 575-615, 755-810, 906-922; `index.html` 6481-6482; `scripts/constants.js` 6-16; `scripts/textgen-settings.js` 378; `scripts/openai.js` 412.
- Prompt Inspector source, `E:\SillyTavern\data\*\extensions\Extension-PromptInspector\index.js` 55-125 and `manifest.json`.
- Project code: `index.js`, `src/{st-bridge,guard,runner,store,fingerprint,queueActions,ui,commands,wandMenu,progressBar,appender,adapter,toastAccumulator}.js`, `test/*`; `.planning/research/ARCHITECTURE.md` 3.3-3.5, `PITFALLS.md` Pitfalls 3, 12, ~213-215, ~283.

### Secondary (MEDIUM confidence)
- MDN Web Locks API (secure contexts only): https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API
- MDN BroadcastChannel (same-origin, no echo to sender): https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel
- MDN `storage` event (not fired in the writing document): https://developer.mozilla.org/en-US/docs/Web/API/Window/storage_event
- MDN `pagehide` (not reliably fired; bfcache `persisted`): https://developer.mozilla.org/en-US/docs/Web/API/Window/pagehide_event

### Tertiary (LOW confidence)
- Chrome intensive timer throttling behavior (A8): training knowledge only, not re-verified this session.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, no new dependencies.
- Architecture: HIGH for ST facts and code seams; MEDIUM for the cross-tab mechanism (browser behavior; needs live smoke).
- Pitfalls: HIGH for Pitfalls 1-6 (derived from verified source order); MEDIUM for 7-9.

**Research date:** 2026-10-27
**Valid until:** 2026-11-26 (ST release branch moves; re-check `events.js`/`popup.js` if ST updates past 1.19.0)
