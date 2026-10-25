# Queued Swipes for SillyTavern

## What This Is

A SillyTavern (ST) UI extension that lets the user queue several swipe generations for the latest AI message while they keep reading the current one. Queued requests run one at a time in the background via dry-run prompt capture and an own transport, and each completed result is appended as a normal swipe page (`k/total` grows) without changing what the user is looking at. Built for the author's own use, distributable as a community third-party extension.

## Core Value

The user can line up multiple alternative replies and keep reading undisturbed; every completed generation shows up as a normal swipe page, and the chat is never corrupted.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Control on the latest AI message adds one swipe request to the queue (repeatable up to max, default 5, configurable)
- [ ] Slash command `/queueswipe [count]` queues swipes
- [ ] Queue badge shows pending/running count; user can cancel one item or all
- [ ] Queued items generate in the background: no streaming into the visible message, no view switch, progress only on the badge
- [ ] Each item uses the same context as a normal swipe (chat up to the target message at run time)
- [ ] On completion, result appends to `swipes[]` with parallel `swipe_info[]` (`send_date`, `gen_started`, `gen_finished`, `extra`), pager total increments live, chat saved via `saveChatConditional()`
- [ ] Displayed `swipe_id` never changes unless user opted in (setting: auto-jump when already on newest swipe)
- [ ] Per-item failures (API error, empty reply, abort) reported non-modally and dropped; queue continues
- [ ] Manual send/swipe/continue pauses the queue; queue resumes after if target still valid
- [ ] Target message edited/deleted or new user message sent: pending items cleared, toast shown
- [ ] Chat switch (`CHAT_CHANGED`): running item aborted, pending items kept in that chat's metadata
- [ ] Queue persists across refresh in `chat_metadata`; on load, user is asked whether to resume (no auto-run)
- [ ] Settings panel: max queue, auto-jump, notification style
- [ ] Works with all ST backends (Chat Completion and Text Completion at minimum) with no extra configuration
- [ ] Coexists with Deep-Swipe, UserSwipes, Prompt Inspector

### Out of Scope

- Server plugin — v1 is extension-only; official content repo rejects extensions requiring a server plugin
- Parallel / concurrent generation — breaks ST single-flight state (`is_send_press`, abort/streaming controller); deferred, keep design seams
- Group chats — swipe semantics differ; v1 disables control in group chats, revisit v2
- Queueing on non-latest messages — Deep-Swipe territory
- Per-item prompt variants (temperature sweeps, different presets) — not core value
- Streaming preview of running item — conflicts with "stay put"; background-only for v1
- Pre-reserving empty swipe slots — would show in native pager
- Multi-user / server-wide scheduling

## Context

- Design docs: `.planning/01-architecture-analysis.md` (ST extension anatomy, swipe data model, single-flight constraint, options A/B/C) and `.planning/02-requirements-draft.md` (FR/NFR draft, decisions D1–D4).
- Many ST internals in those docs are marked `[Recall]`, not read from source. Must verify against ST `public/script.js` (release branch) before relying on them: `swipe_right` guards, `is_send_press`, whether generation can target a non-visible swipe / run without writing into `mes`, prompt hooks (`GENERATE_AFTER_DATA`, `CHAT_COMPLETION_PROMPT_READY`), event names (`MESSAGE_SWIPED`, `GENERATION_STOPPED`, `MESSAGE_EDITED`, `MESSAGE_DELETED`, `CHAT_CHANGED`), `saveChatConditional`.
- Key technical tension (resolved in Phase 1): native `Generate('swipe')` pushes a new slot, switches `swipe_id`, and streams into the visible message. Phase 1's live spike against ST 1.19.0 chose R1 — dry-run `Generate('swipe', {}, true)` capture + own transport + native cleanup helpers — over R2 (native swipe + view restore). See the Generation route Key Decision below and `.planning/phases/01-route-verification-spike/SPIKE-REPORT.md`.
- Reference extensions to study: Deep-Swipe (Rurijian), SillyTavern-UserSwipes (Bartasx4), Prompt Inspector (known conflict with Deep-Swipe over generation state).
- Prompt caching: serial back-to-back identical prompts are cache-friendly.

## Constraints

- **Tech stack**: Browser ES module UI extension, `manifest.json` entry (`js`, `css`, `display_name`, `author`, `minimum_client_version`) — ST extension loader requirement
- **APIs**: Only ST public surface — `getContext()`, `eventSource`, `event_types`, `extension_settings[MODULE_NAME]`, `saveSettingsDebounced()`, `saveChatConditional()`; no core file modifications
- **Execution**: Serial execution through an own scheduler: native prompt build via dry-run `Generate('swipe')` capture, own transport, native cleanup helpers; the extension never starts a non-dry `Generate`. Interceptors, CC squash, WI timed effects and itemized prompts are not applied (documented gaps).
- **Data safety**: Never write `chat.jsonl` directly; only ST save functions — prevent chat corruption
- **Compatibility**: Current ST release branch; declare `minimum_client_version`
- **Security**: No secrets stored; reuse ST backend proxy

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| UI extension only, no server plugin | Simpler install, official-repo eligible | — Pending |
| Generation route (R1 dry-run capture + own transport vs R2 native swipe + view restore) | Hard blockers a/c/d all passed cleanly at runtime (ST 1.19.0 live spike); b's only gap (squash ON) matched the source prediction exactly, no other surprises | Chosen: R1 (see .planning/phases/01-route-verification-spike/SPIKE-REPORT.md; a: PASS, b: PASS w/ documented squash-ON gap, c: PASS, d: PASS, e: not achievable (documented), f: policies confirmed) |
| Serial execution: dry-run capture + own transport (R1) | Respects single-flight state; post-processing comes from calling native cleanup helpers (`cleanUpMessage`, reasoning extraction) on the own-transport result, not from the native pipeline itself | Chosen: R1 (see Generation route decision above; SPIKE-REPORT.md) |
| Stay put: never change displayed swipe | Reading must not be interrupted | — Pending |
| Background generation, no streaming preview | Own transport (R1) never streams into the visible message, so there is nothing to suppress — the view cannot change by construction | Chosen: R1 (SPIKE-REPORT.md) |
| Context = normal swipe context at run time | Matches native behavior; invalidation rules cover staleness | — Pending |
| Persist queue in `chat_metadata`; ask before resume on load | Survive refresh without surprise API spend | — Pending |
| Manual generation pauses queue | User actions take priority; resume if target valid | — Pending |
| Edit/delete target or new user message clears queue + toast | Pending items are stale | — Pending |
| Chat switch pauses, keeps queue stored | Return to chat can resume | — Pending |
| Default max queue 5, configurable | Bound accidental spend | — Pending |
| Group chats deferred to v2 | Different swipe semantics | — Pending |
| Target ST release branch | Stable API surface | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/bm:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/bm:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-10-25 after Phase 1 (Route Verification Spike) completion*
