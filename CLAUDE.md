# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## State
Pre-implementation. Repo has only design docs (`.planning/01-architecture-analysis.md`, `.planning/02-requirements-draft.md`) and `AGENTS.md`. No source, `package.json`, `manifest.json`, build, lint, or tests yet. Not a git repo. Add commands here once tooling exists.

## Purpose
SillyTavern (ST) UI extension: queue multiple swipe generations for the latest AI message while user reads. Each result appends as a normal swipe page on completion.

## Locked decisions (do not contradict; see `AGENTS.md`)
- UI extension only, no server plugin (v1).
- Serial execution through ST's native generation pipeline. Never fire concurrent `Generate('swipe')`; breaks single-flight state (`is_send_press`, abort/streaming controller).
- Append on completion to `message.swipes[]` + parallel `swipe_info[]` (`send_date`, `gen_started`, `gen_finished`, `extra`). Do not pre-reserve empty swipe slots (show in pager). Do not change `swipe_id` unless user opted in.
- Queue persists across refresh, stored with chat (likely `chat_metadata`).
- Clear/pause on `CHAT_CHANGED`, message delete/edit, new user message. Per-item errors must not block queue.
- Persist only via ST save functions (`saveChatConditional()`, `saveSettingsDebounced()`); never write `chat.jsonl` directly.
- Settings in `extension_settings[MODULE_NAME]`. ST APIs via `getContext()`, `eventSource`, `event_types`.

## Target layout
Extension lives in `public/scripts/extensions/third-party/<name>/` (or user data dir `data/<user>/extensions/<name>/`), entry `manifest.json` (`js`, `css`, `display_name`, `author`, `minimum_client_version`).

## Unverified assumptions
Design docs mark many ST internals as `[Recall]`, not read from source. Verify against ST `public/script.js` before relying on them: `swipe_right` guards, whether `Generate('swipe')` can target a non-visible swipe, prompt capture hooks (`GENERATE_AFTER_DATA`), streaming write timing into `mes`, event names (`MESSAGE_SWIPED`, `GENERATION_STOPPED`, etc.). Open requirement questions (resume auto-run vs ask, manual send vs running queue, default max queue 5) are listed in `02-requirements-draft.md` §7.

## Compatibility
Must coexist with Deep-Swipe, UserSwipes, Prompt Inspector (Deep-Swipe/Prompt Inspector already conflict over generation state).

<!-- GSD:project-start source:PROJECT.md -->
## Project

**Queued Swipes for SillyTavern**

A SillyTavern (ST) UI extension that lets the user queue several swipe generations for the latest AI message while they keep reading the current one. Queued requests run one at a time in the background through ST's native generation pipeline, and each completed result is appended as a normal swipe page (`k/total` grows) without changing what the user is looking at. Built for the author's own use, distributable as a community third-party extension.

**Core Value:** The user can line up multiple alternative replies and keep reading undisturbed; every completed generation shows up as a normal swipe page, and the chat is never corrupted.

### Constraints

