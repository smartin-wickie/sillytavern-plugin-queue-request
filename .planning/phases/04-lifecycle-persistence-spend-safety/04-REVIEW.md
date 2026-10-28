---
phase: 04-lifecycle-persistence-spend-safety
reviewed: 2026-10-27T00:00:00Z
depth: standard
files_reviewed: 20
files_reviewed_list:
  - index.js
  - src/commands.js
  - src/connection.js
  - src/fingerprint.js
  - src/guard.js
  - src/lifecycle.js
  - src/mirror.js
  - src/ownership.js
  - src/pauseLabels.js
  - src/persistence.js
  - src/popups.js
  - src/progressBar.js
  - src/queueActions.js
  - src/runner.js
  - src/st-bridge.js
  - src/store.js
  - src/toastAccumulator.js
  - src/ui.js
  - src/wandMenu.js
  - style.css
findings:
  critical: 3
  warning: 10
  info: 6
  total: 19
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-10-27
**Depth:** standard (focus: `git diff 9e71e55..HEAD`)
**Files Reviewed:** 20
**Status:** issues_found

## Summary

The single-tab lifecycle and persistence paths (chat switch hold, resume prompt, Continue
re-fingerprint, breaker, connection gate) are mostly sound. The cross-tab ownership/takeover layer
is where the defects are. Smoke-test open issue #1 is fully explained by the code (CR-01). Its root
cause interacts with two more problems. Browser timer throttling makes ownership flip between tabs
(WR-01). The tab that takes over writes from a stale in-memory chat (CR-02). One more
browser-vs-Node difference can cause unbounded paid generations: `crypto.randomUUID` is missing on
plain-HTTP LAN access, which the Vitest/Node environment never exercises (CR-03).

### Smoke-test open issues: what the code says

1. **Takeover with no toast and an empty store while chat_metadata held 3 items.** Explained, see
   CR-01. `onRoleChange` prefers the localStorage display snapshot over `chat_metadata` whenever
   the snapshot has an `items` array. `buildSnapshot()` never writes a `version` field, so
   `loadStored()` always returns `ignored: true` with 0 items. The store is rebound to `[]`, and
   because `result.items.length === 0` the takeover toast is skipped by design. `chat_metadata` is
   never consulted, so it keeps its 3 items. The snapshot was still present because the old owner's
   lease went stale without `release()` running (throttled or frozen background tab, WR-01), and
   only `release()` removes the state key. If the old owner had released cleanly (state key
   removed), the code would have fallen back to this tab's own in-memory `chat_metadata`. That copy
   is stale too (CR-02).
2. **'failures' / 'inspector' pause persists after Cancel all.** Confirmed as a design gap.
   `cancelAll()` (`src/queueActions.js:53-62`) only drops items and aborts. It never touches pause
   reasons. Nothing ever clears 'inspector' automatically: no poll and no event. The comment at
   `src/lifecycle.js:109-110`, which says it "tracks the live Prompt Inspector state", is
   inaccurate. 'connection' after "Keep paused" behaves the same way. Options: clear the
   'failures'/'connection' reasons when the queue drains to zero via cancel, and re-check
   `promptInspectorEnabled()` at enqueue/resume time to drop a stale 'inspector' reason. Design
   decision, not scored.
3. **"1 failures in a row".** Confirmed at `src/pauseLabels.js:14` and in the breaker toast at
   `src/ui.js:362`. See IN-01.

## Critical Issues

### CR-01: Takeover always loads 0 items when an owner snapshot exists (snapshot has no schema version)

**File:** `src/lifecycle.js:219-231`, `src/persistence.js:127-156`
**Issue:** On takeover, `source` is the localStorage display snapshot whenever
`Array.isArray(snapshot?.items)`. That is true even for `[]`. `buildSnapshot()` returns
`{ items, completed, reasons, failures }` with no `version`, and `loadStored()` rejects anything
where `raw.version !== SCHEMA_VERSION` (`persistence.js:84`). So whenever a snapshot exists, the
result is `{ items: [] }`. The store is rebound empty, there is no takeover toast and no persist,
and the saved queue looks lost. The next `add()` then calls `persist({ immediate: true })`, which
serialises only the new item and overwrites `chat_metadata[moduleName]`. The 3 stored items are then
deleted for good. This is the exact symptom from open issue #1.
**Fix:** Do not use the display snapshot as a queue source. Load from the authoritative chat (see
CR-02), or at minimum stamp and accept a version:
```js
// persistence.js buildSnapshot
return { version: SCHEMA_VERSION, items: out.slice(0, DEFAULT_MAX_ITEMS), ... };
// lifecycle.js onRoleChange: prefer chat_metadata after a reload, never an empty snapshot
const source = c.chatMetadata?.[moduleName];
```
Add a unit test where takeover happens with a published snapshot present. The current tests
evidently cover only the snapshot-absent path.

