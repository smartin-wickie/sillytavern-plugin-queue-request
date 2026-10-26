# Phase 2: Single Queued Swipe End-to-End - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-25
**Phase:** 02-single-queued-swipe-end-to-end
**Areas discussed:** Control icon & placement, Busy-state behavior, Failure toast detail, Testing rigor this phase

---

## Control icon & placement

| Option | Description | Selected |
|--------|-------------|----------|
| Clock/stack icon (fa-clock or fa-layer-group) | Signals "queue another" distinct from navigation arrows; no clash with existing icons | ✓ |
| Plus icon (fa-plus) | Simple "add one" metaphor | |
| Custom | — | |

**User's choice:** Clock/stack icon

| Option | Description | Selected |
|--------|-------------|----------|
| Right of the right arrow (after swipe counter) | Reads left-to-right as prev, counter, next, queue | ✓ |
| Left of the left arrow (before counter) | Groups navigation together, queue control stands apart | |
| Custom | — | |

**User's choice:** Right of the right arrow, after the swipe counter

| Option | Description | Selected |
|--------|-------------|----------|
| "Queue a swipe" | Short, matches slash command name | ✓ |
| "Generate in background" | Describes behavior | |
| Custom | — | |

**User's choice:** "Queue a swipe"

---

## Busy-state behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Disable control, tooltip explains | Simplest, matches single-item scope as originally presented | |
| Ignore click silently | Less feedback | |
| Custom (user's own answer) | Disable only at max; click enqueues another request below max | ✓ |

**User's choice:** Custom — control stays enabled below max and enqueues another request on click; only disables at max.

**Notes:** This answer revealed the user wants multi-item enqueue-while-running in Phase 2, which is QUEUE-02 — originally scoped to Phase 3. Flagged as a scope question per the scope guardrail; user explicitly confirmed moving QUEUE-02 into Phase 2 (see "Scope check" question below). `ROADMAP.md` and `REQUIREMENTS.md` were edited as a result.

**Scope check question:** "Confirmed: Phase 2 ships one item only... Does that match what you want, with multi-add saved for Phase 3?" → User answered "No, pull multi-add into Phase 2 now."
**Roadmap edit confirmation:** "Proceed with editing ROADMAP.md + REQUIREMENTS.md to move QUEUE-02 into Phase 2?" → User answered "Yes, move QUEUE-02 into Phase 2."

| Option | Description | Selected |
|--------|-------------|----------|
| Spin/pulse the control icon itself | Immediate feedback at point of click | |
| Static control, badge only | Simpler; all feedback from the UI-01 badge | ✓ (as "badge with count of queued requests") |
| Custom | — | |

**User's choice:** Badge only, showing a count of queued requests.

| Option | Description | Selected |
|--------|-------------|----------|
| 5 (matches REQUIREMENTS.md QUEUE-02 default) | No settings panel yet; hardcode default | ✓ |
| Custom | — | |

**User's choice:** 5

| Option | Description | Selected |
|--------|-------------|----------|
| Disable control, tooltip "Queue full (5/5)" | Matches earlier disable-at-max answer | ✓ |
| Custom | — | |

**User's choice:** Disable control, tooltip "Queue full (5/5)"

---

## Failure toast detail

| Option | Description | Selected |
|--------|-------------|----------|
| Generic + reason category | e.g. "...failed: API error" / "...: empty reply" / "...: cancelled", no raw error text | ✓ |
| Generic only | Same message regardless of cause | |
| Full error detail | Includes raw backend error/status | |

**User's choice:** Generic + reason category

| Option | Description | Selected |
|--------|-------------|----------|
| toastr.warning, default timeout, preventDuplicates | Matches STACK.md recommendation | ✓ |
| Custom | — | |

**User's choice:** toastr.warning, default timeout, preventDuplicates

---

## Testing rigor this phase

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, Vitest now | Pure modules (store/fingerprint/runner) are cheap to test now with a fake bridge | ✓ |
| Defer, manual smoke test only | Add automated tests later | |

**User's choice:** Yes, Vitest now for pure modules.

| Option | Description | Selected |
|--------|-------------|----------|
| Manual smoke test against local ST + llama.cpp | Reuse spike's zero-spend local setup | ✓ (specified as using claude-in-chrome + plugin) |
| Custom | — | |

**User's choice:** Manual smoke test, using the `claude-in-chrome` MCP and the ST plugin running locally.

---

## Claude's Discretion

- Exact module file layout and build order inside `src/` (already specified in `ARCHITECTURE.md` §4/§7)
- Fingerprint composition details
- Exact toast wording beyond the "generic + reason category" rule
- CSS for the disabled/queue-full control state

## Deferred Ideas

None new. QUEUE-02 was pulled into Phase 2 scope rather than deferred. Cancel UI, per-item list, slash commands, wand menu entries, progress bar, toast coalescing, and the settings panel remain Phase 3 as originally planned.
