# Source Findings (ST 1.19.0, installed)

All line numbers are from the installed tree at `E:\SillyTavern\public\` (HEAD 06bde939f, per ENVIRONMENT.md), read-only. Paths below are relative to `public/`. No Vectors or other interceptor was run live (D-06).

## Version diff

Intended command: `git -C /e/SillyTavern diff 1.19.0 --stat -- public/script.js public/scripts/openai.js public/scripts/extensions.js`.

Not run: the executor's worktree sandbox refused every git invocation targeting a repo other than its own worktree (`git -C`, `--git-dir`). The diff result is therefore UNKNOWN from this plan. What is known from ENVIRONMENT.md: `git rev-list --left-right --count 1.19.0...HEAD` = `0 1`, i.e. the installed HEAD is exactly one commit ahead of the 1.19.0 tag. All citations below come from the installed files (HEAD), not the tag, so they are correct for the tree the live runs will use regardless of what that one commit changed. To close the question, run the diff command above once from a context that may read E:\SillyTavern (open question 2 stays open until then).

## Interceptor parity

Evidence (installed files):

1. Call site: `script.js:4562` `if (!dryRun) {` gate; `script.js:4564` `const aborted = await runGenerationInterceptors(coreChat, this_max_context, type);`. The dry-run branch at `script.js:4572` only logs "Skipping extension interceptors for dry run". So a `Generate(..., dryRun=true)` never runs interceptors. An abort result (`script.js:4566`) calls `unblockGeneration(type)` and returns.
2. Implementation: `scripts/extensions.js:2024` `runGenerationInterceptors(chat, contextSize, type)`. Defines `abort(immediately)` (`extensions.js:2028`), iterates manifests that declare `generate_interceptor` sorted by `sortManifestsByOrder` (`extensions.js:2033`), calls `globalThis[key](chat, contextSize, abort, type)` (`extensions.js:2037`), errors caught and logged per interceptor (`extensions.js:2038-2040`), `exitImmediately` breaks the loop (`extensions.js:2043`). It mutates the `chat` array it is given in place.
3. Vectors `rearrangeChat`: `scripts/extensions/vectors/index.js:776`. Skips only `type === 'quiet'` (`index.js:778`). Clears and sets extension prompts via `setExtensionPrompt` (`index.js:784-785`, `index.js:854`). Splices retrieved messages out of the passed chat array (`index.js:843`, `chat.splice(chat.indexOf(message), 1)`). Registered as `globalThis.vectors_rearrangeChat` (`index.js:891`). Message retrieval and embedding queries happen inside the interceptor path (for example `processFiles(chat)` at `index.js:787`).

Parity verdict: NOT achievable (partial at best)

Confidence: MEDIUM

Reasoning: because the dry-run path in Generate skips interceptors (`script.js:4562`), a dry-run prompt capture for an own-transport route lacks everything interceptors do. Pre-calling interceptors manually on a copy of the chat reproduces the extension-prompt injection side effects (global `setExtensionPrompt` state is shared, so it would also mutate live state) but only matches the splice if the copy is the same array shape Generate builds (`coreChat`, built before `script.js:4562`), and it triggers real embedding/vector queries and any other side effects (Stable Diffusion trigger processing) a second time. The result cannot be proven equivalent from source alone. Confidence is capped at MEDIUM because no interceptor was executed (D-06).

Bundled interceptor manifests (`grep -l generate_interceptor scripts/extensions/*/manifest.json`):
- `scripts/extensions/vectors/manifest.json:8` -> `vectors_rearrangeChat`
- `scripts/extensions/stable-diffusion/manifest.json:25` -> `SD_ProcessTriggers`

User-installed interceptors (from ENVIRONMENT.md, 26 folders scanned):
- Extension-Randomizer -> `randomizerInterceptor`
- Extension-WebSearch -> `WebSearch_Intercept`
- SillyTavern-MessageSummarize -> `memory_intercept_messages`

## Reverified line numbers

| Anchor | Installed location |
|---|---|
| `abortController` module variable declared | `script.js:630` |
| abortController replacement guard `if (!(abortController && signal))` | `script.js:4302` (assignment at `4303`) |
| `GENERATION_STARTED` emit | `script.js:4299` |
| `GENERATE_AFTER_DATA` emit | `script.js:5318` |
| dryRun early return right after it | `script.js:5320-5322` |
| `isGenerating` (`is_send_press \|\| is_group_generating`) | `script.js:604` |
| `is_send_press` declaration | `script.js:603` |
| `stopGeneration` | `script.js:5607` (abort at `5614`, `GENERATION_STOPPED` emit at `5618`) |
| `isSwipingAllowed` | `script.js:9162` (uses `!isGenerating()` at `9169`) |
| `runGenerationInterceptors` call site / definition | `script.js:4564` / `scripts/extensions.js:2024` |
| `unblockGeneration` | `script.js:5693` |

## Stop with partial

- `stopGeneration` (`script.js:5607`): if `streamingProcessor` exists calls `streamingProcessor.onStopStreaming()` (`script.js:5610`), then if the module `abortController` exists calls `abortController.abort('Clicked stop button')` (`script.js:5614`), then emits `GENERATION_STOPPED` (`script.js:5618`).
- `StreamingProcessor.onStopStreaming` (`script.js:3847-3850`): `this.abortController.abort(); this.isFinished = true;`. It does not set `isStopped` (that is set only in `onErrorStreaming`, `script.js:3822`). The streaming loop returns early on abort (`script.js:3881-3883`).
- Partial result path: in Generate the stream result check `isStreamFinished = streamingProcessor && !streamingProcessor.isStopped && streamingProcessor.isFinished` (`script.js:5408`) is true after a user stop, so `onFinishStreaming(messageId, getMessage)` runs (`script.js:5440`), which finalizes the message with the partial text (`finalizeIntermediaryMessage`, `script.js:3755`, called at `3809`) and then `saveChatConditional()` (`script.js:3815`). `auto_swipe` is guarded by `signal.aborted` (`script.js:3811-3812`), so a stopped partial does not trigger auto-swipe.
- `GENERATION_STOPPED` also reaches the raw path: `generateRawData` (`script.js:4000`) creates its own `AbortController` (`script.js:4005`), registers `abortHook` on `GENERATION_STOPPED` (`script.js:4018`) and removes it afterwards (`script.js:4108`); the hook aborts that controller (`script.js:4013-4017`). An own-transport route that does not go through `Generate` has no Stop button of its own and is touched by `stopGeneration` only if it registers such a hook; the shared module `abortController` (`script.js:630`) is not its controller.
- Hypothesis (to confirm at runtime in plan 06): a queued-item cancel should abort the item's own controller and discard the partial; a user Stop on the live generation keeps the partial as a normal swipe via the path above. For R1 (native `Generate`) a cancel of the running item goes through `stopGeneration`, which keeps the partial (appended as a swipe), so a "discard" policy would need explicit removal of that swipe.

## auto_swipe and auto-continue

- Settings defaults in `scripts/power-user.js:180-183`: `auto_swipe`, `auto_swipe_minimum_length`, `auto_swipe_blacklist`, `auto_swipe_blacklist_threshold`. UI binding at `power-user.js:1659-1662` and handlers at `power-user.js:3577-3602`. Filtering in `generatedTextFiltered` at `power-user.js:3056` (`auto_swipe_minimum_length`) and `power-user.js:3062-3063` (blacklist/threshold).
- Evaluation sites: `StreamingProcessor.onFinishStreaming` `script.js:3811-3813` (`!isAborted && power_user.auto_swipe && generatedTextFiltered(text)` then `swipe(null, SWIPE_DIRECTION.RIGHT, { source: SWIPE_SOURCE.AUTO_SWIPE, repeated: true, forceMesId: chat.length - 1 })`), and non-streaming Generate onSuccess `script.js:5566-5569` (same condition, `is_send_press = false` first, then the same `swipe(...)` call).
- `triggerAutoContinue` definition `script.js:5783`; call sites `script.js:5442` (streaming finish) and `script.js:5578` (non-streaming, skipped for `type === 'quiet'`, `script.js:5577`). It clicks `#option_continue` (`script.js:5790`) when `shouldAutoContinue` is true; disabled for group chat (`script.js:5784`).
- `SWIPE_SOURCE.AUTO_SWIPE` is also part of the source list at `script.js:9973`.
- Hypothesis: auto_swipe/auto-continue are reachable only from the native Generate completion paths above. A queued item run through the native pipeline (R1) would therefore be subject to both; a queued item run through an own-transport/dry-run route would not hit them at all. Confirm at runtime in plan 06 with `auto_swipe` enabled and a short minimum length.

## Dry-run fidelity gaps

- Chat Completion `squashSystemMessages` is skipped on dry run: `scripts/openai.js:1608` (`oai_settings.squash_system_messages && dryRun == false`), implementation at `scripts/openai.js:3922`. A dry-run prompt can differ from the live one when that setting is on.
- World Info sticky/cooldown timed effects are skipped on dry run: `scripts/world-info.js:682-683` (`checkTimedEffects`, `if (!this.#isDryRun)` around sticky/cooldown), and `setTimedEffects` returns early at `world-info.js:731`; also `world-info.js:748` (`this.#isDryRun && type !== 'delay'`). Construction with the flag at `world-info.js:4745`, call at `world-info.js:4747`, WI prompt fetch with `dryRun` at `script.js:4635`.
- Itemized prompt is not produced on dry run: itemization runs inside `finishGenerating`, which is only reached after the `dryRun` return at `script.js:5320`; itemized entry pushed at `script.js:5375-5383`.
- Logprobs side effect for non-quiet non-streaming `sendOpenAIRequest`: `scripts/openai.js:3201-3206` (`if (type !== 'quiet')` then `delay(1).then(() => saveLogprobsForActiveMessage(logprobs, null))`); the function is defined at `scripts/logprobs.js:509`. A queued own-transport request using a non-quiet type would write logprobs onto whichever message is active at that moment.
- Draft-text forcing for swipe: `script.js:4399-4404` - the `#send_textarea` value is read and cleared only for non-regenerate/swipe/quiet/impersonate, non-dry-run, depth 0 calls; otherwise `textareaText = ''` (`script.js:4404`). A swipe-type generation therefore ignores the user's draft text (so a prompt built for type swipe never includes it), and a normal dry run also does not consume it.
