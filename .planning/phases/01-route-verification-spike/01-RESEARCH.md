# Phase 1: Route Verification Spike - Research

**Researched:** 2026-10-25
**Domain:** SillyTavern 1.19.0 generation internals (`Generate` dryRun, transport, abort, interceptors), live-instance spike on Windows with local llama.cpp
**Confidence:** MEDIUM-HIGH (source facts HIGH, read from the 1.19.0 tag; runtime behavior unverified until the spike runs)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Use the user's existing local ST install at `E:\SillyTavern`. It is on the `release` branch, currently at **1.14.0**. The plan must include updating it to 1.19.0 (`git pull` on release + `npm install`) and confirming the version before any test.
- **D-02:** Do not take a fresh backup before the update. The user says the existing backup (`E:\SillyTavern\data\default-user.7z`) is enough. Do not add a backup step.
- **D-03:** Run the spike in a throwaway character/chat. Never touch the user's real chats.
- **D-04:** Use one local llama.cpp server process for both backends:
  - **Chat Completion:** ST source "Custom (OpenAI-compatible)" pointing at llama.cpp `/v1/chat/completions`.
  - **Text Completion:** ST textgen type `llamacpp`.
  - Both backends use the same model, so any prompt diff reflects ST prompt-building differences, not the model. Zero API spend.
- **D-05:** Test streaming on and off for both backends: 4 combinations in total. This covers criterion (c): both `sendOpenAIRequest` return shapes (async generator vs JSON) and the TC streaming path.
- **D-06:** Verify interceptor (Vectors) parity, criterion (e), by reading the source only (`runGenerationInterceptors`, Vectors extension). Do not run Vectors live. Record the parity verdict with its confidence level, which is at most MEDIUM.
- **D-07:** During the spike, turn off all 26 user extensions in `data/default-user/extensions/` with the Extensions UI toggle. Record the list of disabled extensions so they can be turned back on after the spike and for Phase 5. The list includes Extension-PromptInspector.
- **D-08:** Write the spike as a minimal real extension (`manifest.json` + `index.js`), not as devtools console snippets. Reason: it must exercise the real ES-module import paths from third-party extension depth (the future `st-bridge.js` imports).
- **D-09:** Keep the spike code in the repo under `spike/` as preserved, re-runnable evidence. Do **not** grow it into Phase 2 production code. Phase 2 starts fresh, with tests.
- **D-10:** Install the spike into `E:\SillyTavern` by creating a directory junction from `public/scripts/extensions/third-party/<name>` to the repo's spike folder. Edits are then live. The junction also lets tooling see ST `public/global.d.ts`.
- **D-11:** Record evidence in `.planning/phases/01-route-verification-spike/SPIKE-REPORT.md`: a verdict table for go/no-go criteria a-f, the policies, the chosen route, the reasoning. Save captured prompts (queued-swipe capture vs native swipe, per backend and streaming mode) as raw JSON dump files so the diff can be reproduced.

### Claude's Discretion
- **Go/no-go rule:** Spike R1 first. Keep R2 as the documented fallback. Treat criteria (a) no-side-effect capture, (c) both return shapes, and (d) no `abortController` corruption as hard blockers for R1. Vectors parity loss (e) and the squash/itemized-prompt gaps are acceptable if documented. If the result is ambiguous, show the evidence to the user at a checkpoint before locking the route.
- **Stop-with-partial policy:** Default is to discard partials. Confirm the actual behavior at runtime.
- **auto_swipe / auto-continue policy:** Confirm whether they can be reached. Default is that the extension never triggers them, and it detects them and warns.
- **Interceptor gap policy:** Default is to document the gap and show a toast when any active extension declares `generate_interceptor`.
- **Spike extension folder name** and the exact layout inside `spike/`.

### Deferred Ideas (OUT OF SCOPE)
None. Discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SPIKE-01 | Route (R1 vs R2) chosen with live 1.19.0 evidence, recorded in PROJECT.md Key Decisions | Criteria a-f made concrete (Go/No-Go section); R1 mechanics verified in source; R2 side effects cited by line |
| SPIKE-02 | Captured queued-swipe prompt matches native swipe prompt on one CC and one TC backend, diff recorded | Capture design, dump format, normalization, expected gaps (Prompt Diff section) |
| SPIKE-03 | Stop-with-partial, `auto_swipe` reachability, interceptor parity verified and policy recorded | Source analysis for all three plus runtime tests to run; recommended policies |
| SPIKE-04 | PROJECT.md and CLAUDE.md "serial through native pipeline" reworded | Exact current phrases/lines to change; replacement wording per route; grep acceptance checks |
</phase_requirements>

## Summary

The 1.19.0 source confirms the R1 design is mechanically sound and reveals a cheaper fix for the biggest R1 risk. `Generate(type, opts, dryRun)` replaces the module-private `abortController` only `if (!(abortController && signal))` (script.js L4302). Passing `{ signal: <own AbortSignal> }` to the dry run therefore skips the replacement, so a dry run no longer clobbers the controller used by a concurrent native generation. This was not in the earlier ARCHITECTURE.md research. Two smaller clobbers remain (`generation_started` L4293, `setGenerationProgress(0)` L4291), so the idle gate is still required. [VERIFIED: raw.githubusercontent.com/SillyTavern/SillyTavern/1.19.0/public/script.js]

`sendOpenAIRequest` IS exported from `openai.js` (export block L85-98) and takes `(type, messages, signal, {jsonSchema})`. It decides streaming internally from `oai_settings.stream_openai`, so the adapter gets an async-generator function when streaming and a parsed JSON object otherwise. Text Completion `generate_data` has no `stream` key unless `generateTextGenWithStreaming` sets it, so a plain `fetch` of the captured body to `/api/backends/text-completions/generate` always returns JSON, regardless of the user's TC streaming toggle. The CC request body (sampler params) is rebuilt at send time from live `oai_settings`; the captured CC payload is only `{prompt: messages[]}`.