### CR-02: Takeover and demotion operate on a stale in-memory chat; resuming overwrites the other tab's saved chat

**File:** `src/lifecycle.js:204-232`, `src/store.js:62-97`, `src/appender.js:63-67`
**Issue:** Each tab holds its own in-memory `chat` and `chatMetadata`, loaded when that tab opened
the chat. While tab A is read-only, owner B appends swipes and saves them. A never reloads.
- After takeover, A's fallback `source` is A's own old `chatMetadata[moduleName]`. Items B already
  completed or cancelled come back as queued. Resuming spends money on them again.
- When A resumes, `appendSwipe` pushes into A's stale `chat` and calls `saveChat()`. That writes
  the whole stale chat file over B's version on the server, so B's appended swipes are lost. The
  same happens if the user sends a message in read-only tab B: owner A never sees it (no
  MESSAGE_SENT in A), keeps appending to its stale copy, and saves over the new message. ST's
  `integrity` check does not catch this, because both tabs share the same chat integrity value
  (verify against ST 1.19.0's `/api/chats/save`).
- A demoted tab keeps `chatMetadata[moduleName]` in memory. Any later native save in that tab
  writes the stale queue back and brings back items the owner cleared.
**Fix:** Before any writes on takeover, reload the chat from the server, for example
`await ctx.reloadCurrentChat()`, and let the normal `handleChatChanged` → `claim` → `loadChat` path
rebuild the queue from fresh `chat_metadata`. On demotion, `delete chatMetadata[moduleName]` locally
(or mark it so the store refuses to serialise from a non-owner) so a native save in the demoted tab
cannot resurrect items. Document that a read-only tab must not be used to edit the chat, or reload
the owner when the mirror sees `chatLength` change.

### CR-03: Non-unique fallback item ids on plain-HTTP origins cause an endless paid-generation loop

**File:** `src/store.js:11-19`, `src/runner.js:106-210`
**Issue:** `crypto.randomUUID` exists only in secure contexts. ST is very often opened over plain
HTTP on a LAN address (phone access), so the fallback runs. The fallback is `item-${fallbackCounter}`,
and that counter restarts at 0 on every page load. After a reload, restored items `item-1..N` sit
next to newly added items that get the same ids again. `findById` returns the first match, so this
happens:
1. `peekNext()` returns the new item B (`item-1`).
2. `markRunning('item-1')` flips the old done/failed item A back to `running` instead of B.
3. `markDone('item-1')` marks A done again.
4. B stays `queued` forever, so the loop regenerates it without end. Each iteration is a paid
   request and appends one more swipe.
Per-row cancel hits the wrong item as well. Node and Vitest always provide `crypto.randomUUID`,
so tests never take this branch.
**Fix:** Make the fallback globally unique, as `ownership.js` already does:
```js
function nextId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  if (typeof crypto?.getRandomValues === 'function') {
    const b = crypto.getRandomValues(new Uint8Array(16));
    return 'item-' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }
  fallbackCounter += 1;
  return `item-${Date.now().toString(36)}-${fallbackCounter}-${Math.random().toString(36).slice(2)}`;
}
```
Also make `loadStored` drop duplicate ids. Separately, `markRunning` should refuse items that are
not `queued`.

## Warnings

### WR-01: A 5 s lease timeout cannot survive browser background-tab timer throttling (ownership flapping)

**File:** `src/ownership.js:8-9,117-145`
**Issue:** The heartbeat is a `setInterval` of 2000 ms with a 5000 ms lease. Chrome and Edge
intensive throttling limits chained timers in a tab hidden for more than 5 minutes to about one run
per minute. Sleeping tabs, Energy Saver and mobile Safari freeze the tab completely. A hidden owner
tab therefore goes stale, and any other tab on the chat takes over. When the user switches back,
the old owner's next tick sees a foreign lease and demotes. The same thing then happens in the
other direction. This is the most likely trigger for the "owner demotes, later takes over again"
sequence in open issue #1. It also aborts and discards in-flight paid results (`onRoleChange`
readonly → `abortRunning({ disposition: 'discard' })`). Vitest fake timers never throttle.
**Fix:** Use the Web Locks API (`navigator.locks.request('queuedSwipes:'+key, {ifAvailable:true}, ...)`),
which is held for the life of the document and is not affected by throttling, with localStorage as
the fallback. Or re-heartbeat on `visibilitychange` and make the lease timeout much larger for a
hidden owner. Do not let a tab that is mid-generation be demoted silently.

