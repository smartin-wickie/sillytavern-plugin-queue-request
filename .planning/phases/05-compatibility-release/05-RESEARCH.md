# Phase 5: Compatibility & Release - Research

**Researched:** 2026-10-28
**Domain:** SillyTavern extension compatibility verification, gap warning toast, README/release packaging
**Confidence:** HIGH (code and ST source read directly in this session); MEDIUM for UserSwipes (not installed locally)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Claude drives the browser (Claude in Chrome) against the user's running ST 1.19.0 instance. The user watches. The plan must include a step to confirm the ST URL and that the browser tools are connected before testing.
- **D-02:** Pass bar is a smoke test per extension: queue 2-3 swipes with the extension enabled. Pass = every item appends as a swipe page, the pager total is correct, no console errors from either extension, and the other extension still does its own job.
- **D-03:** Third-party extensions (Deep-Swipe, UserSwipes, and others) are already installed. Baseline run first with all external (third-party) extensions disabled. Then enable one extension at a time and run the smoke test. Then do one combined run with all listed extensions enabled (Prompt Inspector stays disabled, because the extension pauses while it is on).
- **D-04:** Record results in `.planning/phases/05-compatibility-release/05-COMPAT-MATRIX.md`. Columns: extension, version or commit, case, result, notes, evidence (console excerpt or screenshot/GIF path). The README links to or summarizes this matrix.
- **D-05:** Fold Phase 4's 4 pending HUMAN-UAT checks into the same live session (CR-02 takeover reload, CR-03 ids over plain HTTP, demote-then-takeover restore, WR-01 background-tab throttling). Record results back in `.planning/phases/04-lifecycle-persistence-spend-safety/04-HUMAN-UAT.md`. If a check cannot be automated (for example, a second LAN device for plain HTTP), mark it for the user to do by hand and say why.
- **D-06:** Build one combined, non-modal warning toast, shown once per browser session, on the first queue action when any known gap is active. It lists every active gap: `power_user.auto_swipe` on (via `getContext().powerUserSettings.auto_swipe`); any enabled extension declares `generate_interceptor` (check `getExtensionManifest(name)?.generate_interceptor` per enabled extension; name the extensions); Chat Completion "squash system messages" on.
- **D-07:** The warning never blocks queueing. It only informs.
- **D-08:** Prove COMP-02 with a live test and a unit test. Live: auto-swipe with a minimum length far above the model's typical reply, plus auto-continue on; queue 3; swipe count grows by exactly 3 and no extra generations start. Unit: the runner never calls `swipe()`, never triggers continue, never starts a non-dry `Generate`.

### Claude's Discretion
- README structure, audience and depth. Must cover install, usage, settings, fidelity gaps. No prompt-cache savings claims (COMP-04). Do not carry PROJECT.md line 51 ("cache-friendly") into the README.
- Release packaging: version bump, `homePage`, LICENSE, author field. Minimal; ask user before choosing a license or publishing anything.
- Exact toast wording (UI-SPEC style, `preventDuplicates`), how "once per session" is stored (in-memory or `sessionStorage`).
- How the squash setting is read via `src/st-bridge.js`.

### Deferred Ideas (OUT OF SCOPE)
None.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| COMP-01 | Verified alongside Deep-Swipe, UserSwipes, Prompt Inspector (disabled), Vectors, TTS, Summarize; test matrix | Live session plan below; installed-extension inventory; UserSwipes is NOT installed locally (see Environment Availability) |
| COMP-02 | No auto-swipe / auto-continue cascades | ST source citations for both trigger sites; code scan of `src/`; gap-warning design; unit + live test |
| COMP-04 | README documents install, usage, fidelity gaps; no cache-savings claims | README content inventory; gap list with sources |
</phase_requirements>

## Summary

Phase 5 is small in code and large in live verification. Code work: one bridge helper that reports active gaps, one pure module that formats the combined toast and gates it to once per session, one call site in `enqueue()`, one unit test file for the COMP-02 guarantee. Non-code work: a Claude-in-Chrome session against the user's ST (the spike used `http://127.0.0.1:8001`), a README, and minimal manifest packaging.

