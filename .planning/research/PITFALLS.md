# Pitfalls Research

**Domain:** SillyTavern (ST) UI extension that queues background swipe generations for the latest AI message
**Researched:** 2026-10-25
**Confidence:** HIGH for ST-core behavior (read directly from source), MEDIUM for third-party extension behavior (read their code and changelogs, few public issues exist), MEDIUM for prompt-caching economics (ST source plus general provider knowledge)

**Evidence base.** ST `release` branch, shallow clone at commit `06bde93` (2026-09-14). Line numbers below refer to `public/script.js` at that commit and will drift. Also read: Deep-Swipe `CHANGELOG.md` and `deep-swipe.js` (Rurijian), Prompt Inspector `index.js` (SillyTavern/Extension-PromptInspector), UserSwipes `src/user-swipes.js` (Bartasx4). GitHub issue trackers for Deep-Swipe (3 issues) and UserSwipes (0) are nearly empty. The real failure evidence is in Deep-Swipe's changelog and in ST's own guard code, not in issue threads.

**Effect on the design docs.** Several `[Recall]` items in `01-architecture-analysis.md` are now verified, and some are worse than assumed. See "Verified facts" at the end.

---

## Critical Pitfalls

### Pitfall 1: Native `Generate('swipe')` is hard-wired to "the visible, newest slot"; calling it while the user is on an older swipe overwrites that swipe

**What goes wrong:**
`swipe()` first moves `swipe_id` to the new slot (`swipes.length`), then calls `Generate('swipe')`. `saveReply` (type `swipe`) then does `lastMessage.swipes.length++` (this creates a sparse hole). It writes the new text into `mes` only `if (swipe_id === swipes.length - 1)`. Otherwise it takes the `else { lastMessage.mes = getMessage }` branch. At the end of `saveReply`, `item.swipes[item.swipe_id] = item.mes` and `item.swipe_info[item.swipe_id] = {...}` run unconditionally.

So if the extension runs `Generate('swipe')` while `swipe_id` points at an older swipe (the "stay put" case), the new text overwrites the swipe the user is reading. The hole at `swipes[length-1]` stays empty. JSON serialization turns the hole into `null`. On next load `ensureSwipes` coerces it to `''` and warns. That produces a blank swipe page and a `swipes`/`swipe_info` length mismatch.

Streaming makes it worse. `StreamingProcessor.onProgressStreaming` writes partial text into `swipes[swipe_id]` and `swipe_info[swipe_id]` on every tick (about line 3705).

**Why it happens:**
The design docs assume "Generate('swipe') can target a non-visible slot". It cannot. Native swipe-generation is a view-coupled operation, and the stay-put requirement fights it directly.

**How to avoid:**
Make this the Phase 1 spike's first question and pick one of three routes with eyes open. Each has costs.
- **(a) Raw route.** Capture the exact swipe prompt with `Generate('swipe', {}, true)` (dryRun). dryRun skips UI side effects and returns right after `GENERATE_AFTER_DATA`, but you must intercept `generate_data` there. Then send it with `sendGenerationRequest` (exposed on `getContext()`) and push the result yourself. Cost: you must re-implement `cleanUpMessage`, reasoning extraction, `extractMultiSwipes`, stop-string handling, and images per API, which the project chose "native pipeline" to avoid. These helpers are not on `getContext()`.
- **(b) Native-with-view-flip.** Set `swipe_id` to the new slot, run native `Generate('swipe')` to completion, then restore `swipe_id` and re-render the original swipe (`swipe()` with `forceSwipeId` and `SWIPE_SOURCE.SWIPE_PICKER` or `SLASH_COMMAND`, which bypass guards). This contradicts "stay put and no streaming into the visible message" for the duration of each run. It is only viable if the queue runs while the user is on the newest swipe or accepts a flicker.
- **(c) Quiet route.** `generateQuietPrompt` does not reproduce swipe context (see Pitfall 4). Reject it as the primary route.

Whatever is chosen, do not write `swipes[]` through any path that uses `swipe_id` as the write index.

**Warning signs:**
A swipe page that suddenly shows the newly generated text instead of what the user was reading. `console.warn` "The message had a swipe that is not a string". A `null` in `swipes` in the saved jsonl. Counter total larger than the number of real pages.

**Phase to address:**
Phase 1 (source-verification spike, decides the route). Phase 3 (append implementation, with a test that asserts `swipes.length === swipe_info.length` and no holes after each completion).

---

### Pitfall 2: Chat switch mid-generation is not guarded by ST, and `CHAT_CHANGED` fires after the damage

**What goes wrong:**
`openCharacterChat`, `doNewChat`, `reloadCurrentChat` and `closeCurrentChat` do not stop a running generation, except `closeCurrentChat`, which checks `is_send_press`. `openCharacterChat` (about line 7744) calls `clearChat({clearData:true})`, which empties the same `chat` array in place with `chat.length = 0`. It then replaces `chat_metadata = {}` and loads the new chat. An in-flight `Generate` then completes and `saveReply` runs `lastMessage = chat[chat.length-1]` against the new chat. Possible outcomes:
- a `TypeError` on an empty chat;
- the AI reply appended or merged into the wrong chat;
- `lastMessage.swipes.length++` on an unrelated message.

`CHAT_CHANGED` is emitted only after `getChat()` finishes (about line 7700), so a handler cannot abort the generation before the damage is possible. There is a window where the extension "knows" only after the fact.

**Why it happens:**
ST's own flow assumes the user does not switch chats while generating (the stop button is visible). A background queue removes that assumption, because the user is free to switch while reading.

**How to avoid:**
- Capture a chat identity token when each item starts: `getCurrentChatId()` plus `chat_metadata.integrity`. `getChat()` guarantees a UUID there (about line 7641). Re-check the token before every mutation and before every `saveChatConditional()`.
- Prefer commit-at-end. Build the result off to the side and attach it only after the identity token and the target message identity match.
- On `CHAT_CHANGED`: call `stopGeneration()` if an item is running, discard its result, and move that item back to pending. Do this defensively because the damage window already passed. Also consider hooking the UI paths that trigger a switch (chat list, character select) and calling `stopGeneration()` first, if the spike shows a hook point.
- Never hold a reference to the `chat[i]` message object or the numeric index across an `await`. Re-resolve by a stable key such as `send_date` or `mes_id` plus the integrity token.

**Warning signs:**
`Cannot read properties of undefined (reading 'swipes')` in console after switching chats. An AI reply appearing at the end of a different chat. "Chat integrity check failed" popup on save. Unexpected `OVERWRITE` prompt.

**Phase to address:**
Phase 2 (identity token and event wiring). Phase 4 (edge-case handling and a test matrix that switches chats at every await boundary).

---

### Pitfall 3: Stale references. `chat` is stable, but `chat_metadata`, `streamingProcessor` and the other values from `getContext()` are snapshots

