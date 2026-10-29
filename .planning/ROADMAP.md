# Roadmap: Queued Swipes for SillyTavern

## Overview

A SillyTavern UI extension that queues swipe generations for the latest AI message. The journey: first verify against live ST source which generation route is viable (the choice gates everything), then deliver one queued swipe end-to-end as a thin vertical slice, then grow it into a full queue with controls and UI, then harden it with lifecycle guards, persistence, and spend safety, and finally prove compatibility and ship.

**Granularity:** coarse (5 phases)
**Mode:** Vertical MVP

## Phases

- [x] **Phase 1: Route Verification Spike** - Choose the generation route with live ST 1.19.0 evidence and reword locked decisions (completed 2026-10-25)
- [x] **Phase 2: Single Queued Swipe End-to-End** - One queued swipe generates in background, appends as a native swipe page, saves safely (completed 2026-10-26)
- [x] **Phase 3: Full Queue Control & UI** - Multi-item queue with add-while-running, cancel, slash commands, badge/progress, settings (completed 2026-10-27)
- [x] **Phase 4: Lifecycle, Persistence & Spend Safety** - Queue survives refresh and chat switches, reacts to user actions, and cannot run away on spend (completed 2026-10-28)
- [x] **Phase 5: Compatibility & Release** - Verified alongside other extensions, no auto-swipe cascades, documented for release (completed 2026-10-29)

## Phase Details

### Phase 1: Route Verification Spike

**Goal:** The generation route (R1 dryRun capture + own transport vs R2 native swipe + view restore) is chosen with evidence from a live ST 1.19.0 instance, and project docs reflect it
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: SPIKE-01, SPIKE-02, SPIKE-03, SPIKE-04
**Success Criteria** (what must be TRUE):

  1. PROJECT.md Key Decisions records the chosen route with the live-instance evidence (go/no-go criteria a-f from research) that justified it
  2. A recorded diff shows a captured queued-swipe prompt matches a native swipe prompt on one Chat Completion and one Text Completion backend, with known gaps listed
  3. Stop-with-partial behavior, `power_user.auto_swipe` reachability, and interceptor (Vectors) parity each have a recorded policy
  4. PROJECT.md and CLAUDE.md no longer say "serial through native pipeline" unqualified; the wording matches the chosen route

**Plans**: TBD

### Phase 2: Single Queued Swipe End-to-End

**Goal:** User clicks a control on the latest AI message to queue swipe requests (one at a time, up to the max), each generates in the background and appears as a normal swipe page without disturbing reading
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: QUEUE-01, QUEUE-02, QUEUE-08, GEN-01, GEN-02, GEN-03, GEN-04, GEN-05, GEN-06, SWIPE-01, SWIPE-02, SWIPE-03, SWIPE-04, SWIPE-05, GUARD-04, GUARD-05, UI-01, SET-02, COMP-03
**Success Criteria** (what must be TRUE):

  1. User installs the extension from `manifest.json` (minimum_client_version 1.19.0), sees a control next to the swipe arrows on the latest AI message, and does not see it in group chats or chats with no AI message
  2. User can click the control repeatedly to add more requests while the queue is running, up to the configured max (default 5, hard max 20); items run strictly one after another, the visible message does not stream or change, swipe arrows and Send stay usable, and a badge shows pending/running count
  3. On each completion the pager total `k/total` grows by one live with scroll position intact, the displayed swipe does not change (unless auto-jump is enabled and the user is on the newest swipe), and the new swipe has the same post-processing as a native swipe on both Chat Completion and Text Completion
  4. If the user switches chats or the target changes mid-generation, the result is discarded rather than written to the wrong chat; a failed or empty generation shows a non-modal toast and leaves the chat unchanged, and the queue continues with remaining items
  5. After each append the chat is saved through ST save functions, and `swipes[]` and `swipe_info[]` have equal length with no holes

**Plans**: 5 plans
Plans:

- [x] 02-01-PLAN.md — Walking skeleton: scaffold, bridge, swipe appender, stub control+append
- [x] 02-02-PLAN.md — Queue Store + Fingerprint + Runner (serial multi-item queue, stub generator)
- [x] 02-03-PLAN.md — Real Generation Adapter (dry-run capture + own transport + native cleanup)
- [x] 02-04-PLAN.md — Event Guard (native-generation pause/wake) + GUARD-04/05 hardening
- [x] 02-05-PLAN.md — Badge/disable-at-max UI polish + final comprehensive smoke test

**UI hint**: yes

### Phase 3: Full Queue Control & UI

**Goal:** User can see and control the queue from the badge, progress bar, slash commands, and wand menu
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: QUEUE-03, QUEUE-04, QUEUE-05, QUEUE-06, QUEUE-07, UI-02, UI-03, SET-01
**Success Criteria** (what must be TRUE):

  1. `/queueswipe [count]` queues swipes with the count clamped to remaining capacity and feedback shown; `/queuecancel` clears all and `/queuestatus` reports pending/running
  2. User can cancel the running item or all items from the badge, open a per-item list to cancel individual pending items, and queue or cancel from the wand menu
  3. A progress bar at the top of chat shows queue progress with a stop control, and multi-item completion/error toasts are coalesced instead of one per item
  4. User can change enable, max queue, auto-jump, notification style, and circuit-breaker threshold in the Extensions drawer settings panel and the values take effect

