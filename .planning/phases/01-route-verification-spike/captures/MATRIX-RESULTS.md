# 4-Combination Capture Matrix Results

Run 2026-10-25 against live ST 1.19.0 (`06bde939f`) + llama-server (dolphin-2.9-llama3-8b Q8, `--jinja`), via Claude in Chrome against `http://127.0.0.1:8001`. Character `QS Spike Throwaway`, temperature 0, max response length 64, CC "Squash system messages" OFF, no logprobs requested, Instruct Mode OFF for TC.

| Backend | Streaming | Shape | Cleaned length | Snapshot equal | Side-effect events | Strict diff (queued vs native) | Classification |
|---|---|---|---|---|---|---|---|
| cc | stream | `generator` | 141 | true | 0 | none | n/a (no diff) |
| cc | nostream | `json` | 141 | true | 0 | none | n/a (no diff) |
| tc | stream | `json` | 78 | true | 0 | none | n/a (no diff) |
| tc | nostream | `json` | 78 | true | 0 | none | n/a (no diff) |

Shapes match the plan's own expectation table exactly: only CC stream ON returns a generator; the other three return parsed JSON (`spike/index.js` `send()`; TC streaming is consumed through the spike's own fetch/transport handling, not ST's native EventSource reader, so its shape is `json` even with the TC streaming checkbox ON).

TC prompt diffing compares the full request body (`diff-captures.mjs` `Text Completion` branch: "Body keys that differ (expect `stream` only)"); both TC rows reported `(none)`, meaning even the `stream` key itself matched between queued and native dumps for this backend/version combination — no gap, not just an expected one.

All 4 `qs-*-queued.json` / `qs-*-native.json` pairs are byte-identical after normalization (`STRICT DIFF: none`). Dumps are in this directory: `qs-{cc,tc}-{stream,nostream}-{queued,native,snapshot,transport}.json` (16 files, `proxy_password`/`custom_include_headers`/`api_key` grep confirms no unredacted secret values).

## Draft leakage

Pitfall 9 check ran on combo `cc nostream`: `QS-DRAFT-MARKER` was typed into the chat input box before step A and left there through steps A-C (capture, send, native swipe-right).

```
grep -c "QS-DRAFT-MARKER" qs-cc-nostream-queued.json  -> 0
grep -c "QS-DRAFT-MARKER" qs-cc-nostream-native.json  -> 0
```

No leak into either the dry-run-captured prompt or the prompt the native swipe actually sent. The input box still held the marker text, untouched, after the native swipe completed. **Pass** — draft input does not enter a swipe prompt (confirms assumption A8).

## Criterion verdicts a/b/c

Criteria numbering from `01-RESEARCH.md` "Go/No-Go Criteria: Concrete Checks".

**a — Dry-run capture has no visible side effects (CC and TC). Blocker for R1: YES.**
**PASS.** All 4 `capture()` calls returned `equal: true` (snapshot before == after: chat hash, swipe_id, swipe count, gen_started/gen_finished, scrollTop, last-message DOM hash, Stop-button display, swipe-arrow display, Send-disabled state, `isGenerating()`, swipe state) and `sideEffectEvents: 0` (no `MESSAGE_RECEIVED`/`MESSAGE_SWIPED`/`CHARACTER_MESSAGE_RENDERED` in the event log across all 4 runs). Visual confirmation during each combo: no streamed text appeared, Stop button stayed hidden, Send stayed enabled.

**b — Captured prompt matches native swipe prompt. Blocker for R1: gaps acceptable if documented.**
**PASS, no gaps.** `diff-captures.mjs` strict diff was `none` for all 4 combos — better than the "gaps acceptable" bar the criterion allows. Scope actually tested here: squash OFF (set per 01-04), no World Info sticky activation triggered by this entry's test keyword during these runs, and the draft-marker no-leak check (above) covers the one condition this plan's task explicitly probes. Squash-ON and WI-sticky-active variants are out of scope for this plan; `01-06-PLAN.md` covers runtime behavior evidence for abort safety, stop, and auto_swipe separately, and World Info sticky-gap measurement is not re-run here — if a future plan needs that specific gap measured, it is not covered by this matrix run.

**c — Both return shapes handled. Blocker for R1: YES.**
**PASS.** CC stream ON -> `typeof r === 'function'` (generator, consumed to completion, cleaned length 141, matches CC nostream's 141 given temperature 0 / fixed seed-equivalent greedy decode and identical prompt + max_tokens). CC stream OFF -> JSON object with `choices` (via `send()`'s JSON path, cleaned length 141). TC stream ON and OFF -> both JSON via the spike's own fetch transport (cleaned length 78 for both, consistent since TC output is raw completion text, not CC's chat-formatted reply). All 4 produced non-empty `cleanedText` and no exceptions in `send()` (`aborted: false` for all 4).

**Overall:** No hard blockers found against R1 on the criteria this plan tests (a, c). Criterion b passed with zero gaps in the scope tested. Criteria d, e, f are covered by `01-06-PLAN.md` (abort safety, stop, auto_swipe) and `SOURCE-FINDINGS.md` (interceptor parity, already verdicted NOT achievable from source — criterion e, non-blocking).