**What goes wrong:**
`getContext()` returns `chat` (a module-level array that is mutated in place and never reassigned, so the reference is stable but the contents change). It also returns `chatMetadata: chat_metadata`, `streamingProcessor`, `characterId`, `chatId`, `onlineStatus`, `groupId`, `name1`, `name2` and `maxContext` as values captured at call time. `chat_metadata` is reassigned whenever `updateChatMetadata`, `getChat`, `openCharacterChat` or `doNewChat` run. An extension that does `const { chatMetadata } = getContext()` once at load, and then writes `chatMetadata.queue = ...` later, writes into an orphaned object that is never saved. The queue silently fails to persist, or persists into the wrong chat.

**Why it happens:**
Extension authors cache the context at module load. Destructured primitives look like live bindings but are not.

**How to avoid:**
Call `getContext()` fresh at the point of use, every time. Wrap it in a single accessor, for example `const ctx = () => SillyTavern.getContext()`. Write metadata via `updateChatMetadata({[KEY]: value})` or `getContext().chatMetadata[KEY] = ...` followed by `saveMetadataDebounced()` or `saveChatConditional()`. Never keep `chatMetadata`, `streamingProcessor`, or `characterId` in module scope.

**Warning signs:**
Queue persists in one chat but vanishes after a refresh. Queue state "bleeds" into another chat. Unit tests that stub `getContext()` once and pass.

**Phase to address:**
Phase 2 (skeleton and persistence layer). Enforce with a lint rule or code-review checklist item.

---

### Pitfall 4: `generateQuietPrompt` and `generateRaw` do not produce a swipe. They change context, drop reasoning, and lock the UI

**What goes wrong:**
Observed in `Generate()`:
- The swipe branch pops the last message from the prompt (`if (type === 'swipe') coreChat.pop()`, about line 4497). `quiet` does not. A quiet prompt therefore includes the reply being swiped, and appends `quiet_prompt` at depth 0 as a system/user instruction. The output is a continuation or critique, not an alternative.
- A quiet generation sets `is_send_press = true`, calls `hideSwipeButtons()`, `deactivateSendButtons()`, and `showStopButton()` (lines 4345, 4430, 5336) for its whole duration. It emits `GENERATION_STARTED` with `type: 'quiet'` and runs every extension's `generate_interceptor`, so other extensions react to it as a real generation.
- `type !== 'quiet'` disables streaming for that call, and quiet returns the cleaned string only. `extra.reasoning`, `reasoning_duration`, `reasoning_signature`, images and `swipes` multi-output are all dropped. `generateQuietPrompt` additionally strips reasoning by default (`removeReasoning = true`).
- It never reaches `saveReply`, so `extra.api`, `extra.model`, `gen_started`, `gen_finished`, and `token_count` must all be filled in by the extension. They are the fields users see in the message footer.
- `unblockGeneration('quiet')` early-returns if a stream is still running, which can leave the UI locked.

**Why it happens:**
`generateQuietPrompt` looks like "run a prompt in the background", which is exactly the requirement. It is designed for utility calls (summaries, image prompts), not message alternatives.

**How to avoid:**
Do not use `generateQuietPrompt` / `generateRaw` as the main route. If the raw route (Pitfall 1a) is chosen, call `sendGenerationRequest` with a captured swipe prompt instead. If quiet is ever used as a fallback, document that the result is not equivalent and fill every `swipe_info` field explicitly (including `extra.reasoning`).

**Warning signs:**
Generated swipes that "continue" or "comment on" the previous reply. Missing model name/timer on queued swipes. Swipe arrows disappear and the stop button flashes while the user is reading.

**Phase to address:**
Phase 1 (spike decides the route). Phase 3 (parity test comparing a queued swipe with a native swipe, field by field).

---

### Pitfall 5: Treating a resolved `Generate()` promise as success. Many early exits resolve with nothing appended

**What goes wrong:**
`Generate()` returns a resolved `undefined` (no throw) when:
- there is no backend connection (about line 4392);
- the input was a slash command;
- Kobold streaming is unsupported;
- Horde is disallowed;
- a `generate_interceptor` aborts (line 4564);
- tool calls stop the flow;
- `onSuccess` gets `!data` (also an aborted stream).

In these cases the swipe slot may be left allocated (`swipe_id` already pointing past the end) with nothing added. Native `swipe()` repairs this in `endSwipe` by clamping `swipe_id` and re-rendering. A custom queue that only checks "promise resolved" will count the item as done, report success, or loop forever.

**Why it happens:**
`Generate` signals failure via toasts and side effects, not by throwing. Only API errors throw (through `onError`).

**How to avoid:**
Define success as an observable post-condition: `swipes.length` increased by one, `swipe_info.length` matches, and the new entry is a non-empty string. Otherwise treat the item as failed (non-modal toast, drop, continue). After every attempt, run an invariant repair: clamp `swipe_id` into `[0, swipes.length-1]`, trim holes, and equalize `swipe_info`. Wrap each item in `try/finally`.

**Warning signs:**
Queue badge says "done" but the pager total did not change. `swipe_id` greater than `swipes.length - 1` in the saved chat.

**Phase to address:**
Phase 3 (item runner). Phase 4 (error matrix: offline, interceptor abort, empty reply, API 4xx/5xx, stop).

---

### Pitfall 6: Re-entrancy and event deadlocks. `eventSource.emit` awaits listeners serially, and there is no reliable "generation finished" event

**What goes wrong:**
- `eventSource.emit` awaits each listener in order (`lib/eventemitter.js`). A listener on `MESSAGE_RECEIVED`, `CHARACTER_MESSAGE_RENDERED`, `GENERATION_STOPPED` or `MESSAGE_SWIPED` that awaits starting the next queue item runs inside the previous `Generate`'s own `await emit(...)`. That causes either a deadlock or a concurrent `Generate`, which breaks single-flight state (`is_send_press`, `abortController`, `streamingProcessor` are module globals).
- `GENERATION_ENDED` is emitted only from `hideStopButton()` when the stop button was visible (about line 3534). It does not fire for quiet or dryRun and fires from several code paths. It is not a completion signal.
- `GENERATION_STOPPED` fires on stop but not on normal completion.
- `is_send_press` is a plain `export let`. You can read it live via the import, but there is no event for it going false.

**Why it happens:**
It is natural to chain the queue off events. ST gives no per-generation completion event.

**How to avoid:**
Drive the queue from the `await`ed promise of your own runner, never from event handlers. Handlers only enqueue a microtask or `setTimeout(0)` to schedule the next step, and never call `Generate` inline. Gate each start on `!isGenerating()` (exported from `script.js`) plus a settle delay. Hold a module-level `running` mutex of your own.

**Warning signs:**
UI freezes with the send button stuck on stop. Two stop-button flashes in a row. "Generate entered" logged twice before the first finishes.

**Phase to address:**
Phase 3 (runner design). Add a unit test with a fake event bus that re-enters.

---

### Pitfall 7: Concurrent user action vs queue. Swiping or sending while a queued item streams stops or corrupts it

