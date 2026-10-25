# Feature Research

**Domain:** SillyTavern (ST) UI extension, background/queued swipe generation for the latest AI message
**Researched:** 2026-10-25
**Confidence:** MEDIUM. Competitor behavior is HIGH (READMEs and SwipePregen source read directly). ST UI conventions (drawer markup, toastr use) are MEDIUM, taken from extension source and not from ST core.

## Key Finding: a direct competitor exists

**Nicoolodion/SillyTavern-SwipePregen** (MIT, updated 2026-10-14) already ships "background swipe" and "batch pre-generate up to 20". The project is NOT greenfield in the market. Its design, read from its `index.js`, is weak in ways this project's locked decisions fix. These gaps are the differentiation:

| SwipePregen behavior (source verified) | Gap this project fills |
|---|---|
| Batch is a blocking `for` loop. It cannot be added to while running. | True queue: add or cancel items at any time. |
| Batch stops at the first failed item (`if (!ok) break`). | Per-item failure isolation. |
| Only a global "stop batch" exists. | Cancel one item or all. |
| State is in memory only. A refresh loses the batch. | Persistence in `chat_metadata`, with ask-before-resume. |
| No slash command. | `/queueswipe [count]`. |
| Freeze overlay plus `MutationObserver` hack on `.mes_text`. The `swipe_id` is flipped, then restored and the message re-rendered with `addOneMessage`. | See "Technical lead" below. |
| Refuses to start if a generation is in progress. | Manual generation pauses the queue, which resumes afterward. |
| Aborts on `CHAT_CHANGED` and discards the batch. | Pause and keep per chat. |
| Settings: only default batch size and a progress bar toggle. | Max queue cap, auto-jump option, notification style. |

## Technical lead for the architecture researcher

SwipePregen calls `ctx.swipe.to(null, SWIPE_DIRECTION.RIGHT, { source: SWIPE_SOURCE.AUTO_SWIPE, forceSwipeId: lastMsg.swipes.length, forceDuration: 0 })`. It imports `SWIPE_DIRECTION` and `SWIPE_SOURCE` from `scripts/constants.js`. ST PR #4610 ("Refactored swipe...") is the likely origin of this API. It resolves the `[Recall]` item about whether a swipe can target a given slot. **Verify against ST source before relying on it**, and set `minimum_client_version` accordingly. It is a promising route for "native pipeline, serial", but it still switches `swipe_id` and streams into the visible message, so the project's stay-put requirement still needs a restore step or a different route.

## Landscape of related ST extensions and core features

| Extension / feature | What it does | Relevance |
|---|---|---|
| SwipePregen (Nicoolodion) | Double-arrow button next to the swipe-right chevron, wand-menu batch modal (up to 20), top-of-chat progress bar with stop, toasts. | Direct competitor. Placement conventions to copy. |
| ParallelSwipes (ScrenSixerv) | Extra concurrent chat-completion requests appended as swipes. Wand entry "Parallel replies: N", `/pswipe`, settings section, progress bar, one retry on 429. Chat Completion only, cost scales with N. | Confirms parallel is a separate product with provider-limit risks. Stay out of scope. |
| Deep-Swipe (Rurijian) | Swipes on any message via a truncate-generate-restore trick. Per-message chevrons and counter, `/dswipe`, "read while generating" overlay, "auto-advance to latest swipe" setting. Refuses to generate while Prompt Inspector's "Inspect Prompts" is on. | Compatibility target. "Auto-advance" is the same idea as our auto-jump opt-in. |
| UserSwipes (Bartasx4, plus LenAnderson fork) | Adds `swipes`, `swipe_id`, `swipe_info` to user messages. No UI of its own and no settings. | Compatibility target. Data-shape only. Our feature is disabled on user messages anyway. |
| SwipeModelRoulette | Switches connection profile per swipe for variety. | Per-item variants. Confirms they are a separate concern (out of scope). |
| inSTead | Revision-as-swipe via the message "..." extra-buttons menu. | Confirms the "..." menu is a standard home for per-message actions. |
| swipes-list, SwipeAnnotations, swipe-sculpt, SwipePreviewer | Browse, annotate, merge, and preview swipes. | Consumers of the swipes we create. Our swipes must be plain and native so they work. |
| ST built-in | `/swipe`, `/addswipe`, `/delswipe`, `/regenerate`, `/gen`, `/genraw`, `/trigger`. Auto-swipe (on blacklisted words or short length). | No built-in "N swipes" or queue. The docs list no `/swipes-*` family. The `/swipes-swipe` seen in an issue comment comes from the LALib/STscript ecosystem (see below). |