Fidelity gaps under R1 are all source-confirmed: interceptors skipped (L4562), CC `squashSystemMessages` skipped (openai.js L1608), World Info sticky/cooldown timed effects skipped on dry run (world-info.js L683, L731, L748), no itemized prompt (L5336+ is after the dry-run return). Newly found: non-streaming `sendOpenAIRequest` with `type !== 'quiet'` writes logprobs into in-memory state keyed to the visible last message (openai.js L3203-3206 via `saveLogprobsForActiveMessage`); this only fires when the backend returns logprobs. Vectors' interceptor both sets an extension prompt AND splices retrieved messages out of the `chat` array it is handed, so pre-calling it on a copy cannot reproduce native parity (MEDIUM-confidence verdict from source: partial at best).

**Primary recommendation:** Build the spike extension around five instrumented operations (idle-gated dry-run capture with own `signal`, native-swipe prompt dump, own transport handling both return shapes, side-effect snapshot diff, overlap test), run the 4-combination matrix, expect R1 to pass, and treat Vectors/squash/WI-sticky as documented gaps. Dump evidence to `data/default-user/user/files/` through `/api/files/upload` so no manual file moving is needed.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Prompt assembly (dry-run capture) | Browser / Client (ST page JS) | — | `Generate` runs in the page; there is no server-side prompt builder |
| LLM transport | Browser (fetch to ST backend) | API / Backend (ST Express proxy to llama.cpp) | Page posts to `/api/backends/{chat,text}-completions/generate`; ST server proxies and holds secrets |
| Evidence persistence (dumps) | API / Backend (`/api/files/upload`) | Browser (Blob download fallback) | Browser cannot write to disk; upload endpoint writes to `data/<user>/user/files/` |
| Swipe append / chat save | Browser (ST `saveChatConditional`) | API (`/api/chats/save`) | Out of scope for Phase 1 (Phase 2); only side-effect verification here |
| Model serving | External process (llama-server) | — | One local process serves both CC and TC |
| Doc rewording | Repo (markdown) | — | SPIKE-04 |

## Standard Stack

No npm/pip packages are installed by this phase. The spike is plain ES-module JS loaded by ST; the diff tool is a plain Node script using only `node:fs`/`node:util`.

### Core
| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| SillyTavern | 1.19.0 (`release` is 1 commit ahead of tag; record `git describe` + package.json after pull) | System under test | Locked by D-01 |
| llama.cpp `llama-server` | bundled `llama-server.exe` in text-generation-webui's `llama_cpp_binaries` 0.62.0+cu124 (version of the llama.cpp build unverified; check `--version`) | Local backend for CC + TC | Locked by D-04 |
| Node | 22.17.0 (present; ST needs >=18) | Runs ST and the diff script | Installed |
| Browser (Chromium-based) | any | Hosts ST UI | `showDirectoryPicker`/Blob optional only |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `/api/files/upload` for dumps | Blob `<a download>` | Needs manual move into repo; use only as fallback |
| `/api/files/upload` | `showDirectoryPicker()` | Needs user gesture + permission each session |
| Plain `node` diff script | Vitest/jest | Spike has no test framework requirement; do not add dependencies |

**Installation:** none for the repo. Obtain llama.cpp from github.com/ggml-org/llama.cpp/releases (Windows zip, pick CPU/Vulkan/CUDA by GPU) or build from source. [ASSUMED: release asset naming; README lists Docker images and source build only, no binary location.]

**Models already on disk** (found via `find`): `D:\old-models\Chat\dolphin-2.9-llama3-8b.Q8_0.gguf`, `Cream-Phi-3-14B-v1-Q8_0.gguf`, others. Use a model whose GGUF has an embedded chat template (needed for `/v1/chat/completions`). [VERIFIED: filesystem; template presence ASSUMED]

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| (none) | — | — | — | — | not run (no packages) | n/a |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none
The only install step is ST's own `npm install` (its lockfile), already used by the user on this machine. The llama.cpp binary is an external download from the official `ggml-org/llama.cpp` repo; the plan should gate it behind a human-verify checkpoint.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| ST install `E:\SillyTavern` | all | yes | 1.14.0-9-g765c76ea8, `release...origin/release [behind 523]` | — |
| git | update ST | yes | 2.55.0 | — |
| Node | ST | yes | 22.17.0 | — |
| llama-server binary | D-04 | yes (bundled, version unchecked) | `E:\text-generation-webui\installer_files\env\Lib\site-packages\llama_cpp_binaries\bin\llama-server.exe` (package llama_cpp_binaries 0.62.0+cu124, CUDA 12 DLLs alongside) | Run `llama-server.exe --version` first; if too old for `--jinja`/chat templates, download a current release zip from ggml-org/llama.cpp or use Docker `ghcr.io/ggml-org/llama.cpp:server`. `D:\Downloads\_DownloadArchives\koboldcpp_cu12.exe` also exists but is not what D-04 specifies |
| GGUF models | D-04 | yes | `D:\old-models\Chat\*.gguf` | — |
| `public/scripts/extensions/third-party/` | junction (D-10) | yes, empty, gitignored | — | — |
| Free ports | llama-server | n/a | ST config `port: 8000`; `StartPort8001.bat` runs ST on 8001 | use 8080 for llama-server |

