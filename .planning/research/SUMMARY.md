# Project Research Summary

**Project:** Queued Swipes for SillyTavern
**Domain:** SillyTavern UI extension — serial background swipe queue
**Researched:** 2026-10-25
**Confidence:** MEDIUM-HIGH

## Executive Summary

The project is a browser-only ES-module extension for ST 1.19.0. It queues swipe generations for the latest AI message, and each one lands as a normal swipe page without moving the view.

**How to build it:**
- Plain JS with no bundler.
- All ST access goes through `getContext()`, called fresh each time.
- One `st-bridge.js` file holds the internal imports that can't be avoided.
- Queue state lives in `chat_metadata`.
- The queue core is pure code, unit-tested with Vitest.

**Competitor:** SillyTavern-SwipePregen. Its batch is blocking, can't be extended while running, doesn't persist, and stops on the first failure. Our differentiators:
- add requests while the queue runs
- per-item failure isolation
- persistence with ask-before-resume
- cancel one or all
- `/queueswipe`

**Main risks:** chat corruption and runaway spend.
- Corruption comes from slot overwrite, truncating `chat`, a chat switch mid-flight, and stale `chatMetadata` snapshots.
- Spend comes from auto-resume, retries, the ST auto-swipe cascade, and settings drift.

**Mitigations:**
- Never mutate `swipe_id` and never truncate `chat`.
- Append synchronously, and only when ST is idle.
- Check a chat identity token and a target fingerprint before every commit.
- Start paused on load.
- No auto-retry, plus a circuit breaker and caps.

## KEY OPEN DECISION: Generation Route (resolve in Phase 1 spike)

| Route | Source | Summary |
|---|---|---|
| **R1: dryRun capture + own transport** | ARCHITECTURE.md (recommended) | `generate('swipe', {}, true)` captures `generate_data` via `GENERATE_AFTER_DATA`. The extension sends it with its own `AbortController`, runs the native `cleanUpMessage` and reasoning parse, then appends like `/addswipe`. |
| **R2: native swipe + view restore** | FEATURES.md (SwipePregen uses `ctx.swipe.to(... forceSwipeId ...)`), PITFALLS.md 1b | Runs the real pipeline, then restores `swipe_id` and re-renders. |
| R3: quiet/raw | PITFALLS.md | Rejected: wrong context, no reasoning or metadata, locks the UI. |

**R1 strengths:**
- True stay-put.
- No streaming into the visible message.
- No `is_send_press`, and the arrows stay visible.
- The user can keep navigating.
- The extension controls its own cancel.

**R1 gaps:**
- Generate interceptors are skipped (Vectors).
- Chat Completion squash is skipped.
- No itemized prompt.
- No `MESSAGE_RECEIVED`, tool calls, or auto-continue.
- Only `choices[0]` is kept.
- Horde is unsupported.
- Needs imports beyond `getContext()`.
- The dry run clobbers the private `abortController`, so it can only run when ST is idle.

**R2 strengths:** Full native fidelity and less code.

**R2 weaknesses:**
- `swipe_id` flips during every run.
- Output streams into the visible message and auto-scrolls.
- The arrows are hidden and Send is blocked.
- The saved state is inconsistent mid-run.
- SwipePregen needed a freeze overlay plus a MutationObserver hack.

**Recommendation:** Spike R1 first. Keep R2 only as a documented fallback mode.

**Spike go/no-go criteria:**
- (a) Dry-run capture works on one Chat Completion backend and one Text Completion backend, with no visible side effects.
- (b) The captured prompt matches a real swipe prompt, with Vectors and squash each tested on and off.
- (c) Both `sendOpenAIRequest` return shapes are handled: the async generator when streaming, JSON otherwise.
- (d) A manual send during capture doesn't corrupt `abortController`.
- (e) Calling `runGenerationInterceptors` first restores Vectors parity.
- (f) Stop-with-partial behavior and `power_user.auto_swipe` reachability are confirmed.

### Consequences to carry forward