The COMP-02 guarantee holds by construction. Auto-swipe is evaluated only in `StreamingProcessor.onFinishStreaming` and the non-streaming `Generate` success path; auto-continue is triggered only by `triggerAutoContinue()` called from the `Generate` success paths, and it works by clicking `#option_continue` [VERIFIED: E:\SillyTavern\public\script.js:3812, 5442, 5567, 5578, 5783-5792]. The queue runner only calls a dry-run `Generate('swipe', {signal}, true)` (src/adapter.js:45) and an own transport. A grep of `src/` and `index.js` for `swipe.right`, `option_continue`, `triggerAutoContinue` returned nothing; the only swipe call is `c.swipe.to(...)` in `src/appender.js:60`, a display-only page change gated on the auto-jump setting [VERIFIED: codebase grep]. The dry run returns before the completion paths [CITED: SPIKE-REPORT.md G1; spike showed swipe count unchanged].

**Primary recommendation:** Add `activeGaps()` to `src/st-bridge.js`, a pure `src/gapWarning.js` (format + once-per-session gate, injected storage), call it from `enqueue()` after the refusal checks, and write the COMP-02 unit test as a static source-scan guard plus a runner-level spy test. Run the live session as one checkpoint plan with ordered sections (preflight, baseline, per-extension, combined, COMP-02 cascade, HUMAN-UAT), logging each row to the matrix as it goes.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Gap detection (auto_swipe, interceptors, squash) | Browser (st-bridge.js) | — | All reads come from ST in-page state |
| Gap toast formatting + once-per-session gate | Browser (pure module) | sessionStorage | Pure logic, unit-testable with injected storage |
| Toast display | Browser (toastr via index.js) | — | Existing `toast.warning` injection |
| Compat matrix / UAT | Manual+browser automation | — | Needs live ST |
| README / manifest | Repo docs | — | Static |

## Standard Stack

No new runtime dependencies. Existing: vanilla ES modules, Vitest ^5.0.5 (package.json), `toastr` global, `SillyTavern.getContext()`. Nothing to install, so no Package Legitimacy Audit is needed. **Package Legitimacy Audit:** none (no external packages added this phase).

## Architecture Patterns

### Flow: first queue action -> gap warning

```
Queue click / wand / /queueswipe
        |
   enqueue(store, runner, count)       src/queueActions.js:22
        |-- readOnly? -> toast, return
        |-- promptInspector? -> refuse toast, return
        v
   gapWarning.maybeWarn({bridge, toast, storage})     (NEW, after refusals, before/after add; never blocks)
        |-- already shown this session? -> return
        |-- bridge.activeGaps() -> { autoSwipe, interceptors[], squash }
        |-- none active? -> return (do NOT mark shown; a gap enabled later still warns)
        |-- format one combined message -> toast.warning (preventDuplicates)
        '-- mark shown (sessionStorage 'qs_gap_warned' = '1', in-memory fallback)
        v
   store.add(...) ; runner.wake()
```

### Recommended additions
```
src/st-bridge.js     + autoSwipeEnabled(), squashEnabled(), activeInterceptors(), activeGaps()
src/gapWarning.js    NEW pure: formatGapMessage(gaps), createGapWarner({storage})
src/queueActions.js  call warner inside enqueue()
test/gapWarning.test.js, test/noCascade.test.js, test/queueActions.test.js (extend)
README.md, LICENSE (user decision), manifest.json (homePage, version)
```

### Reading the settings (all verified in ST 1.19.0 source at E:\SillyTavern)

| Setting | Read from | Source |
|---------|-----------|--------|
| auto-swipe on | `ctx().powerUserSettings?.auto_swipe === true` | st-context.js:229 exposes `powerUserSettings: power_user`; script.js:3812 reads `power_user.auto_swipe` |
| auto-continue on (optional info only) | `ctx().powerUserSettings?.auto_continue?.enabled` | power-user.js:127-131 (`enabled`, `allow_chat_completions`, `target_length`); script.js:5717 |
| squash on | `ctx().chatCompletionSettings?.squash_system_messages === true` (this is `oai_settings`, st-context.js:227); the bridge already imports `oai_settings` so `oai_settings.squash_system_messages` also works | openai.js:497 default false, :1608 `if (oai_settings.squash_system_messages && dryRun == false)`, :7030 UI handler |
| interceptor extensions | iterate `extensionNames`, skip `extension_settings.disabledExtensions`, `getExtensionManifest(n)?.generate_interceptor`, then confirm `typeof globalThis[key] === 'function'` | extensions.js:524 (`getExtensionManifest` returns a clone), :2033-2037 (`runGenerationInterceptors` filters the same way and requires the global to be a function) |