**What goes wrong:**
`swipe()` guards against user swipes while `isGenerating()` (toast "Cannot swipe while generating"), but when a user swipe starts it runs `if (isStreamingEnabled() && streamingProcessor) streamingProcessor.onStopStreaming()`. Sources that bypass the guard (`DELETE`, `BACK`, `AUTO_SWIPE`, `SLASH_COMMAND`, `SWIPE_PICKER`) skip the "cannot swipe while generating" check. The queue itself is exposed to those bypass paths: the swipe-picker and slash `/swipe` can run mid-queue. Also `sendTextareaMessage` bails on `is_send_press`, so while the queue is running the user's Send button is dead or shows Stop. Users read that as "ST is frozen".

Separately, `swipeState` (`NONE/SWIPING/EDITING`) is a module-level state machine. Starting a queue item while the user is mid-swipe animation or editing a message is unsafe.

**How to avoid:**
Before every item start check all of: `!isGenerating()`, no message editor open (`this_edit_mes_id` via DOM `.mes_edit` open), no swipe in progress (`document.body.dataset.swiping`), no `is_delete_mode`, `main_api` connected. If any fails, wait, do not force. Offer the user a prominent "Pause queue to send" control, since the native Send is blocked during a run. The requirement "manual send pauses the queue" is only meaningful if the user can send. Because Send is dead while a native-pipeline item runs, the design must either (i) make Stop abort the item and return it to the queue head, or (ii) show a clear "queue running, press Stop" affordance. Decide in requirements (open question 6).

**Warning signs:**
User reports "I can't send a message". A swipe the user did manually silently stops the queue item. Partial text left in `mes`.

**Phase to address:**
Phase 2 (requirements decision on manual-send behavior). Phase 3 (preflight gate). Phase 4 (interaction tests).

---

### Pitfall 8: ST built-in Auto-Swipe cascades with queued swipes (uncontrolled spend)

**What goes wrong:**
If the user has `power_user.auto_swipe` enabled (regex/min-length/blacklist filtering), `Generate()` and `StreamingProcessor.onFinishStreaming` call `swipe(null, RIGHT, {source: AUTO_SWIPE, forceMesId})` after any reply the filter rejects (lines 3812 and 5567). `AUTO_SWIPE` bypasses the generating guard. The result is extra, unqueued generations (possibly unbounded when every reply is "filtered"), view flips to the newest swipe (violating stay-put), and a nested `Generate` inside the item runner. This can multiply real API spend far beyond the queue cap.

**How to avoid:**
Detect `power_user.auto_swipe` (via `getContext().powerUserSettings`, or the DOM checkbox if not exposed; verify in the spike) and either refuse to run, warn loudly at queue time, or run the item and treat any additional swipe produced as part of the item's budget. Count `swipes.length` delta per item; if it is greater than 1, report it. Document the interaction in the README.

**Warning signs:**
Pager total jumps by more than the queued count. View changes without user action. Spend spikes.

**Phase to address:**
Phase 1 (verify the setting is accessible). Phase 4 (guard and test).

---

### Pitfall 9: Accidental bulk spend on resume, retry, or loop

**What goes wrong:**
The queue persists across refresh by design, so a stored queue can fire N paid requests with no user present. Specific vectors:
- auto-resume on page load or `CHAT_CHANGED` (the requirement already says "ask", but code paths like `APP_READY` + chat load can race the prompt);
- a retry loop on 4xx/5xx or rate limit (429);
- an "empty reply" drop-and-requeue;
- Pitfall 8 cascades;
- the user changed model, preset, API, or connection profile since the item was queued, so items run on a more expensive model than intended;
- the same chat open in two tabs/devices, each with a resumed copy of the same persisted queue.

**How to avoid:**
- Never auto-run on load. On load, show a non-modal toast or badge: "N queued swipes pending, Resume / Discard". Default state is `paused`.
- Hard cap (default 5, configurable, with an absolute max of say 20) enforced both at enqueue and at resume.
- No automatic retries. A failed item is dropped, shown, and never re-enqueued. Add a circuit breaker: after K consecutive failures (2-3), pause the queue.
- Store a fingerprint with the queue (`main_api`, model, preset name). If it differs at resume, require explicit confirmation showing the new model.
- Store a `queuedAt` timestamp and expire items after a configurable age (for example 24h) so a stale queue cannot resurrect.
- Show a running tally in the badge ("3 of 5 done"). Provide one-click "Cancel all".
- Multi-tab: store a per-tab `ownerId` with a heartbeat in the queue record; a second tab opens it as paused.

**Warning signs:**
Provider dashboard shows requests when the app was just opened. Badge count rises after refresh.

**Phase to address:**
Phase 2 (persistence format with fingerprint, caps, `paused` default). Phase 4 (resume UX, circuit breaker, multi-tab test).

---

### Pitfall 10: Persisting the queue into `chat_metadata` or the chat file in a way that creates integrity or bloat problems

