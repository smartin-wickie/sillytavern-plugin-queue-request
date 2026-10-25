# Runtime Behavior Evidence: Abort Safety, Stop, auto_swipe, Fidelity Gaps

Run 2026-10-25, continuation of the live ST 1.19.0 + llama-server session from `MATRIX-RESULTS.md`. All tests via Claude in Chrome against `http://127.0.0.1:8001`, CC backend. Raw notes are quoted verbatim from `qs-notes.json` (copied into this directory); dumps are the `qs-*.json` files alongside this report.

## Criterion d

Criterion d (`01-RESEARCH.md` Go/No-Go row d): "Manual send during capture does not corrupt `abortController`." Blocker for R1: YES.

**D1 (with signal), verdict PASS.** Verbatim note (`d_with_signal`):

> D1 with-signal, two parts. Part 1: native generation completed normally during the 8s own-signal dry-run hold. After, isGenerating was false, swipeState was none, mes_stop was hidden. Own dry-run capture reported equal false with sideEffectEvents 2 (MESSAGE_RECEIVED plus CHARACTER_MESSAGE_RENDERED from the native reply) which is expected since a real message was appended during the hold. Chat intact. Part 2: started a second native generation with a new user message, pressed Stop mid-stream almost immediately. Result: mes_stop hidden again (not stuck), send button enabled, chat intact (8 messages total), the stopped AI message was appended with empty text and one swipe (stop captured essentially zero streamed tokens, a partial placeholder message was left in chat, not removed). PASS overall. Passing an own AbortSignal to the dry-run Generate call does not block, corrupt, or interfere with a concurrent or subsequent native generation, and native Stop continues to work normally afterward.

Dumps: `qs-cc-stream-overlap-signal-{queued,snapshot,overlap}.json`.

**D2 (negative control, no signal), verdict PASS with caveat.** Verbatim note (`d_no_signal`):

> D2 negative-control, withSignal false. Two automation-timing-limited attempts completed before any clean mid-stream catch, both because local generation (dolphin-2.9-llama3-8b Q8, 4090, temperature 0) finished in well under a second, faster than a screenshot-then-click round trip could land on the Stop button; those attempts are not evidence either way and are omitted from the verdict. Third attempt used response length 300 and called context.stopGeneration() directly about 50ms after Send, confirmed mid-stream via mes_stop display flex just before the call. Result: mes_stop display went to none (hidden) after stopGeneration, isGenerating ended false, swipeState none, send button stayed enabled. No AI message or placeholder was appended at all -- chat length and last message (the user turn) were unchanged both immediately after and 6 seconds later, so generation did not continue silently in the background. Compare to D1 with-signal part 2, where an early native Stop left an empty placeholder AI message in chat; here no placeholder appeared at all, likely because this stop landed earlier in the native pipeline, before chat push rather than after. No stuck UI, no wrong-controller symptom observed (generation did not keep running after Stop reported success), no reload needed. PASS, with a caveat: fast local generation made it hard to land Stop reliably mid-stream via automation; the one clean catch found no corruption, but the window tested was short.

Dumps: `qs-cc-stream-overlap-nosignal-{queued,snapshot,overlap}.json`.

**Criterion d verdict: PASS.** No corruption, no stuck controller, no wrong-request-aborted symptom in either condition across the attempts that landed cleanly.

## Stop with partial

**F1 (native stop mid-stream): INCONCLUSIVE, not a FAIL.** Verbatim note (`f_native_stop`):

> F1 native-stop-mid-stream: recorded as an environmental limitation rather than a clean pass or fail, per user decision. This local backend (llama-server, dolphin-2.9-llama3-8b Q8, full GPU offload on an RTX 4090) completes a CC reply in well under one second almost every time regardless of max response length (tested up to 300), because the model reliably hits a natural stop (closing quote or EOS) around 60-70 tokens on this raw-completion-style roleplay prompt rather than using the full token budget. Four attempts to interrupt a real native swipe mid-stream all landed after completion: an 80ms-delay check, a 2ms-interval poll loop for 800ms, and a stopGeneration() call fired synchronously inside a one-shot GENERATION_STARTED (type swipe, dryRun false) listener (confirmed fired via a flag, before any visible text) -- all four times the full reply text was already present when checked afterward, and network logs show the chat-completions/generate POST still returned 200. What was confirmed along the way, real UI clicks on the swipe arrow correctly add a new swipe slot each time (swipes.length and swipe_id increment: 1 to 2 to 3 across three real clicks). A programmatic context.swipe.right(syntheticEvent, {source}) call behaved differently -- it overwrote the existing swipe in place rather than adding a new slot -- a source/DOM-context dependency worth a source-code note, not itself a Stop-safety concern. No corruption, no stuck UI, no stray partial swipes were observed in any attempt; mes_stop consistently returned to hidden and chat state stayed internally consistent (mes always matched swipes[swipe_id]). INCONCLUSIVE for the specific mid-stream interruption behavior -- not tested cleanly on this hardware via automation. Native Stop button functionality itself (hide/show, send-button re-enable, no stuck state) was exercised repeatedly across D1, D2 and this task without issue.

