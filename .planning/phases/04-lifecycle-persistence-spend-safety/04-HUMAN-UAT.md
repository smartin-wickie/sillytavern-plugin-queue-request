---
status: partial
phase: 04-lifecycle-persistence-spend-safety
source: [04-VERIFICATION.md]
started: 2026-10-28T00:00:00Z
updated: 2026-10-28T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. CR-02 takeover reloads the chat safely
expected: When a tab takes over, `reloadCurrentChat()` runs without saving the stale chat first, `chat_metadata.integrity` is unchanged, and the tab lands paused with the takeover toast.
result: [pending]

### 2. CR-03 unique item ids over plain HTTP
expected: With ST opened over plain HTTP from another LAN device (no `crypto.randomUUID`), queue swipes, reload, queue more; every item runs exactly once and no item regenerates repeatedly.
result: [pending]

### 3. Demote then takeover restores the queue
expected: Re-run the smoke observation after the CR-01/CR-02 fixes: an owner that demotes and later takes over restores the saved items (not an empty store) and shows the takeover toast.
result: [pending]

### 4. WR-01 background-tab throttling
expected: An owner tab left hidden in the background for several minutes keeps ownership or hands over cleanly, without discarding a paid in-flight result.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
