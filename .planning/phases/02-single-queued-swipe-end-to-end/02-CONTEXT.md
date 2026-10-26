# Phase 2: Single Queued Swipe End-to-End - Context

**Gathered:** 2026-10-25
**Status:** Ready for planning

<domain>
## Phase Boundary

User clicks a control next to the swipe arrows on the latest AI message to queue swipe requests, repeatably up to a max (default 5, hard max 20). Items run strictly serially in the background via the R1 route (dry-run capture + own transport + native cleanup helpers, locked in Phase 1). Each completed item appends as a normal swipe page without disturbing what the user is reading. Cancel UI, per-item list, slash commands, progress bar, and the settings panel remain Phase 3.

**Scope change made during this discussion:** QUEUE-02 (add more requests while the queue is running, up to max) was moved from Phase 3 into Phase 2 at the user's explicit request. `ROADMAP.md` (Phase 2/Phase 3 sections) and `REQUIREMENTS.md` (traceability table) were edited this session to reflect it. Phase 2 is therefore a real serial multi-item queue, not a single-shot slice — only the *control surface* around it (cancel, slash commands, progress bar, settings UI) is deferred to Phase 3.

</domain>

<decisions>
## Implementation Decisions

### Control appearance & placement
- **D-01:** Icon = clock/stack icon (`fa-clock` or `fa-layer-group`)
- **D-02:** Placed to the right of the right swipe arrow, after the swipe counter
- **D-03:** Tooltip text: "Queue a swipe"

### Queue behavior
- **D-04:** Default max queue size = 5 (hardcoded default for Phase 2; configurable settings panel is Phase 3/SET-01). Hard max 20 per REQUIREMENTS.md SAFE policy, enforced even before the settings UI exists.
- **D-05:** Clicking the control while below max enqueues another request; items still run strictly one at a time (GEN-01 unaffected — only enqueue is concurrent with running, not execution)
- **D-06:** Control disables when queue is at max; tooltip changes to "Queue full (5/5)"
- **D-07:** No running indicator on the control itself (no spin/pulse) — the UI-01 badge alone shows pending/running count

### Failure reporting (GUARD-05)
- **D-08:** Toast on item failure = generic message + reason category, e.g. "Queued swipe failed: API error" / "...: empty reply" / "...: cancelled" — never raw backend error text or stack traces
- **D-09:** `toastr.warning`, default timeout, `preventDuplicates: true`

### Testing approach for this phase
- **D-10:** Pure modules (store, fingerprint, runner against a fake bridge, per `ARCHITECTURE.md` §4/§7) get automated Vitest unit tests written in this phase, not deferred
- **D-11:** Adapter/appender (need a live ST instance, not fake-able) are verified by manual smoke test using the `claude-in-chrome` MCP driving the local ST install + the extension, rather than a new automated browser harness (Playwright not adopted this phase)

### Claude's Discretion
- Exact module file layout and build order inside `src/` — already specified in `ARCHITECTURE.md` §4 (file list) and §7 (build order: bridge → store+fingerprint → appender → adapter → runner → guard → UI)
- Fingerprint composition (mesId + content hash + swipe count, per `ARCHITECTURE.md` §3.2/§3.3) — implement per the architecture doc unless it proves unworkable at the keyboard
- Exact toast wording beyond the "generic + reason category" rule (D-08)
- CSS for the disabled/queue-full control state

</decisions>

<specifics>
## Specific Ideas

No additional product references beyond the architecture docs already cited below — this phase's "how" is heavily pre-decided by Phase 1's spike and the research docs; discussion filled in the remaining UI/UX and testing-process gaps.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Route, idle-gating, and Phase 2 consequences (from the Phase 1 spike)
- `.planning/phases/01-route-verification-spike/SPIKE-REPORT.md` — "Consequences for Phase 2" section: idle-gate every capture (`isGenerating()` false, `swipe.state() === 'none'`), always pass `{ signal }` to dry-run `Generate`, never call non-dry `Generate` for queued items, cancel = abort own controller + discard app-side, never call `swipe()`/auto-continue, toast the documented gaps (Vectors/interceptor skip, CC squash-ON skip, WI sticky uncertainty, no itemized prompt)

