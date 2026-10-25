# AGENTS.md

## Repo purpose
SillyTavern UI extension to queue multiple swipe generations for the latest AI message (serial, extension-only). Design docs in `.planning/`.

## Key decisions (do not contradict)
- UI extension only (no server plugin) for v1
- Serial execution through an own scheduler: dry-run `Generate('swipe')` capture, own transport, native cleanup helpers (no concurrent `Generate()` calls, never a non-dry `Generate`)
- Completed swipes append as normal pages; **do not** auto-jump the displayed swipe
- Queue must persist across refresh (store with chat)

## Architecture constraints
- Target: browser UI extension in `public/scripts/extensions/third-party/<name>/` (or user data dir). Entry via `manifest.json` with `js`/`css`.
- Must use ST APIs: `getContext()`, `eventSource`, `event_types`, `extension_settings[MODULE_NAME]`, `saveSettingsDebounced()`, `saveChatConditional()`. 
- Respect single-flight generation (`is_send_press`, abort/streaming state). Queue items run one at a time via dry-run capture and own transport (R1), never through a non-dry native generation.
- On completion: append to `message.swipes[]` with `swipe_info` (`send_date`, `gen_started`, `gen_finished`, `extra`), increment pager, save chat. Never change `swipe_id` unless user opted in.
- Clear/pause on `CHAT_CHANGED`, message deleted/edited, new user message. Handle errors per item (don't block queue).

## Integration points to verify against ST source
When implementing, confirm in SillyTavern source:
- `swipe_right` guards and `is_send_press` behavior
- Where prompt can be captured (`GENERATE_AFTER_DATA` / prompt-ready hooks)
- How `swipes[]`/`swipe_info[]` sync and when streaming writes to `mes`
- Native save path

## Where to look
- `.planning/01-architecture-analysis.md` - ST extension patterns, swipe model, constraints
- `.planning/02-requirements-draft.md` - functional requirements, open questions

## Gotchas
- Don't fire parallel `Generate('swipe')` calls - breaks ST's single-flight state
- Don't pre-reserve visible empty swipe slots (would show in pager); append on completion
- Don't corrupt `chat.jsonl` - only use ST's save functions
- Plugin must be compatible with existing swipe extensions (Deep-Swipe, UserSwipes, Prompt Inspector)
