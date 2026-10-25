# Route Verification Spike Report

Generation route decision for Queued Swipes for SillyTavern, resolved against a live ST 1.19.0 instance per the open decision in `.planning/research/SUMMARY.md` ("KEY OPEN DECISION: Generation Route").

## Environment

- SillyTavern: `1.19.0 'release' (06bde939f)`, `git describe --tags` = `1.19.0-1-g06bde939f` (one commit ahead of the tag), `git rev-list --left-right --count 1.19.0...HEAD` = `0 1`. Source: `captures/ENVIRONMENT.md`.
- llama-server: `version: 1 (ff55414)`, MSVC build, NVIDIA GeForce RTX 4090 (cc 8.9), `--jinja` supported. Model: `D:\old-models\Chat\dolphin-2.9-llama3-8b.Q8_0.gguf`.
- Disabled extensions during the spike: all 26 user-installed extensions (listed in `captures/ENVIRONMENT.md`), bundled extensions left on. Original baseline (`disabledExtensions`: `["translate","expressions"]`) recorded for restore.
- `qsSpike` import check (`spike/tools/check-exports.mjs` against the installed 1.19.0 source and via the live junction path): 20 OK, 0 MISSING, exit 0 both times. No import had to be removed or substituted.

## Verdict table

Hard-blocker rule (`01-CONTEXT.md` Claude's Discretion): criteria **a, c, d** are hard blockers for R1; **b, e, f** are accepted if documented.

| # | Criterion | Check | Result | Evidence | Hard blocker? | Confidence |
|---|---|---|---|---|---|---|
| a | Dry-run capture has no visible side effects (CC and TC) | Snapshot before==after, no `MESSAGE_*`/`*_RENDERED` events, Send enabled, Stop hidden | **PASS** (4/4 combos: `equal:true`, `sideEffectEvents:0`) | `MATRIX-RESULTS.md` | YES | HIGH (runtime, 4/4) |
| b | Captured prompt matches native swipe prompt | `diff-captures` strict diff | **PASS, one documented gap** (squash ON only; all 4 matrix combos + sticky-activation-turn: strict diff none) | `MATRIX-RESULTS.md`, `BEHAVIOR-RESULTS.md` "Fidelity gaps measured" | gaps acceptable if documented | HIGH (runtime, matches source prediction exactly) |
| c | Both return shapes handled | CC stream ON generator, other 3 JSON, all non-empty cleaned text | **PASS** (4/4 combos, correct shapes, `aborted:false` where applicable) | `MATRIX-RESULTS.md` | YES | HIGH (runtime, 4/4) |
| d | Manual send during capture does not corrupt `abortController` | With-signal and no-signal overlap, native Stop still works after | **PASS** (both conditions; no corruption, no stuck controller) | `BEHAVIOR-RESULTS.md` "Criterion d" | YES | HIGH (with-signal, clean); MEDIUM (no-signal — only one cleanly-timed catch landed) |
| e | Interceptor parity | Source analysis, no interceptor run live (D-06) | **NOT ACHIEVABLE** (documented gap) | `SOURCE-FINDINGS.md` "Interceptor parity" | no (policy) | MEDIUM (source-only) |
| f | Stop-with-partial and `auto_swipe` reachability | F1-F3 (own abort, slash /abort, native stop), G1 (auto_swipe control) | **Policies confirmed**: own-transport never appends regardless of outcome (F2/F3 PASS); native stop-mid-stream itself inconclusive on this hardware (F1); `auto_swipe` cascade real and unreachable from own-transport (G1 PASS) | `BEHAVIOR-RESULTS.md` "Stop with partial", "auto_swipe" | no (policy) | HIGH (F2/F3/G1 runtime); INCONCLUSIVE (F1, environmental) |

No hard blocker (a, c, d) failed. Criterion b's only gap (squash ON) is the one the research predicted from source and nothing else surfaced.

## Return shapes

| Backend | Streaming | Shape | Cleaned length | Notes |
|---|---|---|---|---|
| cc | stream | `generator` | 141 | async generator consumed via `for await`, matches CC-stream-ON per plan expectation |
| cc | nostream | `json` | 141 | object with `choices` |
| tc | stream | `json` | 78 | own fetch/transport handling, not ST's native EventSource reader |
| tc | nostream | `json` | 78 | same path as tc/stream, consistent |

Source: `MATRIX-RESULTS.md`.

## Prompt diff

Summary across all tested combinations (`MATRIX-RESULTS.md`, `BEHAVIOR-RESULTS.md` "Fidelity gaps measured"):

- **CC stream ON/OFF, TC stream ON/OFF (baseline config — squash OFF, no sticky WI, no draft text):** strict diff `none` for all 4. The dry-run-captured prompt is byte-identical (after key-sorted normalization) to what the native swipe actually sent, including the TC `stream` body key.
- **Squash ON (CC):** strict diff `25` differences — the native (squashed) prompt merges two leading system messages into one, shifting every later message index. **Expected, source-confirmed gap** (`scripts/openai.js:1608`, dry run skips `squashSystemMessages`).
- **World Info sticky (activation turn only):** strict diff `none`. **Scope caveat:** this test only exercised the turn where the keyword was directly present (plain keyword-match scan, not the sticky-specific codepath). The research's actual concern — whether the sticky counter's state survives a dry run on a *later* turn where the keyword has scrolled out of context (`scripts/world-info.js:682-683,731,748`) — was not exercised and remains source-only/unverified.
- **Draft-text leakage:** `QS-DRAFT-MARKER` typed and left in the input box through a full capture+send+native-swipe cycle did not appear in either prompt. Confirms assumption A8 (`01-RESEARCH.md`): draft text does not enter a swipe prompt, under either route.
- **Still source-only, not runtime-tested:** Vectors interceptor splice/extension-prompt parity (D-06, no interceptor run live), itemized prompt (dry run returns before itemization runs, `script.js:5320` vs `5375-5383`), logprobs write-on-active-message side effect for non-quiet non-streaming requests (`scripts/openai.js:3201-3206`).

## Policies

### Stop with partial

**Observed:** A native Stop press leaves a partial swipe in chat (not removed) — confirmed directly in `BEHAVIOR-RESULTS.md` D1 part 2 (an early stop appended an empty-text placeholder swipe, left in place). The spike's own-transport `send()` **never appends to chat under any outcome** (completed, aborted, or interrupted by a native `/abort`) — confirmed in F2 and F3, both with chat length unchanged before/after. One caveat from F2: on this fast local backend, calling `abortOwn()` does not reliably cut off an in-flight transfer if the response already fully buffered before the abort call — the signal only prevents *future* reads.

**Policy:** Queued-item cancel aborts the item's own `AbortController` and discards the result application-side (never calls the append step), rather than relying on the abort to stop the network transfer in time. Matches the source-derived hypothesis in `SOURCE-FINDINGS.md` "Stop with partial".

**Source of evidence:** `script.js:5607-5621` (native `stopGeneration`), `script.js:5408-5440` (partial finalization path), `BEHAVIOR-RESULTS.md` D1/F2/F3.

### auto_swipe and auto-continue

**Observed:** With `power_user.auto_swipe` enabled and `auto_swipe_minimum_length` set far above the model's typical reply length, a single native swipe triggered a real, fast cascade — 14 auto-swipes in 3 seconds, 23 before `stopGeneration()` halted it. The spike's own-transport `capture()`/`send()` path never reached `swipe()` or triggered any cascade (swipe count and chat length unchanged across the test).

**Policy:** The extension never calls `swipe()` or invokes auto-continue itself (confirmed unreachable from the own-transport path by construction, not just by observation). Detect `power_user.auto_swipe` via `getContext().powerUserSettings.auto_swipe` and show a one-time warning toast that queued results are not auto-swipe filtered, since the cascade is real and fast enough to surprise a user who forgot it was on.

**Source of evidence:** `scripts/power-user.js:180-183` (settings), `script.js:3811-3813` / `5566-5569` (evaluation sites), `BEHAVIOR-RESULTS.md` "auto_swipe" (G1).

### Interceptor gap

**Observed:** Source-confirmed, not runtime-tested (D-06: no interceptor executed live). `script.js:4562-4572` skips `runGenerationInterceptors` entirely on a dry run. Two bundled interceptors (`vectors` → `vectors_rearrangeChat`, `stable-diffusion` → `SD_ProcessTriggers`) and three of the operator's installed extensions declare `generate_interceptor` (`Extension-Randomizer` → `randomizerInterceptor`, `Extension-WebSearch` → `WebSearch_Intercept`, `SillyTavern-MessageSummarize` → `memory_intercept_messages`); all three user ones were disabled during the spike, so only the bundled two were live, and even those never ran because dry runs skip the whole interceptor step.

**Policy:** Document the gap; show a toast when any currently-active extension declares `generate_interceptor` (check `getExtensionManifest(name)?.generate_interceptor` for each loaded/enabled extension, same technique `qsSpike.status()` already uses). Defer any attempt at a fix (e.g. pre-calling interceptors on a chat copy) to Phase 5 — pre-calling was source-analyzed and rejected as not provably equivalent (`SOURCE-FINDINGS.md` "Interceptor parity": mutates shared extension-prompt state, re-triggers embedding queries, splice behavior not reproducible against the real `coreChat`).

**Source of evidence:** `SOURCE-FINDINGS.md` "Interceptor parity", `scripts/extensions.js:2024-2043`.

## Decision

**Route: R1 — dry-run `Generate('swipe', {}, true)` capture + own transport + native cleanup helpers.**

Status: APPROVED — R1 (user approved 2026-10-25)

## Reasoning

All three hard-blocker criteria for R1 (a: no side effects, c: both return shapes, d: no `abortController` corruption) passed cleanly at runtime across the full 4-combination matrix and the overlap tests. Criterion b's only real gap (squash ON) is exactly the gap the source analysis predicted before any runtime test ran, with no additional surprises — every other condition tested (baseline x4, draft-text, sticky-activation-turn) matched the native prompt byte-for-byte. Criteria e (interceptor parity) and f (stop/auto_swipe policy) are both accepted-if-documented per the Go/No-Go table, and both are now backed by concrete runtime evidence or clear source citations rather than being open questions. R2 (native swipe + view restore) was never attempted at runtime since R1 cleared every hard blocker; it remains available as a documented fallback per the research recommendation, not pursued further.

## Consequences for Phase 2

Under R1:
- Serial queue worker must gate every capture on ST being genuinely idle (`isGenerating()` false, `swipe.state() === 'none'`) before starting a dry-run capture — never run a capture while another generation (native or queued) is in flight.
- Always pass the capture's own `AbortController` as `{ signal }` to the dry-run `Generate` call (criterion d only passed cleanly in the with-signal condition at full confidence; no-signal was only cleanly verified once).
- The extension must never call a non-dry `Generate` for queued items — queued generation goes through the captured prompt + own transport (`sendOpenAIRequest`/`fetch` to the TC endpoint) + native `cleanUpMessage`/reasoning-extraction helpers, then appends like `/addswipe`.
- Document and toast the gaps: Vectors/interceptor skip, CC squash skip (if the user has squash enabled), World Info sticky-state-on-dry-run uncertainty, no itemized prompt, draft text is correctly excluded (not a gap).
- Cancel = abort own controller + discard app-side; never rely on the abort cutting off an already-buffered fast response.
- Never call `swipe()` or trigger auto-continue; detect and warn once if `power_user.auto_swipe` is on.

## Pre-spike state to restore

From `captures/ENVIRONMENT.md` "Baseline to restore (D-07)":
- `extension_settings.disabledExtensions`: `["translate","expressions"]`
- `main_api`: `"openai"`
- `oai_settings.preset_settings_openai`: `"Default32k"`
- `textgenerationwebui_settings.preset`: `"Mistral-V7-Tekken-T8-XML"`
- `power_user.instruct.preset`: `"Sphiratrioth - LLAMA 3"`

The API connection (Chat Completion → Custom `http://127.0.0.1:8080/v1`) and the Text Completion → llama.cpp `http://127.0.0.1:8080` connection set up for the spike must be manually re-pointed to the user's real backend(s) after cleanup; this report's "Cleanup done" section (added in Task 3) covers what was restored automatically versus what needs the user's manual action.

## Cleanup done

Executed after route approval (Task 3, plan 01-07):

- **Servers stopped.** The PIDs recorded in `captures/ENVIRONMENT.md` "## Spike session setup" (llama-server 55716, ST 29100) no longer existed — a session restart during plan 01-06 had already replaced them. Verified the *currently running* processes (`node.exe` PID 57980 on :8001, `llama-server.exe` PID 47168 on :8080) matched the expected image names before stopping both. Ports 8080/8001 confirmed free afterward.
- **`disabledExtensions` restored** in `E:\SillyTavern\data\default-user\settings.json` to the original baseline `["translate","expressions"]` (was the 26-entry spike list). First attempt via Node `fs.writeFileSync` silently failed with no error output (environment-specific; not diagnosed further) — completed instead via a PowerShell background job (`Get-Content | ConvertFrom-Json` → mutate → `ConvertTo-Json | Set-Content`). That left a UTF-8 BOM, which breaks strict JSON parsers; rewritten once more via `[System.IO.File]::WriteAllText` with a BOM-less UTF8 encoding. Verified after: valid JSON, 24 top-level keys, `disabledExtensions` exactly `["translate","expressions"]`, `main_api` still `"openai"`. Note: the whole file went through a JSON round-trip (whitespace/key-order may differ from the original byte-for-byte; values were not reported altered beyond the intended key, but ST starting cleanly should be spot-checked once by the user).
- **Spike junction removed**: `cmd /c rmdir "E:\SillyTavern\public\scripts\extensions\third-party\qs-route-spike"` (non-recursive). Confirmed gone from the ST tree; confirmed `spike/index.js` and `spike/manifest.json` are untouched in this repo.

**Not restored automatically — user action required**, per "Pre-spike state to restore" above:
- Re-select the original API connection(s) (the spike pointed Chat Completion at a Custom endpoint `http://127.0.0.1:8080/v1` and Text Completion at llama.cpp `http://127.0.0.1:8080`; point these back at your real backend).
- Re-select presets: `oai_settings.preset_settings_openai` = `Default32k`, `textgenerationwebui_settings.preset` = `Mistral-V7-Tekken-T8-XML`, `power_user.instruct.preset` = `Sphiratrioth - LLAMA 3` (Instruct Mode was left OFF during the spike's TC testing).
- The throwaway character `QS Spike Throwaway` and its chat remain in your ST install; delete if not wanted.
- The temporary World Info test entry (`qstickytest`, uid 4, on the `Eldoria` lorebook) was already removed during plan 01-06; no action needed there.

## Post-decision code review

Phase 01's code review (`01-REVIEW.md`, 1 critical, 4 warning, 4 info) ran after this route was approved. One finding (WR-01) affected evidence quality directly: `diff-captures.mjs`'s Chat Completion branch never diffed body keys outside `{role, name, content}` per message, so the matrix's `STRICT DIFF: none` claims for CC combos only checked message content. Fixed the tool and re-ran it against the already-saved dump files (static JSON, no server needed) — **result unchanged**: all CC baseline combos and the sticky-activation-turn dump still show zero body-key differences; the squash-ON gap is still message-content-only. Full account in `captures/MATRIX-RESULTS.md` and `captures/BEHAVIOR-RESULTS.md` "Post-review strictness fix". The critical finding (CR-01, narrow secret-redaction allowlist) was checked empirically against every committed dump with two independent broader patterns — no unredacted secret-shaped values found — and the spike's redaction was broadened as defense-in-depth regardless.

**The route decision (R1, APPROVED) is unaffected.** No open code-review finding bears on criteria a, c, or d (the hard blockers); the one finding that touched criterion b's evidence was re-verified with the same result.