**Local repo state that will bite the update:** `package-lock.json` is modified in `E:\SillyTavern` (13 deletions, caused by `npm install --omit=dev` in `StartPort8001.bat`), and `StartPort8001.bat` is untracked. `git pull` onto 523 new commits will likely refuse. Run `git checkout -- package-lock.json` (discarding that regenerated lockfile diff) before `git pull`; do not stash user data. `public/scripts/extensions/third-party/` is gitignored (.gitignore L18, L54), so the junction does not dirty the tree. [VERIFIED: git status + 1.19.0 .gitignore]

**Missing with no fallback:** none. The bundled llama-server is a build of unknown age; the `--port` default and `--jinja` default quoted in Pitfall 3 come from current master README and may differ in that build, so pass flags explicitly (`--jinja` included).

## Architecture Patterns

### System Architecture Diagram (spike data flow)

```
 Operator (console / settings buttons: window.qsSpike.*)
        |
        v
 [spike/index.js  in ST page]  -- imports --> /script.js, /scripts/openai.js, /scripts/extensions.js, /scripts/power-user.js, /scripts/reasoning.js
        |
        |-- (1) snapshot(before)   chat hash, chat_metadata hash, #chat scrollTop, DOM hash of last .mes, swipe arrows, #mes_stop, isGenerating()
        |-- (2) idle gate: !isGenerating() && swipe.state()==='none'
        |-- (3) QUEUED CAPTURE: generate('swipe', {signal: own}, true)
        |         |-> GENERATION_STARTED(type,params,dryRun=true)
        |         |-> [interceptors SKIPPED]
        |         |-> CHAT_COMPLETION_PROMPT_READY({chat,dryRun}) / GENERATE_AFTER_DATA(generate_data, true)  --> clone -> dump A
        |-- (4) snapshot(after); diff(before, after) must be empty  => criterion (a)
        |-- (5) OWN TRANSPORT
        |         CC: sendOpenAIRequest('swipe', A.prompt, ownSignal)  --> function (stream on) | object (stream off)
        |         TC: fetch('/api/backends/text-completions/generate', body=A)      --> JSON always
        |         -> extractMessageFromData / extractReasoningFromData / cleanUpMessage  => text   (NOT appended in the spike)
        |-- (6) NATIVE SWIPE (user clicks swipe arrow; one-shot listener on GENERATE_AFTER_DATA dryRun=false) --> dump B
        v
 /api/files/upload (base64 JSON)  -->  E:\SillyTavern\data\default-user\user\files\qs-*.json
        v
 node spike/tools/diff-captures.mjs A B  -->  diff report  --> SPIKE-REPORT.md
```

### Recommended Project Structure
```
spike/
├── manifest.json            # display_name, js, loading_order, minimum_client_version 1.19.0, hooks.activate "init"
├── index.js                 # imports (bridge-like), instrumented ops, window.qsSpike, tiny settings panel
├── st-imports.js            # OPTIONAL: all internal imports in one file (mirrors future st-bridge.js)
├── tools/diff-captures.mjs  # node script, no deps: normalize + structural diff
└── README.md                # how to junction, run matrix, where dumps land
.planning/phases/01-route-verification-spike/
├── SPIKE-REPORT.md          # verdict table a-f, policies, route, reasoning (D-11)
└── captures/                # raw JSON dumps copied from data/default-user/user/files/
```

### Pattern 1: Third-party extension internal imports (verified paths)
A file at `/scripts/extensions/third-party/<name>/index.js` resolves `..` to `third-party`, `../..` to `extensions`, `../../..` to `scripts`, `../../../..` to the web root. [VERIFIED: URL arithmetic; bundled extensions at depth 1 use `../../../script.js`]
```javascript
// spike/st-imports.js  -- the future st-bridge.js import list, proven by loading
export { Generate, isGenerating, cleanUpMessage, extractMessageFromData, stopGeneration,
         getGeneratingApi, getGeneratingModel, ensureSwipes, updateSwipeCounter,
         isStreamingEnabled, getGenerateUrl, getRequestHeaders } from '../../../../script.js';
export { sendOpenAIRequest, oai_settings } from '../../../openai.js';
export { extractReasoningFromData, parseReasoningFromString } from '../../../reasoning.js';
export { extensionNames, getExtensionManifest, extension_settings } from '../../../extensions.js';
export { power_user } from '../../../power-user.js';
export { eventSource, event_types } from '../../../events.js';
```
Each name must be verified to be exported at 1.19.0; `isGenerating` (script.js L604), `cleanUpMessage` (L6442), `extractMessageFromData` (L6276), `getGeneratingApi/Model` (L7039/7050), `ensureSwipes` (L6837), `getGenerateUrl` (L6172), `isStreamingEnabled` (L3517), `sendOpenAIRequest` (openai.js export block L93), `extractReasoningFromData` (reasoning.js L112), `extensionNames` (extensions.js L21), `getExtensionManifest` (L524) were confirmed. Not confirmed this session: `getRequestHeaders` location (it is on `getContext()`; use `getContext().getRequestHeaders` rather than importing), `power_user` export name (use `getContext().powerUserSettings`), `updateSwipeCounter` export (confirmed L9129). A failed named import throws at module load, so a missing export surfaces immediately; that is itself useful evidence for the bridge list. [HIGH for confirmed, MEDIUM for the rest]