### Architecture (generation route, data model, component design)
- `.planning/research/ARCHITECTURE.md` §1.3 — The append race: appender runs only when `!isGenerating() && swipe.state() === 'none'`, else park result and flush on idle
- `.planning/research/ARCHITECTURE.md` §1.4–§1.8 — Event table, swipe data model (`swipes[]`/`swipe_info[]` parallel arrays), pager refresh (`updateSwipeCounter` + `swipe.refresh()`), save path (`saveChatConditional`/`saveMetadataDebounced`, never cache `chatMetadata`)
- `.planning/research/ARCHITECTURE.md` §2.1–§2.2 — Route evaluation matrix and the recommended per-item pipeline (capture → transport → parse+clean → park → flush on idle)
- `.planning/research/ARCHITECTURE.md` §3 — Component boundaries table, data flow, event→action policy table (`CHAT_CHANGED`, `MESSAGE_SENT`, `MESSAGE_DELETED`, `MESSAGE_EDITED`, `GENERATION_STARTED` with `dryRun===false`, etc.)
- `.planning/research/ARCHITECTURE.md` §4 — Project structure (`st-bridge.js`, `store.js`, `fingerprint.js`, `runner.js`, `adapter.js`, `appender.js`, `ui.js`, `commands.js`, `settings.js`, `test/`)
- `.planning/research/ARCHITECTURE.md` §5–§6 — Patterns to follow (idle-gated single flight, park-then-flush, fresh `getContext()` per access, fail-soft per item) and anti-patterns to avoid
- `.planning/research/ARCHITECTURE.md` §7 — Build order (bridge → store+fingerprint → appender → adapter → runner → guard → UI)

### Tech stack and testing
- `.planning/research/STACK.md` — manifest schema, `getContext()` surface, Vitest recommendation for pure modules, why `generate_interceptor` is avoided
- `.planning/research/PITFALLS.md` — pitfalls referenced by the architecture doc (abort/single-flight, auto-swipe cascade, R2 view-restore pitfall)

### Requirements and roadmap (edited this session)
- `.planning/REQUIREMENTS.md` — QUEUE-01, QUEUE-02, QUEUE-08, GEN-01..06, SWIPE-01..05, GUARD-04, GUARD-05, UI-01, SET-02, COMP-03 (QUEUE-02 traceability moved from Phase 3 to Phase 2 this session)
- `.planning/ROADMAP.md` — Phase 2 goal/success criteria reworded this session to include add-while-running; Phase 3 goal/success criteria correspondingly narrowed

### Reference implementation (pattern only, do not copy the file)
- `spike/st-imports.js` — exact ES import paths from third-party extension depth (`../../../../script.js`, `../../../openai.js`, etc.) and which ST internals are and aren't on `getContext()`
- `spike/index.js` — proven reference implementation of the dry-run-capture + own-transport pattern (`capture()`/`send()`/`abortOwn()`); criteria a-d all passed at runtime against this exact code. Mirror its idle-gate + event-listener + `cleanUpMessage`/`extractReasoningFromData` call sequence in the new `adapter.js` — per Phase 1 D-09, the spike file itself stays frozen as evidence and is not grown into production code.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `spike/index.js`'s `capture()` and `send()` functions are a working, spike-verified reference for the adapter's capture+transport+clean pipeline (see Canonical References above) — reuse the pattern, not the file.
- `spike/st-imports.js` already enumerates every ST internal import the extension needs and their exact relative paths from `third-party/<name>/` depth.

### Established Patterns
- Idle-gated single flight: every state transition re-checks `isGenerating()` and `swipe.state() === 'none'` before starting a capture.
- Park, then flush: network completion and chat mutation are decoupled; only the append step has an idle precondition (D-04/ARCHITECTURE.md §1.3, §5).
- Fresh `getContext()` per access; never hold `chatMetadata` or `chat` length across an `await`.
- Fail-soft per item: adapter returns a result or a typed error; runner drops the item, toasts non-modally (D-08/D-09), continues with the rest of the queue.

### Integration Points
- Control DOM injection point: `.last_mes` message block, next to `.swipe_right` / the `.swipes-counter` element (D-02).
- Pager refresh sequence: `await updateSwipeCounter(mesId, {message})` then `getContext().swipe.refresh()`.
- Save: `saveChatConditional()` after each append (SWIPE-05).
- Settings: `extension_settings[MODULE_NAME]` merge-by-key on load for SET-02 (no settings UI panel yet — that's SET-01/Phase 3).

</code_context>

<deferred>
## Deferred Ideas

None new. The one scope change this discussion produced (QUEUE-02) was pulled **into** Phase 2, not deferred out of it — see the Phase Boundary note above. Cancel UI, per-item list, slash commands (`/queueswipe`, `/queuecancel`, `/queuestatus`), wand menu entries, progress bar, toast coalescing, and the settings panel remain Phase 3 (QUEUE-03..07, UI-02, UI-03, SET-01) as originally planned.

</deferred>

---

*Phase: 02-single-queued-swipe-end-to-end*
*Context gathered: 2026-10-25*
