# Queued Swipes for SillyTavern

Queue several swipe generations for the latest AI message while you keep reading the current one. Queued requests run one at a time in the background. Each finished result is appended as a normal swipe page (the `k/total` pager grows) without changing which swipe you are looking at.

## Requirements

- SillyTavern 1.19.0 or newer (`minimum_client_version` in `manifest.json`).
- Single-character chats. Group chats are not supported.
- A Chat Completion or Text Completion backend that works with SillyTavern's normal generation. The extension was exercised end to end against a local OpenAI-compatible endpoint (LM Studio).

## Install

- In SillyTavern open Extensions, then Install extension, and paste the repository URL. The repository URL is pending, so this option is not available yet.
- Manual: clone or copy this folder into `public/scripts/extensions/third-party/` or into `data/<user>/extensions/`, then reload SillyTavern.

## Usage

- A queue control (clock icon) appears next to the swipe arrows on the latest AI message. Click it to queue one more swipe.
- A badge shows the queue state. Open its list to see queued items, cancel a single item, or resume a paused queue. A progress bar offers Stop and Resume buttons.
- The wand (Extensions) menu has two entries: "Queue swipe" and "Cancel all queued".
- Slash commands:
  - `/queueswipe [count]` queues `count` additional swipes (default 1). Returns the number actually queued. The queue size limit applies.
  - `/queuecancel` cancels all queued items and the one currently running. Returns the number cancelled.
  - `/queuestatus` reports pending and running counts, and the pause reason if paused.
- `/queueswipe` is intended only for supported single-character chats whose latest message is an AI message. The visible queue control hides itself in unsupported contexts; until command-side validation is complete, do not use `/queueswipe` in group chats, empty chats, or chats ending with a user message.
- The queue is saved with the chat. After a refresh, a popup asks whether to resume or discard the restored items.
- The queue pauses (and says why) when: it was restored after a reload, the API/model/preset connection changed, Prompt Inspector is on, several items failed in a row, or another tab took over the queue. Resume it from the badge.

## Settings

Found in the Extensions drawer under "Queued Swipes".

| Setting | Default |
|---------|---------|
| Enable queued swipes | On |
| Max queue size (1 to 20) | 5 |
| Jump to newest swipe on completion | Off |
| Notification style (All / Errors only / Off) | All |
| Pause after N consecutive failures (1 to 10) | 3 |

## Safety behavior

- Strictly serial: one queued request runs at a time, and the extension never starts a normal generation of its own.
- The queue clears when you edit or delete the target message, or send a new user message. Switching chats pauses the queue for the old chat; when you return, a popup lets you resume or discard the restored items.
- A failed item does not block the rest. After the configured number of failures in a row the queue pauses.
- The extension never writes chat files directly. It saves through SillyTavern's own save functions.
- Only one browser tab manages the queue for a chat. Other tabs show it read-only and can take over.
- Limitation: avoid opening the same chat in two tabs. A background tab can have its ownership lease go stale for up to about 48 seconds under browser throttling, and if a second tab takes over at that moment the in-flight item is discarded.

## Known limitations and fidelity gaps

Queued swipes build the prompt with SillyTavern's own prompt builder and then send it through the extension's own transport. Some behavior of a native swipe is therefore not reproduced:

- Extension prompt interceptors do not run on queued swipes. Examples seen in testing: Vector Storage, Image Generation (bundled), MessageSummarize, Parameter Randomizer, WebSearch.
- Chat Completion "Squash system messages" is not applied.
- World Info timed effects (sticky, cooldown) may differ from a native swipe.
- Queued results get no itemized prompt entry.
- SillyTavern's auto-swipe filtering is not applied to queued results. In testing with auto-swipe and auto-continue on, a queued run appended exactly the number queued and triggered no extra generations, so the extension does not start auto-swipe or auto-continue cascades.
- The first time you queue in a browser tab, a single warning toast lists the gaps that are active (for example the interceptor names).
- Prompt Inspector must be off while queueing.
- Group chats are not supported.
- Cancelling discards the result on the extension side. A response that was already being generated may still have been billed.

## Compatibility

Tested on SillyTavern 1.19.0 with a local backend. Summary of results (16 PASS, 0 FAIL, 5 BLOCKED); the full matrix with notes and evidence is in [`.planning/phases/05-compatibility-release/05-COMPAT-MATRIX.md`](.planning/phases/05-compatibility-release/05-COMPAT-MATRIX.md).

| Extension | Result |
|-----------|--------|
| Queued Swipes alone (baseline) | PASS |
| Prompt Inspector (inspector disabled) | PASS |
| MessageSummarize | PASS |
| Parameter Randomizer | PASS |
| WebSearch | PASS |
| Summarize (bundled) | PASS |
| Combined run of the above plus bundled TTS, Summarize and Vector Storage loaded | PASS |
| Deep-Swipe | BLOCKED (not tested, untested here) |
| UserSwipes | BLOCKED (not tested, untested here) |
| TTS (bundled) | BLOCKED (queue side clean; TTS voice not configured, so its own job was not checked) |
| Vector Storage (bundled) | BLOCKED (loaded alongside without errors; injection not checked because it is unconfigured) |
| Auto-swipe and auto-continue (core) | PASS (no cascade from queued swipes) |

Compatibility with Deep-Swipe and UserSwipes is untested. Prompt Inspector and Deep-Swipe are known to conflict with each other over generation state.

## Cost

Each queued swipe is a normal full request to your API and is billed as one.

## License and issues

MIT, see [LICENSE](LICENSE). There is no public issue tracker yet.
