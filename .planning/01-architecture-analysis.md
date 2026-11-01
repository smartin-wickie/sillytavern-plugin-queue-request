# SillyTavern Plugin Patterns & Architecture — Analysis

Project: sillytavern-plugin-queue-request
Status: Draft v0.1 (2026-10-25)

> **Confidence legend**
> - **[Docs]** confirmed from official docs / DeepWiki index of the SillyTavern repo (indexed 23 Sep 2026).
> - **[Recall]** from general knowledge of the ST codebase. **Must be verified against the source (`public/script.js`) before implementation.** I could not clone the repo from my environment, so no line-level code reading has been done yet.

---

## 1. Two extension mechanisms

| | UI Extension | Server Plugin |
|---|---|---|
| Runs in | Browser | Node.js / Express server |
| Location | `public/scripts/extensions/third-party/<name>/` or `data/<user>/extensions/<name>/` | `plugins/<name>/` |
| Entry | `manifest.json` → `js`, optional `css` | `init(router)`, `exit()`, `info{id,name,description}` |
| Enabled by | Extensions panel | `enableServerPlugins: true` in `config.yaml` |
| Sandboxed | Browser sandbox, but full DOM + ST context | **No** — full Node/FS access |
| Can add endpoints | No | Yes, under `/api/plugins/<id>/…` |

[Docs] Server plugins load on startup only if `enableServerPlugins` is true; they receive a router created for the plugin and may be a single file or a directory (`package.json` main → `index.js` → `index.mjs`). A Webpack+TypeScript template exists (`SillyTavern/Plugin-WebpackTemplate`).

[Docs] Official content-repo guidance: **extensions that *require* a server plugin are not accepted** into the official repo. Implication: a split design is fine for personal/community distribution, but not for official listing.

[Docs] Community pattern: `st-ext-server-loader` lets an extension ship `server/index.js`, auto-mounted at `/api/plugins/st-ext-server-loader/ext/<ext>/…` (still requires restart on update).

## 2. UI extension anatomy [Docs]

- `manifest.json` fields: `display_name`, `js`, `author` (required); `css`, `loading_order`, `requires`, `optional`, `dependencies`, `version`, `homePage`, `auto_update`, `minimum_client_version`, `i18n`, `generate_interceptor`, `hooks` (install/update/delete/enable/disable/activate).
- Load: `initExtensions()` → dynamic import of module → module uses `getContext()` → registers slash commands and `eventSource.on(...)` handlers → `APP_READY` fires after all loaded.
- `getContext()` exposes: `chat`, `characters`, `chatMetadata`, `generate`, `eventSource`, `event_types`, `saveSettingsDebounced`, `SlashCommandParser`, `ToolManager`, `accountStorage`, token counting, variables, world info.
- Settings: `extension_settings[MODULE_NAME]` + `saveSettingsDebounced()`; templates via `renderExtensionTemplateAsync()` (sanitised, localised).
- Events relevant here [Docs]: `APP_READY`, `MESSAGE_RECEIVED`, `CHARACTER_MESSAGE_RENDERED`, `GENERATION_STARTED`, `GENERATION_ENDED`.
- Events relevant here [Recall – verify names]: `MESSAGE_SWIPED`, `GENERATION_STOPPED`, `STREAM_TOKEN_RECEIVED`, `CHAT_CHANGED`, `MESSAGE_UPDATED`, `MESSAGE_EDITED`, `CHAT_COMPLETION_PROMPT_READY`, `GENERATE_AFTER_DATA`.
- Existing swipe-related extensions to study (all UI-only, all open source):
  - **Deep-Swipe** (Rurijian) — swipe on any message; clones native arrow/counter UI. Notes a hard conflict with Prompt Inspector because both fight over generation state.
  - **SillyTavern-UserSwipes** (Bartasx4) — adds `swipes`, `swipe_id`, `swipe_info` to user messages; reuses built-in arrows/counter.

