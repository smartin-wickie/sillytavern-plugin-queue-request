# Phase 3: Full Queue Control & UI - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-26
**Phase:** 3-full-queue-control-ui
**Areas discussed:** Cancel & per-item list, Slash commands, Settings panel

---

## Cancel & per-item list

| Option | Description | Selected |
|--------|-------------|----------|
| Open dropdown list | Badge click opens dropdown: pending items with per-item cancel ×, plus "Cancel running"/"Cancel all" | ✓ |
| Open modal popup | Same list via ST's Popup/callGenericPopup | |
| Right-click menu / left-click cancel-running | Fast shortcut on left-click, full list on right-click | |

**User's choice:** Open dropdown list.

| Option | Description | Selected |
|--------|-------------|----------|
| abortOwn() + drop as 'cancelled' | Reuses adapter.js's existing abortOwn(); runner advances to next item | ✓ |
| Let it finish, discard result | Don't abort network call, drop result on completion | |

**User's choice:** abortOwn() + drop as 'cancelled'.

| Option | Description | Selected |
|--------|-------------|----------|
| Pending + running | Drops queued items and aborts the running one | ✓ |
| Pending only, running finishes | Clears queue but lets in-flight generate complete | |

**User's choice:** Pending + running.

| Option | Description | Selected |
|--------|-------------|----------|
| Queue swipe + Cancel all queued | Two wand menu entries mirroring control click and badge's Cancel all | ✓ |
| Queue swipe only | Just the enqueue action; cancellation stays badge-only | |

**User's choice:** Queue swipe + Cancel all queued.

---

## Slash commands

| Option | Description | Selected |
|--------|-------------|----------|
| Echo clamped count via system message | Chat-visible line reporting the clamp | |
| toastr only, no chat message | Same info via toastr.info, no chat log line | ✓ |

**User's choice:** toastr only, no chat message.
**Notes:** User explicitly picked the non-recommended option (chat log stays clean) over the suggested chat-message echo.

| Option | Description | Selected |
|--------|-------------|----------|
| No confirm, just clear + report count | Synchronous, scriptable | ✓ |
| Confirm popup first | Safer against fat-finger, blocks scripting | |

**User's choice:** No confirm, just clear + report count.

| Option | Description | Selected |
|--------|-------------|----------|
| One-line summary | "Queue: 1 running, 3 pending (5 max)." | ✓ |
| Multi-line with per-item detail | Per-item status/age lines | |

**User's choice:** One-line summary.

| Option | Description | Selected |
|--------|-------------|----------|
| 1 | Bare /queueswipe queues exactly one | ✓ |
| Fill to max | Bare /queueswipe tops queue up to configured max | |

**User's choice:** 1.

---

## Settings panel

| Option | Description | Selected |
|--------|-------------|----------|
| Toasts on/off + verbosity level | One dropdown controlling both failure and completion toasts | ✓ |
| Separate toggles per event type | Independent checkboxes per event | |

**User's choice:** Toasts on/off + verbosity level.

| Option | Description | Selected |
|--------|-------------|----------|
| Number input, stored only | Field saved via SET-02 merge pattern; no enforcement until Phase 4 GUARD-06 | ✓ |
| Skip the field entirely this phase | Add in Phase 4 alongside enforcement logic | |

**User's choice:** Number input, stored only.

| Option | Description | Selected |
|--------|-------------|----------|
| Number input, 1-20 | Matches store.js's HARD_MAX_QUEUE=20 ceiling | ✓ |
| Dropdown with preset values | Fixed choices (1,3,5,10,20) | |

**User's choice:** Number input, 1-20.

| Option | Description | Selected |
|--------|-------------|----------|
| Live, no reload | Settings re-read on every relevant check, same pattern as store.getMaxQueueSize() | ✓ |
| Applies to next chat/reload | Settings cached at chat-load time | |

**User's choice:** Live, no reload.

---

## Claude's Discretion

- UI-02 (progress bar) and UI-03 (toast coalescing) — not selected for discussion; left to standard-approach implementation per roadmap acceptance criteria and existing `src/ui.js` patterns.
- Exact cancel dropdown CSS/positioning.
- Auto-jump setting's exact wording/values in the settings panel.
- Enable/disable toggle wording and placement.

## Deferred Ideas

None — discussion stayed within phase scope.