1. **Reword the PROJECT.md decision.** If R1 wins, "Serial execution through native pipeline" becomes "native prompt build + native cleanup helpers, own serial scheduler".
   - The rationale changes too. Post-processing is no longer free; the extension reuses exported helpers. The parity gaps are accepted and documented.
   - "Never fire concurrent `Generate('swipe')`" still holds, because the extension never calls a non-dry `Generate('swipe')`.
   - The "Locked decisions" in CLAUDE.md need the same rewording. Update both files after the spike.
2. **Manual send is blocked only while a native-pipeline item runs.** This affects the "manual gen pauses queue" decision.
   - **Under R2:** `is_send_press` is set for each item, so Send is dead and the arrows are hidden. "Pause" then means pressing Stop.
   - **Under R1:** no native state is held while a request is in flight, so the user can send and swipe freely.
     - A non-dry `GENERATION_STARTED` pauses the runner.
     - The result of an in-flight request is parked and appended once ST is idle (ARCHITECTURE.md section 1.3 append race).
   - Restate the decision after the spike. That also resolves open question 6 in the requirements draft.

## Key Findings

### Recommended Stack
- Plain JS with JSDoc type-checking, ESLint 9 flat config, and Vitest.
- `minimum_client_version` 1.19.0. Use `hooks.activate` in the manifest. Don't use `generate_interceptor`.
- Register the slash command with `SlashCommandParser.addCommandObject`.
- Save the queue with `chatMetadata` + `saveMetadataDebounced`, settings with `extensionSettings`, and swipes with `saveChat`.

### Expected Features

**Must have (table stakes):**
- button and badge
- results appended as native swipes
- stay-put view
- cancel one or all
- per-item error isolation
- queue cap (default 5, hard max 20)
- pause on manual generation
- invalidation
- settings
- `/queueswipe`
- persistence with ask-before-resume

**Differentiators:**
- add requests while the queue runs
- per-chat pause and keep
- opt-in auto-jump
- coexistence with Deep-Swipe, UserSwipes and Prompt Inspector

**Defer to v1.x:**
- per-item cancel list
- `/queuecancel` and `/queuestatus`
- wand-menu entry
- progress bar

**Defer to v2+:**
- group chats
- parallel mode
- prompt variants
- queueing on non-latest messages

### Architecture Approach

**Components:**
- ST Bridge
- Queue Store
- Runner/Scheduler
- Generation Adapter
- Swipe Appender
- Event Guard
- UI, Settings and Commands

**Patterns:**
- Idle-gated single flight.
- Park results, then flush.
- Fingerprint (`chatId`, `integrity`, `mesId`, `swipe0Hash`), checked before start and before commit.
- Persist only ids and timestamps, never prompts.

### Critical Pitfalls

1. **Slot overwrite via native `Generate('swipe')`.** After each completion, assert `swipes.length === swipe_info.length` with no holes.
2. **Chat switch and stale snapshots.** Use the identity token, and never cache `chatMetadata`.
3. **Runaway spend.** Start paused, apply caps, never retry, add a circuit breaker, fingerprint the model and preset, and detect auto-swipe.
4. **A resolved promise doesn't mean success, and events can re-enter.**
   - Define success by observable post-conditions.
   - Drive the queue from the runner's own promise.
   - Poll `isGenerating()`, because `GENERATION_ENDED` is unreliable.
5. **Never truncate or mutate `chat`.** Deep-Swipe's truncate-and-restore caused real data loss.
   - Write a full `swipe_info.extra` for each swipe: reasoning, api, model, signature.
   - Append synchronously.

## Implications for Roadmap

1. **Source-verification spike + route decision.**
   - Delivers: go/no-go on the route, the import list, `minimum_client_version`, the prompt-parity diff, the streaming, stop/partial and auto-swipe policies, the PROJECT.md and CLAUDE.md rewording, and the design rules.
   - Avoids: P1, P4, P8, P11, P13, P14.
2. **Skeleton, bridge, settings, store, persistence.**
   - Delivers:
     - manifest and `st-bridge.js` with feature detection
     - settings merge
     - a store with a schema and a fingerprint, paused by default on load
     - the `canQueue()` gate
     - queue-core tests
     - the `qs-` CSS prefix
   - Avoids: P3, P9, P10, P16, P20, P22, P23, P28, P30.
