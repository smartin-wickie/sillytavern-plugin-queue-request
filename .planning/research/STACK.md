# Technology Stack

**Project:** SillyTavern Queued Swipes (UI extension)
**Researched:** 2026-10-25
**Overall confidence:** HIGH for ST API surface (read from `release` branch source); MEDIUM for testing (no community convention found).

## Headline Recommendation

**Plain ES-module JavaScript, no bundler, no runtime dependencies.** Type-check with `jsconfig.json` + JSDoc (`checkJs`) against ST's `public/global.d.ts`. Get every ST API through `SillyTavern.getContext()` (the global), never via relative `import ... from '../../../script.js'`. Use ESLint (flat config, ST's style rules) and Vitest for the pure-logic queue core only.

Rationale: the extension is small (queue state machine + one button + settings + one slash command). A Webpack/TS toolchain adds a build step, a committed `dist/`, and `importFromUrl` hacks for zero benefit. ST's own docs say bundling is for extensions that need npm deps (React/Vue); we need none.

## Current ST Release (for `minimum_client_version`)

| Fact | Value | Confidence |
|------|-------|------------|
| Latest release tag | **1.19.0** (published 2026-09-14), `package.json` on `release` = `1.19.0` | HIGH (GitHub API + raw package.json) |
| Version check logic | `versionCompare(clientVersion, min)` = `localeCompare(..., {numeric:true}) > -1`; clientVersion parsed from `CLIENT_VERSION.split(':')[1]` | HIGH (utils.js, extensions.js) |

**Prescription:** `"minimum_client_version": "1.19.0"`. Justification is not cosmetic: the APIs this project depends on (`getContext().swipe.{right,to,isAllowed,state}`, `SWIPE_SOURCE.AUTO_SWIPE/SLASH_COMMAND`, manifest `hooks`) exist in 1.19.0 and I have NOT verified which earlier version introduced them. Do not claim an older floor without testing. Note a user on `staging` may be on a higher unreleased 1.19.x/1.20 - floor still satisfied.

## Recommended Stack

### Core (runtime)
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Vanilla ES modules (JS) | ES2023 (browser-native) | Extension code | ST loads `js` entry via dynamic `import()` from `/scripts/extensions/<name>/<js>`; no build needed. Matches ST's own bundled extensions (quick-reply, connection-manager). |
| `SillyTavern.getContext()` | ST 1.19.0 | All ST API access | Docs: "more stable API"; direct internal imports "can break at any time". `globalThis.SillyTavern = { libs, getContext }` confirmed in script.js. Context exposes everything we need (list below). |
| jQuery / toastr / DOMPurify / lodash via ST | bundled | DOM + toasts | `$` and `toastr` are page globals (ST ESLint config lists `toastr`, `SillyTavern` as globals). Do not ship own copies. `SillyTavern.libs` exposes DOMPurify, lodash, etc. |

### manifest.json (current schema, verified from extensions.js + docs.sillytavern.app)

```json
{
    "display_name": "Queued Swipes",
    "loading_order": 100,
    "js": "index.js",
    "css": "style.css",
    "author": "<name>",
    "version": "0.1.0",
    "homePage": "https://github.com/<you>/<repo>",
    "minimum_client_version": "1.19.0",
    "auto_update": true,
    "hooks": { "activate": "init" }
}
```

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
Use the object API (the string `registerSlashCommand` is **deprecated** per st-context.js):

```js
const { SlashCommandParser, SlashCommand, SlashCommandArgument, ARGUMENT_TYPE } = SillyTavern.getContext();
SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'queueswipe',
    helpString: 'Queue N additional swipes for the last AI message.',
    returns: 'number queued',
    unnamedArgumentList: [SlashCommandArgument.fromProps({
        description: 'count', typeList: [ARGUMENT_TYPE.NUMBER], defaultValue: '1', isRequired: false })],
    callback: async (namedArgs, unnamed) => String(await enqueue(Number(unnamed) || 1)),
}));
```
Also available on context: `SlashCommandNamedArgument`, `SlashCommandEnumValue`, `executeSlashCommandsWithOptions`. Pattern confirmed from connection-manager/index.js (`SlashCommandParser.addCommandObject(SlashCommand.fromProps({...}))`). Callbacks return strings. Confidence HIGH. Register in `init`/`APP_READY`.

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

**Key finding for architecture (flag to roadmap):** 1.19.0 exposes a first-class `swipe` API. `swipe()` bypasses the generating/`isSwipingAllowed` checks when `source` is one of `DELETE, BACK, AUTO_SWIPE, SLASH_COMMAND, SWIPE_PICKER`, and accepts `forceMesId`, `forceSwipeId`. `isSwipingAllowed()` = chat non-empty AND swipes enabled/not hidden AND `!isGenerating()` AND `swipeState === NONE`. There is also a new `swipe-picker.js`. This invalidates parts of 01-architecture-analysis ([Recall] items) and should be re-read in the Phase 1 spike. `SWIPE_SOURCE` is in `scripts/constants.js` (NOT on the context object) - needs a direct import or a string literal; direct import breaks the "context only" rule, so decide in the spike (a small, isolated `st-internals.js` shim is the right place for any unavoidable internal import).

