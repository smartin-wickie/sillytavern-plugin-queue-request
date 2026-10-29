---
phase: 05-compatibility-release
fixed_at: 2026-10-28T00:00:00Z
review_path: .planning/phases/05-compatibility-release/05-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 5: Code Review Fix Report

**Fixed at:** 2026-10-28
**Source review:** .planning/phases/05-compatibility-release/05-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 2 (0 critical, 2 warning)
- Fixed: 2
- Skipped: 0
- Test suite after fixes: 17 files, 271 tests passing (`npx vitest run`)

## Fixed Issues

### WR-01: Gap toast double-escapes extension names

**Files modified:** `src/gapWarning.js`, `index.js`, `test/gapWarning.test.js`
**Commit:** fdc68a9
**Applied fix:** Removed `escapeName` so interceptor names go into the toast as plain text. `maybeWarn` now passes `escapeHtml: true` in its toast options, and the `index.js` warning wrapper forces `escapeHtml: true` after spreading opts. The toast therefore stays safe even if ST's global toastr option changes. The two escape tests were replaced with one test that checks `Foo & Bar` and `Bob's <Helper>` are passed through raw. The 10s-timeout test now also asserts that `escapeHtml: true` is passed. IN-05 was fixed while editing this test file: the "toast throws" test now asserts that storage is not marked and that a later call with a working toast warns.

### WR-02: `noCascade.test.js` contains assertions that can never fail

**Files modified:** `test/noCascade.test.js`
**Commit:** fb53125
**Applied fix:** Removed the unwired `stub`/`continueClicks` and the dead `Generate.mock.calls` loop. `st-bridge.js` is now mocked so the real `appendSwipe` runs inside the runner drain, and `bridge.Generate` and `ctx.generate` can actually be reached from the appender. There are three behavioural tests:
- autoJump off: no `swipe.to`, `swipe.right` or generate call.
- autoJump on while the user is on the last swipe: `swipe.to` targets 1, 2 and 3, and each target already existed when the call was made.
- autoJump on while the user is on an older swipe: no navigation.

The static scan now covers every `src/*.js` file plus `index.js`. It looks for `Generate(` and `.generate(`, and the only call it allows is the dry run in adapter.js.

To check that the tests can fail, each guarded behaviour was broken on purpose and then reverted with `git checkout`:
- An extra `c.generate()`/`bridge.Generate()` in the appender failed 3 tests.
- `forceSwipeId` set past the end failed the existing-target test.
- Dropping the "user on the last swipe" condition failed the older-swipe test.
- A `getContext().generate(...)` added in `queueActions.js` failed the static scan.

## Out of scope (not attempted)

IN-01, IN-02, IN-03, IN-04, IN-06, IN-07 and CV-01..03 are Info/Convention findings, so `fix_scope` is `critical_warning`. IN-01 ("may not run" wording) sits on the same line WR-01 touched. It was left alone because it is a separate copy change.

---

_Fixed: 2026-10-28_
_Fixer: Claude (bm-code-fixer)_
_Iteration: 1_