### Pattern 2: Idle-gated dry-run capture with own signal
```javascript
// Source: script.js L4290-4303 (Generate), L5318-5322 (GENERATE_AFTER_DATA then dryRun return)
async function captureSwipePrompt(ownSignal) {
  const ctx = SillyTavern.getContext();
  if (isGenerating() || ctx.swipe.state() !== 'none') throw new Error('not idle');
  let armed = false, captured = null;
  const onStart = (type, _params, dryRun) => { if (type === 'swipe' && dryRun === true) armed = true; };
  const onData  = (data, dryRun) => { if (armed && dryRun === true) { captured = structuredClone(data); armed = false; } };
  eventSource.on(event_types.GENERATION_STARTED, onStart);
  eventSource.on(event_types.GENERATE_AFTER_DATA, onData);
  eventSource.makeLast(event_types.GENERATE_AFTER_DATA, onData); // see final state after other listeners
  try { await ctx.generate('swipe', { signal: ownSignal }, true); }   // signal => abortController NOT replaced (L4302)
  finally {
    eventSource.removeListener(event_types.GENERATION_STARTED, onStart);
    eventSource.removeListener(event_types.GENERATE_AFTER_DATA, onData);
  }
  if (!captured) throw new Error('capture failed');
  return captured;
}
```
`GENERATION_STARTED` is emitted as `(type, paramsObject, dryRun)` (L4299), so dryRun is the third listener argument. `eventSource.emit` awaits listeners sequentially and swallows listener errors (eventemitter.js L130-153); `makeLast`/`makeFirst` exist (L66/L90). [VERIFIED]

### Pattern 3: Own transport handling both return shapes
```javascript
// Source: openai.js L3138-3230 (sendOpenAIRequest), textgen-settings.js L1289-1340
async function sendCaptured(captured, signal) {
  const api = SillyTavern.getContext().mainApi;
  let raw, shape;
  if (api === 'openai') {
    const r = await sendOpenAIRequest('swipe', captured.prompt, signal);
    if (typeof r === 'function') {            // streaming: async generator FUNCTION
      shape = 'generator'; let last = { text: '', state: {} };
      for await (const chunk of r()) last = chunk;   // text accumulates; state.reasoning/.signature
      raw = { text: last.text, reasoning: last.state?.reasoning ?? '', signature: last.state?.signature ?? '' };
    } else { shape = 'json'; raw = r; }       // parsed JSON incl. choices[0].message.content
  } else {                                     // textgenerationwebui
    shape = 'json';
    const res = await fetch('/api/backends/text-completions/generate', {
      method: 'POST', headers: SillyTavern.getContext().getRequestHeaders(),
      body: JSON.stringify(captured), signal, cache: 'no-cache' });
    if (!res.ok) throw await res.json();
    raw = await res.json();
  }
  return { shape, raw };
}
```
Use `getGenerateUrl('textgenerationwebui')` instead of the literal URL if importing it. For JSON, text = `extractMessageFromData(raw)`, reasoning = `extractReasoningFromData(raw)`, then `cleanUpMessage({getMessage, isImpersonate:false, isContinue:false, displayIncompleteSentences:false})` (matches native onSuccess, script.js L5470-5500). [VERIFIED]

### Pattern 4: Side-effect snapshot (criterion a)
Capture before/after and require equality of: stable-stringified hash of `chat`; `chat_metadata` hash; `swipe_id` and `swipes.length` of the last message; `document.querySelector('#chat').scrollTop`; hash of `outerHTML` of the last `.mes`; `#mes_stop` computed display; swipe-arrow visibility (`.swipe_right` display); `#send_but` disabled state; `isGenerating()`; `swipe.state()`. Also record an ordered event log (subscribe to GENERATION_STARTED, GENERATION_AFTER_COMMANDS, GENERATE_BEFORE/AFTER_COMBINE_PROMPTS, CHAT_COMPLETION_PROMPT_READY, GENERATE_AFTER_DATA, GENERATION_ENDED, GENERATION_STOPPED, MESSAGE_RECEIVED, MESSAGE_SWIPED, CHAT_CHANGED, CHARACTER_MESSAGE_RENDERED) with the dryRun flag where present; any `MESSAGE_*`/`CHARACTER_MESSAGE_RENDERED` event during a queued item is a failure of (a).

### Anti-Patterns to Avoid
- **Dry-running without `signal`:** replaces `abortController` (L4302-4304); only acceptable on an idle ST and only as the negative control in the (d) test.
- **Calling `sendGenerationRequest`/`sendStreamingRequest` from context:** they use the private `abortController` / `streamingProcessor.abortController` (L6118, L6154) and cannot be cancelled independently.
- **Dumping `CHAT_COMPLETION_SETTINGS_READY` unredacted:** the body can include `proxy_password`, `custom_include_headers`, `custom_url` (openai.js L2852, L2923-2926). Redact before upload.
- **Treating a resolved `generate()` as capture success:** it resolves `undefined` on early exits (group chats, Horde, no character). Success = `captured !== null`.
- **Removing a junction with a recursive delete:** use `cmd /c rmdir <junction>` so repo contents are not deleted.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Prompt assembly | own prompt builder | `Generate('swipe', {signal}, true)` + `GENERATE_AFTER_DATA` | WI, depth injection, instruct formatting, regex, `coreChat.pop()` for swipe (L4497) are all inside |
| CC request body / stream parsing | own fetch + SSE parser | `sendOpenAIRequest('swipe', messages, signal)` | provider-specific reply/reasoning extraction in `getStreamingReply` |
| Post-processing | own regex/trim | `cleanUpMessage`, `extractMessageFromData`, `extractReasoningFromData`, `parseReasoningFromString` | exactly what native `onSuccess` calls |
| File dump | Blob + manual move | `POST /api/files/upload {name, data(base64)}` | writes to `data/<user>/user/files/`; filename regex `^[a-zA-Z0-9_\-.]+$`, no leading dot |
| Detecting interceptor extensions | scanning DOM | `extensionNames` + `getExtensionManifest(name).generate_interceptor` + `typeof globalThis[fn]==='function'` | `manifests` is module-private; disabled extensions never define the global |
| JSON diff | ad hoc eyeballing | small Node script with key-sorted stringify + line diff | reproducible, committed with evidence |

**Key insight:** every piece R1 needs already exists as an export; the spike's job is to prove they compose without side effects, not to write new logic.