**What goes wrong:**
- `saveChat` writes `{...chat_metadata}` as the header at call time. Anything you put in `chat_metadata` goes to the jsonl header, is exported with the chat, and shared when the user shares the file. Do not put prompts, API details, or large payloads there.
- The server checks `chat_metadata.integrity` against the file on disk (`endpoints/chats.js` `checkChatIntegrity`). A save with a stale or foreign metadata object (see Pitfalls 2 and 3) trips "Chat integrity check failed", which prompts the user to type `OVERWRITE` or reloads the page.
- `saveChatConditional()` waits at most about 100ms * N and then logs "Timeout waiting for chat to save" and returns without saving. A call can silently not persist. `saveChat` swallows errors with a toast.
- Each `saveChatConditional()` uploads the entire chat (ST issue #5265, "full chat save uploads don't scale"). Saving once per queued swipe on a long chat is heavy; and Deep-Swipe's changelog shows save code can leave the chat array in a bad state when interrupted.
- Every queue state transition saved immediately causes save storms. Prefer `saveMetadataDebounced()` for queue-only state changes and `saveChatConditional()` only when swipe data changed.

**How to avoid:**
Store the minimum: `{version, items:[{id, queuedAt}], targetKey, fingerprint, state}`. No prompt text. Version the schema. Use ST save functions only. After a completion save, verify (re-read) that the swipe is in `chat` state. Treat a failed or timed-out save as non-fatal but surface it (the swipe exists in memory only).

**Warning signs:**
Chat header in jsonl grows. Integrity popup. Swipes visible after generation but gone after reload.

**Phase to address:**
Phase 2 (schema and save policy). Phase 4 (reload test: complete, refresh, assert swipes survive).

---

### Pitfall 11: Truncate-and-restore of the `chat` array (the Deep-Swipe approach) is a chat-corruption machine. Do not copy it

**What goes wrong:**
Deep-Swipe makes the model see only the context before the target by truncating the live `chat` array during generation and splicing messages back afterward. Its own changelog documents the consequences: v1.5.0 "Critical Fix: message corruption when stopping a swipe generation — messages below the swipe target would occasionally become empty", attributed to ST save functions running while the array was truncated. v1.5.5 fixed "loading older messages during generation would corrupt the chat" by hiding the "Show more messages" button. Any ST autosave, `saveChatConditional()` from another extension, `saveChatDebounced`, or window close during the truncated window persists a truncated chat to disk. This is permanent data loss.

**Why it happens:**
It is the cheapest way to control prompt context when you cannot change `Generate`'s inputs. Native `Generate('swipe')` already handles "last message excluded" for you, which is why this project's last-message-only scope avoids it.

**How to avoid:**
Never mutate `chat` to shape the prompt. Last-message-only scope means native swipe context (`coreChat.pop()`) already does the right thing. Use `generate_interceptor` if prompt shaping is ever needed (it receives a copy). Never hold the chat in a "temporarily broken" state across an `await`. Do not copy Deep-Swipe's deep-copy-and-restore guard pattern, since it treats the symptom.

**Warning signs:**
Any code path that does `chat.splice`, `chat.length =`, or `chat.pop()` on the real array. Messages with empty `mes` after Stop.

**Phase to address:**
Phase 1 (record as a non-negotiable design rule). Code review gate in every phase.

---

### Pitfall 12: Blocking modal from another extension stalls the queue forever (Prompt Inspector)

**What goes wrong:**
Prompt Inspector, when enabled (`localStorage.promptInspectorEnabled === 'true'`), opens a modal popup inside `CHAT_COMPLETION_PROMPT_READY` / `GENERATE_AFTER_COMBINE_PROMPTS` for every real (non-dryRun) generation and awaits the user. A queued item would block on a popup for a message the user is no longer looking at. The popup's "Cancel generation" button calls `stopGeneration()`, which the queue must interpret as "user aborted this item", not as an error to retry. Deep-Swipe's solution is to refuse to generate while the flag is set. Note that this means the "conflict over generation state" is really a blocking-UI problem, plus both wanting to own `stopGeneration`.

**How to avoid:**
At item start, check the localStorage flag. Either refuse with a clear toast, or pause the queue with an explicit message. Add a per-item watchdog (no response within N minutes, for example 5, raises "stalled" and pauses the queue rather than stacking). Treat `GENERATION_STOPPED` during an item as user-abort: drop the item and pause the queue, do not auto-continue.

**Warning signs:**
Prompt Inspector popup appears for background items. Queue "running" for hours with no network activity.

**Phase to address:**
Phase 4 (compat matrix). Phase 6 (docs).

---

### Pitfall 13: Stop and abort semantics are global and ambiguous

**What goes wrong:**
`stopGeneration()` aborts the single global `abortController` and the single `streamingProcessor` and emits `GENERATION_STOPPED`. That event has no owner information. It fires for the user's stop button, Prompt Inspector's cancel, Deep-Swipe's abort handler (which calls `stopGeneration` itself), and the queue's own cancel. The queue cannot tell who stopped it. Furthermore, a stopped stream may still leave partial text saved as a swipe: `onStopStreaming` sets `isFinished = true`, so `Generate` can proceed to finalize with partial text and save it as a legitimate swipe (the `isStreamFinished` check requires `!isStopped`, but the stop path via `onStopStreaming` does not set `isStopped`, so verify in the spike).

If the queue cancels a running item by calling `stopGeneration()`, it must be ready for a partial swipe to be appended.

**How to avoid:**
Set your own flag `cancelRequestedByQueue = true` before calling `stopGeneration()`, so `GENERATION_STOPPED` handling can tell "mine" from "theirs". After a stopped item, inspect the post-condition (Pitfall 5) and remove any partial swipe the queue did not want (clean removal of the last swipe, keeping `swipes` and `swipe_info` aligned and `swipe_id` valid). Decide product policy: keep or discard partial on user Stop. Recommended: discard, since "every result is a complete swipe" is the contract.

**Warning signs:**
Truncated swipes in the pager after pressing Stop. Queue continues after the user pressed Stop.

**Phase to address:**
Phase 1 (verify stop/partial behavior). Phase 4 (abort handling and tests).

---

### Pitfall 14: Streaming on means the "stay put" promise is broken by ST itself

**What goes wrong:**
With streaming enabled, `onStartStreaming` calls `saveReply({type:'swipe', fromStreaming:true})`, then `hideSwipeButtons({hideCounters:true})` and `scrollChatToBottom`. It writes tokens into the visible message DOM and `swipes[swipe_id]`. The native pipeline will stream into whatever message is last, regardless of what the user is viewing. For a route that uses native `Generate('swipe')` (Pitfall 1b), streaming produces visible text churn, hidden swipe counters, auto-scroll to bottom (the user loses their reading position), and `STREAM_TOKEN_RECEIVED` events that other extensions (TTS streaming, expressions) consume.

**How to avoid:**
The decision "no streaming preview" requires the queue to force non-streaming for its items. There is no per-call streaming override. `isStreamingEnabled()` reads global settings (`oai_settings.stream_openai`, `textgen_settings.streaming`, ...). Options: (i) temporarily toggle the setting and restore in `finally` (dangerous if the page closes mid-run: the user's streaming setting is stuck off, so persist a recovery flag); (ii) accept streaming and design for it; (iii) raw route where you control streaming. Record the decision; if toggling, restore on `beforeunload`, on startup (recovery flag), and never call `saveSettingsDebounced()` while toggled.

**Warning signs:**
Text appears in the visible message during a "background" item. Chat auto-scrolls. User's streaming setting is found off after a crash.

**Phase to address:**
Phase 1 (decision). Phase 3 (implementation and recovery flag).

---

### Pitfall 15: Reasoning (`extra.reasoning`) is per-swipe state with several traps

**What goes wrong:**
- Native path stores reasoning in message `extra` then clones into `swipe_info[n].extra` via `structuredClone(item.extra)`. A manual append that builds `swipe_info` as `{send_date, gen_started, gen_finished, extra: {}}` loses reasoning, `reasoning_duration`, `reasoning_signature`, `api`, `model`, `token_count`, and `time_to_first_token`. The reasoning block then displays empty or shows a stale reasoning from the previous swipe.
- `saveReply` initializes `lastMessage.extra.reasoning = ''` and in the swipe branch overwrites `extra.reasoning` for the displayed message. If the new swipe is not the displayed one (Pitfall 1), the visible message's `extra.reasoning` can be clobbered by the background item's reasoning.
- ST has had per-swipe reasoning bugs (issue #3787, "Deleting swipe causes deleted Reasoning to override replacement swipe's Reasoning"). Per-swipe `extra` is an area where regressions recur.
- `syncMesToSwipe` copies the displayed message's `extra` into `swipe_info[swipe_id]`; if the extension edits `message.extra` while another swipe is displayed, the next sync writes the wrong swipe's metadata.
- Signed reasoning blocks (`reasoning_signature`, for Claude thinking) need to travel with the exact swipe they came from.

**How to avoid:**
Build each new `swipe_info` entry as a complete object from the generation's own output: `{send_date, gen_started, gen_finished, extra: {api, model, reasoning, reasoning_duration, reasoning_signature, token_count}}`. Never write to the displayed `message.extra`/`message.mes` while a different swipe is displayed. Add a fixture test with a reasoning-capable response, navigate to the queued swipe, and assert the reasoning block shows that swipe's reasoning.

**Warning signs:**
Reasoning box empty, duplicated, or the previous swipe's reasoning after navigating.

**Phase to address:**
Phase 3 (append) with a parity test. Phase 6 (compat).

---

### Pitfall 16: Settings read at completion time, not at queue time (model/API/preset drift)

**What goes wrong:**
`saveReply` stamps `extra.api = getGeneratingApi()` and `extra.model = getGeneratingModel()` at completion, from live globals. `generation_started` is a module global overwritten by any Generate call. If the user changes model, preset, API, connection profile, or character card edits while an item is queued or running, the queued swipe is generated with the new settings but the context that was "queued" is gone (requirement FR-4 in the draft says "context as of queue time"; the project later chose "as of run time"). Mixed settings produce swipes with misleading provenance.

**How to avoid:**
Adopt "context at run time" explicitly (already in PROJECT.md key decisions) and state it in the README. Record the fingerprint at enqueue and compare at run time (Pitfall 9). On mismatch, pause and ask. Do not try to freeze settings.

**Warning signs:**
Swipes whose footer model differs from what the user expected.

**Phase to address:**
Phase 2 (fingerprint). Phase 4 (pause-on-drift).

---

### Pitfall 17: Side-effect extensions fire on background swipes (sounds, TTS, summaries, auto-continue, expression/image extensions)

**What goes wrong:**
A native swipe emits `MESSAGE_RECEIVED` and `CHARACTER_MESSAGE_RENDERED` when it is displayed (`saveReply` swipe branch, only when the new slot is the displayed one). `playMessageSound()` runs for non-quiet types. `triggerAutoContinue` can extend the reply when `power_user.auto_continue` is enabled. Extensions listening to these (Summarize, TTS auto-play, Expressions, Image Generation triggers, Vector Storage ingest, Quick Reply "on AI message" automations) will act on a message the user is not viewing, or will not act at all if the extension suppresses the events. Either behavior surprises users. Auto-continue could append text to a swipe in the background.

**How to avoid:**
Decide and document: which events fire for queued completions. Recommended: do not fire `MESSAGE_RECEIVED`/`CHARACTER_MESSAGE_RENDERED` for background-appended swipes (they are not "received messages"), and emit a dedicated custom event for integrators. Detect `auto_continue` and warn. Test with Summarize, TTS, Expressions enabled.

**Warning signs:**
Sound or TTS plays while the user is reading something else. Summaries include the wrong swipe.

**Phase to address:**
Phase 3 (event policy). Phase 6 (compat testing).

---

### Pitfall 18: Pager and counter do not refresh, or refresh by re-render and disturb the reading position

**What goes wrong:**
`updateSwipeCounter(mesId)` formats `swipe_id + 1 / swipes.length` and is exported from `script.js` but is not on `getContext()`. If you append to `swipes[]` and do not update the DOM, the `k/total` stays stale until the next navigation. If you refresh by `addOneMessage`/`printMessages`/`reloadCurrentChat`, you re-render the message, resetting scroll, any open edit box, text selection, and expanded reasoning. `refreshSwipeButtons` toggles arrow visibility and hides them during generation (`swipesHidden`); `hideSwipeButtons` is "misleadingly named. It blocks generation then refreshes the swipe buttons" per the source comment. Calling `showSwipeButtons()` from the queue while the pipeline is mid-generation unblocks user swipes concurrently with generation.

Also: another extension (Deep-Swipe) clones the native arrows/counter and uses mesid invalidation tricks; UserSwipes uses `data-user-swipes` attributes and reuses the counter. A selector like `.swipes-counter` may hit clones.

**How to avoid:**
Update only the counter text of the last message (`.last_mes .swipes-counter`) or import `updateSwipeCounter` from `script.js` (stable export used by many extensions, still an internal API, so version-gate it with `minimum_client_version`). Never call `showSwipeButtons` / `activateSendButtons` yourself. Scope selectors to `#chat .mes.last_mes`. After updates, assert the user's scroll position and edit state are unchanged.

**Warning signs:**
Counter shows `2/3` when four pages exist. Scroll jumps when a swipe lands. Arrows enabled while a queue item streams.

**Phase to address:**
Phase 3 (live pager update). Phase 6 (compat with Deep-Swipe/UserSwipes DOM).

---

### Pitfall 19: Target-message invalidation is detected too late or not at all (edit, delete, new user message, swipe-delete, reorder)

**What goes wrong:**
The queue targets "the latest AI message". It becomes invalid when: the target is edited, deleted, or hidden; a new user message is sent; messages are reordered (`messageEditMove`); swipes are deleted (indices shift, the user can delete the very swipe the queue treats as origin); the user continues the message (`Generate('continue')` changes `mes`); the chat is branched/checkpointed; the last message becomes a user message. `MESSAGE_EDITED` and `MESSAGE_DELETED` events exist, but swipe deletion and message move do not necessarily fire them for your purposes. Index-based targeting (`chat.length - 1` at queue time) points at a different message later.

**How to avoid:**
Identify the target by a stable key (`send_date` plus `name` plus `gen_started`; there is no message UUID) and verify it equals `chat[chat.length-1]` immediately before every item and again before commit. Subscribe to `MESSAGE_EDITED`, `MESSAGE_DELETED`, `MESSAGE_SENT`, `USER_MESSAGE_RENDERED`, `MESSAGE_SWIPED`, `CHAT_CHANGED`. Treat "last message is no longer an AI message with the same key" as a hard invalidation regardless of events. Add a pre-commit check as the safety net.

**Warning signs:**
A queued swipe attached to a different message after the user edited or sent text.

**Phase to address:**
Phase 3 (pre-start and pre-commit validation). Phase 4 (event matrix).

---

### Pitfall 20: Group chats and the first-message/greeting special cases

**What goes wrong:**
- Group chat: `Generate` routes to `generateGroupWrapper` when `selected_group` is set and it mutates `this_chid` (`setCharacterId(memberIds[0])`); `saveChat` throws "saveChat called for a group chat" if invoked directly; `is_group_generating` is a separate flag. Using `is_send_press` alone misses group generation (`isGenerating()` covers both). Which member answers a swipe is determined by `gen_id` / `original_avatar` metadata. v1 disables the control, but disabled must mean disabled everywhere: slash command, persisted queue loaded after switching to a group chat, and `CHAT_CHANGED` into a group.
- First message (greeting): the chat's first message may carry alternate-greeting swipes; `syncMesToSwipe` skips syncing for "pristine" chats (`chat_metadata.tainted` / length 1) so macros in greetings resolve again. A queue on a fresh chat (only the greeting) interacts with that special case.
- Messages with `extra.isSmallSys`, system messages, and messages where `swipes` is globally disabled (`swipes` setting, `swipesHidden`) are not swipeable (`isMessageSwipeable`/`isSwipingAllowed`).

**How to avoid:**
Run a single `canQueue()` gate (not group, last message is a swipeable AI message, `swipes` enabled, chat not pristine or explicitly handled) used by the button, the slash command, and the resume path. Add fixtures for greeting-only chat and for a group chat.

**Warning signs:**
Queue runs in a group chat. Greeting swipe corrupted in a new chat.

**Phase to address:**
Phase 2 (gate). Phase 4 (edge fixtures).

---

## Moderate Pitfalls

### Pitfall 21: Prompt-cache assumptions

**What goes wrong:**
Serial back-to-back identical prompts can hit a provider prompt cache (for Anthropic, ST adds `cache_control` at a configurable depth with a TTL, `openai.js` about line 1000; the default provider cache lifetime is short, minutes). But "identical" is fragile: each `Generate` re-evaluates macros (`{{random}}`, `{{time}}`, `{{idle_duration}}`, `{{roll}}`), lorebook timed effects (sticky/cooldown/delay advance per generation), Author's Note intervals, vector/summary injections, and any extension prompt that changes per run. Any early-prompt difference invalidates the cache from that point on, so savings may be nil, and the first run pays a cache-write premium that the user might not have enabled. Long waits between items (slow model, rate limits, popups) can exceed the TTL. Queue order, "parallel is cache-hostile", is only a v2 concern.

**How to avoid:**
Do not promise savings in UI or README. Run items back-to-back with no artificial delay. Show the actual model/provider in the confirmation toast. In docs, tell users to enable provider caching in ST's own settings if they want it. Verify the cache behavior empirically in the spike with a provider that reports cache usage.

**Phase to address:**
Phase 6 (docs). Optional measurement in Phase 1.

---

### Pitfall 22: Extension load order and init timing

**What goes wrong:**
Extensions load in `loading_order` then name order (`extensions.js` `sortManifestsByOrder`). `APP_READY` fires after all loaded. Registering `eventSource.on(CHAT_CHANGED)` handlers at module top level is fine, but the first `CHAT_CHANGED` for the initial chat may have already fired before the module loaded, or may fire when chat is not yet restored. Reading `chat_metadata` at module load gives `{}`. The persisted queue must be read on `CHAT_CHANGED`/`CHAT_LOADED` and again at `APP_READY` if the chat is already open. Interceptor and event-handler order relative to Deep-Swipe (default order) and UserSwipes (`loading_order: 25`) matters only if you hook the same events; avoid stacking `generate_interceptor`.

**How to avoid:**
Initialize lazily. `init()` on `APP_READY`, then call `loadQueueForCurrentChat()` once. Re-run on each `CHAT_CHANGED`. Use a conservative `loading_order` (default, no special claims). Use `eventSource.on` with named handlers so they can be removed on disable.

**Phase to address:**
Phase 2.

---

### Pitfall 23: Importing from `script.js` internals vs `getContext()`

**What goes wrong:**
`import { Generate, isGenerating, updateSwipeCounter } from '../../../../script.js'` works for third-party extensions (Deep-Swipe does it) but the relative path breaks for the user-data-dir install location and changes between ST layouts, and these exports are not a stable API. Several things you need (`isGenerating`, `updateSwipeCounter`, `is_send_press`, `stopGeneration`) are partly on the context and partly not.

**How to avoid:**
Prefer `SillyTavern.getContext()`. Where an internal is required, isolate it behind one adapter module with feature detection and a clear error, and pin `minimum_client_version` to the release you verified.

**Phase to address:**
Phase 2 (adapter). Phase 6 (version matrix).

---

### Pitfall 24: Swipe index and `swipe_info` desync from other tools

**What goes wrong:**
ST core has repeatedly dealt with `swipe_info` missing or short (issues #5033 and #4717; `ensureSwipes` now backfills with a warning). UserSwipes explicitly truncates and pads `swipe_info` to `swipes.length` (user messages only). Other tools (import/export, third-party chat editors, Chub format) may produce mismatched arrays. Your code should not assume invariants hold on entry.

**How to avoid:**
Call the same normalization ST uses before touching a message (`ensureSwipes` is exported from `script.js`; otherwise replicate: arrays exist, equal length, string entries, object `swipe_info`). Append with a single synchronous block (no `await` between the two pushes) so no other code observes `swipes.length !== swipe_info.length`. Re-verify after the block.

**Phase to address:**
Phase 3.

---

### Pitfall 25: Concurrent saves and the 'dirty during await' race

**What goes wrong:**
`swipe()` calls `cancelDebouncedChatSave()` to "prevent accidental swipe_id overwrites". There is a debounced autosave (`saveChatDebounced`) plus explicit `saveChatConditional()` from `Generate`, edit, and other extensions, serialized only by `isChatSaving`. If the extension appends at time T and a debounced save scheduled at T-1 serializes `chat` mid-append (arrays updated one at a time), a half-appended state could be persisted. Within a single JS turn this is safe; across `await` it is not.

**How to avoid:**
Make the mutation synchronous (no await inside), then call `saveChatConditional()` once afterward. Do not call `cancelDebouncedChatSave` yourself unless you re-save.

**Phase to address:**
Phase 3.

---

## Minor Pitfalls

### Pitfall 26: Notifications and toasts
Per-item success toasts for a 5-item queue are noise, and `toastr` errors for each failed item with `timeOut: 0` pile up. Use the badge as primary feedback, one summary toast per run, and coalesce errors. (Phase 4)

### Pitfall 27: Slash-command registration
`/queueswipe` must be registered through `SlashCommandParser.addCommandObject` (the `registerSlashCommand` helper is deprecated). Parse `count` as an integer, clamp to the cap, and return a string (pipe-friendly). Running it from a QuickReply/STscript loop can enqueue unbounded items; clamp total, not per call. (Phase 2)

### Pitfall 28: Settings migration and defaults
`extension_settings[MODULE_NAME]` may be absent or partial on first run or after update. Merge with defaults on load; never assume keys. (Phase 2)

### Pitfall 29: Mobile and background tabs
Browsers throttle timers and may suspend fetch for backgrounded tabs; the queue "running in the background" may stall when the tab is hidden. Mobile Safari kills long requests. The queue must tolerate a long stall (watchdog, Pitfall 12) and never assume completion. (Phase 4)

### Pitfall 30: i18n and CSS collisions
Prefix every CSS class and element id (`qs-`); the native `.swipe_right`, `.swipes-counter` classes are bound by ST delegated handlers and by other extensions. Deep-Swipe had to remove a conflicting `swipe_right` class (v1.5.3) because it triggered native behavior. Never reuse native class names on your controls. (Phase 2)

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Call native `Generate('swipe')` and flip the view back afterward | Reuses full native pipeline | Violates stay-put during runs; flicker; streaming into the visible message | Only as an explicit fallback mode, documented |
| Toggle global streaming setting during an item | Gives background-feel on native route | Stuck setting if the page dies mid-run | Only with a persisted recovery flag restored at startup |
| Use `generateQuietPrompt` for "background" | Trivial code | Wrong context, no reasoning, UI lock, wrong metadata (Pitfall 4) | Never as the main route |
| Truncate `chat` to shape the prompt | Easy prompt control | Permanent chat corruption on interrupted save (Pitfall 11) | Never |
| Cache `getContext()` result at module load | Cleaner code | Stale `chat_metadata`, wrong-chat writes (Pitfall 3) | Never |
| Persist the queue with prompt text | Faster resume | Leaks into the shared chat header; bloat | Never |
| Auto-retry failed items | Fewer user clicks | Runaway spend (Pitfall 9) | Never in v1 |
| Import internals from `script.js` directly | Access to `updateSwipeCounter`, `isGenerating` | Break on ST refactors | Acceptable behind one adapter module with version gate |
| Index-based message targeting | Simple | Wrong message after edit/delete/move | Never; use a stable key plus a last-message check |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| ST `eventSource` | Awaiting new `Generate` inside a listener (emit awaits listeners serially) | Schedule via the runner, never inline (Pitfall 6) |
| ST `GENERATION_ENDED` | Treat as completion | It only fires when the stop button hides; await your own promise and check post-conditions |
| ST `GENERATION_STOPPED` | Assume it is the queue's own cancel | No owner info; track `cancelRequestedByQueue` |
| ST `saveChatConditional` | Assume a save happened | It can time out silently; verify and surface |
| ST `chat_metadata` | Hold the object | Reassigned on chat change; fetch fresh; key by integrity UUID |
| Prompt Inspector | Run items with the inspector enabled | Check `localStorage.promptInspectorEnabled`; refuse or pause |
| Deep-Swipe | Share `.swipes-counter`/arrow selectors | Scope to `#chat .last_mes`; never reuse `swipe_right` class; detect its mid-run overlay state by refusing to start while `document.body.dataset.swiping` is set |
| UserSwipes | Assume the user message has no swipes | Only matters if the target is ever a user message; v1 targets AI only |
| Built-in Auto-Swipe / Auto-Continue | Ignore | Detect and warn or refuse (Pitfall 8, 17) |
| Provider prompt cache | Promise savings | Don't; measure (Pitfall 21) |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Full-chat upload on every completion save (#5265) | UI lag after each swipe lands | One save per completed item, debounced metadata saves for queue-only state | Chats with thousands of messages or large embedded media |
| `printMessages`/`reloadCurrentChat` to refresh pager | Scroll reset, flicker | Update counter text only | Any |
| Per-item `structuredClone` of large `extra` | Minor | Only the new entry | Rarely |
| Polling `is_send_press` in a tight loop | CPU use | Await the item promise; poll at 250 to 500ms only when waiting to start | Background tabs |
| Many queued items persisted with full objects | Header bloat | IDs and timestamps only | Cap of 20+ |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Storing prompts, headers, or keys in `chat_metadata` | Leaks via chat export/share | Store only item ids, timestamps, and a model/preset fingerprint name |
| Writing HTML from chat/model text into the badge or toasts without escaping | XSS via crafted card or reply | Use `textContent` / ST's sanitizers; never `.html()` model text |
| Direct calls to `/api/chats/save` | Bypasses integrity logic; corruption | Only `saveChatConditional` (project rule) |
| Loading a queue from another chat's/imported metadata and auto-running it | Unexpected spend triggered by a shared chat file | Default paused; validate schema; clamp caps; require confirmation |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Send button dead while the queue runs, with no explanation | "ST is frozen" | Badge states: running/paused; "Pause to send"; explain in tooltip |
| Silent drops of failed items | User thinks swipes are coming | One coalesced, non-modal summary of failures |
| Queue persists invisibly after refresh | Surprise spend | Visible paused badge with Resume/Discard |
| Counter shows pending items as pages | User navigates to blank pages | Never pre-reserve slots (already decided) |
| Pager changes under the user's finger | Mis-clicks | Update total only; do not move the active page |
| No indication of the model that will be used | Cost surprise | Show model/preset on the Resume prompt |

## "Looks Done But Isn't" Checklist

- [ ] **Append path:** Often missing hole/`null` check. Verify `swipes.length === swipe_info.length`, all strings, `swipe_id` in range after every completion and after every failure path.
- [ ] **Stay put:** Often only tested with streaming off. Verify the displayed text, scroll position and `swipe_id` are untouched, with streaming on and off.
- [ ] **Persistence:** Often tested without reload. Verify complete, refresh, and swipes are present; queue restored paused; no auto-run.
- [ ] **Chat switch:** Often tested only between items. Verify switching mid-request neither writes to the new chat nor throws; the old chat's queue is intact.
- [ ] **Reasoning:** Often tested with a non-reasoning model. Verify a reasoning response lands with its own `extra.reasoning` and signature, and navigating shows the right block.
- [ ] **Footer metadata:** Verify the model, timer and token count on queued swipes match a native swipe.
- [ ] **Abort:** Verify user Stop mid-item leaves no partial swipe (or the documented policy), and `GENERATION_STOPPED` from Prompt Inspector pauses rather than loops.
- [ ] **Offline/interceptor abort:** Verify a resolved-with-nothing `Generate` is counted as failure.
- [ ] **Auto-swipe/auto-continue enabled:** Verify the guard triggers and spend stays within the cap.
- [ ] **Group chat and greeting-only chat:** Verify the control is disabled or safe, including via slash command and a persisted queue.
- [ ] **Two tabs:** Verify a second tab does not double-run the same persisted queue.
- [ ] **Coexistence:** Verify with Deep-Swipe, UserSwipes and Prompt Inspector installed and enabled at the same time.
- [ ] **Setting recovery:** If the streaming setting is toggled, verify it is restored after a hard refresh mid-run.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Hole or `null` in `swipes` (Pitfall 1) | LOW | Reload the chat (`ensureSwipes` backfills `''`); delete the blank swipe via the swipe picker; ship a "repair swipes" self-heal that runs on `CHAT_CHANGED` |
| Reply landed in the wrong chat (Pitfall 2) | MEDIUM | User deletes the stray message in that chat; the queue logs the incident; recommend backups (ST keeps chat backups in the `backups` dir) |
| Truncated chat saved (Pitfall 11) | HIGH | Restore from ST's automatic chat backups; this is the reason never to truncate |
| Streaming setting stuck off (Pitfall 14) | LOW | Recovery flag restores at startup; manual toggle in the AI Response Configuration |
| Runaway spend (Pitfalls 8, 9) | HIGH, not recoverable | Prevention only: caps, paused-by-default, circuit breaker |
| Integrity popup (Pitfall 10) | MEDIUM | Do not type OVERWRITE blindly; reload the page; compare with backup |
| Queue stuck behind a modal (Pitfall 12) | LOW | Watchdog pauses; user dismisses the popup or disables Prompt Inspector |

## Pitfall-to-Phase Mapping

Phase names follow the tentative milestones in `02-requirements-draft.md` §8 (1 source-verification spike, 2 skeleton/settings/slash command, 3 serial queue and swipe append and pager, 4 error/edge/cancel/persistence, 5 optional parallel (deferred), 6 docs, packaging, compatibility).

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1 Swipe slot overwrite / route choice | Phase 1 (decide), Phase 3 | Test: user on swipe 1 of 3, queue completes; swipe 1 unchanged, length 4, no holes |
| 2 Chat switch mid-generation | Phase 2 (token), Phase 4 | Test: switch chat at each await boundary; no writes to the new chat |
| 3 Stale context snapshots | Phase 2 | Code review rule; test that persistence works after a chat switch round trip |
| 4 Quiet/raw misuse | Phase 1 | Parity test vs native swipe (prompt and fields) |
| 5 Resolved promise is not success | Phase 3, 4 | Fault-injection: offline, interceptor abort, empty reply |
| 6 Event re-entrancy | Phase 3 | Fake-bus test; no `Generate` overlap |
| 7 Concurrent user action | Phase 2 (decision), 3, 4 | Manual send/swipe/edit during run |
| 8 Auto-swipe cascade | Phase 1 (verify), 4 | Enable auto-swipe with a filter that always rejects; spend stays capped |
| 9 Bulk spend on resume | Phase 2 (format), 4 (UX) | Reload with a stored queue; nothing runs; breaker trips after K failures |
| 10 Metadata/integrity/save | Phase 2, 4 | Reload test; header contains only ids; integrity popup never appears in the matrix |
| 11 Truncate-and-restore | Phase 1 (rule), all (review) | Grep gate: no `chat.splice`/`chat.length =` on the real array |
| 12 Prompt Inspector modal | Phase 4, 6 | PI enabled: queue refuses or pauses with a message |
| 13 Stop semantics / partials | Phase 1, 4 | Stop mid-item: policy honored, arrays aligned |
| 14 Streaming | Phase 1 (decide), 3 | Streaming on and off; setting restored after crash |
| 15 Reasoning per swipe | Phase 3 | Reasoning fixture parity |
| 16 Settings drift | Phase 2, 4 | Change model mid-queue; pause and confirm |
| 17 Side-effect extensions | Phase 3, 6 | Summarize/TTS/Expressions on; no surprise firing |
| 18 Pager refresh | Phase 3, 6 | Counter live; scroll and edit state unchanged; Deep-Swipe present |
| 19 Target invalidation | Phase 3, 4 | Edit/delete/send/swipe-delete/move each clears with toast |
| 20 Groups and greeting | Phase 2 (gate), 4 | Group chat and greeting-only fixtures |
| 21 Prompt cache | Phase 6 | Docs honest; no claims |
| 22 Load order | Phase 2 | Cold start with a populated chat restores the queue paused |
| 23 Internals imports | Phase 2, 6 | Adapter module; `minimum_client_version` set |
| 24 swipe_info desync | Phase 3 | Normalizer unit tests |
| 25 Save races | Phase 3 | Synchronous mutation; autosave stress test |

## Verified facts (resolving `[Recall]` items in the design docs)

| Item in `01-architecture-analysis.md` | Finding (source, commit `06bde93`) |
|---|---|
| `swipe_right` / `is_send_press` guards | `swipe()` refuses when `isGenerating()` (`is_send_press \|\| is_group_generating`) unless `source` is `DELETE/BACK/AUTO_SWIPE/SLASH_COMMAND/SWIPE_PICKER`; also needs `isSwipingAllowed()` and `isMessageSwipeable()` (last message only, not small-sys) |
| Can `Generate('swipe')` target a non-visible swipe? | No. It writes via `swipe_id`; see Pitfall 1 |
| Event names | Verified in `scripts/events.js`: `MESSAGE_SWIPED`, `MESSAGE_EDITED`, `MESSAGE_DELETED`, `MESSAGE_UPDATED`, `MESSAGE_SENT`, `CHAT_CHANGED` (`chat_id_changed`), `CHAT_LOADED`, `GENERATION_STARTED/STOPPED/ENDED`, `GENERATE_AFTER_DATA`, `CHAT_COMPLETION_PROMPT_READY`, `USER_MESSAGE_RENDERED`, `CHAT_DELETED`, `CHAT_CREATED` |
| `GENERATE_AFTER_DATA` capture | Emitted with `(generate_data, dryRun)`; `Generate(type, opts, true)` returns right after it with no UI side effects, a candidate for prompt capture |
| `saveChatConditional` | Exported; waits on `isChatSaving`, can time out silently; saves group or solo accordingly; context exposes it as `saveChat` |
| Streaming write timing | Writes `mes` and `swipes[swipe_id]`/`swipe_info[swipe_id]` on every tick |
| Group chat | Routed via `generateGroupWrapper`; mutates `this_chid`; `saveChat` throws for groups |
| `swipe_info` per-swipe fields | `send_date, gen_started, gen_finished, extra` (full `structuredClone` of message `extra`, including reasoning) |

## Sources

- SillyTavern `release` branch source, `public/script.js` (`swipe`, `Generate`, `saveReply`, `StreamingProcessor`, `ensureSwipes`, `syncMesToSwipe`, `syncSwipeToMes`, `updateSwipeCounter`, `openCharacterChat`, `getChat`, `saveChat`, `saveChatConditional`, `stopGeneration`, `unblockGeneration`, `generateQuietPrompt`), `public/scripts/st-context.js`, `public/scripts/events.js`, `public/lib/eventemitter.js`, `public/scripts/extensions.js`, `src/endpoints/chats.js`. HIGH confidence (read directly).
- Deep-Swipe (Rurijian) `CHANGELOG.md` v1.5.0 and v1.5.5, `README.md`, `deep-swipe.js`. HIGH for what it does, MEDIUM for the causal explanations (author's own).
- SillyTavern/Extension-PromptInspector `index.js`. HIGH.
- Bartasx4/SillyTavern-UserSwipes `src/user-swipes.js`, `manifest.json`. HIGH.
- ST issues #5033, #4717 (`swipe_info` missing/backfilled), #3787 (reasoning override on swipe delete), #4478 (`display_text` dropped when swiping back), #5265 (full-chat save scalability), via GitHub search. MEDIUM (titles only, not read in depth).
- Prompt caching: ST `openai.js` `cache_control` handling plus general provider behavior (short default TTL). MEDIUM; validate empirically.

## Gaps and Open Items

- Whether the stop path with streaming (`onStopStreaming` sets `isFinished` but not `isStopped`) saves a partial swipe. Needs a runtime test (Pitfall 13).
- Whether `power_user.auto_swipe` is reachable from `getContext()`. If not, read the DOM checkbox or import `power_user` from `scripts/power-user.js`.
- Whether a pre-switch hook exists for chat changes (to stop before `clearChat`). Otherwise rely on the integrity-token commit gate.
- Exact `generate_data` shape per API for the raw route, and which post-processing helpers are importable.
- Multi-tab/device behavior (ST has no cross-tab chat locking beyond the integrity check).
- Group-chat swipe semantics remain out of scope for v1 but the persisted-queue-into-group path must be blocked.

---
*Pitfalls research for: SillyTavern queued background swipe extension*
*Researched: 2026-10-25*