D1 part 2 (recorded under criterion d, directly relevant here too) did land one genuine native-stop case: an early stop left an **empty placeholder AI message with 1 swipe**, not removed from chat. This is consistent with the source-predicted policy in `01-RESEARCH.md` ("a Stop leaves a partial swipe in the chat") — here the partial happened to be empty because the stop landed before any tokens streamed, but the mechanism (partial swipe retained, not discarded) matches.

**F2 (own abort): PASS, with a real caveat.** Verbatim note (`f_own_abort`):

> F2 own abort. qsSpike.capture() then qsSpike.send({holdForAbort:true}), which holds 2000ms after the first streamed chunk by design. Called qsSpike.abortOwn() about 500ms into that hold. abortOwn() reported aborted true (signal.aborted set). However send() still resolved with aborted false and the full cleaned text (267 chars, shape generator) -- the abort signal did not cut the transfer short. Most likely cause: this local connection is fast enough that the full SSE response had already arrived and buffered in the browser before the abort call at 500ms (the whole reply streams in well under a second on this hardware, matching what F1 also found); an AbortController only prevents future reads, not already-buffered data already handed to the consumer, so resuming the for-await loop after the hold just drained already-received chunks. The property that actually matters passed: chat length was unchanged before and after (23 both times), confirming send() never appends to chat regardless of completion or abort outcome, by design (comment in spike source: the result is never appended). No swipe was added, no chat corruption. PASS on the safety property (own-transport results are never auto-appended, so an abort race cannot corrupt chat). NOTE for the real extension design: on a fast local backend, cancelling an in-flight own-transport request may not actually stop the network transfer if the response already fully buffered before cancellation was requested -- the extension must still discard the buffered result at the application level rather than relying on the abort to prevent the bytes from arriving.

**F3 (slash /abort isolation): PASS.** Verbatim note (`f_slash_abort`):

> F3 slash /abort isolation. qsSpike.send({holdForAbort:true}) started (2000ms hold after first chunk by design), then at about 500ms into the hold ran context.executeSlashCommandsWithOptions(slash abort) in the same window. Result: the slash command executed without error (isError false). The spike own-transport send() still resolved normally: aborted false, shape generator, cleanedLength 267 -- the native /abort command did NOT cancel or interrupt the spike own request. Chat length was unchanged before and after (23 both times) regardless, same as F2 -- send() never appends. PASS -- this is the desired isolation property: a user pressing native Stop or running /abort on their own current generation does not reach into and cancel a queued extension own-transport request running concurrently. The own AbortController used by send()/abortOwn() is genuinely independent of ST module-level abort state; ownership of GENERATION_STOPPED is out of scope here per 01-RESEARCH.md (Phase 4/GUARD-06), but this confirms the spike own-transport path is not accidentally wired to the native stop/abort plumbing.

**Confirmed policy (01-RESEARCH.md "Stop-with-partial"):** queued cancel = abort own controller and discard (no partial append). F2 and F3 both confirm `send()` never appends to chat under any outcome, so this policy is upheld by construction in the spike design, and nothing observed contradicts it. The one open nuance (F2) is that on a fast backend, "abort" may not stop the network transfer, only the application-level append — the real extension's cancel path must rely on not-appending, not on the transfer actually being cut short.

## auto_swipe

Verbatim note (`g_autoswipe`):

> G1 auto_swipe reachability. Enabled power_user.auto_swipe with auto_swipe_minimum_length 5000 (far above this models ~267-char replies), guaranteeing every reply is rejected. Own-transport test first: qsSpike.capture({label autoswipe}) then qsSpike.send({label autoswipe}). Result: swipes.length unchanged (2 before, 2 after), chat length unchanged (23 before, 23 after) -- the extension own-transport never calls swipe() or triggers the auto_swipe cascade, confirming it is unreachable from the dry-run/own-transport path. Control test: clicked the real native swipe arrow once. Cascade fired immediately and kept running -- swipes.length reached 14 after 3 seconds and kept climbing (mes_stop stayed visible/flex, actively generating) until stopGeneration() was called, by which point it had reached 23 swipes before halting. Confirms power_user.auto_swipe genuinely drives a reachable, fast-looping cascade from a single native swipe when every reply is rejected by the minimum-length filter. Stop cleanly halted the cascade (mes_stop hidden, not generating, no stuck state). auto_swipe disabled and minimum length reset to 0 afterward. PASS for the policy this validates: the extension (own-transport path) never reaches auto_swipe or calls swipe() itself, while the native pipeline cascade is confirmed real and fast enough that the documented policy (detect power_user.auto_swipe and warn once, never invoke it) is the right one -- a user with auto_swipe on could unknowingly generate dozens of swipes in seconds from their own native swiping, independent of anything the extension does.

Dumps: `qs-cc-nostream-autoswipe-{queued,snapshot,transport}.json`.

