# Architecture Research

**Domain:** SillyTavern (ST) UI extension: background serial queue of swipe generations appended to the latest AI message
**Researched:** 2026-10-25
**Source verified against:** SillyTavern `release` branch, `package.json` version 1.19.0 (latest GitHub release tag 1.19.0). Files read in full or in the relevant sections: `public/script.js`, `public/scripts/st-context.js`, `public/scripts/events.js`, `public/scripts/extensions.js`, plus `openai.js`, `textgen-settings.js`, `reasoning.js`, `slash-commands.js`, `group-chats.js`, `constants.js`, `lib/eventemitter.js`, and the bundled extensions (tts, vectors, quick-reply, macros) for cross-checks.
**Confidence:** HIGH for all "what the source does" claims. MEDIUM for the recommended generation route (sound on paper, needs one live spike). LOW for interceptor parity (see Gaps).

Citations use `file:function` (line numbers are approximate, taken from the 1.19.0 release snapshot, and will drift; the function name is the stable key).

---

## Headline Findings (read this first)

1. **The native `Generate('swipe')` path cannot be used as the background route.** It hijacks the visible message, blocks swipe navigation for the whole run, and corrupts data if `swipe_id` is not pre-staged. This contradicts the locked decisions "stay put" and "background, no streaming preview". Details in section 2.
2. **Recommended route: "native prompt assembly via `Generate('swipe', {}, true)` (dryRun) + own transport + native post-processing helpers + manual append".** A dry run builds the exact swipe prompt (character card, world info, chat minus the target message, presets, instruct/chat-completion formatting) and emits `GENERATE_AFTER_DATA` with the ready request body, without touching `is_send_press`, the DOM, `swipe_id`, or the stop button. The extension then sends that body itself and appends the result the same way the built-in `/addswipe` command does.
3. **Wording change needed on locked decisions.** "Serial through ST's native generation pipeline" should be read as "native prompt building + native request builders + native cleanup helpers, serialized by our own scheduler". We never call a non-dry `Generate('swipe')`, so the spirit of "never fire concurrent `Generate('swipe')`" is preserved. PROJECT.md "Key Decisions" row 2 should be updated after the spike.
4. **Three fidelity gaps of the dry-run route are real and must be tracked** (section 2.3): generate interceptors are skipped on dry runs (Vectors injection, SD triggers), chat-completion "squash system messages" is skipped on dry runs, and per-message prompt itemization is not recorded for the new swipe.
5. **Queue state in `chat_metadata` is safe but expensive to save**: every `saveChat` posts the entire chat file. Persist on enqueue/cancel/complete only, never on progress ticks. Always re-read `getContext().chatMetadata` (the object is replaced on chat load and by `updateChatMetadata`).
6. **Race to design for:** appending a swipe while a native generation is in flight can overwrite the appended text (section 1.3). The appender must only run when ST is idle.

---

## 1. Verified Source Facts

### 1.1 Native swipe flow (`script.js`)

**`swipe(event, direction, {source, repeated, message, forceMesId, forceSwipeId, forceDuration})`** (exported; `swipe_left`/`swipe_right` are deprecated wrappers; the DOM handlers at `.last_mes .swipe_right` call `swipe` directly).

Guards, in order (non-bypass sources only):
- Bypass list: `SWIPE_SOURCE.{DELETE, BACK, AUTO_SWIPE, SLASH_COMMAND, SWIPE_PICKER}` skip all three checks below (`constants.js`; `KEYBOARD` does not bypass).
- `isGenerating() && swipes && !swipesHidden && swipeState === NONE` -> `toastr.warning('Cannot swipe while generating...')`, return.
- `isSwipingAllowed()` = `chat.length !== 0 && swipes && !swipesHidden && !isGenerating() && swipeState === NONE`.
- `isMessageSwipeable(mesId, message)` = is last message, not `is_user`, not `extra.isSmallSys`, not `extra.swipeable === false`, not below an open editor.

Then: `cancelDebouncedChatSave()`, `swipeState = SWIPING`, `syncMesToSwipe(mesId)`, create `swipes/swipe_info` if missing (copying `extra` into `swipe_info[0]`), and for a right-swipe past the last slot:
- `newSwipeId = swipes.length`, **`chat[mesId].swipe_id = newSwipeId` (index past the end; no slot is pushed here)**, then per `getOverswipeBehavior`: REGENERATE -> `clearMessageData`, `animateSwipe(run_generate=true)`.
- `animateSwipe(true)` sets the DOM text to `'...'`, emits `MESSAGE_SWIPED(mesId)`, and `if (run_generate && !is_send_press) { is_send_press = true; generation = Generate('swipe'); }`.
- The slot is created later by `saveReply` (below). Correction to 01-architecture-analysis.md section 3: the doc says swipe "pushes a new empty slot"; it does not. It sets `swipe_id` to the next index and `saveReply` does `lastMessage.swipes.length++`.

**`saveReply({type:'swipe', ...})`** (non-stream and stream-start path):
```
lastMessage.swipes.length++                      // sparse hole at end
if (lastMessage.swipe_id === lastMessage.swipes.length - 1) {   // only if pre-staged
    mes/gen_started/gen_finished/send_date/extra.{api,model,reasoning,...} = new values
    addOneMessage(chat[id], {type:'swipe'})      // re-renders visible message
    emit MESSAGE_RECEIVED(id,'swipe'); CHARACTER_MESSAGE_RENDERED(id,'swipe')
} else {
    lastMessage.mes = getMessage                 // only mes
}
item.swipes[item.swipe_id] = item.mes            // ALWAYS overwrites the CURRENT swipe_id slot
item.swipe_info[item.swipe_id] = {send_date, gen_started, gen_finished, extra: structuredClone(item.extra)}
// then pushes extra multi-swipe results (n>1) with parseReasoningInSwipes
```
Consequence: calling `Generate('swipe')` when `swipe_id` is not `swipes.length` silently overwrites the swipe the user is reading and leaves a sparse hole (`null` in JSON). This is the single most dangerous behavior for this project.

**Answers to the open questions in 01-architecture-analysis.md section 6:**
- Q1 guards: verified above.
- Q2 "Can `Generate('swipe')` target a non-visible swipe?" No. It always targets `chat[chat.length - 1]` and only behaves correctly when `swipe_id === swipes.length` was pre-staged.
- Q3 interception per API: `GENERATE_AFTER_DATA(generate_data, dryRun)` is emitted for every API from one place (after the per-API `switch (main_api)` that builds `generate_data`; text APIs get the full body, `openai` gets `{prompt: messages[]}`). Emitted before `if (dryRun) return`. Verified.
- Q4 streaming writes: `StreamingProcessor.onStartStreaming` calls `saveReply({type, fromStreaming:true})` (stages the slot), then `onProgressStreaming` writes `chat[messageId].mes` and the DOM on every chunk; `swipes[]`/`swipe_info[]` are synced by `finalizeIntermediaryMessage`/`syncMesToSwipe` at the end and by `saveReply`'s trailing block. `swipe()` itself calls `streamingProcessor.onStopStreaming()` if streaming is active.
- Q6 group chats: non-dry `Generate` for a group returns `generateGroupWrapper(...)`; a dry run in a group calls `setCharacterId(memberIds[0])` and `setCharacterName('')` (side effects). `saveChat` throws for groups (`saveChatConditional` routes to `saveGroupChat`). Keep group chats out of v1 as already decided.

