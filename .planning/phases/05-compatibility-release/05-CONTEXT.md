# Phase 5: Compatibility & Release - Context

**Gathered:** 2026-10-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Verify the extension coexists with the extensions users run (Deep-Swipe, UserSwipes, Prompt Inspector (disabled), Vectors, TTS, Summarize) and record the results in a test matrix. Prove queued generations never trigger ST auto-swipe or auto-continue cascades. Write a README that documents install, usage and the fidelity gaps of the R1 route, with no prompt-cache savings claims. Requirements: COMP-01, COMP-02, COMP-04.

</domain>

<decisions>
## Implementation Decisions

### Test matrix method (COMP-01)
- **D-01:** **Claude drives the browser** (Claude in Chrome) against the user's running ST 1.19.0 instance. The user watches. The plan must include a step to confirm the ST URL and that the browser tools are connected before testing.
- **D-02:** **Pass bar is a smoke test per extension:** queue 2-3 swipes with the extension enabled. Pass = every item appends as a swipe page, the pager total is correct, no console errors from either extension, and the other extension still does its own job.
- **D-03:** **Third-party extensions (Deep-Swipe, UserSwipes, and others) are already installed.** Baseline run first with all external (third-party) extensions disabled. Then enable one extension at a time and run the smoke test. Then do one combined run with all listed extensions enabled (Prompt Inspector stays disabled, because the extension pauses while it is on).
- **D-04:** Record results in **`.planning/phases/05-compatibility-release/05-COMPAT-MATRIX.md`**. Columns: extension, version or commit, case, result, notes, evidence (console excerpt or screenshot/GIF path). The README links to or summarizes this matrix.
- **D-05:** **Fold Phase 4's 4 pending HUMAN-UAT checks into the same live session** (CR-02 takeover reload, CR-03 ids over plain HTTP, demote-then-takeover restore, WR-01 background-tab throttling). Record results back in `.planning/phases/04-lifecycle-persistence-spend-safety/04-HUMAN-UAT.md`. If a check cannot be automated (for example, a second LAN device for plain HTTP), mark it for the user to do by hand and say why.

### Cascade and gap warnings (COMP-02, spike policy)
- **D-06:** **Build one combined, non-modal warning toast, shown once per browser session, on the first queue action** when any known gap is active. It lists every active gap:
  - `power_user.auto_swipe` on (via `getContext().powerUserSettings.auto_swipe`): queued results are not auto-swipe filtered.
  - Any enabled extension declares `generate_interceptor` (check `getExtensionManifest(name)?.generate_interceptor` per enabled extension): name the extensions (for example Vectors, MessageSummarize, WebSearch, Randomizer) and say they run on normal swipes but not on queued swipes.
  - Chat Completion "squash system messages" on: queued prompts are not squashed.
  These toasts were planned in the Phase 1 spike policy (SPIKE-REPORT.md "auto_swipe and auto-continue", "Interceptor gap") but were never built.
- **D-07:** The warning **never blocks queueing**. It only informs.
- **D-08:** **Prove COMP-02 with a live test and a unit test.** Live: turn on auto-swipe with a minimum length far above the model's typical reply, and turn on auto-continue; queue 3; the swipe count grows by exactly 3 and no extra generations start. Unit: the runner never calls `swipe()`, never triggers continue, and never starts a non-dry `Generate`.

### Claude's Discretion
- README structure, audience and depth (user did not select this area). Must cover install, usage, settings, and the fidelity gaps (interceptors skipped, CC squash skipped, WI timed effects, no itemized prompt, auto-swipe filter not applied). Must make **no prompt-cache savings claims** (COMP-04). Note `.planning/PROJECT.md` line 51 says serial prompts are "cache-friendly". Do not carry that into the README.
- Release packaging (user did not select this area): version bump, `homePage`, LICENSE, author field. Keep changes minimal and ask the user before choosing a license or publishing anything.
- Exact toast wording (follow the existing UI-SPEC toast style and `preventDuplicates`), and how "once per session" is stored (in-memory or `sessionStorage`).
- How the squash setting is read via `src/st-bridge.js`.

</decisions>

<specifics>
## Specific Ideas

- Spike evidence for the cascade: one native swipe with a high auto-swipe minimum length produced 14 auto-swipes in 3 seconds and 23 before `stopGeneration()`. The live COMP-02 test should reuse that setup, so the test would clearly show a cascade if one happened.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and scope
- `.planning/REQUIREMENTS.md` — COMP-01, COMP-02, COMP-04 (lines 78-81)
- `.planning/ROADMAP.md` §"Phase 5: Compatibility & Release" — success criteria
- `.planning/PROJECT.md` — Constraints, Key Decisions (R1 route)

### Route policies and fidelity gaps
- `.planning/phases/01-route-verification-spike/SPIKE-REPORT.md` — "auto_swipe and auto-continue", "Interceptor gap", fidelity gap list (README source)
- `.planning/phases/01-route-verification-spike/SOURCE-FINDINGS.md` — "Interceptor parity", line citations
- `.planning/phases/01-route-verification-spike/captures/BEHAVIOR-RESULTS.md` — G1 auto_swipe cascade evidence, measured fidelity gaps

### Pending live checks
- `.planning/phases/04-lifecycle-persistence-spend-safety/04-HUMAN-UAT.md` — 4 pending checks folded into this phase (D-05)

### UI conventions
- `.planning/phases/04-lifecycle-persistence-spend-safety/04-UI-SPEC.md` — toast copy style

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/st-bridge.js:105` `promptInspectorEnabled()`: pattern for a bridge-level detection helper. Add auto-swipe, interceptor and squash detection beside it.
- `src/queueActions.js:28,73`: the queue action entry, where Prompt Inspector is checked. A natural hook for the once-per-session gap warning.
- `src/toastAccumulator.js`: existing toast batching.
- `spike/` `qsSpike.status()`: already enumerates extensions with `generate_interceptor` (per SPIKE-REPORT).

### Established Patterns
- All ST access goes through `src/st-bridge.js`. Pure modules take injected dependencies and have Vitest tests in `test/`.
- Toasts are non-modal and use `preventDuplicates`.

### Integration Points
- `src/runner.js`: the place for the COMP-02 unit test (it must not call swipe, continue or non-dry Generate).
- New files: `README.md` at repo root, `05-COMPAT-MATRIX.md` in the phase directory.
- `manifest.json` currently has version 0.1.0, author "seant", and no `homePage`. There is no README or LICENSE yet.

</code_context>

<deferred>
## Deferred Ideas

None. The discussion stayed within the phase scope.

</deferred>

---

*Phase: 05-compatibility-release*
*Context gathered: 2026-10-28*
