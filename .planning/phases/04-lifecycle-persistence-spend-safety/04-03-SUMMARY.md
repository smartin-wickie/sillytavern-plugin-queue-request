---
phase: 04-lifecycle-persistence-spend-safety
plan: 03
subsystem: persistence
tags: [sillytavern, extension, persistence, chat_metadata, lifecycle, vitest]

requires:
  - phase: 04-lifecycle-persistence-spend-safety
    provides: lifecycle clear policy, runner abortRunning dispositions, store.clear/onReset
provides:
  - src/persistence.js serialize/loadStored (schema v1, untrusted-input validation, 24h expiry)
  - chat-bound store persistence (bindChat/unbind/rebind/persist/persistExcluding)
  - bridge.chatKey, persist-before-append in runner
  - lifecycle.handleChatChanged (same-chat dedupe, switch sequence, load, restored pause)
affects: [04-04]

key-files:
  created: [src/persistence.js, test/persistence.test.js]
  modified: [src/store.js, src/runner.js, src/st-bridge.js, src/lifecycle.js, index.js, test/store.test.js, test/runner.test.js, test/lifecycle.test.js]

key-decisions:
  - "Same-chat dedupe uses chatKey plus metadata integrity, with an initialized flag so the first call always loads"
  - "A load token cancels a pending load if another CHAT_CHANGED arrives before the setTimeout(0) hop runs"
  - "A chat with no key (none open or group) stays unbound and resumes 'restored' so the runner is not left paused"

requirements-completed: [GUARD-03, PERS-01, PERS-04]
completed: 2026-10-27
---

# Phase 4 Plan 03: Persistence and chat-switch lifecycle Summary

Queued swipes are written to chat_metadata.queuedSwipes (ids, timestamps, hashes, names, connection names only) through ST save functions, validated on chat load (24h expiry, target match, malformed dropped with one toast), and always restored paused with reason 'restored'.

## Tasks and commits

1. persistence.js serialize/loadStored: d353384
2. Chat-bound store persistence, bridge.chatKey, persistExcluding before append: 8c6d251
3. handleChatChanged, load algorithm, index.js catch-up: 0dd5edb

## Verification (observed)

- `npx vitest run test/persistence.test.js`: 10 passed.
- `npx vitest run test/store.test.js test/runner.test.js` (via full run): green.
- Full `npx vitest run`: 8 files, 131 tests passed.
- Not verified: bridge.chatKey has no unit test (st-bridge.js imports ST internals, unresolvable under Vitest); live ST refresh/switch smoke is deferred to the plan 08 checkpoint.

## Deviations from Plan

None. Notes: the store's debounced persist calls `ctx.saveMetadataDebounced()` and immediate calls `ctx.saveChat()` on a fresh `bridge.ctx()`. Items created by `store.add` carry no `connection`, so serialize writes null connection fields until a later plan records it.

## Known Stubs

None. `promptResume` is an optional injected hook; plan 04 supplies it, so until then a restored queue stays paused.

## Self-Check: PASSED