**Squash only matters when `mainApi === 'openai'`** (Chat Completion). Gate it with `ctx().mainApi === 'openai'` so a Text Completion user with a stale CC setting is not warned [ASSUMED: squash is a CC-only setting; openai.js location supports it, but a mainApi gate is a judgment call].

Interceptor detection pattern (matches existing `promptInspectorEnabled()` style, try/catch, fail to "none"):

```js
// Source: pattern of src/st-bridge.js:105 + extensions.js:2033-2037
export function activeInterceptors() {
  try {
    const disabled = extension_settings.disabledExtensions ?? [];
    return (extensionNames ?? [])
      .filter((n) => !disabled.includes(n))
      .map((n) => getExtensionManifest(n))
      .filter((m) => m?.generate_interceptor && typeof globalThis[m.generate_interceptor] === 'function')
      .map((m) => m.display_name ?? m.generate_interceptor);
  } catch { return []; }
}
```

Known interceptor declarers on this install: bundled `vectors` (`vectors_rearrangeChat`) and `stable-diffusion` (`SD_ProcessTriggers`); third-party Extension-Randomizer, Extension-WebSearch, SillyTavern-MessageSummarize [CITED: SPIKE-REPORT.md "Interceptor gap"]. Grep of bundled manifests this session confirmed only `stable-diffusion` and `vectors` declare it [VERIFIED: grep of scripts/extensions/*/manifest.json].

Pitfall: Vectors' interceptor is a no-op when Vector Storage itself is turned off in its settings, but the manifest check cannot see that. Word the toast as "may not run" rather than "will not run" to avoid a false claim. Wording suggestion (UI-SPEC style: static literals, display names inserted as text only):

`Heads up: queued swipes skip some features. Auto-swipe filtering is not applied. Prompt interceptors (Vector Storage, MessageSummarize) do not run on queued swipes. System-message squashing is not applied.` Include only the lines for active gaps. Use `toastr.warning(msg, '', { preventDuplicates: true, timeOut: 10000 })`. Display names come from third-party manifests, so escape or use toastr's text only (toastr renders HTML; pass names through a small escape or strip `<>&"`), matching UI-SPEC rule that interpolated values are never raw HTML [CITED: 04-UI-SPEC.md line 93].

"Once per session": use `sessionStorage` (a browser session = the tab's session; survives reload, which is the desirable reading of "once per browser session") with an in-memory boolean fallback when storage throws, same try/catch style as `index.js` localStorage handling. Decision for planner: warn once per tab session; do not persist across sessions.

### Anti-patterns
- Do not mark the warning "shown" when no gap is active; a user who enables auto-swipe later should still be warned.
- Do not call the warner from the runner or lifecycle (restore/resume paths). The decision says "first queue action"; keep it in `enqueue()` only. `resumeQueue()` may stay unwarned.
- Do not add a settings toggle for the warning; not requested.

## Why the runner cannot trigger auto-continue / auto-swipe

- Auto-continue: `triggerAutoContinue()` (script.js:5783) returns early for group chat, else `shouldAutoContinue()` (script.js:5716) checks `power_user.auto_continue.enabled`, target_length, chat-completion allowance, and an empty input box, then does `$('#option_continue').trigger('click')`. It is called only at script.js:5442 and 5578, inside `Generate`'s success handlers [VERIFIED: ST source].
- Auto-swipe: script.js:3812 (streaming finish) and script.js:5567 (non-streaming success), both inside the native completion path [VERIFIED].
- The extension's non-dry calls: none. `src/adapter.js` calls `bridge.Generate('swipe', {signal}, true)` only (dry run, returns before completion handling), then own transport [VERIFIED: codebase].
- `appender.js:60` calls `c.swipe.to(...)` only for display, when auto-jump is on. It does not call Generate. Worth watching in the live test that this does not itself fire anything.
- Default auto-continue config is off, `target_length: 400` [VERIFIED: power-user.js:127-131]. Chat Completion additionally needs `allow_chat_completions` [VERIFIED: script.js:5747]. For the live COMP-02 test, the user's backend is CC (spike used CC), so set `allow_chat_completions` true too, otherwise the auto-continue arm is silently inert and the test proves nothing. Also auto-continue requires an empty input box (script.js:5756) and a non-group chat.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Toast dedupe | Own dedupe | toastr `preventDuplicates` + session flag |
| Enabled-extension list | DOM scraping | `extensionNames` + `extension_settings.disabledExtensions` + `getExtensionManifest` (already imported in st-bridge.js) |
| Cascade proof | Mock-only unit test | Live test using the spike setup (min length 5000) |
| Screenshots/GIFs | Manual capture | claude-in-chrome `gif_creator`/screenshot tools |

## Unit test design for COMP-02

Two complementary tests (no ST needed; follow the existing `vi.mock('../src/adapter.js')` pattern in runner.test.js):

1. **Runner spy test** (`test/noCascade.test.js`): build the runner with a fake bridge whose `ctx().swipe = { right: vi.fn(), to: vi.fn() }`, `Generate: vi.fn()`, and a global `$`/`document` stub counting `#option_continue` clicks. Inject fake `generate`/`append` that resolve successfully for 3 items; run to drain; assert `swipe.right` and `Generate` (non-dry, i.e. any call whose third arg is not `true`) never called and no continue click. Adapter is mocked, so also assert the real adapter's call shape in test 2.
2. **Source guard test**: read `src/*.js` + `index.js` with `fs`, strip the `st-bridge.js` import list, and assert none contains `triggerAutoContinue`, `option_continue`, `swipe.right(`, `.right(`, or `Generate(` with a non-dry third argument. In `adapter.js` assert the only `Generate(` call matches `/Generate\('swipe',\s*\{[^}]*\},\s*true\)/`. This is cheap, deterministic, and catches future regressions. Mark as intentionally textual [ASSUMED: acceptable style for this repo; no precedent in test/].

Run: `npm test` (`vitest run`). Test layout: flat `test/*.test.js`.

## Live test session structure (checkpoint plan)

One plan, `type: checkpoint` style, Claude drives via claude-in-chrome (load the `claude-in-chrome` skill first). Ordered sections; every section appends rows to `05-COMPAT-MATRIX.md` immediately so a crash loses nothing.

0. **Preflight (blocking):** confirm ST URL with the user (spike used `http://127.0.0.1:8001`; ST dir E:\SillyTavern) [CITED: BEHAVIOR-RESULTS.md]; confirm browser tools connected; confirm ST 1.19.0; use a throwaway character/chat with an AI last message (the spike used a throwaway character "QS Spike Throwaway"; reuse it so no real chats are touched); note the backend. Spend: spike used a local llama.cpp backend (zero spend, T-01-17). Ask the user which backend to use; COMP-02 cascade test can burn tokens on a paid backend, so strongly prefer local, and have `stopGeneration()` ready.
1. **Snapshot state to restore:** record `extension_settings.disabledExtensions`, `power_user.auto_swipe`, `auto_swipe_minimum_length`, `auto_continue.*`, `squash_system_messages` before changing anything; restore at the end (spike did the same, SPIKE-REPORT "Pre-spike state to restore").
2. **Baseline:** disable all third-party extensions (not Queued Swipes), reload, queue 3, check pager total and console. Disabling goes through the Extensions manager UI or `extension_settings.disabledExtensions` + reload.
3. **Per-extension smoke (one at a time):** Deep-Swipe, UserSwipes, Vector Storage (bundled, enable its option), TTS (bundled; needs a provider configured, e.g. browser/system TTS), Summarize (bundled `memory` extension; also MessageSummarize third-party declares an interceptor, treat it as a separate row), Prompt Inspector (case: installed but **disabled**; plus one extra case: toggled ON confirms the existing pause/refuse behavior, optional). For each: queue 2-3, record result per D-02 plus "other extension still does its job" check (e.g. TTS reads a normal swipe; Vector Storage injects on a native swipe; Summarize runs).
4. **Combined run:** all listed enabled, Prompt Inspector disabled.
5. **COMP-02 live cascade:** set `auto_swipe` on, `auto_swipe_minimum_length` 5000 (spike value), `auto_continue.enabled` on with `allow_chat_completions` on if CC and `target_length` above reply length, empty input box. Record swipe count N. Queue 3. Wait until drained. Expect swipes N+3 exactly, no extra `is_send_press`/generation, no console cascade. Optional control: do one native swipe first to prove the setup would cascade (spike: 14 in 3 s, 23 before stop) — but this burns generations; keep it short and press Stop. Also verify the D-06 toast appears once with the auto-swipe line. Restore settings.
6. **Gap toast checks:** with auto-swipe off/squash off/no interceptors it would not fire; with Vector Storage enabled it should list interceptors; reload tab and confirm sessionStorage behavior; open a new tab and confirm it warns again.
7. **Folded Phase 4 HUMAN-UAT** (04-HUMAN-UAT.md, 4 items):
   - #1 CR-02 takeover reload and #3 demote-then-takeover: need two tabs of the same ST (automatable with two Chrome tabs; the extension uses localStorage ownership shared across same-origin tabs). Claude can drive both tabs.
   - #4 WR-01 background throttling: leave the owner tab hidden several minutes (open a second tab in front). Automatable but slow; Chrome throttles timers in background tabs after about 5 minutes of hidden time [ASSUMED]. Plan a wait of 5-10 minutes with a queued item.
   - #2 CR-03 plain-HTTP ids: needs a non-secure context (no `crypto.randomUUID`) from another LAN device. `http://127.0.0.1` and `localhost` are secure contexts, so a loopback tab does NOT reproduce it [ASSUMED: standard secure-context rule; verify]. Mark as manual for the user unless Claude can reach ST at the machine's LAN IP from Chrome (`http://<LAN-IP>:8001`, which is an insecure context and would reproduce it, if ST is listening beyond loopback and whitelist allows). Try the LAN IP in the same Chrome first; fall back to user-by-hand.
   Update `04-HUMAN-UAT.md` result lines and its Summary counts, and set front-matter `status` accordingly.
8. **Restore state**, write matrix summary, screenshots/GIFs saved under `.planning/phases/05-compatibility-release/evidence/` (path referenced in the Evidence column).

Matrix columns (D-04): extension | version/commit | case (baseline / solo / combined) | result | notes | evidence.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| ST instance | all live checks | assumed running (spike: 127.0.0.1:8001), install at E:\SillyTavern | 1.19.0 | none, ask user |
| Claude in Chrome | live session | to confirm at preflight | — | user performs steps by hand, Claude records |
| Deep-Swipe | COMP-01 | yes (`third-party/Deep-Swipe`) | check manifest | — |
| **UserSwipes** (Bartasx4/SillyTavern-UserSwipes) | COMP-01 | **NOT FOUND** in E:\SillyTavern\public\scripts\extensions\third-party or data\default-user\extensions; grep of manifests for "userswipe" found nothing | — | Ask the user whether it lives elsewhere; otherwise install it (the third-party installer needs a git clone or Extensions > Install). Installing a third-party extension is a user decision; do not do it silently. Installed swipe-related alternatives exist (SwipePregen 1.0.0, st-swipe-browse-all 0.3.0, Swipe Sculpt 0.2.2) but CONTEXT names UserSwipes |
| Prompt Inspector | COMP-01 (disabled case) | yes (`Extension-PromptInspector`) | — | — |
| Vector Storage / TTS / Summarize | COMP-01 | bundled: `vectors`, `tts`, `memory` (display "Summarize") | 1.19.0 | — |
| Node + Vitest | unit tests | `vitest ^5.0.5` in package.json | — | — |

**Missing with no fallback:** none. **Needs a user decision:** UserSwipes is missing; this affects the success criterion directly. The `generate_interceptor`-declaring MessageSummarize, Randomizer, WebSearch are installed and make good additional matrix rows.

Also note: the repo is both the project dir and (per `tools`/earlier phases) deployed as `third-party/queued-swipes` in the ST install (directory listing shows `queued-swipes/`); confirm it is a junction to the repo so edits are live [VERIFIED: ls shows the directory; junction status not checked].

## README content inventory (COMP-04)

Audience: SillyTavern users installing a third-party extension; tone factual. Sections:
1. What it does (one paragraph: queue swipes for the latest AI message, results append as normal swipe pages).
2. Requirements: ST >= 1.19.0 (manifest `minimum_client_version`), single-character chats only (groups excluded, `canQueue()` returns false for `groupId`), Chat Completion and Text Completion backends [ASSUMED: both supported; adapter handles both return shapes per criterion c, but confirm wording against Phase 2 summaries].
3. Install: ST Extensions > Install extension > repo URL; manual: clone to `public/scripts/extensions/third-party/` or `data/<user>/extensions/`; reload. Needs the real repo URL (user decision).
4. Usage: queue control/badge, wand menu entry "Queue swipe", `/queueswipe`, `/queuecancel`, progress bar, cancel all, resume popup after refresh, pause reasons. Take exact command names/syntax from `src/commands.js` and UI strings from `src/ui.js`, `src/pauseLabels.js` (read them when writing; not re-extracted here).
5. Settings: Enable, Max queue size, Jump to newest swipe on completion, Notification style (All/Errors only/Off), Pause after N consecutive failures (from settings.html), with defaults from `src/settings.js`.
6. Safety behavior: serial execution, queue clears on message edit/delete/new user message, persists with chat, multi-tab single owner (read-only in other tabs), pauses on Prompt Inspector, connection change prompt, circuit breaker.
7. **Known limitations / fidelity gaps** (source: SPIKE-REPORT.md, BEHAVIOR-RESULTS.md): extension interceptors do not run on queued swipes (Vector Storage, MessageSummarize, WebSearch, Randomizer, Stable Diffusion triggers); Chat Completion "Squash system messages" not applied (measured 25 vs 24 messages diff); World Info timed effects / sticky state on dry run (documented uncertainty; sticky-activation turn matched byte-for-byte in the spike); no itemized prompt / Prompt Itemization entry for queued results; auto-swipe filter not applied to queued results (and the extension never triggers auto-swipe/auto-continue); Prompt Inspector must be off (queue refuses/pauses); not for group chats; cancel discards the result app-side (an already-buffered fast response may have been paid for).
8. Compatibility: link/summary of `05-COMPAT-MATRIX.md`. Because `.planning/` may not ship, copy a short summary table into the README or move a copy to `docs/COMPATIBILITY.md` [planner decision].
9. **No cache claims.** Do not write "cache-friendly" or any savings language. Because every queued request is a full separate API call, one honest line is allowed: "Each queued swipe is a normal full request to your API and is billed as one." Also ensure no PROJECT.md-derived wording leaks in (grep README for `cache` before finishing: acceptance check `! grep -i cache README.md`).
10. License, issues link (user decisions).

## Release packaging (minimal; ask user)

Current manifest: version 0.1.0, author "seant", no `homePage`, `loading_order` 20, `minimum_client_version` 1.19.0, `hooks.activate: init` [VERIFIED: manifest.json]. package.json is `private: true` (fine; not published to npm). Proposals needing user answers (use a checkpoint:decision): license (MIT is common but is the user's choice), `homePage` repo URL, author display name, version for release (suggest 1.0.0 once matrix passes; or stay 0.x), whether to create a git tag. Do not publish or push anything. ST's third-party installer reads manifest.json from the repo root; `.planning/` and `spike/` and `test/` are harmless but could be excluded from any release; no build step exists. The spike folder has its own manifest.json (spike/manifest.json) — confirm ST does not load it from the repo root (it only loads when placed in an extensions dir).

## Common Pitfalls

1. **Auto-continue arm silently inert on CC:** needs `allow_chat_completions`, empty input, non-group. Without these the live test is a false pass. How to avoid: assert via a native `/continue`-style control or check the settings are set before queueing.
2. **Marking the gap toast shown when nothing was active** (see anti-patterns).
3. **Toast HTML injection** via a third-party `display_name`. Escape names.
4. **Disabling extensions by editing `disabledExtensions` without reload:** extensions load at startup; reload ST after toggling. Bundled `vectors` also requires its own enable checkbox.
5. **Plain-HTTP check on loopback:** localhost is a secure context, no repro (see UAT #2).
6. **Prompt Inspector's `localStorage['promptInspectorEnabled']` toggle** is separate from the extension being enabled; for the "disabled" case set it false and optionally disable the extension, then confirm `promptInspectorEnabled()` is false.
7. **Spend:** COMP-02 live test can cascade on a paid backend if the extension were wrong. Use local backend, keep Stop ready, note in the plan.
8. **Settings leakage:** restore `power_user` settings after the live test (persist through ST's own UI, which saves settings; don't edit files).
9. **Evidence retention:** GIF/screenshot files must be written into the phase dir; reference relative paths.
10. **PROJECT.md line 51** contradicts COMP-04; also update PROJECT.md or leave a note so the "cache-friendly" statement does not reach docs [VERIFIED: grep shows line 51].

## Code Examples

Once-per-session gate (pure, injected storage):

```js
// src/gapWarning.js
const KEY = 'qs_gap_warned';
export function createGapWarner({ storage }) {
  let memory = false;
  const seen = () => { try { return memory || storage?.getItem(KEY) === '1'; } catch { return memory; } };
  const mark = () => { memory = true; try { storage?.setItem(KEY, '1'); } catch { /* memory only */ } };
  return {
    maybeWarn(gaps, toast) {
      const lines = formatGapLines(gaps);
      if (lines.length === 0 || seen()) return false;
      toast.warning(lines.join(' '));
      mark();
      return true;
    },
  };
}
```
(`formatGapLines` returns the per-gap sentences; unit test with fake storage covering: no gaps -> no toast and not marked; gaps -> one toast; second call -> none; storage throwing -> memory fallback; names escaped.)

Cascade-set-up helper for the live session (run in page console via the Chrome tool):

```js
const p = SillyTavern.getContext().powerUserSettings;
Object.assign(p, { auto_swipe: true, auto_swipe_minimum_length: 5000 });
Object.assign(p.auto_continue, { enabled: true, allow_chat_completions: true, target_length: 5000 });
// Prefer toggling via the UI so ST's own handlers save settings; restore the snapshotted values afterwards.
```
[ASSUMED: direct mutation works for the read paths, since ST reads `power_user` live; the UI path is safer for persistence.]

## State of the Art / Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Squash is CC-only so gate on `mainApi === 'openai'` | Reading settings | Minor: missed/extra warning |
| A2 | `localhost`/127.0.0.1 are secure contexts so UAT #2 not reproducible on loopback | Live test | Check could be wrongly marked manual |
| A3 | Chrome throttles hidden-tab timers after ~5 min | UAT #4 | Wait time too short/long |
| A4 | Source-scan unit test style acceptable | Unit test | Style preference only |
| A5 | Both CC and TC supported (README wording) | README | Wrong README claim; verify vs. Phase 2 summaries |
| A6 | Direct mutation of `power_user` in console is OK for the test | Code examples | Settings not persisted; use UI |

## Open Questions (RESOLVED)

1. **UserSwipes is not installed at E:\SillyTavern.** Ask the user whether to install it (repo Bartasx4/SillyTavern-UserSwipes) or point to its location. Without it COMP-01 cannot be met for that row. RESOLVED: user approved install; UserSwipes is installed in 05-02 Task 2.
2. **Which backend for the live session** (local llama.cpp as in the spike, or paid)? Needed before the cascade test. RESOLVED: LM Studio, model Satyr-V0.1-4B (user decision, 2026-10-28).
3. **License, homePage, release version, repo URL** (user decisions; do not guess). RESOLVED: collected via checkpoint:decision in 05-04 Task 1.
4. **Does the user want auto-continue included in the D-06 toast?** CONTEXT lists three gaps only; auto-continue is not a fidelity gap of queued results (they are not continued), so recommended: no. RESOLVED: no auto-continue line in the toast (as decided in 05-01).
5. **Matrix copy in README:** keep `.planning/` link vs. duplicate summary in README or `docs/`. RESOLVED: README carries a short summary table plus a link to the full matrix (05-04 Task 2).

## Security Domain

Low surface (no new network, storage, or input paths). Applicable: V5 input handling for toast text built from third-party manifest `display_name` (escape; never innerHTML, per UI-SPEC rule). No secrets; README must not include API keys or captured prompt dumps. Do not commit captured prompts or screenshots containing personal chat content; use the throwaway chat.

## Sources

### Primary (HIGH)
- E:\SillyTavern\public\script.js (3812, 5442, 5567, 5578, 5711-5792), scripts\power-user.js (127-131), scripts\openai.js (497, 1608, 7030), scripts\st-context.js (227-229, 300), scripts\extensions.js (21, 524, 2024-2043), bundled manifests (grep)
- Repo: src/st-bridge.js, src/queueActions.js, src/adapter.js, src/appender.js, index.js, manifest.json, settings.html, test/ layout
- .planning: SPIKE-REPORT.md, BEHAVIOR-RESULTS.md (G1), SOURCE-FINDINGS.md, 04-HUMAN-UAT.md, 04-UI-SPEC.md

### Tertiary (LOW)
- Secure-context and tab-throttling behavior from general browser knowledge (A2, A3)

## Metadata

**Confidence:** code/ST-source findings HIGH; live-session design MEDIUM (UserSwipes absent, backend unknown); README content HIGH for gaps, MEDIUM for command/settings details to be re-read at write time.
**Research date:** 2026-10-28 | **Valid until:** ~30 days or the next ST release