- **Tech stack**: Browser ES module UI extension, `manifest.json` entry (`js`, `css`, `display_name`, `author`, `minimum_client_version`) — ST extension loader requirement
- **APIs**: Only ST public surface — `getContext()`, `eventSource`, `event_types`, `extension_settings[MODULE_NAME]`, `saveSettingsDebounced()`, `saveChatConditional()`; no core file modifications
- **Execution**: Serial, one generation at a time through ST native pipeline — single-flight global state
- **Data safety**: Never write `chat.jsonl` directly; only ST save functions — prevent chat corruption
- **Compatibility**: Current ST release branch; declare `minimum_client_version`
- **Security**: No secrets stored; reuse ST backend proxy
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Headline Recommendation
## Current ST Release (for `minimum_client_version`)
| Fact | Value | Confidence |
|------|-------|------------|
| Latest release tag | **1.19.0** (published 2026-09-14), `package.json` on `release` = `1.19.0` | HIGH (GitHub API + raw package.json) |
| Version check logic | `versionCompare(clientVersion, min)` = `localeCompare(..., {numeric:true}) > -1`; clientVersion parsed from `CLIENT_VERSION.split(':')[1]` | HIGH (utils.js, extensions.js) |
## Recommended Stack
### Core (runtime)
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Vanilla ES modules (JS) | ES2023 (browser-native) | Extension code | ST loads `js` entry via dynamic `import()` from `/scripts/extensions/<name>/<js>`; no build needed. Matches ST's own bundled extensions (quick-reply, connection-manager). |
| `SillyTavern.getContext()` | ST 1.19.0 | All ST API access | Docs: "more stable API"; direct internal imports "can break at any time". `globalThis.SillyTavern = { libs, getContext }` confirmed in script.js. Context exposes everything we need (list below). |
| jQuery / toastr / DOMPurify / lodash via ST | bundled | DOM + toasts | `$` and `toastr` are page globals (ST ESLint config lists `toastr`, `SillyTavern` as globals). Do not ship own copies. `SillyTavern.libs` exposes DOMPurify, lodash, etc. |
### manifest.json (current schema, verified from extensions.js + docs.sillytavern.app)
| Field | Use? | Notes |
|-------|------|-------|
| `display_name`, `js`, `author` | required | docs.sillytavern.app |
| `css`, `version`, `homePage` | yes | |
| `loading_order` | yes | higher loads later; sorted by `parseInt(loading_order)` then name. Pick >= 10 so we load after core ones (quick-reply=12, connection-manager=1). |
| `minimum_client_version` | yes | extension is *not loaded* (with UI error) if client older. |
| `auto_update` | yes (optional) | updates when ST version changes; only for `third-party`. |
| `hooks.activate` | **optional** | Bundled extensions use `"hooks":{"activate":"init"}` and export `init`. Hooks are exported functions from the entry module, no args, may be async, 5s timeout, errors logged not fatal. `activate` is invoked during activation (extensions.js ~L637). Simpler alternative: top-level `jQuery(async () => {...})` in index.js. **Recommend the hook form** (matches current core extensions); keep init fast (<5s) - register listeners, defer heavy work to `APP_READY`. Confidence MEDIUM-HIGH on timeout semantic (docs), HIGH on hook plumbing (source). |
| `hooks.install/update/delete/enable/disable/clean` | skip for v1 | `delete`/`clean` could later purge persisted queue from chat metadata; not needed. |
| `generate_interceptor` | **NO** | Names a `globalThis` function called as `(chat, contextSize, abort, type)` before generation (`runGenerationInterceptors`). Intended for prompt mutation/abort. Our design re-enters native `Generate`; an interceptor would run on every generation and is a conflict surface (Prompt Inspector / Deep-Swipe). Only reconsider if FR-4 (prompt snapshot) needs it - prefer `GENERATE_AFTER_DATA` / `CHAT_COMPLETION_PROMPT_READY` events instead. |
| `requires`, `optional` | omit | Deprecated (Extras modules). |
| `dependencies` | omit | Folder names of other extensions; would hard-block load. Keep Deep-Swipe/UserSwipes compat soft. |
| `i18n` | defer | `{ "de-de": "i18n/de-de.json" }`; `t` tagged-template available on context. |
### Settings, persistence, templates
| API | Usage | Confidence |
|-----|-------|------------|
| `const { extensionSettings, saveSettingsDebounced } = SillyTavern.getContext()` | `extensionSettings[MODULE_NAME] ??= {}`; merge defaults key-by-key (don't replace object, preserves new defaults after upgrade); `saveSettingsDebounced()` after change. Note context key is `extensionSettings` (camel), same object as `extension_settings`. | HIGH |
| `chatMetadata` + `saveMetadataDebounced()` | Per-chat persisted queue (decision D4). `getContext().chatMetadata` is a live object; `saveMetadataDebounced` (extensions.js L89) re-checks group/character didn't change before saving - safer than `saveMetadata` for async flows. Also `updateChatMetadata`, `saveMetadata`, `saveChat` (= `saveChatConditional`) on context. | HIGH |
| `renderExtensionTemplateAsync(extensionName, templateId, data)` | Loads `scripts/extensions/<extensionName>/<templateId>.html`, **sanitised + localised forced**. `extensionName` must be the folder path incl. `third-party/<folder>`, e.g. `'third-party/SillyTavern-QueuedSwipes'`. Keep a `const EXT_PATH`; do not hardcode in many places. Templates: `settings.html` (drawer), tiny HTML for the pager button. | HIGH (source), path form MEDIUM (verify at install location, `data/<user>/extensions` is served under same `third-party` namespace) |
| Settings drawer markup | Follow `inline-drawer` / `inline-drawer-toggle` / `inline-drawer-content` classes used in ST extension settings panel; append to `#extensions_settings2`. | MEDIUM (ST convention, not re-verified this session) |
### Slash commands
### Notifications and UI primitives
| API | Usage |
|-----|-------|
| `toastr.info/success/warning/error(msg, title, opts)` | Global; used by core (e.g. swipe warns "Cannot swipe while generating"). Use for per-item failure (FR-7), non-modal. Set `{ timeOut, preventDuplicates: true }` to avoid toast spam when several queue items fail. |
| `Popup`, `POPUP_TYPE`, `callGenericPopup` (on context) | Only for confirm dialogs (e.g. "resume N queued swipes?" on refresh). `callPopup`, `showLoader` etc. are deprecated. |
| `ModuleWorkerWrapper` (on context) | Available for polling workers; not needed - drive queue off events. |
### ST APIs this project should consume (all on `getContext()` in 1.19.0, source-verified)
| Need | API |
|------|-----|
| Chat data | `chat`, `chatMetadata`, `chatId`, `characterId`, `groupId` |
| Events | `eventSource`, `eventTypes` (`event_types` is the legacy alias) |
| Save | `saveChat` (alias of `saveChatConditional`), `saveMetadataDebounced`, `saveSettingsDebounced` |
| Swipe/generate | `swipe.right(event, {source, message})`, `swipe.to(event, direction, {source, message, forceMesId, forceSwipeId, forceDuration})`, `swipe.isAllowed()`, `swipe.state()`, `swipe.refresh()`, `swipe.show/hide`, `generate`, `stopGeneration`, `streamingProcessor` |
| Re-render | `updateMessageBlock`, `addOneMessage`, `reloadCurrentChat` |
### Dev tooling
| Tool | Version | Purpose | Why |
|------|---------|---------|-----|
| ESLint | **^9** (flat config `eslint.config.js`) | Lint | ST core is still on ESLint 8.57 + `.eslintrc.cjs` (legacy), but the official Extension-WebpackTemplate uses ESLint ^9.23 flat config with `@eslint/js` ^9.23 and `globals` ^16. New repo should use flat config. Port ST's style rules (below) so code matches core/community conventions. |
| `@eslint/js`, `globals` | ^9 / ^16 | Base rules / browser globals | Add `globals: { toastr:'readonly', SillyTavern:'readonly', $:'readonly', jQuery:'readonly' }` (mirrors ST's own config). |
| TypeScript (types only) | ^5.x | `tsc --noEmit -p jsconfig.json` | JSDoc type-check using ST `public/global.d.ts` (declares `SillyTavern.getContext()` types). ST's `jsconfig.json`: `module ESNext, target ES2023, moduleResolution Bundler, checkJs, strictNullChecks`. Docs: put `global.d.ts` next to manifest with `import '../../../../public/global';`. Works only when repo is checked out under `public/scripts/extensions/third-party/` (or symlinked) during dev. |
| Vitest | **^3 or later (verify at install)** | Unit tests | See Testing. |
| `eslint-plugin-jsdoc` | optional | JSDoc hygiene | ST uses ^48 with ESLint 8; check ESLint 9 compat before adding (version compat not verified). |
### Testing (MEDIUM/LOW: no community convention found)
- ST core has only server-side Jest (`tests/jest.config.json`: `testEnvironment: node`, no transform) + Playwright; nothing for browser extensions. The official TS/Webpack template ships **no tests**. A web search for community extension unit-test setups found nothing. Treat this as greenfield; don't copy a nonexistent convention.
- **Recommendation:** structure code so the queue is a pure module (`queue-core.js`: state machine, persistence (de)serialisation, stale-item rules, retry/error policy) with all ST access injected (`createQueue({ ctx })`). Test that with **Vitest** (native ESM, zero config for ESM-only project; Jest needs `--experimental-vm-modules` or transforms for ESM, ST's own Jest config uses `transform: {}` workaround). Inject a fake ctx: `{ chat:[], eventSource: new EventTarget-like emitter, eventTypes, swipe:{...}, saveChat: vi.fn() }`.
- Environment: `node` for the core; `jsdom` only if testing the DOM button module (optional, likely skip).
- Integration: **manual** checklist against a real ST 1.19.0 (staging + release). Playwright against a live ST instance is possible (ST core uses `eslint-plugin-playwright`) but is high-cost; defer, consider only if regressions recur.
## Alternatives Considered
| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Language/build | Plain JS + JSDoc types | TS + Webpack (`SillyTavern/Extension-WebpackTemplate`) | Template is real and maintained-ish (flat ESLint 9, ts-loader, webpack, terser, `globals.d.ts`), but needs committed `dist/index.js`, build step in dev loop, manifest `js: dist/index.js`. Its package.json devDependencies omit `webpack`/`typescript`/`terser-webpack-plugin` (only webpack-cli listed) - verify before adopting. Only worth it if codebase grows large or needs npm libs. Fallback: add `tsc`-only type-check (already included) before ever adding a bundler. |
| UI framework | jQuery + template HTML | `SillyTavern/Extension-ReactTemplate` | Overkill for a button, badge, and settings panel; React inside ST's DOM-mutating chat is a hazard. |
| API access | `SillyTavern.getContext()` | `import { ... } from '../../../script.js'` | Relative imports tie us to ST's internal layout (third-party path depth, renamed/moved exports); docs warn they "can break at any time". Exception: constants not on context (`SWIPE_SOURCE`), isolated in one shim. Note core bundled extensions use imports - but they ship with the app. |
| Slash command | `SlashCommandParser.addCommandObject(SlashCommand.fromProps)` | `registerSlashCommand` | Deprecated (st-context.js). |
| Prompt hook | Events (`GENERATE_AFTER_DATA`) | `generate_interceptor` | See manifest table. |
| Persistence | `chatMetadata` + `saveMetadataDebounced` | `localStorage`, `extension_settings` | Queue is per-chat; settings store is global and would leak across chats; localStorage is invisible to ST backups/exports. Never write `chat.jsonl` directly (locked decision). |
| Test runner | Vitest | Jest | ESM friction; Jest only appears in ST server tests. |
| Lint | ESLint 9 flat | ESLint 8 `.eslintrc.cjs` (ST core) | 8.x is EOL-track; template already uses 9. |
| Server plugin | none | `plugins/<name>` | Locked decision D1; also plugin-dependent extensions rejected from official listing. |
## Layout Convention
## Installation (dev only; nothing ships to users)
# Clone into ST for live dev (user-scoped alt: data/<user>/extensions/<name>)
# optional style parity
## What NOT to Use
- `registerSlashCommand`, `callPopup`, `showLoader/hideLoader`, `renderExtensionTemplate` (sync), `registerHelper`, `getTokenCount` - all `@deprecated` in st-context.js.
- `generate_interceptor` (see above), `requires`/`optional`/`dependencies`.
- Direct `fetch` to `/api/chats/save` or any file write (locked decision).
- Concurrent `Generate('swipe')` (locked decision; `isSwipingAllowed()` exists precisely to block it).
- Bundled copies of jQuery/toastr/lodash/DOMPurify.
- Webpack/React template for v1.
## Confidence Summary
| Area | Level | Basis |
|------|-------|-------|
| ST version / manifest schema / hooks / interceptor | HIGH | `release` source (extensions.js, st-context.js, package.json) + docs.sillytavern.app |
| getContext surface, slash command pattern, event names, swipe API | HIGH | Source read 2026-10-25 |
| Template path form, settings drawer markup | MEDIUM | Convention; verify in Phase 1 |
| ESLint 9 + stylistic plugin / Vitest versions | MEDIUM-LOW | Not pinned; verify with `npm view` at scaffold time |
| Testing approach | MEDIUM | Own design; no community precedent found |
| Webpack template details | MEDIUM | README/package.json read; commit recency not visible |
## Sources
- https://raw.githubusercontent.com/SillyTavern/SillyTavern/release/public/scripts/st-context.js (HIGH)
- https://raw.githubusercontent.com/SillyTavern/SillyTavern/release/public/scripts/extensions.js (HIGH)
- https://raw.githubusercontent.com/SillyTavern/SillyTavern/release/public/script.js (swipe, isSwipingAllowed, `globalThis.SillyTavern`) (HIGH)
- https://raw.githubusercontent.com/SillyTavern/SillyTavern/release/public/scripts/events.js (HIGH)
- https://raw.githubusercontent.com/SillyTavern/SillyTavern/release/.eslintrc.cjs, jsconfig.json, package.json, tests/jest.config.json (HIGH)
- https://raw.githubusercontent.com/SillyTavern/SillyTavern/release/public/scripts/extensions/connection-manager/{manifest.json,index.js} (HIGH, reference implementation)
- https://api.github.com/repos/SillyTavern/SillyTavern/releases/latest -> 1.19.0 (HIGH)
- https://docs.sillytavern.app/for-contributors/writing-extensions/ (HIGH)
- https://github.com/SillyTavern/Extension-WebpackTemplate (MEDIUM)
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