### 1.2 Single-flight state

| State | Where | Exported? | In `getContext()`? |
|-------|-------|-----------|--------------------|
| `is_send_press` | `script.js:603` `export let` | yes (live binding) | **no** |
| `isGenerating()` = `is_send_press \|\| is_group_generating` | `script.js:604` | yes | **no** |
| `abortController` | `script.js:630` `let` | **no (module-private)** | no |
| `streamingProcessor` | `script.js:456` `export let` | yes (live) | yes, **but a stale snapshot** (value at `getContext()` call time) |
| `swipeState` | `script.js:416` `export let` | yes (live) | only via `getContext().swipe.state()` |
| `swipesHidden` | `script.js:622` | yes | no |
| `generation_started` | `script.js:425` module-private | no | no |

Set/clear sites: `is_send_press = true` in non-dry `Generate` (before prompt send, ~line 4986) and in `swipe`'s run_generate branch and `sendTextareaMessage`-style paths; cleared in `unblockGeneration`, `activateSendButtons`, `setSendButtonState`. `deactivateSendButtons()` also sets `body[data-generating=true]`, shows the stop button and hides swipe buttons.

**Idle detection (question 6).** Use `isGenerating()` imported from `script.js` (HIGH; this is the exact check `swipe`/`isSwipingAllowed` use). Fallbacks without an import: `document.body.dataset.generating === 'true'` (set by `deactivateSendButtons`, cleared by `activateSendButtons`), or `!getContext().swipe.isAllowed()` (too coarse: also false when swipes are hidden/mid-swipe). ST's own `/swipe` command waits with the same idiom: `waitUntilCondition(() => !is_send_press && !is_group_generating, 10000, 100)` (`slash-commands.js:swipeChatCallback`), so a 100-250 ms poll is accepted practice. Do not rely only on events: `GENERATION_ENDED` is emitted from `hideStopButton()` only if the stop button was visible, so a generation that fails before `showStopButton()` never emits it.

### 1.3 The append race (must be designed around)

If our background request finishes and pushes a swipe while a native swipe generation is staged (`swipe_id = N`, `swipes.length = N`), our push fills index N and makes the length N+1. Then `saveReply` does `swipes.length++` (N+2), sees `swipe_id (N) !== N+1`, takes the `else` branch, and finally runs `swipes[N] = mes`, overwriting our appended swipe. **Rule: the appender runs only when `!isGenerating() && getContext().swipe.state() === 'none'`; otherwise it parks the finished result in memory and flushes on idle.**

### 1.4 Events (`events.js` `event_types`, `eventSource = new EventEmitter([APP_READY, APP_INITIALIZED])`)

| Purpose | Constant -> value | Emit site and payload |
|---------|-------------------|-----------------------|
| Swipe happened | `MESSAGE_SWIPED` -> `'message_swiped'` | `swipe()` -> `animateSwipe`: `(mesId)`. Fires for navigation and for regenerate; **not** fired by our appender (we do not swipe). Emitted mid-swipe, while `swipeState` is `swiping` (`script.js:9995`, `:10315`, cleared at `:10099`), so `swipe.isAllowed()` and `canQueue()` are false inside the listener. Do not make visibility decisions there; wait for idle (`renderWhenIdle` in `src/ui.js`) |
| Swipe deleted | `MESSAGE_SWIPE_DELETED` -> `'message_swipe_deleted'` | `deleteSwipe`: `{messageId, swipeId, newSwipeId}` |
| Generation start | `GENERATION_STARTED` -> `'generation_started'` | top of `Generate`: `(type, {automatic_trigger, force_name2, quiet_prompt, quietToLoud, skipWIAN, force_chid, signal, quietImage}, dryRun)`. **Also fires for dry runs; check 3rd arg** (tts, macros, quick-reply all do) |
| Generation end | `GENERATION_ENDED` -> `'generation_ended'` | `hideStopButton()`: `(chat.length)`, only if stop button was visible |
| Generation stopped | `GENERATION_STOPPED` -> `'generation_stopped'` | `stopGeneration()`: no args. `generateRawData` listens and aborts itself |
| Message sent (user) | `MESSAGE_SENT` -> `'message_sent'` | `sendMessageAsUser`: `(messageId)` (also `USER_MESSAGE_RENDERED`) |
| Message received (AI) | `MESSAGE_RECEIVED` -> `'message_received'` | `saveReply`/streaming: `(messageId, type)` where type in `normal|swipe|continue|append|appendFinal|first_message` |
| AI message rendered | `CHARACTER_MESSAGE_RENDERED` -> `'character_message_rendered'` | `(messageId, type)` |
| Message edited | `MESSAGE_EDITED` -> `'message_edited'` | `messageEditDone`: `(this_edit_mes_id)`, after text applied, before re-render. **Only real edits** |
| Message updated | `MESSAGE_UPDATED` -> `'message_updated'` | `(messageId)`; fires on edit done **and on edit cancel** (`messageEditCancel`) and `updateMessage` paths. Do not treat as "content changed" |
| Message deleted | `MESSAGE_DELETED` -> `'message_deleted'` | `deleteMessage`, `deleteLastMessage`: **`(chat.length)` after deletion, not the id** |
| Chat changed | `CHAT_CHANGED` -> `'chat_id_changed'` (note the value) | `getChatResult`, `reloadCurrentChatUnsafe`, group load: `(getCurrentChatId())`. Fires after `chat_metadata` is loaded, so it is the resume hook |
| Chat loaded | `CHAT_LOADED` -> `'chatLoaded'` | `({detail:{id, character}})` |
| Prompt data ready | `GENERATE_AFTER_DATA` -> `'generate_after_data'` | `(generate_data, dryRun)` |
| Chat-completion prompt | `CHAT_COMPLETION_PROMPT_READY` -> `'chat_completion_prompt_ready'` | `({chat, dryRun})` (mutable) |
| Chat-completion body | `CHAT_COMPLETION_SETTINGS_READY` | `(generate_data)` from `sendOpenAIRequest` |
| Text prompt combine | `GENERATE_BEFORE_COMBINE_PROMPTS`, `GENERATE_AFTER_COMBINE_PROMPTS` | `({prompt, dryRun})` |
| Stream token | `STREAM_TOKEN_RECEIVED` -> `'stream_token_received'` (alias `SMOOTH_STREAM_TOKEN_RECEIVED`, deprecated) | per chunk |
| App ready | `APP_READY` | auto-fires for late listeners (`autoFireAfterEmit`) |

