---
phase: 01-route-verification-spike
reviewed: 2026-10-25T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - spike/README.md
  - spike/index.js
  - spike/manifest.json
  - spike/st-imports.js
  - spike/tools/check-exports.mjs
  - spike/tools/diff-captures.mjs
findings:
  critical: 1
  warning: 4
  info: 4
  total: 9
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-10-25
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Reviewed as throwaway, read-only diagnostic tooling per the phase's explicit scope decision (not shipping code). No command injection, `eval`, or `innerHTML`/XSS writes were found anywhere in the reviewed files — the only DOM access is a read (`outerHTML` for hashing) and `getComputedStyle` reads, which is consistent with the "read-only probe" claim in `index.js:2`. The already-noted `structuredClone` → `jsonClone` fix is present and the rationale is documented (`index.js:44-53`).

The most consequential finding is that the hardcoded secret-redaction key list (`REDACT_KEYS`) is narrow and the tool's own README frames its output as "preserved, re-runnable evidence" — i.e. these JSON dumps are meant to persist and likely end up committed as phase evidence, so an incomplete redaction list is a real credential-exposure risk, not just a style nit. The second most consequential finding is that `diff-captures.mjs`'s chat-completion branch is less "strict" than advertised: it only compares three fields per message and never diffs the rest of the request body, which is exactly the kind of silent gap that could produce a false "routes are equivalent" conclusion — the central question this spike exists to answer. Remaining findings are narrower correctness/robustness gaps in the interactive helper functions and the dev tooling scripts.

## Critical Issues

### CR-01: Secret-redaction key list is incomplete for data that is meant to be preserved as evidence

**File:** `spike/index.js:19,104`
**Issue:** `REDACT_KEYS = ['proxy_password', 'custom_include_headers', 'api_key', 'custom_url']` is the only thing standing between live ST generation payloads and files written to disk via `/api/files/upload` (`dump()`, line 103-125). The README (`spike/README.md:43-45`) and its own top line ("Preserved, re-runnable evidence for the R1 vs R2 generation-route decision", line 3) make clear these dumps are intended to be kept and reused as proof for the phase decision — i.e. likely committed into the repo as evidence, not just transient debug output. A hardcoded, exact-key-name allowlist is brittle: ST has other credential-bearing settings fields used by its various chat-completion presets (e.g. a reverse-proxy endpoint URL field that is a *different* key from `custom_url`/`proxy_password` and can itself embed a token/password in the URL for self-hosted setups) that are not in this list. Because `captured` is a live snapshot of real `generate_data`/`oai_settings`, any secret-bearing field whose key name doesn't exactly match one of these four strings is written to disk and, per the stated intent, potentially committed as "evidence" un-redacted.
**Fix:** Before relying on any dump as committed evidence, manually diff a raw (pre-redaction) dump against the redacted one for whichever backend/preset was actually exercised, and verify by inspection that no secret-shaped value survived. Consider redacting by value-shape too (e.g. anything under a key matching `/key|token|password|secret|proxy/i`) as a defense-in-depth backstop rather than an exact 4-string allowlist:
```js
const REDACT_KEY_RE = /key|token|password|secret|proxy|auth/i;
const replacer = (k, v) => (REDACT_KEY_RE.test(k) ? '[redacted]' : v);
```

## Warnings

### WR-01: `diff-captures.mjs` chat-completion branch is not actually a "strict diff"

**File:** `spike/tools/diff-captures.mjs:47-64` (compare with the text-completion branch at `73-80`)
**Issue:** The script's own banner comment and README both call this a "strict prompt diff" (`spike/README.md:51`, `diff-captures.mjs:2`). For text-completion payloads (array is empty / `else` branch), the script correctly diffs *every* top-level body key via `sortKeys`/`norm` (lines 73-80), flagging any field other than `stream` that differs. For chat-completion payloads (the `if (Array.isArray(...))` branch, lines 47-64), it only ever compares `{ role, name, content }` per message and never compares any other top-level body field (model, temperature, logit_bias, stream, tool definitions, etc.) between the queued and native captures. A real difference anywhere outside those three per-message fields — exactly the kind of regression this spike exists to catch for the R1-vs-R2 route decision — would be silently reported as `STRICT DIFF: none`.
**Fix:** Add a body-level key diff to the chat-completion branch mirroring the text-completion branch, e.g. diff `Object.keys(a)` / `Object.keys(b)` excluding `prompt`, the same way lines 73-80 do, so chat-completion payloads get the same strictness guarantee as text-completion ones.

### WR-02: `send()` always targets the `textgenerationwebui` endpoint for any non-openai backend

**File:** `spike/index.js:70-72,289-303`
**Issue:** `backendKey()` collapses every `mainApi` that isn't `'openai'` into `'tc'`, and `send()`'s `else` branch unconditionally calls `getGenerateUrl('textgenerationwebui')` (line 291) for that whole bucket. ST's text-completion-style backends aren't limited to `textgenerationwebui`/llama.cpp (e.g. NovelAI, KoboldAI/Horde use different generate routes). If this spike is ever run against one of those backends, `send()`'s "own transport" request goes to the wrong URL, and the resulting `transport`/`abort` dump would misrepresent the route-equivalence result for that backend while looking like a normal, successful capture.
**Fix:** Either assert `mainApi === 'textgenerationwebui'` explicitly in `send()` and fail loudly for other non-openai backends, or branch `getGenerateUrl(...)` on the actual `mainApi` value instead of hardcoding the string.

