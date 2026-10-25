# Phase 1: Route Verification Spike - Context

**Gathered:** 2026-10-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Choose the generation route with evidence from a live ST 1.19.0 instance. The candidates are R1 (dryRun capture + own transport) and R2 (native swipe + view restore). Record the evidence, set policies for stop-with-partial, `power_user.auto_swipe`, and interceptor (Vectors) parity, and reword PROJECT.md and CLAUDE.md to match the chosen route. Requirements: SPIKE-01..04.

This phase ships no product features. The queue, UI, persistence, and settings belong to Phases 2-4.

</domain>

<decisions>
## Implementation Decisions

### Spike environment
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

### Spike artifact form
- **D-08:** Write the spike as a minimal real extension (`manifest.json` + `index.js`), not as devtools console snippets. Reason: it must exercise the real ES-module import paths from third-party extension depth (the future `st-bridge.js` imports).
- **D-09:** Keep the spike code in the repo under `spike/` as preserved, re-runnable evidence. Do **not** grow it into Phase 2 production code. Phase 2 starts fresh, with tests.
- **D-10:** Install the spike into `E:\SillyTavern` by creating a directory junction from `public/scripts/extensions/third-party/<name>` to the repo's spike folder. Edits are then live. The junction also lets tooling see ST `public/global.d.ts`.
- **D-11:** Record evidence in `.planning/phases/01-route-verification-spike/SPIKE-REPORT.md`:
  - a verdict table for go/no-go criteria a-f
  - the policies
  - the chosen route
  - the reasoning

  Save captured prompts (queued-swipe capture vs native swipe, per backend and streaming mode) as raw JSON dump files so the diff can be reproduced.

### Claude's Discretion
The user did not discuss these areas. Use the research recommendations unless spike evidence points another way:
- **Go/no-go rule:** Spike R1 first. Keep R2 as the documented fallback. Treat criteria (a) no-side-effect capture, (c) both return shapes, and (d) no `abortController` corruption as hard blockers for R1. Vectors parity loss (e) and the squash/itemized-prompt gaps are acceptable if documented. If the result is ambiguous, show the evidence to the user at a checkpoint before locking the route.
- **Stop-with-partial policy:** Default is to discard partials. Confirm the actual behavior at runtime.
- **auto_swipe / auto-continue policy:** Confirm whether they can be reached. Default is that the extension never triggers them, and it detects them and warns.
- **Interceptor gap policy:** Default is to document the gap and show a toast when any active extension declares `generate_interceptor`.
- **Spike extension folder name** and the exact layout inside `spike/`.

</decisions>

<specifics>
## Specific Ideas

- Local install path: `E:\SillyTavern` (release branch). User extensions are under `E:\SillyTavern\data\default-user\extensions\`.
- Zero-spend setup is preferred: everything runs against local llama.cpp.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Route decision and spike criteria
- `.planning/research/SUMMARY.md` — "KEY OPEN DECISION: Generation Route" section. Defines R1/R2/R3, the go/no-go criteria a-f, and the consequences to carry forward (rewording, manual-send semantics).
- `.planning/research/ARCHITECTURE.md` — R1 design: dryRun capture via `GENERATE_AFTER_DATA`, own transport, cleanup helpers, §1.3 append race.
- `.planning/research/PITFALLS.md` — Pitfall 1b (R2 view restore), the abort/single-flight pitfalls, auto-swipe cascade.
- `.planning/research/FEATURES.md` — SwipePregen's R2-style approach (`ctx.swipe.to(... forceSwipeId ...)`).
- `.planning/research/STACK.md` — ST 1.19.0 API surface, manifest schema, why `generate_interceptor` is avoided.

### Requirements and docs to reword
- `.planning/REQUIREMENTS.md` — SPIKE-01..04 (lines 12-15). GEN-03 depends on the SPIKE-01 route.
- `.planning/PROJECT.md` — Key Decisions table and Constraints "Execution" line (reword per SPIKE-04).
- `CLAUDE.md` — "Locked decisions" serial/native-pipeline wording (reword per SPIKE-04).
- `AGENTS.md` — Locked decisions source.
- `.planning/01-architecture-analysis.md`, `.planning/02-requirements-draft.md` — original design docs with `[Recall]` claims the spike verifies.

### Live source (verify against)
- `E:\SillyTavern\public\script.js`, `public\scripts\st-context.js`, `public\scripts\extensions.js`, `public\scripts\openai.js`, `public\scripts\textgen-settings.js`, `public\scripts\reasoning.js`, `public\scripts\extensions\vectors\index.js`. Read these after the update to 1.19.0.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None. The repo has only planning docs. No source, `package.json`, or `manifest.json` exists yet.

### Established Patterns
- None yet. The research recommends plain ES modules, `getContext()` called fresh each time, and internal imports kept in one bridge file. The spike should try the bridge import paths.

### Integration Points
- ST extension loader: `E:\SillyTavern\public\scripts\extensions\third-party\<name>\manifest.json` (junctioned to repo `spike/`).
- Local llama.cpp server: serves both `/v1/chat/completions` (CC) and the native completion endpoint (TC).

</code_context>

<deferred>
## Deferred Ideas

None. Discussion stayed within phase scope.

</deferred>

---

*Phase: 01-route-verification-spike*
*Context gathered: 2026-10-25*