`EventEmitter.emit` is async and awaits listeners in registration order; `makeFirst`/`makeLast` exist. Listener errors are caught per-listener (so throwing in a handler cannot cancel a generation).

### 1.5 Swipe data model (verified, `saveReply`, `ensureSwipes`, `syncMesToSwipe`, `syncSwipeToMes`)

```
chat[i] = {
  mes, send_date (ISO string), gen_started (Date), gen_finished (Date), extra: {...},
  swipes: string[], swipe_id: number,
  swipe_info: [{ send_date, gen_started, gen_finished, extra: {...} }]   // parallel to swipes
}
```
- `extra` fields set by a normal swipe: `api` (`getGeneratingApi()`), `model` (`getGeneratingModel()`), `reasoning`, `reasoning_duration: null`, `reasoning_signature`, optional `token_count`, and for streamed gens `time_to_first_token`. `swipe_info[n].extra` is `structuredClone(message.extra)`.
- `syncMesToSwipe(id)` copies `mes` + metadata of the displayed message into `swipes[swipe_id]`/`swipe_info[swipe_id]`; `syncSwipeToMes(id, swipeId)` does the reverse and sets `swipe_id`.
- `ensureSwipes(message)` (exported, not in context) backfills `swipes/swipe_id/swipe_info` for messages that never swiped (returns true if it changed anything); it returns false for user and `isSmallSys` messages.
- **Reference implementation for "append without switching": the built-in `/addswipe` command** (`slash-commands.js:addSwipeCallback`): backfills arrays, `swipes.push(text)`, `swipe_info.push({send_date, gen_started, gen_finished, extra})`, then (when not `switch=true`) `await updateSwipeCounter(lastMessageId, {message})`, `refreshSwipeButtons()`, then `await saveChatConditional()`. It never touches `swipe_id`. Our appender should be a superset of this.

### 1.6 Pager refresh

- `updateSwipeCounter(mesId, {message, messageElement})` (exported from `script.js`, **not** in `getContext()`) rewrites `.swipes-counter` text as `${swipe_id+1}/${swipes.length}` (zero-width spaces around `/`) and the swipe-picker button state.
- `refreshSwipeButtons(updateCounters=false, fade=true)` (exported; in context as `getContext().swipe.refresh`) toggles `swipes_visible` (left arrow needs `swipes.length > 1`), `last_swipe`, and the picker button. **It early-returns after adding `body.hideAllSwipeButtons` if `!isSwipingAllowed()`**, so it is a no-op visually while any native generation is running (appender is gated on idle anyway).
- `updateMessageBlock(id, message, {rerenderMessage})` is for re-rendering text; it is not needed (we do not change displayed text) and would reset reasoning UI.
- `addOneMessage(mes, {type:'swipe'})` re-renders the whole message from `mes`; **do not use**, because it would also show text from the current `swipe_id`, which is fine, but it scrolls and fires render side effects with no benefit.
- Correct append refresh sequence: `await updateSwipeCounter(mesId, {message})` then `getContext().swipe.refresh()`.

### 1.7 Save path and metadata (question 5)

- `saveChatConditional()` (`script.js:9412`): waits until `!isChatSaving` (up to `DEFAULT_SAVE_EDIT_TIMEOUT`), `cancelDebouncedChatSave()`, then `saveChat()` (character chats) or `saveGroupChat` (groups), then saves token cache and itemized prompts. `getContext().saveChat` **is** `saveChatConditional`. Errors are swallowed and logged (returns undefined), so the appender cannot rely on it throwing.
- `saveMetadata()` (`script.js:9408`) is literally `return await saveChatConditional()`. `saveMetadataDebounced()` (`extensions.js:89`, in context) debounces then calls `getContext().saveMetadata()`, aborting if `groupId` or `characterId` changed during the delay.
- `saveChatDebounced()` (`script.js:7361`) is the debounced variant; aborts if `this_chid`/group changed.
- `saveChat` serializes `{ ...chat_metadata, ...withMetadata }` as the header line and posts `[chatHeader, ...chat]` (compressed) to `/api/chats/save`. **Every metadata save is a whole-chat save.** Server enforces an integrity check (`chat_metadata.integrity` uuid) and prompts the user to type OVERWRITE on mismatch, then reloads the page. Never write the file any other way.
- `chat_metadata` is `export let` and is **reassigned** on chat load (`getChat`), `clearChat`/reset paths, and by `updateChatMetadata(newValues, reset)`. `getContext().chatMetadata` is therefore a snapshot of the binding at call time. **Rule: call `getContext()` fresh for every read and write of queue state, never cache the object.** Pattern used by bundled quick-reply: mutate `chat_metadata.quickReply = ...` then `saveMetadataDebounced()`.
- Metadata is chat-scoped, so the queue naturally follows the chat file and is loaded before `CHAT_CHANGED` fires.

### 1.8 Other verified facts used in the design

- `Generate` signature: `Generate(type, {automatic_trigger, force_name2, quiet_prompt, quietToLoud, skipWIAN, force_chid, signal, quietImage, quietName, jsonSchema, depth}, dryRun=false)`.
- `getContext()` exposes `generate`, `generateQuietPrompt`, `generateRaw`, `generateRawData`, `sendGenerationRequest`, `sendStreamingRequest`, `stopGeneration`, `extractMessageFromData`, `parseReasoningFromString`, `powerUserSettings`, `chatCompletionSettings`, `textCompletionSettings`, `getRequestHeaders`, `saveMetadataDebounced`, `updateChatMetadata`, `swipe.{left,right,to,show,hide,refresh,isAllowed,state}`, `eventSource`, `eventTypes`/`event_types`, `extensionSettings`, `saveSettingsDebounced`, `SlashCommandParser/SlashCommand/...`, `renderExtensionTemplateAsync`, `Popup`, `t`. It does **not** expose `isGenerating`, `is_send_press`, `cleanUpMessage`, `updateSwipeCounter`, `ensureSwipes`, `getGeneratingApi/Model`, `getGenerateUrl`, `sendOpenAIRequest`. Those need direct ES imports from `script.js`/`openai.js` (common practice: bundled quick-reply imports `chat_metadata` from `script.js`). Third-party extension modules load from `/scripts/extensions/third-party/<name>/`, so the import path is `../../../../script.js`.
- `runGenerationInterceptors(chat, contextSize, type)` (`extensions.js:2024`): runs `globalThis[manifest.generate_interceptor](coreChat, contextSize, abort, type)` for each enabled extension; called inside non-dry `Generate` only (`if (!dryRun) { ... runGenerationInterceptors ... } else { console.debug('Skipping extension interceptors for dry run') }`). Bundled users: `vectors` (`vectors_rearrangeChat`) and `stable-diffusion` (`SD_ProcessTriggers`).
- Dry runs are an established ST pattern: `openai.js` `promptManager.tryGenerate = () => Generate('normal', {}, true)`; built-ins gate on the third `GENERATION_STARTED` arg (`tts/index.js:onGenerationStarted`, `macros.js`, `state-macros.js`, `quick-reply/index.js:onBeforeGeneration`).
- `cleanUpMessage` (exported) applies: stopping-string tail trimming (`getStoppingStrings`), `getRegexedString(..., AI_OUTPUT)`, newline collapse, wrong-name trimming, `<|endoftext|>`, instruct sequences, group cleanup, `fixMarkdown`, name trimming, `trim_sentences`, `trim_spaces`. This is the same function the native non-streaming `onSuccess` calls, so it is the native post-processing for trimming/regex/stop strings.
- Non-streaming reasoning in native flow: `extractReasoningFromData(data)` (reasoning.js, API field), then `getRegexedString(reasoning, REASONING)` and trim; inline `<think>`-style blocks are parsed later by the `MESSAGE_RECEIVED`/`MESSAGE_UPDATED` handler in `reasoning.js:registerReasoningAppEvents` operating on `chat[idx]` (the displayed swipe). That handler will **not** run for our appended swipe, so the adapter must call `parseReasoningFromString` itself when `power_user.reasoning.auto_parse` is on.