### WR-03: `stableStringify` marks any revisited (non-cyclic) object reference as circular

**File:** `spike/index.js:82-94`
**Issue:** `seen` is a single `WeakSet` populated for the lifetime of one `walk()` call and never removed from after a branch finishes (no backtracking). This correctly prevents infinite recursion on true cycles, but it also means any object referenced twice in a DAG-shaped structure (not actually circular, just shared, e.g. the same sub-object appearing in two array slots) gets serialized as `'[circular]'` the second time it's visited, discarding its real content from the hash input. Since `before`/`after` snapshot hashes (`index.js:136-137`) are the mechanism several callers rely on to assert "nothing else changed" (`compareSnapshots`, line 153-158), a false `'[circular]'` substitution can mask genuine content differences inside a shared sub-object between the two snapshots.
**Fix:** Pop the current node from `seen` after walking its children (stack-based cycle detection) instead of leaving it marked for the whole traversal:
```js
const walk = (v, stack = new Set()) => {
    if (v && typeof v === 'object') {
        if (stack.has(v)) return '[circular]';
        stack.add(v);
        const out = Array.isArray(v) ? v.map((x) => walk(x, stack)) : Object.fromEntries(Object.keys(v).sort().map((k) => [k, walk(v[k], stack)]));
        stack.delete(v);
        return out;
    }
    return v;
};
```

### WR-04: `state.ownController` is unconditionally overwritten, orphaning `abortOwn()`'s target

**File:** `spike/index.js:195,257,333-338`
**Issue:** Both `capture()` (line 195) and `send()` (line 257) unconditionally replace `state.ownController` with a fresh `AbortController`, and `abortOwn()` (lines 333-338) always aborts whichever controller is currently referenced. If an operator triggers `send()` (or a second `capture()`/`overlap()`) while a prior request is still in flight, the earlier request's controller reference is lost — `abortOwn()` can no longer cancel it, and will instead abort the newer request. Given `overlap()` is specifically designed to run a held capture concurrently with other operator actions (`index.js:356-389`), this is a plausible sequence during actual spike usage, not just a theoretical misuse.
**Fix:** Either throw if `state.ownController` is already set and not yet settled, or track controllers in a small collection (`Set`) so `abortOwn()` can target a specific in-flight request rather than "whichever is currently referenced."

## Info

### IN-01: Unused re-exports in `st-imports.js`

**File:** `spike/st-imports.js:4,8-12,17-18`
**Issue:** `Generate`, `stopGeneration`, `getGeneratingApi`, `getGeneratingModel`, `ensureSwipes`, `updateSwipeCounter`, `parseReasoningFromString`, and `extension_settings` are re-exported but never imported or used anywhere in `index.js`.
**Fix:** Drop the unused re-exports, or if they're intentionally kept available for ad-hoc console exploration during the spike, note that explicitly in a comment so a future reader doesn't assume they're load-bearing.

### IN-02: `overlap()` report field `nativeStopWorked` is always `null`

**File:** `spike/index.js:381`
**Issue:** `report.nativeStopWorked` is initialized to `null` and never assigned anywhere else in `overlap()`. An operator reading an `overlap` dump could reasonably assume this field reflects an actual check that was performed.
**Fix:** Either implement the check (e.g. compare `isGenerating()`/`swipeState` before and after a simulated stop) or remove the field until it's implemented, to avoid a misleading always-null signal in evidence data.

### IN-03: `check-exports.mjs` doesn't handle `as`-aliased re-export names

**File:** `spike/tools/check-exports.mjs:14,43-48`
**Issue:** The outer regex (line 14) captures the raw text inside `export { ... } from '...'` and splits only on commas (no handling of `foo as bar`). If `st-imports.js` ever re-exports an aliased name (it doesn't today), `names` would contain the literal string `"foo as bar"`, and the `declRe` built from it (line 44) would never match a real declaration in the target file, producing a false `MISSING` for a name that is actually exported.
**Fix:** Split each entry on `/\s+as\s+/` and check the target-side (post-`as`) name against the local declaration name (pre-`as`), mirroring the handling already done for `blockNames` at lines 38-41.

### IN-04: `diff-captures.mjs` `load()` unwraps a `.captured` property the actual dump format never has

**File:** `spike/tools/diff-captures.mjs:8-11`
**Issue:** `load()` checks `obj.captured ? obj.captured : obj`, but the dumps actually produced by `index.js` (`dump(fileName('queued', label), captured)` at `index.js:231`, and the `native` dump at `index.js:346`) write the captured object directly — there is no wrapping `{ captured: {...} }` envelope anywhere in the producer code. The branch is always a no-op given the current pipeline, which is harmless but suggests either a stale assumption from an earlier design or a dead code path left over from edits.
**Fix:** Remove the `.captured` unwrap if it's confirmed unused, or add a brief comment stating what producer/shape it was meant to support if it's intentionally kept for forward compatibility.

---

_Reviewed: 2026-10-25_
_Reviewer: Claude (bm-code-reviewer)_
_Depth: standard_