Verified event names (events.js): `APP_READY`, `MESSAGE_SWIPED`, `MESSAGE_SENT`, `MESSAGE_EDITED`, `MESSAGE_DELETED`, `MESSAGE_UPDATED`, `MESSAGE_SWIPE_DELETED`, `CHAT_CHANGED` (= `'chat_id_changed'`), `GENERATION_STARTED`, `GENERATION_STOPPED`, `GENERATION_ENDED`, `GENERATE_AFTER_DATA`, `CHAT_COMPLETION_PROMPT_READY`. All previously `[Recall]` names are confirmed to exist.

### Dev tooling
| Tool | Version | Purpose | Why |
|------|---------|---------|-----|
| ESLint | **^9** (flat config `eslint.config.js`) | Lint | ST core is still on ESLint 8.57 + `.eslintrc.cjs` (legacy), but the official Extension-WebpackTemplate uses ESLint ^9.23 flat config with `@eslint/js` ^9.23 and `globals` ^16. New repo should use flat config. Port ST's style rules (below) so code matches core/community conventions. |
| `@eslint/js`, `globals` | ^9 / ^16 | Base rules / browser globals | Add `globals: { toastr:'readonly', SillyTavern:'readonly', $:'readonly', jQuery:'readonly' }` (mirrors ST's own config). |
| TypeScript (types only) | ^5.x | `tsc --noEmit -p jsconfig.json` | JSDoc type-check using ST `public/global.d.ts` (declares `SillyTavern.getContext()` types). ST's `jsconfig.json`: `module ESNext, target ES2023, moduleResolution Bundler, checkJs, strictNullChecks`. Docs: put `global.d.ts` next to manifest with `import '../../../../public/global';`. Works only when repo is checked out under `public/scripts/extensions/third-party/` (or symlinked) during dev. |
| Vitest | **^3 or later (verify at install)** | Unit tests | See Testing. |
| `eslint-plugin-jsdoc` | optional | JSDoc hygiene | ST uses ^48 with ESLint 8; check ESLint 9 compat before adding (version compat not verified). |

**ST core ESLint style rules to copy** (from `.eslintrc.cjs`, release branch; HIGH): `quotes: single`, `semi: always`, `indent: 4 (SwitchCase 1)`, `comma-dangle: always-multiline`, `eol-last`, `no-trailing-spaces`, `object-curly-spacing: always`, `brace-style: 1tbs (allowSingleLine)`, `keyword-spacing`, `space-before-function-paren {anonymous: always, named: never, asyncArrow: always}`, `padded-blocks: never`, `no-multiple-empty-lines max 2`, `no-unused-vars {args:'none'}`, `arrow-spacing`, `no-unused-expressions {allowShortCircuit, allowTernary}`. Note ESLint 9 removed formatting rules from core (deprecated in 8.53, moved to `@stylistic/eslint-plugin`); to keep these rules use `@stylistic/eslint-plugin` (version: verify at install). Alternative: skip style rules, keep only correctness rules - acceptable, style isn't enforced on third-party code.

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

```
SillyTavern-QueuedSwipes/        (git repo root == folder under third-party/)
  manifest.json
  index.js                       entry; exports init (hooks.activate)
  style.css
  settings.html                  rendered via renderExtensionTemplateAsync
  src/                           (ES modules, relative imports inside extension are fine)
    queue-core.js                pure, tested
    st-adapter.js                the ONLY file touching getContext()/internals
    ui.js, settings.js, commands.js
  test/                          vitest
  global.d.ts                    ST types
  jsconfig.json
  eslint.config.js
  package.json                   devDependencies only (private, no runtime deps)
  README.md, LICENSE
```
Convention from bundled extensions: `manifest.json`+`index.js`+`style.css`+`*.html` templates at root; community uses repo name `SillyTavern-<Name>` / `Extension-<Name>`. `.github/` and `node_modules` are harmless but add `.gitignore`. Folder name matters at runtime (`third-party/<folder>` in template path).

## Installation (dev only; nothing ships to users)

```bash
# Clone into ST for live dev (user-scoped alt: data/<user>/extensions/<name>)
cd SillyTavern/public/scripts/extensions/third-party
git clone <repo> SillyTavern-QueuedSwipes && cd SillyTavern-QueuedSwipes

npm init -y   # private, "type": "module"
npm install -D eslint@^9 @eslint/js@^9 globals@^16 typescript@^5 vitest
# optional style parity
npm install -D @stylistic/eslint-plugin
```
Users install via ST "Install extension" with the git URL; no npm install on their side. Reload the browser page after edits (no HMR).

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