---

## 2. Generation Route Evaluation (question 2)

### 2.1 Candidate matrix

Target behavior ("normal swipe context"): full prompt incl. character card, world info, author's note, chat up to the target message **excluding the target message and all its swipes**, then native cleanup.

| Route | Prompt content | Touches visible message / `swipe_id` | Single-flight state | Post-processing | Verdict |
|-------|----------------|--------------------------------------|---------------------|-----------------|---------|
| `Generate('swipe')` (real, = native swipe) | Correct: `if (type === 'swipe') coreChat.pop()` removes the target message | Yes. Writes `chat[last]`, DOM `'...'`, streams into DOM, requires pre-staged `swipe_id = swipes.length`, otherwise overwrites current slot | Sets `is_send_press`, replaces `abortController`, shows stop button, hides swipe arrows (`hideSwipeButtons`), blocks `swipe()` and `isSwipingAllowed` for the whole run | Full native (+ side effects: `MESSAGE_RECEIVED`, TTS auto-play, itemized prompts, sound, auto-continue, tool calls) | **Rejected** for background. Violates "stay put" and blocks pager navigation while the queue runs |
| `generateQuietPrompt()` -> `Generate('quiet')` | **Wrong**: `pop()` is only for `'swipe'`, so the target message is the last assistant turn, then the quiet instruction is appended. `quiet_prompt=''` still sends the current reply as context. No Claude prefill (`type !== 'quiet'` guards in `openai.js`) | No | Sets `is_send_press` (non-dry), replaces `abortController` | Partial: `displayIncompleteSentences = true` for quiet, `removeReasoning`; result is returned, not saved | **Rejected**: different context and different cleanup |
| `generateRaw()` / `generateRawData()` | Only the caller-provided prompt; no character card, WI, chat, presets; `createRawPrompt` rewraps | No | Own local `AbortController`; does **not** set `is_send_press`; aborts on `GENERATION_STOPPED`; re-emits `GENERATE_AFTER_COMBINE_PROMPTS` / `CHAT_COMPLETION_PROMPT_READY` | `generateRaw` runs `cleanUpMessage` | **Rejected as a prompt source**; fine as a precedent for a headless transport |
| `getContext().generate` | = `Generate`. `'normal'`/`'regenerate'`/`'continue'` types are destructive or user-input driven (`'regenerate'` does `chat.length--` + `removeLastMessage()`) | Yes | Same as real `Generate` | Full | **Rejected** |
| `Generate('swipe', {}, true)` (**dryRun**) | **Correct** (same code path; interceptors and squash skipped, see 2.3). Emits `GENERATE_AFTER_DATA(generate_data, true)` then returns `undefined` | **No**: skips `hideSwipeButtons`, `deactivateSendButtons`, `is_send_press=true`, `tainted`, `pingServer`, and never reaches DOM writes | Does **replace module-private `abortController` and `generation_started`** (unconditional at top of `Generate`) -> must only be called when idle | None (we do it) | **Recommended prompt source** |
| `generate_interceptor` (manifest) | Receives a copy of `coreChat` before prompt finalization; can `abort()` | n/a | n/a | n/a | **Not a route**: cannot capture or redirect the final prompt; skipped for dry runs |
| `sendGenerationRequest(type, data)` (context) | Takes ready `generate_data` | No | Uses the **private** `abortController.signal` (cannot be aborted by us except through `stopGeneration()`, which also emits `GENERATION_STOPPED`) | None | Usable transport, weaker cancel |
| Own `fetch(getGenerateUrl(main_api), ...)` / `sendOpenAIRequest(type, messages, signal)` | Takes captured `generate_data` | No | **Own `AbortController`**, no global state | None | **Recommended transport** |

### 2.2 Recommended pipeline (per queue item)

```
idle? (isGenerating() false, swipe.state() 'none', fingerprint matches)
  -> capture:   Generate('swipe', {}, true)  [listen GENERATE_AFTER_DATA, dryRun === true]  -> generate_data
  -> transport: openai    -> sendOpenAIRequest('swipe', generate_data.prompt, ownSignal)
                text APIs -> fetch(getGenerateUrl(main_api), {POST, getRequestHeaders(), body: generate_data, signal: ownSignal})
  -> parse:     extractMessageFromData(data); extractReasoningFromData(data) [+ signature]; error checks
  -> clean:     cleanUpMessage({getMessage, isImpersonate:false, isContinue:false, displayIncompleteSentences:false})
                + parseReasoningFromString if power_user.reasoning.auto_parse
  -> hold until idle again
  -> append:    swipes.push / swipe_info.push / tainted / updateSwipeCounter / swipe.refresh / saveChatConditional
```

Why `type='swipe'` and not `'quiet'` for `sendOpenAIRequest`: with `'quiet'` the Claude `assistant_prefill` and Fireworks `chat_id` are dropped and multi-swipe `n` is disabled (`openai.js:createGenerationParameters`). With `'swipe'` and `oai_settings.stream_openai` on, `sendOpenAIRequest` returns an **async generator function** (`streamData`) instead of JSON. The adapter must handle both shapes: if the return value is a function, iterate it and keep the last yielded `{text, state}` (text accumulates; `state.reasoning`/`state.images`/`state.signature` carry reasoning). Text-completion bodies are non-streaming unless `sendStreamingRequest` sets `generate_data.stream = true` (`textgen-settings.js:1290`), so plain `fetch` returns JSON. Kobold Horde needs `generateHorde`; treat `koboldhorde` as unsupported in v1 (guard and toast).

