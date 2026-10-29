---
status: partial
phase: 04-lifecycle-persistence-spend-safety
source: [04-VERIFICATION.md]
started: 2026-10-28T00:00:00Z
updated: 2026-10-29T00:20:00Z
---

## Current Test

Test 2 (CR-03 plain HTTP) is awaiting a LAN-device check by the user.

## Tests

### 1. CR-02 takeover reloads the chat safely
expected: When a tab takes over, `reloadCurrentChat()` runs without saving the stale chat first, `chat_metadata.integrity` is unchanged, and the tab lands paused with the takeover toast.
result: passed (2026-10-28, live, ST 1.19.0). Tab A owned the queue with 3 items; tab B was read-only. A navigated away, and B took over within 8 s. B's patched `fetch` saw 0 calls to `/api/chats/save`. CHAT_CHANGED fired once (the reload), and B picked up A's newer swipe from the server (37 -> 38 swipes). `chat_metadata.integrity` was unchanged (5f5a7d4e-...). B landed with the status "Paused: taken over from another tab" and 3 items. The takeover toast had faded before this check's 8 s poll. The same toast text was captured on the takeover path in test 3. Evidence: ../05-compatibility-release/evidence/uat3-demote-takeover.jpg

### 2. CR-03 unique item ids over plain HTTP
expected: With ST opened over plain HTTP from another LAN device (no `crypto.randomUUID`), queue swipes, reload, queue more; every item runs exactly once and no item regenerates repeatedly.
result: [manual - user must test from another LAN device over plain HTTP] ST is loopback-only on this machine (config.yaml `listen: false`, whitelist ::1 and 127.0.0.1), and 127.0.0.1 is a secure context with `crypto.randomUUID`. The ST config was not changed (T-05-09). Unit tests cover the `makeTabId` fallback path. See 05-03 Task 3.

### 3. Demote then takeover restores the queue
expected: Re-run the smoke observation after the CR-01/CR-02 fixes: an owner that demotes and later takes over restores the saved items (not an empty store) and shows the takeover toast.
result: passed (2026-10-28, live). B owned the queue with 3 paused items, and C was read-only. B's main thread was blocked for 9 s, so its heartbeat stopped and the lease went stale. C took over and showed the toast "This tab now manages the queue. It is paused; resume from the queue badge." B demoted: its control was disabled. C then navigated away, and B took back over. B restored all 3 items, not an empty store, landed paused ("taken over from another tab") and showed the same toast (captured via a toastr hook). It made 0 chat saves, and integrity was unchanged. Evidence: ../05-compatibility-release/evidence/uat3-demote-takeover.jpg

### 4. WR-01 background-tab throttling
expected: An owner tab left hidden in the background for several minutes keeps ownership or hands over cleanly, without discarding a paid in-flight result.
result: passed (2026-10-28, live). B owned the queue, resumed 3 items, and was hidden behind another tab for 7 min. No other ST tab was open. B kept ownership the whole time, and all 3 results appended (swipes 38 -> 41, swipe_info 41). Nothing was discarded, and there were 0 console errors. Observation: Chrome's intensive throttling let the lease go stale for up to ~48 s while hidden (age samples of 47-48 s, about once per minute). A second ST tab open on the same chat at that moment would take over, and the hidden owner would demote and abort its in-flight item with disposition `discard`. That handover-while-throttled path was not exercised. Evidence: ../05-compatibility-release/evidence/uat4-background.jpg

## Summary

total: 4
passed: 3
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