## Runtime State Inventory

Not a rename phase, but the spike mutates the user's live environment, so state is inventoried:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `E:\SillyTavern\data\default-user\` user data migrates 1.14.0 -> 1.19.0 on first start; `settings.json` holds `extension_settings.disabledExtensions` | Existing backup per D-02; before disabling, copy the current `disabledExtensions` array into SPIKE-REPORT |
| Live service config | llama-server process; ST connection settings (CC Custom URL, TC server URL) stored in `settings.json` | Note original API/preset so it can be restored after the spike; use throwaway char/chat |
| OS-registered state | none | None - verified, nothing is registered; junction is a filesystem object |
| Secrets/env vars | Custom CC key can be blank for llama.cpp; if a dummy key is set it is stored in `secrets.json` | Do not dump request bodies unredacted |
| Build artifacts | `package-lock.json` locally modified; `node_modules` from 1.14.0 | `git checkout -- package-lock.json`, then `npm install` after pull |

## Common Pitfalls

### Pitfall 1: `git pull` blocked by regenerated lockfile
**What goes wrong:** pull aborts with local changes to `package-lock.json`. **Why:** `StartPort8001.bat` runs `npm install` on every launch. **Avoid:** discard the lockfile diff first; confirm with `git status`. **Warning sign:** "Your local changes would be overwritten by merge".

### Pitfall 2: Version drift between researched tag and installed release
`release` is 1 commit ahead of the `1.19.0` tag. After pull record `git describe --tags`, `git rev-parse HEAD`, and package.json version in SPIKE-REPORT. If a line number differs, trust the installed file.

### Pitfall 3: llama-server defaults
README lists `--port` default 9931 (not the historic 8080), `--jinja` default enabled. Always pass `--port 8080 --host 127.0.0.1` explicitly and `-c 8192`. `cache_prompt` defaults true (nondeterminism possible); use `temperature 0`, small `max_tokens` (~64), and fixed seed for repeatability. [CITED: github.com/ggml-org/llama.cpp tools/server/README.md]

### Pitfall 4: Non-deterministic prompt content breaks the diff
Macros like `{{random}}`, `{{time}}`, `{{date}}`, `{{idle_duration}}`, `{{roll}}`, probability-based WI entries make two prompts differ for reasons unrelated to the route. Use a throwaway character with no such macros and no probabilistic WI; the diff script should report any difference and the operator must classify it.

### Pitfall 5: Sticky/cooldown WI timed effects missing on dry run
`WorldInfoTimedEffects.checkTimedEffects` skips sticky and cooldown when `isDryRun` (world-info.js L683-687, L731, L748). A WI entry with sticky N activated by an earlier message can be absent from a queued capture but present in a native swipe. Include one sticky WI entry in the test character so this gap is measured, not guessed. [VERIFIED source; runtime effect to be confirmed]

### Pitfall 6: Squash cannot be reproduced after the fact
`squashSystemMessages` (openai.js L3922) excludes messages by `identifier` (`newMainChat`, `newChat`, `groupNudge`), which is absent from the final `{role,content,name}` array. A post-hoc merge is approximate. Test squash OFF (default false, L497) for the parity check, ON to measure the gap.

### Pitfall 7: Disabled extensions and the spike's own loading
Disabling 26 extensions requires a page reload. The spike extension must stay enabled. Disabled state is stored by name (`third-party/<name>`) in `extension_settings.disabledExtensions`; save the array verbatim before and after. Bundled extensions (vectors, tts, quick-reply, regex, stable-diffusion) remain active; Vectors is off by default (settings `enabled_chats` false) - confirm and record.

### Pitfall 8: Logprobs side effect
Non-streaming `sendOpenAIRequest` with type `swipe` calls `saveLogprobsForActiveMessage` after `delay(1)` (openai.js L3203-3206), keyed to `chat[chat.length-1]`. Only active when the backend returns logprobs. Record as known gap; do not enable logprobs in the spike unless testing this explicitly.

### Pitfall 9: Typed draft text leaking into a swipe prompt
For `type === 'swipe'`, `textareaText` is forced to `''` (script.js L4399-4411), so a draft in the input box should not appear. Cheap to verify: type a draft, capture, grep the dump. [VERIFIED source; runtime confirm]

### Pitfall 10: Group chats / no active character
Dry-run capture returns nothing for CC when `promptManager.activeCharacter` is null (openai.js L1561 `if (!promptManager.activeCharacter && dryRun) return [null,false]`). Groups take a separate branch (L4351-4360). Spike only needs single-character chat; document group chats stay disabled (QUEUE-08).

## Code Examples

### Manifest (current schema, STACK.md-verified)
```json
{
  "display_name": "QS Route Spike",
  "loading_order": 100,
  "js": "index.js",
  "author": "seant",
  "version": "0.0.1",
  "minimum_client_version": "1.19.0",
  "hooks": { "activate": "init" }
}
```
`hooks.activate` calls an exported `init` (extensions.js L391-425); `manifest.json` must exist in the spike root or discovery skips the folder (src/endpoints/extensions.js `hasManifest`). `minimum_client_version` 1.19.0 doubles as a check that the version gate works on the installed build. [VERIFIED]

### Windows junction (no admin needed)
```bat
:: cmd.exe or via PowerShell
mklink /J "E:\SillyTavern\public\scripts\extensions\third-party\qs-route-spike" "D:\repositories\sillytavern-plugin-queue-request\spike"
:: remove later (does NOT delete target contents):
rmdir "E:\SillyTavern\public\scripts\extensions\third-party\qs-route-spike"
```
From Git Bash use `cmd //c mklink //J ...`. Discovery uses `fs.statSync(...).isDirectory()` which follows junctions (extensions.js endpoint L524). [VERIFIED source; junction behavior ASSUMED to work as described, confirm on first load]