Capture helper (sketch; `Generate` accessed as `getContext().generate`):
```javascript
async function captureSwipePrompt() {
  const { eventSource, eventTypes, generate } = getContext();
  let armed = false, captured = null;
  const onStart = (type, _p, dryRun) => { if (type === 'swipe' && dryRun) armed = true; };
  const onData = (data, dryRun) => { if (dryRun && armed) { captured = data; armed = false; } };
  eventSource.on(eventTypes.GENERATION_STARTED, onStart);
  eventSource.on(eventTypes.GENERATE_AFTER_DATA, onData);
  try { await generate('swipe', {}, true); }
  finally {
    eventSource.removeListener(eventTypes.GENERATION_STARTED, onStart);
    eventSource.removeListener(eventTypes.GENERATE_AFTER_DATA, onData);
  }
  if (!captured) throw new Error('Prompt capture failed');       // group / no connection / no character
  return structuredClone(captured);                              // clone AFTER Generate resolves: later listeners may mutate
}
```

Append helper (sketch, mirrors `addSwipeCallback` + native `swipe()` backfill):
```javascript
async function appendSwipe(mesId, text, meta) {
  const ctx = getContext(), m = ctx.chat[mesId];
  if (isGenerating() || ctx.swipe.state() !== 'none') return 'defer';
  if (!m || mesId !== ctx.chat.length - 1 || m.is_user || m.is_system) return 'stale';
  if (!Array.isArray(m.swipes)) {                      // same backfill as swipe() in script.js
    m.swipe_id = 0; m.swipes = [m.mes];
    m.swipe_info = [{ send_date: m.send_date, gen_started: m.gen_started, gen_finished: m.gen_finished, extra: structuredClone(m.extra) }];
  } else { ensureSwipes(m); }
  m.swipes.push(text);
  m.swipe_info.push({ send_date: new Date().toISOString(), gen_started: meta.started, gen_finished: new Date(),
                      extra: { api: getGeneratingApi(), model: getGeneratingModel(), reasoning: meta.reasoning ?? '',
                               reasoning_duration: null, reasoning_signature: meta.signature ?? null } });
  ctx.chatMetadata.tainted = true;                     // deleteSwipe/Generate do the same
  await updateSwipeCounter(mesId, { message: m });
  ctx.swipe.refresh();
  await ctx.saveChat();                                // = saveChatConditional
  return 'ok';                                         // swipe_id untouched
}
```

### 2.3 Fidelity gaps of the dry-run route (track as risks)

| Gap | Source | Effect | Mitigation |
|-----|--------|--------|------------|
| Generate interceptors skipped | `Generate`: `if (!dryRun) runGenerationInterceptors(...)` | Vectors (`vectors_rearrangeChat`) memory injection and any third-party interceptor not applied; captured prompt differs from a native swipe when Vectors is enabled | Spike: try calling `runGenerationInterceptors(copyOfChatWithoutTarget, maxContext, 'swipe')` ourselves immediately before the dry run so side effects via `setExtensionPrompt` land in `extension_prompts`; verify with Prompt Inspector. If not equivalent, document the limitation and surface a one-time toast when any extension declares `generate_interceptor`. Confidence LOW until spiked |
| Chat-completion `squashSystemMessages` skipped | `openai.js:prepareOpenAIMessages`: `if (oai_settings.squash_system_messages && dryRun == false)` | Prompt not byte-identical when that setting is on; prompt-cache key differs from native | Re-implement a minimal squash in the adapter behind the same setting, or accept and document. Low practical impact |
| No itemized prompt for the new swipe | `finishGenerating` itemization is non-dry only | Prompt Inspector / token breakdown shows nothing for appended swipes (itemization is keyed by message id, so the existing entry remains) | Accept; note in docs |
| Not run: tool calls, auto-continue, sound, logprobs, `statMesProcess`, `triggerAutoContinue`, image attachment extraction | Non-dry `onSuccess` tail | Features that depend on native `onSuccess` do not apply to queued swipes | Acceptable; list in README. Image extraction (`extractImagesFromData`) can be added later |
| `n > 1` multi-swipe responses | `extractMultiSwipes` is module-private | Only `choices[0]` appended | Ignore extras in v1 (or set `n` to 1 in the cloned body when `generate_data.n`/`body.n` exists) |
| `abortController` / `generation_started` clobbered by dry run | top of `Generate` | If a native generation is mid-flight, its Stop button would abort the wrong controller and its timer would be wrong | Only dry-run when idle (checked immediately before and re-checked on the `GENERATION_STARTED` listener); small async window remains (`unshallowCharacter` + event emits before the controller is replaced). Treat as LOW risk, test by sending a manual message during capture |
| Third-party listeners that ignore the `dryRun` arg on `GENERATION_STARTED`/`GENERATE_AFTER_DATA`/`CHAT_COMPLETION_PROMPT_READY` | extension code | Prompt Inspector may record our dry run as the "last prompt" | Compatibility test matrix in the last phase |

Rejected fallback ("B2"): run a real `Generate('swipe')` and abort inside `GENERATE_AFTER_DATA` to capture a fully faithful prompt (interceptors, squash). It would flash the stop button, toggle `is_send_press` and swipe arrows, overwrite itemized prompts, and the only exported abort is `stopGeneration()` (emits `GENERATION_STOPPED`, which aborts every `generateRawData` in flight). Keep only as an emergency option if the interceptor spike fails and users demand parity.

---

## 3. Component Architecture

### 3.1 System overview

