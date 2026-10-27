# Phase 4: Lifecycle, Persistence & Spend Safety - Context

**Gathered:** 2026-10-27
**Status:** Ready for planning

<domain>
## Phase Boundary

The queue reacts sensibly to what the user does in ST (manual send/swipe/continue, edit, delete, new message, chat switch, native Stop), survives a page refresh and chat switches without surprise API spend (persisted in `chat_metadata`, paused on load, resume/discard prompt), and cannot run away (circuit breaker, connection-change pause, Prompt Inspector refusal, single-tab ownership). Requirements: GUARD-01, GUARD-02, GUARD-03, GUARD-06, PERS-01..04, SAFE-01..04.

All visual states, copy strings, popups, and toast rules are already locked by the approved `04-UI-SPEC.md`. This discussion covered only the behavioral rules the UI-SPEC left open. New capabilities are out of scope.

</domain>

<decisions>
## Implementation Decisions

### Stale & expiry on load (PERS-01, PERS-04)
- **D-01:** Stored items expire after a **fixed 24h** age (from the item's creation timestamp). Expired items are dropped on load and are included in the PERS-04 "Dropped {n} saved queued swipe(s)..." notice. No new setting. The UI-SPEC adds no settings field.
- **D-02:** An item stored with status `running` (the page was refreshed mid-generation) is **demoted to `queued`** on load. It counts in the resume popup and runs again if the user resumes. This matches ARCHITECTURE.md §3.4.
- **D-03:** The on-load stale check is **existing fingerprint + 24h age**. The fingerprint is chat id, integrity, last-message index/chat length, swipe0 hash and name (see `src/fingerprint.js`). A connection change (api/model/preset) does **not** make an item stale. The resume popup shows the change and asks (UI-SPEC "Combined case").

### Target-change edge cases (GUARD-01, GUARD-02)
- **D-04:** **Continue on the target message re-fingerprints the queue and keeps it.** It does not clear the queue. When the native Continue generation ends, every pending item and any in-flight or parked item adopts a fresh fingerprint of the target. This makes the append-time GUARD-04 check pass. Note: a swipe prompt does not include the target message, so a continuation does not change what queued items generate. Only the identity key needs a refresh. The queue still waits during Continue (GUARD-01). No toast. The planner must detect Continue specifically (generation type `continue` on the target index), so a real edit or delete is not re-fingerprinted by mistake.
- **D-05:** **Any `MESSAGE_EDITED` on the target index clears the queue** with the UI-SPEC "edited" toast, whichever swipe was edited (including swipes other than swipe 0). Edits of earlier messages leave the queue alone (ARCHITECTURE.md §3.4). `MESSAGE_UPDATED` alone never clears.
- **D-06:** **A manual native swipe on the target does not clear or reduce the queue.** The queue pauses during the native generation (GUARD-01), then resumes and appends its own pages. The fingerprint does not include swipe count, so it stays valid. The native swipe is not counted against pending items.

### Multi-tab ownership (SAFE-04)
- **D-07:** **First tab wins.** The tab that opened a chat first owns that chat's queue. Any tab that opens the chat later is read-only until the owner goes away. A new tab never steals a running queue.
- **D-08:** **Ownership is per chat.** If the owner tab switches to a different chat but stays open, a tab still showing the original chat takes over, in the paused `takeover` state with the takeover toast. It never auto-runs and never opens the resume popup (UI-SPEC).
- **D-09:** **Takeover after a few seconds of silence.** Heartbeat roughly every 2s, takeover after roughly 5s without a heartbeat. A graceful close (`pagehide`/`beforeunload`) or a chat switch releases ownership immediately, so takeover happens at once. The exact mechanism (BroadcastChannel vs `localStorage` events) is the planner's choice. A throttled background owner may briefly look gone. This is acceptable because takeover is always paused.
- **D-10 (derived, required for safety):** A former owner that finds another tab has taken over (for example, after its timers were throttled) must **demote itself to read-only**. It must not run or write `chat_metadata` for the queue. Two tabs must never run the same chat's queue at once.

### Circuit breaker (SAFE-01)
- **D-11:** **Default threshold stays 3** (shipped in Phase 3 D-10, used by the UI-SPEC). REQUIREMENTS.md SAFE-01 is updated from "default 2" to "default 3". Saved user values are kept by the existing merge-by-key logic.
- **D-12:** **The consecutive-failure counter is in-memory only.** It resets to 0 on reload, chat switch, success and Resume. It is not persisted in `chat_metadata`. Counted reasons are `api` and `empty` only. `cancelled` and `stale` never count (UI-SPEC).

### Claude's Discretion
- Multi-tab transport (BroadcastChannel vs `localStorage` storage events), tab-id generation, and exact heartbeat/timeout numbers within D-09's "a few seconds".
- `chat_metadata[MODULE_NAME]` schema details beyond PERS-01 (ids, timestamps, fingerprint, recorded api/model/preset; no prompts). Start from ARCHITECTURE.md §3.5. Include a `version` field.
- Which preset identifier is recorded for SAFE-02 (CC preset name vs TC preset), and how api/model/preset are read via the bridge.
- Prompt Inspector detection method (PITFALLS.md: `localStorage.promptInspectorEnabled === 'true'`), plus the polling or event used to notice it turning on mid-queue.
- How GUARD-06 tells native Stop apart from queue cancel. Queue cancel already uses its own AbortController (`abortOwn`) and never calls `stopGeneration()`. Native Stop only resumes the queue via `GENERATION_STOPPED` (UI-SPEC: no toast).
- How GUARD-03 aborts the running item on chat switch without reporting it as a failure. The aborted item stays stored in the original chat, demoted to `queued`.

</decisions>

<specifics>
## Specific Ideas

- Spend safety beats convenience in every ambiguous case: takeover is paused, reload is paused, a connection change asks first, and there are no retries.
- The user's own actions on the same message (Continue, manual swipe) must not destroy the queue. Only content changes (edit, delete) and a new message clear it.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 4 design contract
- `.planning/phases/04-lifecycle-persistence-spend-safety/04-UI-SPEC.md`: all copy, popups (resume/discard, connection changed, combined case), paused and read-only state table, circuit-breaker counting rules, Prompt Inspector refuse/pause rules, and takeover behavior. Approved. Do not contradict it.
- `.planning/phases/03-full-queue-control-ui/03-UI-SPEC.md`: inherited tokens, class names and copy.

### Requirements & decisions
- `.planning/REQUIREMENTS.md`: GUARD-01/02/03/06, PERS-01..04, SAFE-01..04 (SAFE-01 default corrected to 3 per D-11).
- `.planning/ROADMAP.md` Phase 4: success criteria 1-5.
- `.planning/PROJECT.md` Key Decisions: ask before resume, chat switch keeps the queue, manual generation pauses the queue.
- `.planning/phases/03-full-queue-control-ui/03-CONTEXT.md`: D-09 (notification style), D-10 (circuit-breaker setting), D-12 (live settings reads).
- `.planning/phases/02-single-queued-swipe-end-to-end/02-CONTEXT.md`: D-08/D-09 (failure toast taxonomy), D-10/D-11 (testing approach: Vitest for pure modules, manual live smoke via claude-in-chrome).

### Architecture & pitfalls
- `.planning/research/ARCHITECTURE.md` §3.3 (data flow, resume flow), §3.4 (Event Guard policy table), §3.5 (persistence schema).
- `.planning/research/PITFALLS.md`: Pitfall 3 (stale `getContext()` snapshots / `chat_metadata`), the chat-integrity pitfall (`checkChatIntegrity`), Pitfall 12 (Prompt Inspector blocking modal, detection flag), the expiry and multi-tab ownerId notes (~L213-215), and the `stopGeneration()` ownership notes (~L283).
- `.planning/phases/01-route-verification-spike/SPIKE-REPORT.md` and `SOURCE-FINDINGS.md`: verified event names and line citations (ST 1.19.0).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/store.js`: in-memory store. Its header comment already plans for Phase 4 to wrap `add`/`markDone`/`drop` with `chat_metadata` persistence without changing the public shape. Needs: load/serialize, clear-with-reason, a demote-running path, and a re-fingerprint path (D-04).
- `src/fingerprint.js`: `buildFingerprint(ctx, mesId)` / `fingerprintMatches(bridge, fp)`. Reused for the on-load stale check (D-03) and the Continue re-fingerprint (D-04).
- `src/runner.js`: `pause(reason)` ignores `reason` today, and there is a single boolean. Phase 4 needs reason-aware pause (native vs restored/failures/connection/inspector/takeover). Only `native` auto-resumes (UI-SPEC). Also needs the consecutive-failure counter (D-12) and a per-item SAFE-02 check before `processNext` starts an item. `abortRunning()` already exists for GUARD-03.
- `src/guard.js`: subscribes to `GENERATION_STARTED/ENDED/STOPPED` only. Phase 4 adds `CHAT_CHANGED`, `MESSAGE_SENT`, `MESSAGE_EDITED`, `MESSAGE_DELETED` handling, and Continue detection for D-04.
- `src/queueActions.js` `cancelAll()`: shared cancel path. The clear-with-toast behavior for GUARD-02 should reuse it or sit next to it.
- `index.js` `DEFAULT_SETTINGS.circuitBreakerThreshold: 3`, already present (D-11).

### Established Patterns
- All ST access goes through `src/st-bridge.js`. Always call `getContext()` fresh, never a cached snapshot (Pitfall 3).
- Event handlers schedule work via `setTimeout(0)` and never re-enter `eventSource.emit` (guard.js).
- Live settings reads on every check (Phase 3 D-12).
- Pure modules have Vitest unit tests in `test/` with a fake bridge. Adapter, appender, popups and multi-tab are verified by manual live smoke.

### Integration Points
- `index.js` wiring: a new ownership/tab module and a lifecycle/persistence wiring point.
- `src/ui.js` / `src/progressBar.js` / `src/commands.js`: paused/read-only render states and the `/queuestatus` suffix (UI-SPEC).
- `getContext().chatMetadata` + `saveMetadataDebounced()` for persistence. `callGenericPopup` + `POPUP_TYPE.CONFIRM` for the popups.

</code_context>

<deferred>
## Deferred Ideas

None. The discussion stayed within the phase scope.

</deferred>

---

*Phase: 04-lifecycle-persistence-spend-safety*
*Context gathered: 2026-10-27*
