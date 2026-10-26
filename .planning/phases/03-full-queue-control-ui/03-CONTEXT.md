# Phase 3: Full Queue Control & UI - Context

**Gathered:** 2026-10-26
**Status:** Ready for planning

<domain>
## Phase Boundary

User can see and control the queue from the badge, progress bar, slash commands, and wand menu. Scope: QUEUE-03 (`/queueswipe`), QUEUE-04 (`/queuecancel`/`/queuestatus`), QUEUE-05 (wand menu), QUEUE-06 (cancel running/all from badge), QUEUE-07 (per-item cancel list), UI-02 (progress bar + stop), UI-03 (toast coalescing), SET-01 (settings panel). The circuit-breaker threshold *field* is built here; its enforcement logic (GUARD-06) is Phase 4. Lifecycle/persistence/spend-safety behavior otherwise stays in Phase 4.

**Not discussed this session (deferred to planning's discretion):** Progress bar design and toast coalescing (UI-02/UI-03) — the user did not select this area for discussion. The planner/researcher should treat UI-02/UI-03 as standard-approach, Claude's-discretion work within the roadmap's stated acceptance criteria (progress bar at top of chat with a stop control; multi-item completion/error toasts coalesced instead of one per item), informed by the existing badge pattern in `src/ui.js`.

</domain>

<decisions>
## Implementation Decisions

### Cancel UI surface (QUEUE-06, QUEUE-07)
- **D-01:** Clicking the existing badge (`.qs-queue-badge` in `src/ui.js`) opens a dropdown anchored to it — not a modal popup. Shows each pending item with a per-item cancel (×), plus "Cancel running" and "Cancel all" buttons in one surface.
- **D-02:** Cancel running item: call `adapter.js`'s existing `abortOwn(ownController)` (already spike-verified, never touches ST's global `stopGeneration()`), drop the item with reason `'cancelled'` (reuses the existing `FAILURE_MESSAGES.cancelled` toast string), runner immediately advances to the next pending item.
- **D-03:** "Cancel all" scope = pending + running. Drops every queued item via a new store removal path and aborts the running item via the same `abortOwn()` call as D-02.
- **D-04:** Per-item pending cancel (inside the dropdown list) drops just that one queued item — does not touch the running item or other pending items.

### Wand menu (QUEUE-05)
- **D-05:** Two entries: "Queue swipe" (same `store.add()` + `runner.wake()` call as clicking the control) and "Cancel all queued" (same action as the badge dropdown's "Cancel all" button, D-03). No separate "cancel running only" entry in the wand menu.

### Slash commands (QUEUE-03, QUEUE-04)
- **D-06:** `/queueswipe [count]` — count defaults to **1** when omitted (same effect as one control click). When clamped to remaining capacity, feedback is `toastr.info`/`toastr.warning` only — **no chat-visible system message** (user explicitly chose this over echoing to chat).
- **D-07:** `/queuecancel` — no confirmation popup. Clears immediately (same pending+running scope as D-03) and reports the cancelled count via toast/command return value, matching slash-command scripting conventions (synchronous, no blocking dialog).
- **D-08:** `/queuestatus` — one-line summary format: `"Queue: 1 running, 3 pending (5 max)."` No per-item detail line.

### Settings panel (SET-01)
- **D-09:** Notification style is a single setting controlling verbosity across both failure toasts (GUARD-05) and completion/coalesced toasts (UI-03) — not independent per-event-type toggles. Values: e.g. "All" / "Errors only" / "Off".
- **D-10:** Circuit-breaker threshold ships as a plain number input (range 1–10, suggested default 3) in this phase's settings panel, saved to `extension_settings[MODULE_NAME]` via the existing SET-02 merge-by-key pattern. It is stored only — no enforcement runs until Phase 4's GUARD-06 reads the same setting key.
- **D-11:** Max queue setting is a plain number input, 1–20, client-side clamped to `store.js`'s `HARD_MAX_QUEUE` (20) before saving — not a dropdown of presets.
- **D-12:** All settings panel values take effect live, with no reload or chat-switch required — store/runner/UI re-read `extension_settings[MODULE_NAME]` on every relevant check, following the same live-read pattern `store.getMaxQueueSize()` already uses. This directly satisfies ROADMAP Phase 3 success criterion 4 ("the values take effect").

### Claude's Discretion
- Progress bar (UI-02) and toast coalescing (UI-03) visual/implementation design — not discussed this session; follow the roadmap's stated acceptance criteria and existing badge/toast patterns in `src/ui.js`.
- Exact dropdown CSS/positioning for the cancel UI (D-01).
- Auto-jump setting's exact wording/values in the settings panel (behavior itself was already locked conceptually in Phase 2/PROJECT.md — this phase just exposes it in SET-01's UI).
- Enable/disable toggle wording and placement within the settings panel.