```
 ┌────────────────────────────── UI (DOM, no state) ──────────────────────────────┐
 │  QueueBadge / controls on .last_mes  |  /queueswipe slash cmd  |  Settings panel │
 └───────────┬───────────────────────────────────┬──────────────────────┬──────────┘
             │ enqueue / cancel / resume         │ subscribe             │ read/write
 ┌───────────▼───────────────────────────────────▼───────┐      ┌───────▼────────┐
 │                    Queue Store                        │      │   Settings     │
 │  items[], status, schema version, fingerprint,        │      │ extension_     │
 │  persist to chat_metadata, emits change events        │      │ settings[MOD]  │
 └───────▲───────────────────────▲───────────────▲───────┘      └────────────────┘
         │ invalidate/pause      │ state         │ results
 ┌───────┴──────────┐   ┌────────┴────────────────────────────────────────────────┐
 │   Event Guard    │   │                Runner / Scheduler (state machine)        │
 │ eventSource      ├──►│  idle-gate -> capture -> send -> post-process -> park -> │
 │ listeners        │   │  append; one in-flight; AbortController per item         │
 └───────▲──────────┘   └───────┬──────────────────────────────┬──────────────────┘
         │ events               │ prompt+request               │ text+meta
         │                ┌─────▼──────────────┐        ┌──────▼─────────────┐
         │                │ Generation Adapter │        │   Swipe Appender    │
         │                │ dryRun capture,    │        │ push swipes/info,   │
         │                │ transport, cleanup │        │ counter refresh,    │
         │                └─────┬──────────────┘        │ saveChatConditional │
         │                      │                       └──────┬─────────────┘
 ┌───────┴──────────────────────▼──────────────────────────────▼──────────────┐
 │                   ST Bridge (single module, all ST imports)                 │
 │  getContext(), eventSource, isGenerating, Generate(dry), cleanUpMessage,     │
 │  sendOpenAIRequest, updateSwipeCounter, ensureSwipes, getGenerateUrl, ...    │
 └──────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Component responsibilities and boundaries

| Component | Owns | Talks to | Must not |
|-----------|------|----------|----------|
| **ST Bridge** (`st-bridge.js`) | Every `import` from `script.js`/`openai.js`/`reasoning.js`, `getContext()` access, `isGenerating()`, capability probing (feature-detect each import, expose `bridge.capabilities`) | ST only | Contain logic. This is the only file that breaks when ST internals move, which localizes `minimum_client_version` work |
| **Queue Store** | Item list, item state (`queued`, `running`, `failed`, `cancelled`), target fingerprint, schema `version`, persistence to `chat_metadata[KEY]`, change notifications | Bridge (metadata read/write only), Runner, Guard, UI | Know about DOM or network. Cache `chat_metadata`. Persist on progress ticks |
| **Runner / Scheduler** | Single-flight loop, idle gating, per-item `AbortController`, retry-vs-drop policy, pause/resume state, parked results, wake sources (events + 250 ms poll while non-empty) | Store, Adapter, Appender, Bridge (`isGenerating`) | Call non-dry `Generate`; run two items concurrently; append while not idle |
| **Generation Adapter** | `captureSwipePrompt`, transport (openai vs text APIs, handles generator return), response parsing, native cleanup, reasoning, error normalization (`data.error`, empty reply -> failure) | Bridge only | Touch `chat[]`, DOM, or the store |
| **Swipe Appender** | The only code that mutates `message.swipes/swipe_info`; target validation (fingerprint, last message, not user/system); pager refresh; `tainted`; save; optional auto-jump (via `getContext().swipe.to(null,'right',{source:'slash_command', forceMesId, forceSwipeId})`, the same call `/addswipe switch=true` makes) | Bridge | Change `swipe_id` unless the auto-jump setting applies; emit `MESSAGE_SWIPED`/`MESSAGE_RECEIVED` |
| **Event Guard** | Subscriptions and policy table (3.4); translates ST events into Store/Runner commands | `eventSource`, Store, Runner | Hold queue state of its own |
| **UI** | Badge (pending/running count), per-item cancel, "cancel all", resume prompt on load, toasts, `/queueswipe` registration, settings panel markup | Store (subscribe), Runner (cancel), Settings | Mutate chat or call ST generation |
| **Settings** | `extension_settings[MODULE_NAME]` defaults merge, `saveSettingsDebounced()`, max queue, auto-jump, notification style | Bridge | Store queue state |

### 3.3 Data flow

Enqueue: UI/slash -> Store.add (validates target is last, swipeable AI message, queue < max, not a group chat; computes fingerprint; persists via `saveMetadataDebounced`) -> Runner.wake.

Run: Runner (idle gate) -> Adapter.capture (dryRun) -> Adapter.send (own signal) -> Adapter.parse+clean -> Runner parks result -> (idle) -> Appender.append (validates fingerprint) -> Store.markDone + persist (the chat save already carries metadata) -> UI updates from Store events; the native pager is updated by the Appender.

Invalidation: ST event -> Guard -> Store.clear / Runner.pause / Runner.abortInFlight -> UI toast.

Resume: `CHAT_CHANGED` -> Store.loadFromMetadata (items with status `running` demoted to `queued`; nothing is auto-run) -> UI shows "N queued swipes, resume?" -> user confirms -> Runner.resume.

**Fingerprint** (stable key to detect that the queue still targets the same message; ST messages have no unique id): `{ chatId: getCurrentChatId(), integrity: chat_metadata.integrity, mesId, chatLength, swipe0Hash: hash(swipes[0] ?? mes), name }`. Do **not** store swipe indexes in queue items (swipes can be deleted; `MESSAGE_SWIPE_DELETED` then needs no handling). Do **not** persist prompts (bloat and secrets in chat file); prompts are rebuilt at run time, which matches PROJECT.md "Context = normal swipe context at run time".

### 3.4 Event Guard policy table

| Event (payload) | Action |
|-----------------|--------|
| `CHAT_CHANGED (chatId)` | Abort in-flight request, drop parked result for the old chat, `Store.loadFromMetadata()` for the new chat in `awaiting-resume` state, no auto-run |
| `MESSAGE_SENT (id)` / `USER_MESSAGE_RENDERED` | Clear queue + toast (target no longer last) |
| `MESSAGE_RECEIVED (id, type)` where `type !== 'swipe'` or id != target | Fingerprint check; usually clear. Our own appends do not emit this event |
| `MESSAGE_DELETED (newLength)` | Payload is the new length, not an id: re-validate fingerprint; clear if target missing or length shrank below `mesId + 1` |
| `MESSAGE_EDITED (id)` | If `id === target.mesId` clear + toast. Edits of earlier messages: leave queued (prompt is rebuilt at run time) |
| `MESSAGE_UPDATED (id)` | Do **not** clear on its own (fires on edit-cancel and reasoning auto-parse paths). Rely on `MESSAGE_EDITED` and the fingerprint check at append time |
| `GENERATION_STARTED (type, params, dryRun)` with `dryRun === false` | A native run (manual send, swipe, continue, regenerate, impersonate, quiet from another extension) began: Runner enters `paused-by-native`. In-flight request: keep going but park its result (do not waste paid tokens); capture is never started while paused |
| `GENERATION_ENDED` / `GENERATION_STOPPED` | Wake Runner to re-check idle (plus poll; `GENERATION_ENDED` can be missed) |
| `MESSAGE_SWIPE_DELETED`, `MESSAGE_SWIPED` | No queue action (no indexes stored); useful only for debug logging |
| `APP_READY` | Register UI, slash command; first `CHAT_CHANGED` follows when a chat opens |

Append-time re-validation (never trust the event stream alone, because `messageEditMove` swaps messages without emitting an event): chat id, `integrity`, `mesId === chat.length - 1`, not user/system, `swipe0Hash` match.

### 3.5 Persistence schema

```json
chat_metadata["<MODULE_NAME>"] = {
  "version": 1,
  "target": { "mesId": 12, "swipe0Hash": "...", "integrity": "uuid" },
  "items": [ { "id": "uuid", "createdAt": "ISO", "status": "queued", "attempts": 0 } ],
  "paused": true
}
```
Writes: `getContext().chatMetadata[KEY] = state; getContext().saveMetadataDebounced();` (fresh `getContext()` each time). Persist on enqueue, cancel, clear, and completion (completion already triggers `saveChatConditional`, which includes metadata, so update the store before the append's save to get one write). Never persist progress or partial text.

---

## 4. Recommended Project Structure

```
queued-swipes/                     # extension folder (third-party/<name>/)
├── manifest.json                  # display_name, js, css, author, version, minimum_client_version (>= 1.19.0 until the spike says lower)
├── index.js                       # wiring only: init, register UI, slash command, start Guard
├── style.css
├── settings.html                  # template via renderExtensionTemplateAsync
└── src/
    ├── st-bridge.js               # ONLY file importing ST internals; feature detection
    ├── store.js                   # queue state + persistence (pure except bridge metadata calls)
    ├── fingerprint.js             # hashing / target matching (pure)
    ├── runner.js                  # scheduler state machine
    ├── adapter.js                 # capture + transport + parse + clean
    ├── appender.js                # chat mutation + pager refresh + save
    ├── guard.js                   # event subscriptions -> store/runner commands
    ├── ui.js                      # badge, cancel, resume prompt, toasts
    ├── commands.js                # /queueswipe
    └── settings.js
