---
phase: 04-lifecycle-persistence-spend-safety
fixed_at: 2026-10-28T06:08:18Z
review_path: .planning/phases/04-lifecycle-persistence-spend-safety/04-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 4: Code Review Fix Report

**Fixed at:** 2026-10-28T06:08:18Z
**Source review:** .planning/phases/04-lifecycle-persistence-spend-safety/04-REVIEW.md
**Iteration:** 1

**Scope:** limited by request to CR-01, CR-02, CR-03, WR-02, WR-03 and IN-01. WR-01, WR-04 to
WR-10 and IN-02 to IN-06 were left alone on purpose. They are deferred, not rejected.

**Summary:**
- Findings in scope: 6
- Fixed: 6 (CR-02 and CR-03 marked "requires human verification", see below)
- Skipped: 0
- Test suite: 231 tests before, 252 after (`npx vitest run`, 15 files, all passing after every commit)

Each new test was checked to fail against the code before its fix.

## Fixed Issues

### CR-01: Takeover always loads 0 items when an owner snapshot exists

**Files modified:** `src/persistence.js`, `src/lifecycle.js`, `test/snapshot.test.js`, `test/lifecycle.test.js`
**Commit:** b670d7f
**Applied fix:** `buildSnapshot()` now writes `version: SCHEMA_VERSION`, so `loadStored()` accepts
a published snapshot (`parseSnapshot` ignores the extra field). The no-reload takeover path no
longer trusts a snapshot just because it has an `items` array. It falls back to chat metadata
when the snapshot is missing or `loadStored` returns `ignored`.
**Tests added:** round trip `buildSnapshot -> JSON -> loadStored` restores the items
(`snapshot.test.js`). Takeover with a snapshot built by `buildSnapshot` (no hand-stamped version)
restores its items and shows the toast. An unusable snapshot falls back to metadata
(`lifecycle.test.js`). The old "prefers a valid mirror snapshot" test used a hand-written
`version: 1` blob, which is why it missed this bug.

### CR-02: Takeover and demotion operate on a stale in-memory chat

**Files modified:** `src/lifecycle.js`, `test/lifecycle.test.js`
**Commit:** c44e349
**Status:** fixed: requires human verification (state handling, plus ST runtime behaviour that the unit tests cannot cover)
**Applied fix:**
- **Takeover:** when `getContext().reloadCurrentChat` exists, the tab holds the runner
  (`pause('takeover')`), keeps the store read-only, and awaits `reloadCurrentChat()` before it
  binds or writes anything. The same-chat CHAT_CHANGED fired by the reload hits the existing
  same-key/integrity no-op branch. After the reload the fresh server `chat_metadata` is the queue
  source (the snapshot is not used). Then the existing takeover rules apply: with items it stays
  paused and toasts; with an empty queue it releases its hold.
- The reload is deferred (500 ms retry) while a native generation runs.
- The reload is abandoned when a real chat switch or an integrity change bumps `loadToken`, or
  when the tab is demoted mid-reload (`ownership.getRole() !== 'owner'`).
- If the reload throws, the tab finishes takeover from snapshot/metadata but stays paused
  ('takeover' kept even with an empty queue), so nothing runs without an explicit Resume.
- Without `reloadCurrentChat` (old ST or test doubles), the previous no-reload path runs unchanged.
- **Demotion and read-only claim:** both paths now `delete chatMetadata[moduleName]` on the local
  in-memory object, without any save. A later native save in that tab therefore cannot write a
  stale queue back.
**Tests added (lifecycle.test.js):**
- reload happens before bind, and nothing becomes writable while it is in flight
- fresh metadata is loaded
- an empty fresh queue releases the hold
- a failed reload stays paused
- the reload is deferred during a generation
- a chat switch during the reload abandons the takeover
- demotion drops the local key without saveChat or saveMetadataDebounced
- a read-only claim drops the local key

Two existing tests that relied on stale local metadata now use a snapshot or set metadata explicitly.
**Left for live verification / follow-up:**
- Against ST 1.19.0, confirm that `reloadCurrentChat()` does not save the stale chat before it
  reloads. Also confirm that its CHAT_CHANGED keeps the same `chat_metadata.integrity`. If the
  integrity changes, the code falls back to the full load path: release, re-claim, then the resume
  popup. That is safe but noisier.
- Trade-off: dropping the local key means a native save in a read-only tab removes the queue key
  from the saved file. The owner writes it again on its next persist (add, done, drop or clear).
  If the owner tab is closed before that, the saved queue is lost. That is the spend-safe
  direction: nothing gets generated again without consent.