**ST core history on this request (all closed "not planned" by the stale bot, never by maintainer decision):**
- #327 "Multi swap" (2023): sequential queue of N swipes while doing other things. Maintainer: "out of scope". Stale-closed.
- #1189 "Queueing multiple responses" (2023): unconditional N swipes. Maintainer (Wolfsblvt) called it niche and said STscript/LALib can do it. Workaround: an automation that runs `/times 4 {: /swipes-swipe :}`. Stale-closed.
- #4001 "Batch response queue / pre-set number of automatic swipes" (2025): slow local-model users who want a background queue. Stale-closed with no maintainer reply.

Takeaway: real, recurring demand from slow-local-model and expensive-API users. ST core will not build it. The STscript workaround is blocking, unpersisted, and has no UI. Do not expect help from core.

## Feature Landscape

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| One-click "queue a swipe" button on the latest AI message, in the swipe-right area | SwipePregen sets the precedent (button beside the chevron or counter). Zero discoverability cost. | MEDIUM | Inject into `.last_mes .swipeRightBlock`, before `.swipes-counter`. Re-inject on `CHARACTER_MESSAGE_RENDERED`, `MESSAGE_SWIPED`, `MESSAGE_DELETED`, `CHAT_LOADED`. Hide on user, system, and group messages. |
| Completed results appear as normal swipes (`k/total` grows) | Core promise. Other swipe tools (lists, annotations) must see native data. | MEDIUM | `swipes[]` plus parallel `swipe_info[]`. Save with `saveChatConditional()`. Timestamps required. |
| Reading is undisturbed (view stays on the current swipe) | Stated purpose. SwipePregen's overlay hack shows how easy it is to flicker. | HIGH | The hardest item. Depends on the source-verification spike. Re-render of the counter must not move the scroll position. |
| Queue count and progress indicator (badge) | Users must know something is running and how many remain. | LOW | Badge on the button (`running + pending`). Spinner icon on the running state (SwipePregen uses a spinning icon). |
| Cancel one or all | A queue with no cancel is a spend hazard. | MEDIUM | Aborting the running item needs ST's stop path, then continue to the next item. See "Cancel semantics" below. |
| Non-modal failure reporting that doesn't kill the queue | SwipePregen's break-on-first-fail is the known weakness. | LOW | `toastr.warning` with the reason; drop the item; continue. |
| Max queue cap, configurable (default 5) | Prevents accidental spend (parallel extension notes cost scales with N). | LOW | `extension_settings[MODULE_NAME].maxQueue`. SwipePregen caps at 20, so use that as the hard upper bound. |
| Safe interaction with manual send, swipe, continue, and stop | The native pipeline is single-flight. SwipePregen just warns and refuses. | HIGH | Pause on manual generation; resume when idle and the target is still valid. |
| Invalidation on edit, delete, new user message, chat change | A stale queue produces swipes for the wrong context. | MEDIUM | Events: `MESSAGE_EDITED`, `MESSAGE_DELETED`, `MESSAGE_SENT`, `CHAT_CHANGED` (names `[Recall]`, verify). Toast on clear. |
| Settings panel in the Extensions drawer | Universal convention. | LOW | An inline-drawer block in `#extensions_settings` (or `#extensions_settings2`). Stored in `extension_settings[MODULE_NAME]`. Defaults merged on load. |
| Works on all backends with no config | Goal G4. | MEDIUM | Free if using the native pipeline. Notably this beats ParallelSwipes, which is Chat Completion only. |
| Completion notification | Users are not looking at the screen. SwipePregen toasts "Swipe ready! (n total)". | LOW | `toastr.success` per item, or one summary toast at queue end. Make it a setting (per-item, summary, off). |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| True add-while-running queue | SwipePregen's batch cannot be extended. The #327 and #4001 requests are literally this. | MEDIUM | Queue as data (array in state), a runner loop that pulls items. |
| Persistence across refresh (in `chat_metadata`) with ask-before-resume | No competitor survives a reload. Ask-first avoids surprise API spend. | HIGH | Handle stale and partial items: store only target message id/index, swipe count at queue time, and a creation timestamp. Drop items whose target no longer matches. Prompt via `callGenericPopup` or a toast with an action. |
| Per-item cancel (queue popover or list) | Finer than "stop batch". | MEDIUM | Small popover on the badge listing pending items with an X. Can be cut to "cancel last" if cost is too high. |
| `/queueswipe [count]` slash command | Scriptable and usable from Quick Replies. No competitor has one. ParallelSwipes has `/pswipe`, so there is precedent for the pattern. | LOW | Register through `SlashCommandParser`. Add `/queuecancel` and `/queuestatus` as trivial companions. |
| Pause and keep per chat on chat switch | Come back to the chat and resume. | MEDIUM | Keyed by chat metadata, so it comes for free once persistence exists. |
| Opt-in auto-jump when already on the newest swipe | Matches Deep-Swipe's "auto-advance" setting. | LOW | Default off. Only fires if the user was on the last swipe at completion time. |
| Prompt-cache-friendly serial back-to-back runs | Serial identical prompts hit provider caches, which lowers cost versus parallel. | LOW | A side effect of the design. Worth stating in the README. |
| Coexists with Deep-Swipe, Prompt Inspector, UserSwipes | Deep-Swipe and Prompt Inspector already conflict, so a third extension that plays nicely is a real selling point. | MEDIUM | Detect `isGenerating()` and defer. Never start while Prompt Inspector is "inspecting". Test matrix required. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Parallel / concurrent generation | Speed. ParallelSwipes exists. | Breaks single-flight state (`is_send_press`, abort and streaming controller). Chat Completion only. Needs provider concurrency. Cost scales linearly. Hard to cancel. | Serial queue. Revisit as a separate, opt-in v2 seam. |
| Streaming preview of the running item | "I want to watch it." | Conflicts with stay-put. The streaming writes go into the visible `mes`. | Badge spinner only. Users can swipe to the result when it lands. |
| Pre-reserving empty swipe slots | Gives instant pager count. | Empty pages appear in the native pager and corrupt `k/total`. | Append on completion only. |
| Per-item prompt variants (temperature sweeps, profile roulette, different presets) | Variety. SwipeModelRoulette exists. | Scope creep. Needs preset and connection switching, which is global state. | Out of scope. Document that SwipeModelRoulette-style tools can coexist. |
| Queueing on non-latest messages | Fill old messages with alternatives. | Deep-Swipe territory. Requires truncate-and-restore, which breaks cache and conflicts with Prompt Inspector. | Point to Deep-Swipe. |
| Group chat support (v1) | Completeness. | Swipe semantics differ (member selection, `/trigger` rounds). | Hide the control in groups. v2 candidate. |
| Auto-run queue on page load | Convenience. | Silent API spend after a refresh. | Ask before resume. |
| Auto-queue rules (e.g. "always generate 3 after each reply") | The #1189 workaround. | Runaway spend. Overlaps built-in auto-swipe and STscript. | Leave to STscript on top of `/queueswipe`. |
| Modifying `chat.jsonl` or core files | Shortcuts. | Corruption risk, update breakage. | `saveChatConditional()` only. |
| Server plugin | Could enable true parallelism. | Official content repo rejects extensions that need a server plugin. | Extension-only. |
| Swipe rating, annotation, or comparison UI | Natural follow-on. | Other extensions already cover it (SwipeAnnotations, swipe-sculpt, swipes-list). | Stay compatible and let them consume our swipes. |
| Retry-on-failure loop | Users want resilience. | Hides systematic failures (bad key, empty replies) and burns spend. | Drop the failed item and toast the reason. Optionally one manual "requeue". |

