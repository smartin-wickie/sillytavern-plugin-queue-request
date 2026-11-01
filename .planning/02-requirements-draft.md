# Requirements — Queued Swipes for SillyTavern (DRAFT v0.1)

Status: **Draft v0.2.** Items marked ❓ are still open; see section 7.

## 0. Decisions so far (2026-10-25)
- D1. **UI extension only** (no server plugin) for v1.
- D2. **Serial execution** through ST's native generation path (parallel deferred; keep design seams).
- D3. **Stay put**: completed swipes never change the displayed swipe; pager count just increases.
- D4. **Queue persists across refresh** (stored with the chat; resumes afterward) — needs design for stale/partial items.

## 1. Problem
Today a user can request only one new swipe at a time and must wait for it. Reading the current response while waiting is the natural behaviour, but you can't line up more alternatives. Goal: let the user queue several swipe requests while reading; each result becomes a normal swipe page as it completes.

## 2. Goals
- G1. Queue N additional swipes for the latest AI message without blocking reading/navigation.
- G2. Completed swipes appear in the standard swipe pager (`k/total`) with native look and behaviour.
- G3. Current view never jumps unexpectedly when a swipe completes.
- G4. Works with the user's existing API connections and presets with no extra configuration.

## 3. Non-goals (v1)
- Queueing on non-latest messages (Deep-Swipe territory) ❓
- Changing prompts per queued swipe (variants/temperature sweeps) ❓
- Multi-user/server-wide scheduling.

## 4. Functional requirements
| ID | Requirement |
|---|---|
| FR-1 | A control on the latest AI message adds one swipe request to the queue; repeatable up to a configurable max (default 5 ❓). |
| FR-2 | Slash command `/queueswipe [count]` does the same. |
| FR-3 | Queue badge shows pending/running count; user can cancel one or all. |
| FR-4 | Each queued request uses the prompt context as of the moment it was queued (the message it's a swipe of), not later chat changes. ❓ |
| FR-5 | On completion, result is appended to `swipes[]` with proper `swipe_info` (send_date, gen_started, gen_finished, extra), then chat is saved. |
| FR-6 | Pager total increments live; displayed swipe does not change unless the user is already on the newest swipe and opted in (setting). |
| FR-7 | Failures (API error, empty reply, abort) are reported non-modally and dropped from the queue; other items continue. |
| FR-8 | Queue is cleared/paused on: chat change, message deleted/edited, user sends a new message. Behaviour configurable ❓ |
| FR-9 | Execution mode: serial through native pipeline (default) or parallel (opt-in, concurrency limit) ❓ |
| FR-10 | Optional streaming preview of the running item without disturbing the visible swipe ❓ |
| FR-11 | Settings panel: max queue, concurrency, auto-jump, notification style. |

## 5. Non-functional
- NFR-1 No core file modifications; install as extension (and plugin if needed) only.
- NFR-2 Compatible with current ST release; declare `minimum_client_version`.
- NFR-3 Never corrupt chat JSONL: all writes via ST's own save path.
- NFR-4 Graceful degradation if server plugin is missing/disabled.
- NFR-5 No secrets stored by the plugin; reuse ST's backend proxy.

## 6. Architecture options (see 01-architecture-analysis.md §4)
- A. Extension-only, serial queue — lowest risk, slowest.
- B. Extension + parallel direct backend calls (optionally via server plugin) — fastest, highest risk/complexity.
- C. Hybrid — recommended starting point **pending your input**: ship A first, design seams for B.

## 7. Open questions for you
1. ~~Packaging~~ → decided: extension only.
2. ~~Serial vs parallel~~ → decided: serial.
3. Which backends do you use (chat completion provider, text-gen, etc.)?
4. Max queue size (default 5?).
5. ~~Persistence~~ → decided: persist. Open: on resume, auto-run or ask first? Where to store (chat_metadata)?
6. Serial means the native single-flight pipeline is in use: how should a manual send/swipe/continue interact with a running queue (queue waits, or queue cancels)?
7. Target ST version / staging vs release branch?

## 8. Milestones (tentative)
1. Source verification spike (swipe/generate internals).
2. Extension skeleton + settings + slash command.
3. Serial queue → swipe append → pager update.
4. Error/edge handling, cancel, persistence.
5. Optional parallel mode.
6. Docs, packaging, compatibility testing.