**Policy confirmed (01-RESEARCH.md "auto_swipe / auto-continue"):** extension never invokes `swipe()`/auto-continue; detect `power_user.auto_swipe` and warn once. The cascade is real and fast (9+ auto-swipes in 3 seconds on this hardware) — the warning matters.

## Fidelity gaps measured

**Squash ON (CC "Squash system messages").** `qs-cc-nostream-squash-queued.json` vs `qs-cc-nostream-squash-native.json`:

```
Chat Completion: queued 25 messages, native 24 messages
STRICT DIFF: 25 differences
```

Classification: **expected-gap, source-confirmed.** `diff-captures.mjs` shows the native (squashed) prompt merges the character's two leading system messages (persona block + "You are a mysterious figure...") into one combined message, shifting every subsequent message index down by one. This matches the predicted gap in `01-RESEARCH.md` ("CC `squashSystemMessages` skipped (openai.js L1608)") and `SOURCE-FINDINGS.md` exactly: the dry-run capture does not apply squash, so a captured prompt under squash ON will not match what native actually sends. **This is the one condition where criterion b has a real, documented gap** — acceptable per the Go/No-Go table ("gaps measured for squash ON... gaps acceptable if documented").

**World Info sticky.** `qs-cc-nostream-sticky-queued.json` vs `qs-cc-nostream-sticky-native.json`:

```
Chat Completion: queued 29 messages, native 29 messages
STRICT DIFF: none
```

A temporary WI entry (`qstickytest`, sticky 3, non-constant) was added to the character's bound world (`Eldoria`) — no sticky entry existed from Phase 1-04's setup, so one was created for this test and removed afterward. `QS_STICKY_MARKER` content was confirmed present in both dumps (`grep -c` both returned 1).

**Important scope caveat, not a clean pass on the research's actual sticky concern.** This test captured the WI entry's **activation turn** — the user's message directly contained the keyword `qstickytest`, so the entry fires through plain keyword-match scanning in both the dry-run and native paths identically; that scan happens before the dry-run early-return and is not one of the sticky-specific codepaths. The research's predicted gap (`01-RESEARCH.md`: "World Info sticky/cooldown timed effects skipped on dry run (world-info.js L683, L731, L748)") is about whether the **sticky counter's state advance** is applied correctly across a dry run — i.e., on a **later** turn where the keyword has scrolled out of the recent-context window but the entry should still be included because its sticky count hasn't expired yet. That specific turn-N+1-or-later scenario was not exercised here; `STRICT DIFF: none` on this run only shows that a directly-triggered keyword match is captured identically by both paths, which was expected and uninteresting. **The sticky-persistence fidelity gap remains unverified at runtime** — still source-only per `SOURCE-FINDINGS.md`, same confidence level as before this task.

## Hard-blocker summary

| Criterion | Blocker for R1? | Verdict | Source |
|---|---|---|---|
| a — dry-run capture has no visible side effects | YES | **PASS** (4/4 combos, `equal:true`, `sideEffectEvents:0`) | `MATRIX-RESULTS.md` |
| b — captured prompt matches native prompt | gaps acceptable if documented | **PASS with one documented gap** (squash ON; zero gaps elsewhere, matrix combos were all strict-diff-none) | `MATRIX-RESULTS.md` + this report |
| c — both return shapes handled | YES | **PASS** (4/4 combos, correct shapes, non-empty cleaned text) | `MATRIX-RESULTS.md` |
| d — manual send during capture does not corrupt `abortController` | YES | **PASS** (with-signal clean; no-signal clean on the one properly-timed catch, no corruption observed) | this report |
| e — interceptor parity | no (policy) | **NOT ACHIEVABLE** (source-only verdict, documented gap, non-blocking per the criterion table) | `SOURCE-FINDINGS.md` |
| f — stop-with-partial / auto_swipe | no (policy) | **Policies confirmed**: queued cancel discards (F2/F3 PASS); auto_swipe cascade real and unreachable from own-transport (G1 PASS); native stop-mid-stream itself inconclusive on this hardware (F1), but no corruption observed anywhere Stop was exercised | this report |

No criterion that is a hard blocker for R1 (a, c, d) failed. Criterion b's only gap (squash ON) is explicitly allowed by the Go/No-Go table and matches the source prediction exactly, with no surprises.

RECOMMEND: R1

## Post-review strictness fix (01-REVIEW.md CR-01/WR-01)

Code review (`01-REVIEW.md`) found `diff-captures.mjs`'s Chat Completion branch never diffed body keys outside `{role, name, content}` per message. Fixed and re-ran against the already-saved sticky and squash dumps in this directory (no server needed). **Result: unchanged.** `qs-cc-nostream-sticky-queued.json` vs `qs-cc-nostream-sticky-native.json` still reports `Body keys that differ: (none)` and `STRICT DIFF: none`; the squash-ON gap is still message-content-only. See `MATRIX-RESULTS.md` "Post-review strictness fix" for the full account, including the secret-scan re-check (CR-01).