## UX Conventions (where things live)

| Element | Convention (evidence) | Recommendation |
|---------|----------------------|----------------|
| Per-swipe action | Beside the swipe-right chevron and `.swipes-counter` on the last message (SwipePregen). | Primary control here. Badge overlays the icon. |
| Per-message extras | Message "..." extra-buttons menu (inSTead). | Optional secondary entry. |
| Global action | Wand (Extensions) menu `#extensionsMenu`, appended lazily so poll briefly (SwipePregen, ParallelSwipes). | Optional entry "Queue swipes...". Not needed for MVP. Prefer the button plus slash command. |
| Progress | Top-of-chat bar with stop (SwipePregen, ParallelSwipes). | Badge only for v1 (stay-put). A progress bar is optional and later. |
| Notifications | `toastr` (success for ready, warning for busy or failure). `toastr.success(msg, '', { timeOut: 2500 })` is the pattern. | Honor a notification-style setting. |
| Settings | Extensions drawer inline-drawer section, plus `extension_settings[MODULE_NAME]`. | Max queue, auto-jump, notification style. |
| i18n | SwipePregen uses `t` from `i18n.js` and ships en, de, zh-CN, fr. | Use `t` template tags from day one. Translations are optional. |
| Busy guard | `isGenerating()` check with a warning toast. | Reuse, but queue instead of refuse. |
| Popups | `callGenericPopup(..., POPUP_TYPE.CONFIRM)`. | Use for the resume prompt. |