</decisions>

<specifics>
## Specific Ideas

No additional product references beyond what's captured above — discussion stayed close to the roadmap's stated success criteria and REQUIREMENTS.md wording.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and roadmap
- `.planning/ROADMAP.md` — Phase 3 section (goal, requirements list, success criteria 1-4)
- `.planning/REQUIREMENTS.md` — QUEUE-03..07, UI-02, UI-03, SET-01 (exact requirement wording and traceability table)

### Architecture and prior decisions
- `.planning/research/ARCHITECTURE.md` — component boundaries, event→action policy table; Phase 3's cancel/settings UI must follow the same "fresh `getContext()` per access", "fail-soft per item" patterns already established in Phase 2
- `.planning/phases/02-single-queued-swipe-end-to-end/02-CONTEXT.md` — D-01..D-11 (control appearance, queue behavior, failure reporting conventions this phase extends rather than replaces, e.g. the `FAILURE_MESSAGES` toast taxonomy reused by D-02)
- `.planning/phases/01-route-verification-spike/SPIKE-REPORT.md` — "cancel = abort own controller + discard app-side, never call `swipe()`/auto-continue" policy that D-02/D-03 implement

### Reference implementation (existing code, Phase 2 — study, do not duplicate)
- `src/store.js` — current `add`/`markRunning`/`markDone`/`drop`/`getMaxQueueSize` API; Phase 3 needs a new per-item and bulk cancel path on top of this (no cancel/remove function exists yet)
- `src/runner.js` — `pause`/`resume`/`onItemFailed` API; no running-item abort wiring exists yet — D-02 needs the runner to call `adapter.js`'s `abortOwn()` on the item currently mid-`generate()`
- `src/adapter.js` — `abortOwn(ownController)` (already implemented and spike-verified) is the exact function D-02/D-03 must call
- `src/ui.js` — existing badge (`renderBadge`), disabled-state, and `FAILURE_MESSAGES` toast taxonomy patterns that the new dropdown/wand-menu/slash-command UI should extend, not replace

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `adapter.js`'s `abortOwn(ownController)` — working, spike-verified abort path; reuse directly for cancel-running (D-02) and cancel-all (D-03), never call ST's global `stopGeneration()`.
- `ui.js`'s `FAILURE_MESSAGES` lookup and `toastr.warning(..., { preventDuplicates: true })` pattern — extend with the `'cancelled'` reason already present, reuse the same non-raw-error-text convention for any new toasts (clamp feedback D-06, cancel-count feedback D-07).
- `store.js`'s live-read `getMaxQueueSize()` pattern (reads `extension_settings` at call time, not cached) — the pattern to mirror for D-12's live-apply settings requirement.

### Established Patterns
- Fresh `getContext()` per access; never cache `chatMetadata`/`chat` across an `await` (ARCHITECTURE.md §5, carried from Phase 2).
- Fail-soft per item: a cancelled/failed item never blocks the rest of the queue — runner already advances via `processNext()`'s loop; D-02's abort path must return control to this same loop.
- Settings merge-by-key on load (SET-02, already implemented) — SET-01's new fields (D-09/D-10/D-11) extend the same `extension_settings[MODULE_NAME]` object, not a new storage location.

### Integration Points
- `store.js` needs new cancel/remove methods (no existing `remove`/`cancel` function) — add alongside `drop()`, which currently only marks failed, not user-cancelled-and-removed-from-pending.
- `runner.js` needs to expose the in-flight item's `ownController` (or an abort method) so UI-triggered cancel-running (D-02) can reach it — currently `generate()`/`abortOwn()` are only wired inside the generation adapter call chain, not exposed to callers of `runner`.
- Wand menu registration point: ST's extension menu API (not yet used anywhere in this codebase — new integration, check `getContext()` surface or `extensions_settings2`-adjacent menu hooks during research).
- Settings panel: no `settings.html` template exists yet (STACK.md recommends `renderExtensionTemplateAsync` + `#extensions_settings2` drawer convention) — this phase creates it.

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. UI-02 (progress bar) and UI-03 (toast coalescing) were in-scope per the roadmap but not selected for discussion this session; they are not deferred out of the phase, just left to Claude's discretion per the note in `<domain>` above.

</deferred>

---

*Phase: 03-full-queue-control-ui*
*Context gathered: 2026-10-26*
