# Requirements: Queued Swipes for SillyTavern

**Defined:** 2026-10-25
**Core Value:** The user can line up multiple alternative replies and keep reading undisturbed; every completed generation shows up as a normal swipe page, and the chat is never corrupted.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Route Verification (Spike)

- [ ] **SPIKE-01**: Generation route (R1 dryRun capture + own transport vs R2 native swipe + view restore) chosen with evidence from a live ST 1.19.0 instance, recorded in PROJECT.md Key Decisions
- [ ] **SPIKE-02**: Captured prompt for a queued swipe matches a native swipe prompt on one Chat Completion and one Text Completion backend (diff recorded, known gaps documented)
- [ ] **SPIKE-03**: Stop-with-partial behavior, `power_user.auto_swipe` reachability, and interceptor (Vectors) parity verified and policy recorded
- [ ] **SPIKE-04**: PROJECT.md and CLAUDE.md "serial through native pipeline" decision reworded to match chosen route

### Queue Control

- [ ] **QUEUE-01**: User can click a control next to the swipe arrows on the latest AI message to add one swipe request to the queue
- [ ] **QUEUE-02**: User can add more requests while the queue is running, up to the configured max (default 5, hard max 20)
- [ ] **QUEUE-03**: User can run `/queueswipe [count]` to queue swipes; count is clamped to remaining capacity with feedback
- [ ] **QUEUE-04**: User can run `/queuecancel` (all) and `/queuestatus` (pending/running summary)
- [ ] **QUEUE-05**: User can queue or cancel from the extensions wand menu
- [ ] **QUEUE-06**: User can cancel the running item or all items from the badge
- [ ] **QUEUE-07**: User can open a per-item list and cancel individual pending items
- [ ] **QUEUE-08**: Queue control is disabled in group chats and on chats with no AI message to swipe

### Generation

- [ ] **GEN-01**: Queued items run strictly one at a time; no concurrent generations from the extension and no overlap with ST's own generation
- [ ] **GEN-02**: Each item uses the same prompt context a native swipe of the target message would use at run time
- [ ] **GEN-03**: Queued generation never streams into or changes the visible message, and does not lock swipe arrows or the Send button (subject to SPIKE-01 route)
- [ ] **GEN-04**: Output is post-processed like a native swipe (stop strings, regex, trimming, reasoning parsing)
- [ ] **GEN-05**: Works with Chat Completion and Text Completion backends using the user's current connection and preset, with no extra configuration
- [ ] **GEN-06**: Item success is judged by observable post-conditions (non-empty result appended), not by a resolved promise or events

### Swipe Append

- [ ] **SWIPE-01**: Completed result is appended to `swipes[]` with a matching `swipe_info[]` entry (`send_date`, `gen_started`, `gen_finished`, `extra` incl. api, model, reasoning); arrays stay equal length with no holes
- [ ] **SWIPE-02**: Pager total (`k/total`) updates live without re-rendering or losing scroll position
- [ ] **SWIPE-03**: Displayed `swipe_id` never changes on completion unless the user enabled auto-jump and is on the newest swipe
- [ ] **SWIPE-04**: Append happens only when ST is idle; results finishing during a native generation are parked and flushed afterward
- [ ] **SWIPE-05**: Chat is saved via ST save functions after each append; `chat` array is never truncated or mutated to shape prompts

### Lifecycle Guards

- [ ] **GUARD-01**: When the user starts a manual send/swipe/continue, the in-flight item finishes in background (result parked), and remaining items wait until the manual generation ends
- [ ] **GUARD-02**: When the target message is edited or deleted, or the user sends a new message, pending items are cleared and a toast explains why
- [ ] **GUARD-03**: When the user switches chats, the running item is aborted and pending items stay stored with the original chat
- [ ] **GUARD-04**: Every append and save re-checks a chat identity token (chat id + `chat_metadata.integrity`) and target fingerprint; a mismatch discards the result instead of writing to the wrong chat
- [ ] **GUARD-05**: A failed item (API error, empty reply, abort) is reported with a non-modal toast and dropped; remaining items continue
- [ ] **GUARD-06**: Native Stop pressed by the user is distinguished from queue-initiated cancel

### Persistence

- [ ] **PERS-01**: Pending queue is stored in the chat's `chat_metadata` (ids and timestamps only, no prompts) and survives a page refresh
- [ ] **PERS-02**: On loading a chat with pending items, the queue starts paused and the user is asked to resume or discard (prompt shows count and model)
- [ ] **PERS-03**: Returning to a chat with a stored queue offers the same resume/discard prompt
- [ ] **PERS-04**: Stored items whose target no longer matches (message changed, deleted, expired) are dropped on load with a notice

### Spend Safety

- [ ] **SAFE-01**: Queue pauses after N consecutive failures (default 2) and notifies the user; no automatic retries
- [ ] **SAFE-02**: Queue pauses if API, model, or preset changed since items were queued, and asks before continuing
- [ ] **SAFE-03**: Queue refuses to start or pauses while Prompt Inspector is enabled, with a toast explaining why
- [ ] **SAFE-04**: Only one browser tab runs a given chat's queue; other tabs show state read-only

### UI & Settings

- [ ] **UI-01**: Badge on the latest AI message shows pending count and a running indicator
- [ ] **UI-02**: Progress bar at the top of chat shows queue progress with a stop control
- [ ] **UI-03**: Completion and error toasts are coalesced (no toast storm for multi-item queues)
- [ ] **SET-01**: Settings panel in the Extensions drawer: enable, max queue, auto-jump, notification style, circuit-breaker threshold
- [ ] **SET-02**: Settings persist in `extension_settings` and merge with defaults on load/upgrade

### Compatibility & Release

- [ ] **COMP-01**: Verified working alongside Deep-Swipe, UserSwipes, and Prompt Inspector (disabled), plus Vectors, TTS, Summarize; results recorded in a test matrix
- [ ] **COMP-02**: Extension does not trigger ST auto-swipe or auto-continue cascades
- [ ] **COMP-03**: Installable as a third-party extension via `manifest.json` with `minimum_client_version` 1.19.0
- [ ] **COMP-04**: README documents install, usage, fidelity gaps of the chosen route, and makes no prompt-cache savings claims

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Expansion

- **V2-01**: Group chat support (queue swipes for last group member's message)
- **V2-02**: Opt-in parallel mode with concurrency limit for backends that support it
- **V2-03**: Streaming preview of running item in a side panel
- **V2-04**: Per-item prompt variants (temperature sweep, alternate preset)
- **V2-05**: i18n beyond English

## Out of Scope

| Feature | Reason |
|---------|--------|
| Server plugin | v1 extension-only; official repo rejects extensions requiring server plugins |
| Concurrent `Generate()` calls | Breaks ST single-flight state |
| Queueing on non-latest messages | Deep-Swipe territory |
| Pre-reserving empty swipe slots | Would show in native pager |
| Auto-resume on load | Surprise API spend; ask instead |
| Automatic retries | Spend risk |
| Kobold Horde backend | Different request flow; unsupported v1 |
| Multi-user / server-wide scheduling | Not a personal-reading use case |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|

**Coverage:**
- v1 requirements: 46 total
- Mapped to phases: 0
- Unmapped: 46 ⚠️

---
*Requirements defined: 2026-10-25*
*Last updated: 2026-10-25 after initial definition*