3. **Swipe appender + pager.**
   - Delivers:
     - a synchronous append with `/addswipe` parity
     - a full `swipe_info.extra`
     - a live `k/total` update, saved once
     - opt-in auto-jump
     - a normalizer
     - a debug command for testing
   - Avoids: P1, P15, P18, P24, P25.
4. **Generation adapter + serial runner.**
   - Delivers:
     - dryRun capture and transport for Chat Completion and Text Completion
     - cleanup, reasoning parse, and an error taxonomy
     - an idle gate with park/flush
     - per-item abort and the `cancelRequestedByQueue` flag
     - a circuit breaker, no retries, and the identity-token check on every commit
   - Avoids: P2, P4–P7, P13, P14, P17.
5. **Event guard, UI, slash command, resume.**
   - Delivers:
     - the event policy, re-validated at append time
     - badge and button with scoped selectors
     - cancel one or all
     - coalesced toasts
     - `/queueswipe` with a total clamp
     - a resume/discard prompt that shows the model
     - a pause when settings drift
     - a multi-tab owner heartbeat
   - Avoids: P2, P7, P9, P12, P16, P19, P26, P27.
6. **Compatibility, docs, packaging.**
   - Delivers:
     - a test matrix covering Deep-Swipe, UserSwipes, Prompt Inspector, Vectors, TTS, Summarize and Expressions, with auto-swipe and auto-continue on
     - a README that documents the fidelity gaps and promises no cache savings
     - a version matrix
   - Avoids: P12, P17, P18, P21, P23.

**If R2 wins:**
- Phase 4 changes shape. It needs streaming control with a persisted recovery flag, Stop semantics, and view-restore logic.
- The stay-put requirement relaxes to "restore after each item".

### Research Flags
- **Need research:**
  - Phase 1, the live spike.
  - Phase 4: per-backend request shapes, interceptor parity, and the abort race.
  - Phase 6: the internals of the third-party extensions.
- **Standard patterns, skip research:** Phases 2, 3 and 5.

## Confidence Assessment

| Area | Confidence | Notes |
|---|---|---|
| Stack | HIGH | From the 1.19.0 source and docs. Testing approach and lint plugin versions: MEDIUM. |
| Features | MEDIUM | Competitor source was read. UI conventions unverified, and another queue extension may exist. |
| Architecture | MEDIUM-HIGH | Source facts HIGH. The route isn't spiked yet. Interceptor parity: LOW. |
| Pitfalls | MEDIUM-HIGH | ST core HIGH. Third-party behavior and cache costs: MEDIUM. |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address
- **Generation route (R1 vs R2):** decide in the Phase 1 spike.
- **Interceptor parity:** if it can't be restored, document it and show a toast when any extension declares `generate_interceptor`.
- **Partial save on Stop while streaming:** needs a runtime test. Recommend discarding partials.
- **`power_user.auto_swipe` and auto-continue:** check that both are reachable.
- **Chat switch:** ST has no pre-switch hook, so the identity token and commit gate must cover it.
- **Imports outside the context:** keep `SWIPE_SOURCE` and similar imports isolated in the bridge.
- **Template path and settings drawer markup:** check them at install.
- **Other backends:** only Chat Completion and Text Completion were read.
- **Multi-tab:** untested. ST has no cross-tab lock.
- **Prompt-cache benefit:** unverified, so promise no savings.

## Sources

### Primary (HIGH confidence)
- ST `release` 1.19.0 source: `script.js`, `st-context.js`, `events.js`, `extensions.js`, `openai.js`, `textgen-settings.js`, `reasoning.js`, `slash-commands.js`, `constants.js`, `eventemitter.js`, `endpoints/chats.js`.
- docs.sillytavern.app.
- Source of SwipePregen, Prompt Inspector, UserSwipes and Deep-Swipe.

### Secondary (MEDIUM confidence)
- ParallelSwipes and inSTead READMEs.
- GitHub search (18 of 34 results read).
- ST issues #327, #1189, #4001, #3787, #4717, #5033, #5265.
- Extension-WebpackTemplate.

### Tertiary (LOW confidence)
- ST PR #4610 (title only).
- Provider prompt-cache behavior.

---
*Research completed: 2026-10-25*
*Ready for roadmap: yes*