### WR-02: Read-only tab shows the previous chat's snapshot (or nothing) after a chat switch

**File:** `src/lifecycle.js:137-138,156-164`, `src/mirror.js:30-39`
**Issue:** `store.setReadOnly(true)` (line 137) runs before `ownership.release()` (line 138). The
mirror's `onReadOnly` → `applyStored()` therefore reads the old chat's state key, which is often
this tab's own published snapshot, and applies it to the freshly emptied store. When `claim()`
later returns `readonly`, line 162 calls `setReadOnly(true)` again. That is a no-op (no change),
so the new chat's snapshot is never applied. The read-only tab shows the old chat's items, or an
empty queue, until the owner happens to publish again. The owner only publishes on a change.
**Fix:** Call `ownership.release()` before `store.setReadOnly(true)`, and explicitly apply the
stored snapshot after a readonly claim, for example by exposing `mirror.applyStored()` or having
`ownership.claim` emit a state callback when it resolves `readonly`.

### WR-03: `onDeleted` throws on mirrored items (null fingerprint) in a read-only tab

**File:** `src/lifecycle.js:63-68`, `src/fingerprint.js:40-44`, `src/store.js:167-174`
**Issue:** `applySnapshot` sets `fingerprint: null`. In a read-only tab with mirrored items,
deleting any message calls `fingerprintStatus(bridge, null)`, which reads `fp.chatId` on `null`.
The result is an uncaught TypeError in a timer. `onSent` in a read-only tab also "clears" the
mirrored items and toasts "Cleared N queued swipe(s)" for a queue this tab does not own. The next
owner snapshot restores the items, so the toast is false.
**Fix:** Return early from every lifecycle message handler when `store.isReadOnly()`. Also guard
`fingerprintStatus` with `if (!fp) return 'target';`.

### WR-04: `resumeAll()` clears the 'native' reason mid-generation, so queued items can be dropped after a native Continue

**File:** `src/runner.js:289-304`, `src/queueActions.js:68-78`
**Issue:** The Resume button calls `runner.resume()` with no reason, which clears every reason,
including 'native'. If the user presses Resume during a native Continue, the runner's idle-retry
can start the next item as soon as `isIdle()` is true. That can happen before the guard's scheduled
`endNative()` → `onNativeEnd()` re-fingerprints. On swipe 0 the Continue has changed `swipes[0]`,
so the item is classified `'target'` and silently dropped as stale. The parked-result wait at
`runner.js:167` depends on 'native' being held for the same reason.
**Fix:** In `resume(undefined)`, keep 'native', for example
`for (const r of [...pauseReasons]) if (r !== 'native') pauseReasons.delete(r);`.

### WR-05: An abort during capture is reported as an API failure (wrong toast, breaker count, item not requeued)

**File:** `index.js:43-48`, `src/runner.js:226-247`
**Issue:** `generate()` maps every throw from `capture()`/`send()` to `{ error: 'api' }`. That
includes an AbortError or a "capture failed" caused by the signal. `handleFailure` honours
`abortDisposition` only when `reason === 'cancelled'`. So a chat switch during capture (disposition
`requeue`) drops the item with 'api', shows a failure toast and counts toward the breaker. A
demotion (disposition `discard`) shows a failure toast in a tab that is supposed to stay silent.
**Fix:** `catch (err) { return { error: signal?.aborted ? 'cancelled' : 'api' }; }`.

### WR-06: Append defer-retry loop never re-validates epoch, ownership or fingerprint

**File:** `src/runner.js:86-97,171-195`, `src/appender.js:16-20`
**Issue:** The epoch, `isOwner()` and fingerprint checks run once, before `flushAppend`. If
`appendSwipe` returns `'defer'`, the loop retries every 250 ms with no further checks. A chat
switch, demotion or edit during that window still appends. `appendSwipe` itself checks only that
`mesId` is the last non-user message, so the swipe can land in a different chat of equal length.
The first-attempt window is narrow (synchronous), so this is a robustness gap rather than a live
bug.
**Fix:** Pass a `stillValid()` predicate into `flushAppend` (epoch, `isOwner()`,
`fingerprintStatus(...) === 'ok'`) and return `'stale'` when it fails.

### WR-07: Ownership reads as owner while the role is null (pagehide/bfcache, claim window)