test/                              # node:test for store, fingerprint, runner (with a fake bridge)
```

Rationale: pure modules (`store`, `fingerprint`, `runner` against a fake bridge) can be unit-tested outside ST; `adapter`/`appender` need a live ST and are verified in a manual or Playwright smoke test. The bridge makes the ST dependency surface explicit and mockable.

## 5. Patterns to Follow

- **Idle-gated single flight**: one `inFlight` slot; every transition re-checks `isGenerating()`. Wake on events, confirm by poll.
- **Park, then flush**: network completion and chat mutation are decoupled; appending is the only step with an idle precondition.
- **Fresh context per access**: `getContext()` every time; never hold `chatMetadata`, `chat` length, or `streamingProcessor` across awaits.
- **Fail-soft per item**: adapter returns a result or a typed error; runner drops the item, toasts non-modally, continues (matches FR-7).
- **Mirror the built-in**: appender mirrors `/addswipe`; adapter mirrors native `onSuccess` ordering (extract -> clean -> reasoning).

## 6. Anti-Patterns to Avoid

| Anti-pattern | Why it is wrong | Do instead |
|--------------|-----------------|------------|
| Calling `Generate('swipe')` (non-dry) for queued items | Hijacks visible message, blocks arrows, overwrites current slot if `swipe_id` not staged | Dry-run capture + own transport |
| Pre-staging `swipe_id = swipes.length` and swapping back afterwards | Inconsistent state is saveable at any `await`; user sees flicker; fires TTS/translate on `MESSAGE_RECEIVED` | Never mutate `swipe_id` |
| Pushing `''` placeholder slots | Visible in pager, counted by other extensions | Append only on completion (already decided) |
| Caching `getContext().chatMetadata` | Object is replaced on chat load and by `updateChatMetadata` | Re-read each time |
| Treating `MESSAGE_UPDATED` as "content changed" | Fires on edit cancel and similar | Use `MESSAGE_EDITED` + fingerprint |
| Reading `MESSAGE_DELETED` payload as an id | It is the new chat length | Re-validate fingerprint |
| Relying on `GENERATION_ENDED` alone | Not emitted if the stop button never showed | Poll `isGenerating()` as backup |
| Saving metadata on every progress tick | Each save uploads the whole chat | Persist on state changes only |
| Using `generateQuietPrompt` | Includes the target reply in context, drops prefill, different cleanup | Dry-run capture |
| Appending while native generation active | Race overwrites appended swipe (1.3) | Park and flush on idle |

## 7. Build Order (dependencies)

```
0 Spike ─► 1 Bridge+Settings+Skeleton ─► 2 Store+Fingerprint ─┬─► 4 Adapter ─┐
                                                              └─► 3 Appender ─┴─► 5 Runner ─► 6 Guard ─► 7 UI+Slash ─► 8 Resume/Compat