## 3. Swipe data model [Recall – verify]

Each `chat[i]` message holds:
- `mes` — currently displayed text
- `swipes: string[]` — all alternatives
- `swipe_id: number` — index shown
- `swipe_info: [{ send_date, gen_started, gen_finished, extra }]` — parallel array to `swipes`
- `extra` — per-message metadata (also mirrored per swipe in `swipe_info[n].extra`)

Native flow: right-arrow on the last swipe → `swipe_right` → pushes a new empty slot → calls `Generate('swipe')` → result stored in `swipes[swipe_id]`, `mes` synced, chat saved. Navigating swipes copies `swipes[id]` + `swipe_info[id]` into the message and re-renders.

## 4. The core constraint: generation is single-flight [Recall – verify]

The main pipeline in `script.js` relies on module-level/global state: `is_send_press`, a single `abortController`/`streamingProcessor`, `this_chid`, "generation in progress" UI (send button → stop button), and `mesSend`-style locking. Swipe-right is disabled/ignored while a generation is running. Prompt building (`getCombinedPrompt` / `Generate`) also reads live chat state at call time.

Consequence: **queueing N swipes cannot be done by firing N concurrent `Generate('swipe')` calls**. It needs either:

- **A. Serial queue (UI extension only).** Hold requests, run them one at a time through the native pipeline, each time targeting the same message. Simple and safe, but total wait = N × latency; user can read the *current* swipe while the queue works. (Streaming into the visible message would be disrupted unless the queue writes into the swipe slot without switching view.)
- **B. Parallel out-of-band generation (extension + optional server plugin).** Capture the final prompt/request payload once (via `GENERATE_AFTER_DATA` / chat-completion prompt-ready hooks), then issue N backend requests directly to `/api/backends/...` (or via a plugin endpoint), writing results straight into `message.swipes` without touching the global generation state. True parallelism, but bypasses native post-processing (regex, trimming, reasoning parsing, instruct sequences, stop strings, token counts) unless re-implemented, and must handle each API source's response format.
- **C. Hybrid.** Serial through native pipeline by default; optional parallel mode where the backend supports it.

A server plugin is only *necessary* for B if browser CORS/connection limits, secrets, or server-side fan-out/persistence are needed; ST already proxies backends via its own `/api/backends/*` endpoints, which a browser extension can call.

## 5. Integration points for the feature

1. **Trigger UI**: a "queue swipe" control on the last AI message (e.g. button beside the swipe arrows, or modifier-click on right arrow), plus a `/queue-swipe n` slash command.
2. **Queue state**: in-memory queue per chat + message; persisted (optionally) in `chat_metadata` or the swipe slot so a refresh doesn't silently lose it.
3. **Placeholders**: reserve `swipes[k]` slots up front? Risky — native UI would show empty swipes and the counter would count them. Alternative: hold results in the plugin and only append when complete (matches "available as paged swipes as they complete").
4. **Completion**: push text + `swipe_info` into the message, update the counter `n/total` via DOM or by re-render, save chat (`saveChatConditional` [Recall]); must not change `swipe_id` unless the user is on it.
5. **Safety events**: handle `CHAT_CHANGED`, message deleted/edited, user sends a new message (queue targets are stale), manual Stop, API errors, rate limits.
6. **Compatibility**: Prompt Inspector, Deep-Swipe, UserSwipes, swipe-counting extensions, group chats, impersonation, continue.

## 6. Open technical questions to verify in source

1. Exact guard conditions on `swipe_right` and `is_send_press`.
2. Whether `Generate('swipe')` can be invoked against a non-visible `swipe_id` or only the current one.
3. Where final prompt payload can be intercepted per API type (`chat_completion`, `textgen`, `kobold`, `novel`, `openai`).
4. How streaming writes into `mes` and when `swipes[]` is synced.
5. Prompt-caching impact: N identical prompts back-to-back are cache-friendly; parallel ones are not.
6. Group chat swipe semantics.
