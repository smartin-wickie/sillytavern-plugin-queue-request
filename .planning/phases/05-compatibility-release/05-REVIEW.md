---
phase: 05-compatibility-release
reviewed: 2026-10-28T00:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - index.js
  - manifest.json
  - README.md
  - src/gapWarning.js
  - src/queueActions.js
  - src/st-bridge.js
  - test/gapWarning.test.js
  - test/noCascade.test.js
  - test/queueActions.test.js
findings:
  critical: 0
  warning: 2
  info: 7
  convention: 3
  total: 12
status: issues_found
---

# Phase 5: Code Review Report

**Reviewed:** 2026-10-28
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Scope was the phase 5 diff (`182518a..HEAD`): the gap-warning module and how it is wired into `enqueue()`, the three new gap probes in `st-bridge.js`, the no-cascade test, the manifest author change and the new README. I checked ST facts against the installed ST 1.19.0 tree (`E:\SillyTavern`). The probe keys are correct: `power_user.auto_swipe`, `oai_settings.squash_system_messages`, `getContext().powerUserSettings` and `mainApi`, and the `generate_interceptor` + `globalThis[fn]` pattern used by `runGenerationInterceptors`. The test suite passes (17 files, 270 tests).

I found no blockers. The main defect is that the toast text is HTML-escaped twice: ST already configures toastr with `escapeHtml: true`. The second warning is that `test/noCascade.test.js` contains assertions that cannot fail, so it overstates its COMP-02 coverage. I checked the README against src. The command names and return values, settings labels, defaults and ranges, wand labels, pause reasons, compat counts (16/0/5) and the ~48 s figure are accurate, with two small wording issues.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: Gap toast double-escapes extension names (toastr already escapes HTML in ST)

**File:** `src/gapWarning.js:8-16, 26`; `index.js:120`
**Issue:** ST 1.19.0 sets `toastr.options = { ..., escapeHtml: true }` globally (`E:\SillyTavern\public\script.js:348-360`). That means toastr already escapes the message. `formatGapLines` also runs every interceptor name through `escapeName`, so the text is escaped twice. A display name such as `Foo & Bar` or `Bob's Helper` shows up in the toast as `Foo &amp; Bar` / `Bob&#39;s Helper`. The extra escaping adds no protection because toastr already escapes. `test/gapWarning.test.js:31-41` asserts the double-escaped output, so the tests lock in the wrong rendering.
**Fix:** Pass plain text and rely on ST's global `escapeHtml: true`. If you want to protect against a future change to that global, force escaping on the call site instead:
```js
// gapWarning.js
const names = gaps.interceptors.map((n) => String(n)).join(', ');
// index.js
warning: (m, opts) => toastr.warning(m, '', { preventDuplicates: true, ...opts, escapeHtml: true }),
```
Then update the two escape tests to assert that the raw name is passed through and that `escapeHtml: true` reaches toastr.

### WR-02: `noCascade.test.js` contains assertions that can never fail

**File:** `test/noCascade.test.js:28-58`
**Issue:** The behavioural test reads as if it proves that "draining the queue never ... continues, or starts a non-dry Generate". Several of its assertions are tautological:
- `stub = { click: continueClicks }` (line 45) is not wired into the bridge, ctx, runner or any DOM. Nothing can ever call it, so `expect(stub.click).not.toHaveBeenCalled()` always passes.
- `ctx.Generate` / `ctx.generate` are not reachable either. The runner gets the injected `generate` mock, not ctx. So `expect(Generate).not.toHaveBeenCalled()` always passes.
- The loop `for (const call of Generate.mock.calls) expect(call[2]).toBe(true)` (line 56) is dead code, because the next line asserts there are zero calls.
- `append` is mocked, so the real `appendSwipe` never runs. That is the one module that calls `c.swipe.to(...)` (on the autoJump path, `src/appender.js:60`), so the `swipe.to` assertion only covers the runner.

In practice the test only shows that `runner.js` does not touch `ctx.swipe`. The source-scan tests (lines 68-80) do the real work, and they only cover `adapter.js` for `Generate(`. A `ctx().generate(...)` call (lowercase context alias) added in any other file would not be caught.
**Fix:** Remove the unwired `stub`/`continueClicks` and the dead loop. Run the real `appendSwipe` against the fake ctx, with `autoJump` both on and off, and assert that `swipe.to` is only called with `forceSwipeId` pointing at an existing swipe. Extend the static scan to every `src/*.js` and `index.js` and check for `Generate(` / `.generate(`, allowing only the one dry-run call site in adapter.js.

