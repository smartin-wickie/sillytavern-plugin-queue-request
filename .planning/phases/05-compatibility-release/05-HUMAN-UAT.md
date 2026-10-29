---
status: partial
phase: 05-compatibility-release
source: [05-VERIFICATION.md]
started: 2026-10-29T01:45:00Z
updated: 2026-10-29T01:45:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Plain-HTTP LAN device (Phase 4 UAT #2, CR-03)
expected: With ST opened over plain HTTP from another LAN device (no `crypto.randomUUID`), queue swipes, reload, then queue more. Every item runs exactly once.
result: [pending] Deferred by the user on 2026-10-28 (LAN support is low priority). Tracked in 04-HUMAN-UAT.md test 2.

### 2. TTS reads a normal swipe while Queued Swipes is enabled
expected: With a TTS voice configured, a normal swipe or `/speak` is spoken. Queued appends are not spoken (0 speak calls were already observed live).
result: [pending] Blocked: the voice map has the default voice set to disabled.

### 3. Vector Storage injects on a native swipe while Queued Swipes is enabled
expected: With chat vectorization configured, a native swipe's prompt contains the injected vector memory. Queued swipes do not (this is a documented gap).
result: [pending] Blocked: Vector Storage has never been configured on this install.

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