**Plans**: 4 plans
Plans:
**Wave 1**

- [x] 03-01-PLAN.md — Runner abortRunning()/onItemDone() + shared cancelAll() + cancel dropdown anchored to the badge

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 03-02-PLAN.md — Slash commands (/queueswipe, /queuecancel, /queuestatus) + wand menu entries

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 03-03-PLAN.md — Top-of-chat progress bar + coalesced completion/error toasts

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 03-04-PLAN.md — Settings panel (enable, max queue, auto-jump, notification style, circuit-breaker threshold), wired to take effect live

**UI hint**: yes

### Phase 4: Lifecycle, Persistence & Spend Safety

**Goal:** The queue reacts sensibly to what the user does in ST, survives refresh and chat switches without surprise API spend, and cannot run away
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: GUARD-01, GUARD-02, GUARD-03, GUARD-06, PERS-01, PERS-02, PERS-03, PERS-04, SAFE-01, SAFE-02, SAFE-03, SAFE-04
**Success Criteria** (what must be TRUE):

  1. When the user starts a manual send/swipe/continue, the in-flight result is parked and appended once ST is idle, and remaining items wait until the manual generation ends; native Stop is treated differently from queue cancel
  2. Editing or deleting the target message, or sending a new message, clears pending items with a toast explaining why; switching chats aborts the running item and keeps pending items stored with the original chat
  3. After a page refresh or returning to a chat, the queue starts paused and the user is asked to resume or discard (showing count and model); stale stored items are dropped with a notice, and no prompts are stored in chat metadata
  4. The queue pauses with a notification after N consecutive failures (no automatic retries), when API/model/preset changed since queueing, and while Prompt Inspector is enabled
  5. With the same chat open in two tabs, only one tab runs the queue and the other shows state read-only

**Plans**: 8 plans
Plans:

**Wave 1**

- [x] 04-01-PLAN.md — Reason-set runner pause, park-then-check, native-only guard resume, idle watchdog (GUARD-01, GUARD-06)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 04-02-PLAN.md — Lifecycle clears on edit/delete/send, Continue re-fingerprint (GUARD-02)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 04-03-PLAN.md — chat_metadata persistence, chat-switch handler, validated load (GUARD-03, PERS-01, PERS-04)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 04-04-PLAN.md — Resume/discard popup and paused UI states (PERS-02, PERS-03)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 04-05-PLAN.md — Circuit breaker, Prompt Inspector refuse/pause, shared enqueue (SAFE-01, SAFE-03)

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 04-06-PLAN.md — Connection-change pause and popup (SAFE-02)

**Wave 7** *(blocked on Wave 6 completion)*

- [x] 04-07-PLAN.md — Cross-tab lease ownership, takeover, demotion (SAFE-04)

**Wave 8** *(blocked on Wave 7 completion)*

- [x] 04-08-PLAN.md — Read-only tab mirror and UI, live smoke checkpoint (SAFE-04)

**UI hint**: yes

### Phase 5: Compatibility & Release

**Goal:** The extension is verified to coexist with the other extensions users run, never triggers spend cascades, and is documented for release
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: COMP-01, COMP-02, COMP-04
**Success Criteria** (what must be TRUE):

  1. A test matrix records the extension working alongside Deep-Swipe, UserSwipes, Prompt Inspector (disabled), Vectors, TTS, and Summarize
  2. With ST auto-swipe and auto-continue enabled, queued generations do not trigger cascades of extra generations
  3. README documents install, usage, and the fidelity gaps of the chosen route, and makes no prompt-cache savings claims

**Plans**: 4 plans
Plans:

**Wave 1**

- [x] 05-01-PLAN.md — Gap warning toast (bridge detection, once-per-session gate) + COMP-02 unit proofs (COMP-02)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 05-02-PLAN.md — Live COMP-01 matrix: preflight, UserSwipes install, baseline, solo, combined, gap-toast (COMP-01)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 05-03-PLAN.md — Live COMP-02 cascade test + folded Phase 4 HUMAN-UAT (COMP-02)
**Wave 4** *(blocked on Wave 3 completion)*

- [x] 05-04-PLAN.md — Packaging decision, README, manifest, LICENSE (COMP-04)

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Route Verification Spike | 7/7 | Complete   | 2026-10-25 |
| 2. Single Queued Swipe End-to-End | 5/5 | Complete   | 2026-10-26 |
| 3. Full Queue Control & UI | 4/4 | Complete   | 2026-10-27 |
| 4. Lifecycle, Persistence & Spend Safety | 8/8 | Complete   | 2026-10-28 |
| 5. Compatibility & Release | 4/4 | Complete   | 2026-10-29 |