```

0. **Live spike in ST 1.19.0** (one throwaway extension or console snippet): (a) dry-run capture on one Chat Completion source and one Text Completion backend; (b) diff captured prompt against a real swipe's prompt (`console_log_prompts` or Prompt Inspector) with Vectors on/off and `squash_system_messages` on/off; (c) both `sendOpenAIRequest` return shapes (stream on/off); (d) manual send during capture; (e) `runGenerationInterceptors` pre-call experiment. Output: go/no-go on route, `minimum_client_version`, list of required imports.
1. **Bridge, manifest, settings, skeleton** (no behavior). Establishes import paths and feature detection.
2. **Store + fingerprint** with persistence and demote-on-load rules. Pure, testable.
3. **Appender** can be built and tested first against a hardcoded string via a debug slash command (`/addswipe` parity), validating pager refresh, `saveChatConditional`, and non-switching behavior. No dependency on the adapter.
4. **Adapter** (needs spike results): capture, transport, cleanup, reasoning, error taxonomy.
5. **Runner** wires store + adapter + appender with idle gating, park/flush, abort.
6. **Guard** (event policy) after the runner exists so every invalidation path can be integration-tested; include the append-time re-validation.
7. **UI + `/queueswipe`**: badge, cancel one/all, toasts, enqueue control on `.last_mes`.
8. **Resume prompt, compatibility pass** (Deep-Swipe, UserSwipes, Prompt Inspector, Vectors), docs, packaging.

Roadmap phase hints: Phase for steps 0-1 should be flagged "needs research/spike"; steps 2-3 are standard; step 4 carries the main risk; step 8 needs hands-on compatibility testing (third-party code not read here).

## 8. Verification Status of `[Recall]` Claims (01-architecture-analysis.md)

| Claim | Status | Evidence |
|-------|--------|----------|
| `MESSAGE_SWIPED` exists | VERIFIED `'message_swiped'`, payload `(mesId)` | `events.js`; `script.js:swipe/animateSwipe` |
| `GENERATION_STOPPED` | VERIFIED, no payload | `script.js:stopGeneration` |
| `STREAM_TOKEN_RECEIVED` | VERIFIED `'stream_token_received'` | `events.js` |
| `CHAT_CHANGED` | VERIFIED value `'chat_id_changed'`, payload chat id | `events.js`; `getChatResult` |
| `MESSAGE_UPDATED` / `MESSAGE_EDITED` | VERIFIED, payload id; UPDATED also on cancel | `messageEditDone`, `messageEditCancel` |
| `MESSAGE_DELETED` | VERIFIED, payload is new `chat.length` | `deleteMessage`, `deleteLastMessage` |
| `CHAT_COMPLETION_PROMPT_READY`, `GENERATE_AFTER_DATA` | VERIFIED, payloads `{chat, dryRun}` and `(generate_data, dryRun)` | `openai.js:prepareOpenAIMessages`; `Generate` |
| Swipe data model fields | VERIFIED | `saveReply`, `ensureSwipes`, `syncMesToSwipe` |
| "Swipe pushes a new empty slot" | CORRECTED: sets `swipe_id = swipes.length`; `saveReply` does `swipes.length++` | `swipe`, `saveReply` |
| `is_send_press` / single `abortController` / `streamingProcessor` | VERIFIED (+ `abortController` is module-private; `is_send_press` and `isGenerating` are not in `getContext()`) | `script.js:603-630`, `st-context.js` |
| Swipe disabled while generating | VERIFIED: toast in `swipe`, `isSwipingAllowed`, `refreshSwipeButtons` hides all arrows | `script.js` |
| `saveChatConditional` | VERIFIED; `getContext().saveChat` aliases it; `saveMetadata` aliases it | `script.js:9408-9412`, `st-context.js` |
| `generate_interceptor` runs in `Generate` | VERIFIED, **skipped on dry runs** | `Generate`, `extensions.js:runGenerationInterceptors` |
| Option B "bypasses native post-processing unless re-implemented" | PARTLY OUTDATED: `cleanUpMessage`, `extractMessageFromData`, `extractReasoningFromData`, `parseReasoningFromString` are exported and reusable | `script.js`, `reasoning.js`, `st-context.js` |
| Prompt-caching impact of serial identical prompts | NOT VERIFIED (provider behavior, outside ST source). Note squash skip (2.3) can change the prompt shape | n/a |
| Group-chat swipe semantics | PARTIALLY VERIFIED (groups route through `generateGroupWrapper`; dry run has side effects); keep out of v1 | `Generate` |
| Deep-Swipe / UserSwipes / Prompt Inspector behavior | NOT READ (third-party repos); schedule compatibility testing | n/a |

## 9. Scalability and Operational Considerations

| Concern | Typical (1 user, chats up to a few MB) | Large chats (tens of MB, long histories) |
|---------|----------------------------------------|------------------------------------------|
| Chat saves | One `saveChatConditional` per completed swipe is acceptable | Each save re-uploads the whole chat; avoid extra metadata saves, coalesce enqueue bursts with `saveMetadataDebounced` |
| Prompt build time | Dry run is sub-second | WI scans and tokenization can take seconds per item; expose "preparing" badge state |
| API spend | Bounded by max queue (default 5) | Add confirmation when queue length x context size is large (optional) |
| Prompt cache | Serial back-to-back identical prompts are cache-friendly at providers | Squash-skip difference may reduce hits (2.3) |

## 10. Integration Points

| Service / Component | Pattern | Notes |
|---------------------|---------|-------|
| ST backend proxy | `/api/backends/chat-completions/generate`, `/api/backends/text-completions/generate`, `/api/backends/kobold/generate`, `/api/novelai/generate` via `getGenerateUrl` + `getRequestHeaders()` | No secrets in the extension (NFR-5) |
| Prompt Inspector / Prompt Manager | They observe dry-run events | `promptManager.tryGenerate` also dry-runs; do not assume a dry-run event stream is ours alone (use the `armed` correlation) |
| TTS / expressions / translate | Triggered by `MESSAGE_RECEIVED`/`CHARACTER_MESSAGE_RENDERED` | Intentionally not emitted for background swipes; document that these extensions do not process queued swipes until the user navigates to them (translate/vectors do listen to `MESSAGE_SWIPED`) |
| Vectors, stable-diffusion | `generate_interceptor` | Parity gap (2.3) |

## Gaps to Address

- **Interceptor parity** (LOW): whether pre-invoking `runGenerationInterceptors` reproduces Vectors injection in a dry-run prompt. Needs the spike (build step 0).
- **Streaming-enabled chat completion via `sendOpenAIRequest('swipe', ...)`**: generator consumption shape and reasoning/image state handling verified by reading code only, not executed.
- **Kobold Horde, NovelAI, Kobold, TabbyAPI-style multi-choice responses**: only the common path was read; test each backend family the author uses (open question 3 in the requirements draft).
- **Concurrency window** between the idle check and `abortController` replacement inside `Generate`: reasoned from code, needs an adversarial manual test.
- **Third-party extensions** (Deep-Swipe, UserSwipes, Prompt Inspector) were not read.
- **Auto-jump** implementation (`swipe(null, 'right', {source:'slash_command', forceMesId, forceSwipeId})`) is lifted from `/addswipe switch=true`; confirm it behaves when `swipesHidden`.

## Sources

- SillyTavern `release` branch (1.19.0), read 2026-10-25: https://github.com/SillyTavern/SillyTavern/tree/release
  - `public/script.js` (`swipe`, `saveReply`, `Generate`, `generateQuietPrompt`, `generateRaw`, `generateRawData`, `sendGenerationRequest`, `unblockGeneration`, `stopGeneration`, `hideStopButton`, `activateSendButtons`, `deactivateSendButtons`, `ensureSwipes`, `syncMesToSwipe`, `syncSwipeToMes`, `updateSwipeCounter`, `refreshSwipeButtons`, `isSwipingAllowed`, `isMessageSwipeable`, `deleteSwipe`, `deleteMessage`, `messageEditDone`, `messageEditCancel`, `saveChat`, `saveChatConditional`, `saveChatDebounced`, `saveMetadata`, `updateChatMetadata`, `cleanUpMessage`, `extractMessageFromData`)
  - `public/scripts/st-context.js` (`getContext`)
  - `public/scripts/events.js` (`event_types`, `eventSource`)
  - `public/scripts/extensions.js` (`runGenerationInterceptors`, `saveMetadataDebounced`)
  - `public/scripts/openai.js` (`sendOpenAIRequest`, `createGenerationParameters`, `prepareOpenAIMessages`, `promptManager.tryGenerate`)
  - `public/scripts/textgen-settings.js`, `public/scripts/reasoning.js`, `public/scripts/slash-commands.js` (`addSwipeCallback`, `swipeChatCallback`), `public/scripts/group-chats.js` (`saveGroupChat`), `public/scripts/constants.js` (`SWIPE_SOURCE`, `SWIPE_STATE`), `public/lib/eventemitter.js`
  - Bundled extensions for dry-run conventions: `tts/index.js`, `vectors/index.js`, `quick-reply/index.js`, `macros.js`
- Latest release tag check: https://api.github.com/repos/SillyTavern/SillyTavern/releases/latest (1.19.0)

---
*Architecture research for: SillyTavern queued-swipes UI extension*
*Researched: 2026-10-25*