### Update ST to 1.19.0
```bash
cd /e/SillyTavern
git checkout -- package-lock.json
git pull origin release
npm install --no-audit --no-fund
git describe --tags; grep '"version"' package.json   # expect 1.19.0 (release may be +1 commit)
node server.js --port 8001   # or StartPort8001.bat; config.yaml has port 8000 and whitelistMode true
```

### llama.cpp server
```bash
llama-server -m "D:\old-models\Chat\dolphin-2.9-llama3-8b.Q8_0.gguf" --host 127.0.0.1 --port 8080 -c 8192 -ngl 99
```
Connections in ST:
- **CC:** API = Chat Completion, Source = "Custom (OpenAI-compatible)", Custom Endpoint (Base URL) `http://127.0.0.1:8080/v1` (server appends `/chat/completions`, chat-completions.js), key may be blank, model id from `/v1/models`. Streaming toggle = "Streaming" checkbox (`oai_settings.stream_openai`).
- **TC:** API = Text Completion, type `llamacpp`, server URL `http://127.0.0.1:8080`. Streaming toggle = `textgenerationwebui_settings.streaming`. Instruct mode/template is applied by ST for TC; keep it consistent across native and queued runs.
Set temperature 0 and a small response length on both presets.

### Redacting and uploading a dump
```javascript
async function dump(name, obj) {               // name: qs-<backend>-<stream>-<kind>.json
  const redact = (k, v) => (['proxy_password','custom_include_headers','api_key'].includes(k) ? '[redacted]' : v);
  const body = btoa(unescape(encodeURIComponent(JSON.stringify(obj, redact, 2))));
  const r = await fetch('/api/files/upload', { method:'POST', headers: SillyTavern.getContext().getRequestHeaders(),
                         body: JSON.stringify({ name, data: body }) });
  return r.json();   // { path: 'user/files/<name>' } -> E:\SillyTavern\data\default-user\user\files\<name>
}
```
[VERIFIED: src/endpoints/files.js L28-47; dir `user/files` from constants.js L43]

### Native swipe capture (one-shot)
```javascript
function armNative(tag) {
  const once = async (data, dryRun) => {
    if (dryRun) return;                         // ignore our own dry runs
    eventSource.removeListener(event_types.GENERATE_AFTER_DATA, once);
    store[tag] = structuredClone(data);         // CC: {prompt: messages[]}; TC: full body
  };
  eventSource.makeLast(event_types.GENERATE_AFTER_DATA, once);
}
```
Then the operator clicks the real swipe-right arrow on the last AI message (native `swipe()` -> overswipe -> `Generate('swipe')`, script.js L10337-10340). The native run adds a swipe to the throwaway chat; that is fine.

### Diff tool (Node, no deps)
Normalize with key-sorted `JSON.stringify(_, null, 2)`; for CC compare `prompt` (messages array) strictly; for TC compare `prompt` string strictly and the remaining body keys as a second table (expected extra/missing `stream` when native streaming is on, because `generateTextGenWithStreaming` sets `generate_data.stream = true` on the object, L1290). Exit non-zero on any strict difference so the result is scriptable.

## Go/No-Go Criteria: Concrete Checks

| # | Criterion | Check (pass condition) | Evidence artifact | Blocker for R1? |
|---|-----------|------------------------|-------------------|-----------------|
| a | Dry-run capture has no visible side effects (CC and TC) | Snapshot before == after (Pattern 4); event log shows only dry-flagged events; no MESSAGE_*/RENDERED events; Send enabled, Stop hidden, arrows visible, scrollTop unchanged | `qs-*-snapshot.json` | YES |
| b | Captured prompt matches native swipe prompt | `diff-captures` strict diff empty for squash OFF, no WI sticky, no draft text; gaps measured for squash ON and WI sticky; Vectors half covered by source read only (D-06) | `qs-*-queued.json`, `qs-*-native.json`, diff output | gaps acceptable if documented |
| c | Both return shapes handled | CC stream ON: `typeof r === 'function'`, final text equals native for same seed/temp 0; CC stream OFF: object with `choices`; TC stream ON and OFF: JSON via fetch; all four produce non-empty cleaned text and reasoning handled | per-combo `shape` field in report | YES |
| d | Manual send during capture does not corrupt `abortController` | Hold the dry run inside a `GENERATION_STARTED` listener (`await delay(5000)` when `dry`), send a manual message in that window. With `signal` passed: native generation completes, native Stop works, `isGenerating()` returns false after, chat intact. Negative control without `signal`: record whether Stop breaks (expected: native Stop aborts the wrong controller) | screen/console log + chat dump | YES |
| e | Interceptor parity | Source-only verdict (D-06): `runGenerationInterceptors(coreChat, ctxSize, type)` skipped on dry run (L4562-4572). Vectors `rearrangeChat` skips `quiet` only (vectors/index.js L777-780), sets extension prompts and **splices queried messages out of the passed chat** (L851-858). Pre-calling on a copy reproduces the extension-prompt injection only, not the splice or the real `coreChat`; it also triggers embedding queries. Verdict: parity NOT achievable -> document gap | report section, MEDIUM | no |
| f | Stop-with-partial and `auto_swipe` reachability | See Policies; runtime: native stream + Stop -> inspect `swipes`; own-transport abort -> nothing appended; `power_user.auto_swipe` on + native swipe -> cascade observed | report section | no (policy) |

## Policies (recommended, to confirm at runtime)