**File:** `src/ownership.js:229-231,260-262`
**Issue:** `isOwner()` returns `role !== 'readonly'`, which is true while `role === null`.
`onPageHide` calls `release()` (role becomes null, lease removed). If the page is restored from
bfcache, nothing re-claims. The tab then acts as owner with no lease while another tab can claim
the same chat, so two runners exist and spend is doubled. Today the claim window is protected only
because the runner also holds 'restored'.
**Fix:** Treat `null` as not-owner (`return failOpen || role === 'owner';`, with `index.js`
handling the no-storage case through `failOpen`). Add a `pageshow` handler that re-runs
`lifecycle.handleChatChanged()` when `event.persisted` is true.

### WR-08: A demoted owner tab is never paused, and the 'restored' hold differs between the two read-only entry paths

**File:** `src/lifecycle.js:204-210`
**Issue:** The claim-readonly path keeps 'restored' paused. The demotion path only aborts and sets
read-only. Correctness then relies entirely on the `isOwner()` check in `processNext`. Any path
that flips `isOwner()` true without the takeover handler (WR-07) runs the queue at once with no
consent. On takeover, `runner.resume('restored')` is also called even though nothing paused it.
**Fix:** In the readonly branch of `onRoleChange`, call `runner.pause('restored')` so both
read-only paths hold the same state.

### WR-09: `enqueue(count)` fires one immediate `saveChat()` per item

**File:** `src/store.js:187-205`, `src/queueActions.js:38-42`
**Issue:** `/queueswipe 5` calls `persist({ immediate: true })` five times back-to-back. ST's
`saveChatConditional` refuses or coalesces overlapping saves (verify against 1.19.0). Depending on
that behaviour, the later items may be left only in the debounced path, which the comment at
`store.js:58-61` says can be cancelled by `clearChat`. Either way it means 5 full chat-file uploads.
**Fix:** Add an `addMany(fp, n)` (or a `{ persist: false }` option) and persist once after the loop.

### WR-10: The 'inspector' pause is documented as live-tracked but is never cleared automatically

**File:** `src/lifecycle.js:109-110,126`, `src/runner.js:121-128`
**Issue:** The comment says 'inspector' "tracks the live Prompt Inspector state", but no code
re-polls `promptInspectorEnabled()` to clear it. After the user turns Inspector off, the queue
stays paused across chat switches until a manual Resume. This is the mechanism behind open
issue #2.
**Fix:** In `resume()`/`wake()`, and when an item is enqueued, drop 'inspector' if
`!bridge.promptInspectorEnabled()`. Otherwise correct the comment.

## Info

### IN-01: Pluralisation: "1 failures in a row"

**File:** `src/pauseLabels.js:14`, `src/ui.js:361-363`
**Fix:** `` `${n} ${n === 1 ? 'failure' : 'failures'} in a row` `` in both places. With
threshold 1 the breaker toast reads "after 1 failures".

### IN-02: Unused exports and parameters left over from the refactor

**File:** `src/fingerprint.js:55` (`fingerprintMatches`, no callers), `src/store.js:159`
(`getSnapshotStats`, no callers), `src/runner.js:306` (`isPaused`), `src/lifecycle.js:30`
(`promptResume`, legacy fallback only).
**Fix:** Remove them, or keep them only if the tests use them.

### IN-03: Stale header and JSDoc comments

**File:** `src/store.js:1-4,21-24` ("No chat_metadata read/write happens in this plan": it now does),
`src/lifecycle.js:16-20` (JSDoc for `createLifecycle` sits above the toast constants, not the function).
**Fix:** Update the comments to match the code.

### IN-04: `onRoleChange` skips the takeover toast when the queue is empty

**File:** `src/lifecycle.js:224-231`
**Issue:** This is intentional, but combined with CR-01 it hides the ownership change completely.
**Fix:** Show a short "This tab now manages the queue" info toast even when nothing was restored.

### IN-05 (CONVENTION): File-name casing

**File:** `src/st-bridge.js:1`
**Deviation:** kebab-case basename. **Convention:** camelCase file names (dominant in `src/`).
**Fix:** Rename to `stBridge.js` when convenient. This predates the phase and is low priority.

### IN-06 (CONVENTION): Catch block style flagged by convention scan

**File:** `src/store.js:94`
**Deviation:** The tool flagged a swallowed catch. It actually logs with `console.warn`, which is a
deliberate log-and-handle. **Convention:** architectural-split error handling.
**Fix:** No change needed. Optionally add a comment saying it is deliberately non-fatal.

---

_Reviewed: 2026-10-27_
_Reviewer: Claude (bm-code-reviewer)_
_Depth: standard_
