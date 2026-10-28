---
phase: 04-lifecycle-persistence-spend-safety
plan: 07
subsystem: multi-tab ownership
tags: [ownership, localStorage, lease, heartbeat, takeover, SAFE-04]
requires: [04-06]
provides:
  - "src/ownership.js lease module (claim, release, heartbeat, takeover, demotion, state mirror API)"
  - "runner isOwner gate and store read-only flag"
  - "lifecycle claim/release/takeover/demotion integration"
affects: [04-08]
tech-stack:
  added: []
  patterns: [localStorage lease with read-back heartbeat, injected storage/clock/timers/window]
key-files:
  created: [src/ownership.js, test/ownership.test.js]
  modified: [src/runner.js, src/store.js, src/lifecycle.js, index.js, test/runner.test.js, test/store.test.js, test/lifecycle.test.js]
key-decisions:
  - "Takeover pauses 'takeover' before releasing 'restored' so the runner cannot start an item in between"
  - "Takeover prefers the owner's mirrored snapshot only when it has an items array; otherwise chat metadata"
  - "Resume and connection popups are gated on store.isReadOnly(); read-only tabs never reach the load/prompt path"
requirements-completed: [SAFE-04]
duration: ~15min
completed: 2026-10-27
---

# Phase 4 Plan 07: Multi-tab ownership Summary

A localStorage lease (2s heartbeat, 5s takeover, read-back demotion) makes the first tab on a chat its sole queue runner; other tabs are inert, takeover is always paused and popup-free, and a demoted tab discards late results without writing.

## Tasks

| Task | Commit | Result |
|------|--------|--------|
| 1 ownership.js + tests | 87ab38d | 21 tests pass |
| 2 runner isOwner gates, store read-only | d3abdba | runner/store tests pass |
| 3 lifecycle integration + index wiring | 9db2da2 | full suite 218 tests pass |

Verification: `npx vitest run` run after each task; final result 11 files, 218 tests, all passing. Live multi-tab behavior was NOT verified here (deferred to the plan 08 checkpoint).

## Deviations from Plan

**1. [Rule 1 - Bug] Takeover ordering** - Plan said `runner.resume('restored')` then `runner.pause('takeover')`. resume() calls wake(), which could start an item before the pause lands. Implemented pause('takeover') first, then resume('restored'). Commit 9db2da2.

## Carry-forward handled
Read-only-tab gating of the resume/connection popups: a read-only tab never runs the load path (so no resume popup), and both popup runners also bail on `store.isReadOnly()`.

## Known Stubs
None. Read-only rendering and the cross-tab state mirror consumer are plan 08 (ownership exposes publishState/readState/onState; nothing publishes yet).

## Self-Check: PASSED
Files and commits 87ab38d, d3abdba, 9db2da2 exist.