**Stop-with-partial.** Source: native `stopGeneration()` calls `streamingProcessor.onStopStreaming()` then aborts the module `abortController` and emits `GENERATION_STOPPED` (script.js L5607-5621). The stream loop returns the partial `this.result` (L3881-3883) and `onFinishStreaming` saves it, so under R2 a Stop leaves a partial swipe in the chat. Under R1 the queued request uses its own controller; the native Stop button is never shown for it (`showStopButton` only on the non-dry path), and `stopGeneration()` does not touch it. Policy: queued cancel = abort own controller and discard (no partial append); consuming the CC generator, an abort throws and the partial text is dropped. Runtime checks: (1) native streaming swipe + Stop, record resulting `swipes`; (2) own abort mid-stream, confirm no chat change; (3) `/abort` while a queued request is in flight, confirm it is not cancelled by native stop (record; ownership of `GENERATION_STOPPED` is Phase 4/GUARD-06).

**auto_swipe / auto-continue.** `auto_swipe` is only evaluated inside native completion paths: `StreamingProcessor.onFinishStreaming` (L3811-3813) and `Generate.onSuccess` (L5566-5570), via `swipe(..., {source: AUTO_SWIPE})`. `triggerAutoContinue` is called only from the native stream path (L5442). Under R1 a queued item never reaches these, so no cascade from the extension; the user's own native generations can still trigger them. Under R2 every item would. Settings are readable at `getContext().powerUserSettings.auto_swipe` (plus `auto_swipe_minimum_length`, `auto_swipe_blacklist`, `auto_swipe_blacklist_threshold`, power-user.js L180-183). Policy: extension never invokes these; detect `auto_swipe` and show a one-time info toast that queued results are not auto-swipe filtered (R1) or refuse/warn (R2). Runtime check: enable `auto_swipe` with a filter that always rejects and confirm a queued R1 item produces exactly one appended result and no `swipe()` call.

**Interceptor gap.** Document the gap. At queue time, enumerate `extensionNames`, keep manifests where `generate_interceptor` is set AND `typeof globalThis[name] === 'function'` (only loaded/enabled extensions define the global), and toast once per chat when any exist. Bundled interceptors at 1.19.0: `vectors_rearrangeChat`, `SD_ProcessTriggers`. The user's installed extensions declare `randomizerInterceptor` (Extension-Randomizer), `WebSearch_Intercept` (Extension-WebSearch), `memory_intercept_messages` (SillyTavern-MessageSummarize); all are disabled during the spike (D-07) and matter for Phase 5. [VERIFIED: GitHub 1.19.0 manifests; local manifests grep]

## Documents to Reword (SPIKE-04)

Current unqualified phrases (exact lines at research time):
- `.planning/PROJECT.md` L5 ("run one at a time in the background through ST's native generation pipeline"), L58 (Constraints "Execution: ... through ST native pipeline"), L68 (Key Decisions "Serial execution through native pipeline ... native post-processing ... for free").
- `CLAUDE.md` L13 (Locked decisions), plus the generated mirror of PROJECT.md at L34 and L42. Edit all three; the Project/Constraints blocks are a copy of PROJECT.md.
- `AGENTS.md` L4, L8, L15 (not required by SPIKE-04 but should be made consistent so agents are not misled).
- Also adjust `REQUIREMENTS.md` GEN-01/GEN-03 wording only if the route is R2; add the chosen route to the PROJECT.md Key Decisions row ("Generation route") with Outcome pointing to SPIKE-REPORT.md and listing the evidence for a-f.

Suggested R1 wording: "Serial execution through an own scheduler: native prompt build via dry-run `Generate('swipe')` capture, own transport, native cleanup helpers; the extension never starts a non-dry `Generate`. Interceptors, CC squash, WI timed effects and itemized prompts are not applied (documented gaps)." Suggested R2 wording: "Serial execution through native `swipe()`/`Generate('swipe')` with view restore; `swipe_id` and visible message change during each run."

Grep acceptance: after editing, `grep -n -i "native pipeline\|native generation pipeline" PROJECT.md CLAUDE.md AGENTS.md` must return only qualified occurrences (each line must also contain the route qualifier such as "dry-run" or "own transport" or "view restore"), and PROJECT.md must contain a Key Decisions row whose Outcome is not "Pending" for the route.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Dry run clobbers `abortController` (ARCHITECTURE.md assumption) | Pass `signal` to skip replacement (`if (!(abortController && signal))`) | present in 1.19.0 | Reduces criterion (d) risk; still gate on idle |
| `getContext()` only | `getContext()` + a few direct imports | n/a | Spike proves import list |
| `registerSlashCommand` | `SlashCommandParser.addCommandObject` | deprecated in st-context.js | Not needed for the spike |

`setExternalAbortController(controller)` is also exported (script.js L7114) - not needed, but note it exists. [VERIFIED]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A Windows llama.cpp release zip is available and matches the user's GPU | Standard Stack | Executor needs a different build or Docker |
| A2 | The chosen GGUF has an embedded chat template usable by `/v1/chat/completions` | Standard Stack | CC requests fail; pick another model |
| A3 | Junction target on another drive (D: -> E:) is served by Express static and discovered | Code Examples | Fallback: copy the folder or put repo under E: |
| A4 | Passing `signal` makes criterion (d) pass in practice (derived from source, not run) | Go/No-Go | If Stop still breaks, R1 hard-blocker fires |
| A5 | `getRequestHeaders` on `getContext()` returns CSRF-bearing headers for `/api/files/upload` | Code Examples | Upload fails; use Blob fallback |
| A6 | Custom CC base URL must include `/v1` | Code Examples | 404 from llama-server; adjust URL |
| A7 | Logprobs contamination only occurs when logprobs are enabled and returned | Pitfall 8 | Wider side effect; make (a) check include logprobs setting |
| A8 | Draft text in the input box does not enter a swipe prompt | Pitfall 9 | Capture would differ; add to gap list |

## Open Questions