### Cancel semantics (decide in requirements)
- Cancel pending item: remove from the array. Trivial.
- Cancel running item: call ST's stop path (button or `stopGeneration`; verify). Drop the item and continue, unless the user pressed the native stop button, in which case it is ambiguous whether to continue. Recommendation: native stop pauses the queue (treat as a manual action) and shows a toast "Queue paused, N pending".
- Cancel all: clear pending and abort running.

## Feature Dependencies

```
Source-verification spike (swipe/generate internals)
    └──requires──> Serial runner (one item at a time)
                       ├──requires──> Append-on-completion (swipes[] + swipe_info[] + save)
                       │                  └──requires──> Stay-put view preservation
                       ├──requires──> Per-item error isolation
                       └──requires──> Busy detection / pause on manual generation

Queue data model (array in state)
    ├──requires──> Add button + badge
    ├──requires──> /queueswipe command
    ├──requires──> Cancel one / all
    └──requires──> Invalidation (edit / delete / new user msg / chat change)
                       └──enhances──> Persistence in chat_metadata
                                          └──requires──> Resume prompt (ask-first)
                                                             └──requires──> Stale item validation

Settings panel ──enhances──> Max queue, auto-jump, notification style
Auto-jump opt-in ──conflicts──> Stay-put (only when the user opts in and is on the newest swipe)
Parallel mode ──conflicts──> Serial single-flight (deferred)
Streaming preview ──conflicts──> Stay-put
Per-item cancel list ──enhances──> Badge
```

### Dependency Notes
- **Serial runner requires the spike:** whether `ctx.swipe.to` (or `Generate('swipe')`) can run without switching view is unproven. SwipePregen's approach (flip `swipe_id`, freeze the DOM, restore, re-render) is a fallback, but it is brittle and shows flicker risk. This gates all runner work, so it must be Phase 1.
- **Persistence requires invalidation rules:** a persisted queue is only safe if staleness checks exist. Build invalidation first, then persist.
- **Slash command and button share one `enqueue()` API:** build the model first so both are thin callers.
- **Per-item cancel enhances badge:** the badge can ship alone, with the list added later.
- **Auto-jump conflicts with stay-put:** gate it behind a default-off setting and the "already on newest swipe" condition.

## MVP Definition

### Launch With (v1)
- [ ] Queue model plus serial runner using the native pipeline, with append-on-completion and save: the core value
- [ ] Add button beside the swipe arrows on the latest AI message, with a count badge and running spinner
- [ ] Stay-put guarantee (never change `swipe_id` unless opted in)
- [ ] Cancel all, and cancel pending items
- [ ] Per-item error isolation with a warning toast
- [ ] Pause on manual generation, resume after
- [ ] Invalidation on edit, delete, new user message, and chat change, with a toast
- [ ] `/queueswipe [count]`
- [ ] Settings: max queue (default 5), auto-jump (off), notification style
- [ ] Persistence in `chat_metadata` with ask-before-resume: required by locked decision D4, so it is in v1 even though it is the highest-risk differentiator

### Add After Validation (v1.x)
- [ ] Per-item cancel list or popover: trigger is user feedback that "cancel all" is too coarse
- [ ] `/queuecancel` and `/queuestatus`
- [ ] Wand-menu entry with a count modal, for SwipePregen-style batch UX
- [ ] Optional top-of-chat progress bar
- [ ] i18n strings in other languages