- **Not fixed (architectural):** a read-only tab still holds a stale `chat`. A native message or
  save there overwrites the owner's appended swipes, and the owner keeps appending to a copy that
  misses the read-only tab's message. Fixing this needs either "reload the owner when the mirror
  sees `chatLength` change" or documenting that read-only tabs must not edit the chat. Also
  verify whether ST's `/api/chats/save` integrity check catches cross-tab overwrites.

### CR-03: Non-unique fallback item ids on plain-HTTP origins

**Files modified:** `src/store.js`, `src/persistence.js`, `test/store.ids.test.js` (new)
**Commit:** 3c47099
**Status:** fixed: requires human verification (logic change on the id path)
**Applied fix:** `nextId()` tries three sources in order:
1. `crypto.randomUUID`
2. 128 bits from `crypto.getRandomValues` (available on insecure origins)
3. `item-<time36>-<counter>-<two Math.random strings>`, if `crypto` is missing entirely

It never falls back to a bare per-load counter. `loadStored()` drops duplicate ids, which count
toward `dropped`. `markRunning()` now refuses any item that is not `queued`.
**Tests added:** new `test/store.ids.test.js`. It simulates a page reload with `vi.resetModules()`
and a re-import, in two variants: `crypto` stubbed with only `getRandomValues`, and no `crypto` at
all. It restores the previous load's ids and checks that new ids do not collide. It also checks
that `markRunning` refuses a done item and that `loadStored` drops duplicates.
**Left for live verification:** open ST over plain HTTP on a LAN IP. Queue items, reload, queue
more, and confirm that each item runs exactly once.

### WR-02: Read-only tab shows the previous chat's snapshot after a chat switch

**Files modified:** `src/lifecycle.js`, `test/lifecycle.test.js`
**Commit:** c543390
**Applied fix:** in the `handleChatChanged` sync prefix, `ownership.release()` now runs before
`store.setReadOnly(true)`. The mirror's read-only callback therefore reads no state, because
`chatKey` is null after release, instead of the old chat's snapshot. After a `readonly` claim,
lifecycle applies the new chat's owner snapshot directly
(`parseSnapshot(ownership.readState().snapshot)` -> `store.applySnapshot`). Later updates still
come through the mirror's `onState` subscription. I used this approach instead of exposing
`mirror.applyStored`, to avoid reordering construction in `index.js`.
**Tests added:** release comes before `ro:true` in the sync prefix. A read-only claim applies the
owner's snapshot. Without a snapshot, nothing is applied.

### WR-03: `onDeleted` throws on mirrored items in a read-only tab

**Files modified:** `src/lifecycle.js`, `src/fingerprint.js`, `test/lifecycle.test.js`, `test/fingerprint.test.js`
**Commit:** 87d03c5
**Applied fix:** `onEdited`, `onDeleted`, `onSent` and `onReceived` return early when
`store.isReadOnly()` is true. This prevents the false "Cleared N" toasts and the clear/abort in a
non-owner tab. `fingerprintStatus(bridge, null)` returns `'target'` instead of throwing.
**Tests added:** a read-only tab with null-fingerprint items ignores all four message events (no
clear, toast or abort). A delete with a null fingerprint does not throw. `fingerprintStatus`
handles null and undefined.

### IN-01: Pluralisation "1 failures in a row"

**Files modified:** `src/pauseLabels.js`, `src/ui.js`, `test/pauseLabels.test.js`
**Commit:** 549ed08
**Applied fix:** new exported helper `failuresInARow(n)` (singular for 1). It is used by the pause
label and by the circuit-breaker toast in `ui.js`.
**Tests added:** singular and plural cases in `pauseLabels.test.js`. The `ui.js` toast text has no
unit test (it is DOM/toastr wiring); it passes `node --check`.

## Notes

- Fixes were committed directly on `master` in the main tree (no isolated worktree). The caller's
  rules (stage by path, keep the listed untracked and modified planning files out of commits)
  assume the main tree, and `node_modules` for Vitest exists only there.
- No locked decision was touched: no non-dry `Generate`, persistence only through ST save
  functions (the CR-02 demotion change only deletes an in-memory key and never saves), and ST
  access only through `getContext()` / `eventSource`.

---

_Fixed: 2026-10-28T06:08:18Z_
_Fixer: Claude (bm-code-fixer)_
_Iteration: 1_