1. **Does a manual send during the capture hold window leave any residual corruption beyond `abortController` (e.g. `generation_started` timestamp on the native message)?**
   - Known: `generation_started` is reassigned at L4293 and read at L5387/L6677+; capture only runs idle by design.
   - Unclear: observable effect under the overlap test. Recommendation: record `gen_started/gen_finished` of the native message in test (d).
2. **Is the 1.19.0+1 `release` commit relevant to `Generate`?** Recommendation: diff `script.js` against the tag after pull (`git diff 1.19.0 -- public/script.js`).
3. **Does `Generate('swipe', ..., true)` still pass through `unblockGeneration` anywhere on early exits (Horde, kobold streaming guards)?** Only for unsupported APIs; not exercised by CC/TC. Record as out of scope.
4. **Multi-swipe `n>1` and tool calls:** `extractMultiSwipes` is module-private; R1 keeps `choices[0]` only. Accept; list in README later.

## Evidence Verification (no automated tests; `workflow.nyquist_validation` is false)

| Evidence | Artifact | How verified |
|----------|----------|--------------|
| ST at 1.19.0 | SPIKE-REPORT "Environment" with `git describe`, HEAD sha, package.json version | grep the report for `1.19.0` |
| Prompt parity per backend/stream mode | `captures/qs-{cc,tc}-{stream,nostream}-{queued,native}.json` + diff output | rerun `node spike/tools/diff-captures.mjs <a> <b>`; exit code 0 or listed gaps |
| Side-effect snapshot | `captures/qs-*-snapshot.json` | before == after check printed by spike; report cites file names |
| Return shapes | report table with `shape` per combo | 4 rows, each `generator` or `json`, plus final text length |
| Overlap test (d) | console/log excerpt + post-test chat state | report states pass/fail with and without `signal` |
| Policies | SPIKE-REPORT "Policies" section with three headed subsections | grep for `Stop`, `auto_swipe`, `Interceptor` headings |
| Route chosen | PROJECT.md Key Decisions row; SPIKE-REPORT "Decision" | grep `R1` or `R2` in both; Outcome not "Pending" |
| Docs reworded | grep acceptance above | run grep in plan verification step |

Operator-gated steps (clicking swipe arrows, switching connections, toggling streaming, Stop) must be `checkpoint:human-verify` tasks unless the executor has a controllable browser. Where scriptable, expose them through `window.qsSpike.*` methods and invoke from the console; the swipe click can also be driven programmatically via `getContext().swipe.right(null, {source: ...})` but a real click is closer to native use.

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | ST session/CSRF headers via `getRequestHeaders()` on the upload call |
| V3 Session Management | no | n/a |
| V4 Access Control | no | single local user (`default-user`) |
| V5 Input Validation | yes | `/api/files/upload` filename regex; dump names fixed by the spike |
| V6 Cryptography | no | none |

| Threat | STRIDE | Mitigation |
|--------|--------|------------|
| Secrets in dumps (`proxy_password`, custom headers) | Information disclosure | Redact keys before upload; commit only redacted captures; captures contain throwaway-chat text only |
| Junction deletion removes repo files | Tampering | Remove with `rmdir`, never recursive delete |
| Real chats touched | Tampering | D-03: throwaway char/chat; guard in spike that refuses to run unless character name matches a configured name |

## Sources

### Primary (HIGH confidence)
- https://raw.githubusercontent.com/SillyTavern/SillyTavern/1.19.0/public/script.js - `Generate` (L4290-5322), `swipe` (L9961+), `stopGeneration` (L5607), `isGenerating` (L604), `sendGenerationRequest`/`sendStreamingRequest`/`getGenerateUrl` (L6110-6190), StreamingProcessor (L3560-3920)
- .../public/scripts/openai.js - `sendOpenAIRequest` (L3138), `createGenerationParameters` (L2691), squash (L1608, L3922), export block (L85)
- .../public/scripts/textgen-settings.js - `generateTextGenWithStreaming` (L1289)
- .../public/scripts/extensions.js - `runGenerationInterceptors` (L2024), hooks (L391-425), `extensionNames`, `getExtensionManifest`
- .../public/scripts/extensions/vectors/index.js and manifest.json - `rearrangeChat` (L776-888)
- .../public/scripts/world-info.js - timed effects dry-run gating (L683, L731, L748)
- .../public/scripts/st-context.js - exposed context surface
- .../public/lib/eventemitter.js, events.js - emit semantics, `makeLast`, event names
- .../src/endpoints/files.js, assets.js, extensions.js - upload, filename validation, discovery
- api.github.com/repos/SillyTavern/SillyTavern/releases/latest -> 1.19.0 (2026-09-14); compare 1.19.0...release: ahead_by 1
- Local: `E:\SillyTavern` git status/describe, config.yaml, extension manifests

### Secondary (MEDIUM confidence)
- https://raw.githubusercontent.com/ggml-org/llama.cpp/master/tools/server/README.md - flags (`--port` default 9931, `--jinja` default on), endpoints
- .planning/research/{SUMMARY,ARCHITECTURE,PITFALLS,STACK}.md (prior project research)

### Tertiary (LOW confidence)
- llama.cpp Windows binary availability/naming (training knowledge)

## Metadata

**Confidence breakdown:**
- Standard stack / environment: MEDIUM - llama-server not yet present; everything else verified locally
- Architecture (R1 mechanics, imports, return shapes): HIGH from 1.19.0 source; runtime unproven
- Pitfalls: MEDIUM-HIGH - source-derived, several need the live run to confirm
- Interceptor parity verdict: MEDIUM (source only, per D-06)

**Research date:** 2026-10-25
**Valid until:** 2026-11-08 (ST release branch is moving; re-diff `script.js` after pulling)