### Future Consideration (v2+)
- [ ] Group chat support
- [ ] Parallel mode behind a seam (separate effort, a ParallelSwipes-style design)
- [ ] Per-item prompt variants (profile or preset per item)
- [ ] Queueing on non-latest messages (coordinate with Deep-Swipe, not duplicate)

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Queue model plus serial runner | HIGH | HIGH | P1 |
| Append-on-completion with native `swipe_info` | HIGH | MEDIUM | P1 |
| Stay-put view preservation | HIGH | HIGH | P1 |
| Add button plus badge | HIGH | MEDIUM | P1 |
| Cancel all and pending | HIGH | MEDIUM | P1 |
| Error isolation | HIGH | LOW | P1 |
| Pause on manual generation | HIGH | HIGH | P1 |
| Invalidation rules | HIGH | MEDIUM | P1 |
| Settings panel | MEDIUM | LOW | P1 |
| `/queueswipe` | MEDIUM | LOW | P1 |
| Persistence plus ask-before-resume | HIGH | HIGH | P1 (locked decision) |
| Completion notifications (style setting) | MEDIUM | LOW | P1 |
| Auto-jump opt-in | LOW | LOW | P2 |
| Per-item cancel list | MEDIUM | MEDIUM | P2 |
| Wand-menu entry | LOW | LOW | P2 |
| Progress bar | LOW | LOW | P3 |
| Other-language i18n | LOW | LOW | P3 |
| Compatibility test matrix (Deep-Swipe, Prompt Inspector, UserSwipes) | MEDIUM | MEDIUM | P1 |

**Priority key:** P1 must have for launch. P2 should have, add when possible. P3 nice to have.

## Competitor Feature Analysis

| Feature | SwipePregen | ParallelSwipes | Deep-Swipe | Our Approach |
|---------|-------------|----------------|------------|--------------|
| Background single swipe | Yes (button + freeze overlay) | No | Yes, any message, overlay | Yes, stay-put without a visual hack if the spike allows |
| Batch / queue | Batch up to 20, blocking, not extendable | N concurrent per generation (1-10) | No | Extendable queue, default cap 5 |
| Add while running | No | N/A | N/A | Yes |
| Cancel | Stop whole batch | ST stop cancels all | N/A | One, all |
| Failure handling | Stops batch | Retry once on 429, fail notice | N/A | Drop item, continue, toast |
| Persistence | None | None | None | `chat_metadata`, ask-first resume |
| Slash command | None | `/pswipe` | `/dswipe` | `/queueswipe` |
| Backends | All (native pipeline) | Chat Completion only | All | All (native pipeline) |
| Streaming preview | Hidden via overlay | N/A | Overlay | None (by design) |
| Settings | Batch size, progress bar | Rich (counts, timeouts, retry) | Toggles, prompts | Max queue, auto-jump, notification style |
| Prompt Inspector compat | Unknown | Unknown | Conflicts | Explicit goal |

## Sources

- SwipePregen README and `index.js` (read in full): https://github.com/Nicoolodion/SillyTavern-SwipePregen (HIGH)
- ParallelSwipes README: https://github.com/ScrenSixerv/SillyTavern-ParallelSwipes (HIGH for its stated behavior)
- Deep-Swipe README: https://github.com/Rurijian/deep-swipe (HIGH for its stated behavior; the repo slug is lowercase in the GitHub search API)
- UserSwipes READMEs: https://github.com/Bartasx4/SillyTavern-UserSwipes and https://github.com/LenAnderson/SillyTavern-UserSwipes (HIGH)
- inSTead (message "..." menu placement): https://github.com/ActualBroeckchen/inSTead (MEDIUM)
- GitHub repo search "sillytavern swipe" (34 results; the first 18 were read): https://api.github.com/search/repositories?q=sillytavern+swipe (MEDIUM)
- ST issues #327, #1189, #4001: https://github.com/SillyTavern/SillyTavern/issues/327, https://github.com/SillyTavern/SillyTavern/issues/1189, https://github.com/SillyTavern/SillyTavern/issues/4001 (HIGH)
- ST PR #4610 (swipe refactor), cited for the `ctx.swipe.to` lead: https://github.com/SillyTavern/SillyTavern/pull/4610 (LOW for the link between the PR and the `swipe.to` API; only the PR title was read)
- ST STscript docs (`/swipe`, `/addswipe`, `/delswipe`, `/regenerate`, `/gen`, `/genraw`, `/trigger`): https://docs.sillytavern.app/usage/st-script/ (HIGH)

## Gaps / Not Verified
- The inline-drawer settings markup, `SlashCommandParser` registration, and exact event names were not read from ST core. They come from convention and from SwipePregen's imports.
- Whether Prompt Inspector can be detected programmatically (flag or event) is unknown. Needs a look at its source in the compatibility phase.
- The remaining ~16 results of the GitHub swipe search (past the first 18) were not read, and neither were non-GitHub sources such as Reddit or Discord. Another queue extension could exist.
- The `/swipes-swipe` command in the #1189 comment is from the STscript/LALib ecosystem, and its existence was not confirmed in ST core docs.

---
*Feature research for: SillyTavern queued swipe generation extension*
*Researched: 2026-10-25*