## Info

### IN-01: Toast wording "may not run" contradicts source and README

**File:** `src/gapWarning.js:26`
**Issue:** The toast says interceptors "may not run on queued swipes". ST skips `runGenerationInterceptors` whenever `dryRun` is true (`E:\SillyTavern\public\script.js:4562-4564`), so they never run. The README (line 62) correctly says they "do not run". The toast's hedged wording is wrong.
**Fix:** `Prompt interceptors (${names}) do not run on queued swipes, though they run on normal swipes.` and update `test/gapWarning.test.js:28`.

### IN-02: Interceptor gap fires for nearly every install because bundled interceptors are always registered

**File:** `src/st-bridge.js:140-155`
**Issue:** Bundled Image Generation (`SD_ProcessTriggers`) and Vector Storage (`vectors_rearrangeChat`) define their global as soon as they load, even when the feature is unconfigured or switched off in its own settings. As a result the gap toast fires on most installs and names extensions the user is not actually using. It only shows once per tab, so the noise is limited.
**Fix:** Optionally skip bundled interceptors whose own enable flag is off (e.g. `extension_settings.vectors?.enabled_chats`). If not, document in the README that bundled extensions are listed whenever they are loaded.

### IN-03: Dead self-exclusion and inaccurate doc comment in `activeInterceptors`

**File:** `src/st-bridge.js:136-149`
**Issue:** The JSDoc says "third-party extensions", but the loop also returns bundled ones (Vector Storage, Image Generation). The `name === 'Queued Swipes'` check is dead code because this extension's manifest has no `generate_interceptor`. Matching by display name is also brittle compared with matching by folder name.
**Fix:** Change the comment to "enabled extensions (bundled or third-party)". Either drop the self-check, or compare `n` against this extension's folder key.

### IN-04: Gap warning is one-shot across all gaps

**File:** `src/gapWarning.js:56-66`
**Issue:** A single `qs_gap_warned` flag covers every gap. If the toast fires for auto-swipe and the user turns on squash or installs an interceptor later in the same tab, nothing is shown. The README line 67 ("lists the gaps that are active") is accurate only for the first queue action.
**Fix:** Store a signature of the warned gap set (e.g. a sorted JSON of the active keys and names) and warn again when it changes. If you keep the current behaviour, say "active at that moment" in the README.

### IN-05: Test name claims an assertion it does not make

**File:** `test/gapWarning.test.js:96-106`
**Issue:** The test is named "never throws when the toast throws, and does not mark as warned", but it only checks that nothing is thrown. The "does not mark" part (which guarantees a retry on the next enqueue) is never asserted.
**Fix:** Use `memStorage()` as a named const and add `expect(storage.setItem).not.toHaveBeenCalled()`. Then check that a second `maybeWarn` with a working toast returns `true`.

### IN-06: README compat table wording is redundant

**File:** `README.md:84-85`
**Issue:** "BLOCKED (not tested, untested here)" says the same thing twice.
**Fix:** Use "BLOCKED (not installed; untested)" or simply "Untested".

### IN-07: README lists an install path that does not exist yet

**File:** `README.md:13`
**Issue:** The first install bullet describes the URL-based install and then says it is "not available yet". Users will look for a URL that does not exist.
**Fix:** Remove the bullet until the repository URL exists, or turn it into a note under the manual install step.

## Conventions

These come from `gsd-tools verify conventions --check`. They are advisory and never block a merge.

### CV-01: Swallowed catch in `maybeWarn`
**File:** `src/gapWarning.js:50`. **Convention:** architectural-split, catch-block style. **Fix:** This is deliberate (the warner must never throw). A `console.debug('[queuedSwipes]', e)` would keep it from being completely silent.

### CV-02: Swallowed catch around `gapWarner.maybeWarn`
**File:** `src/queueActions.js:35`. **Convention:** catch-block style. **Fix:** Same as CV-01. Log at debug level instead of `// ignored`.

### CV-03: File-name casing
**File:** `src/st-bridge.js:1`. **Convention:** the dominant file-name casing is camelCase (`gapWarning.js`, `queueActions.js`). **Fix:** Rename to `stBridge.js` if the project wants to follow that convention strictly. This file predates phase 5, so the change is optional.

---

_Reviewed: 2026-10-28_
_Reviewer: Claude (bm-code-reviewer)_
_Depth: standard_
