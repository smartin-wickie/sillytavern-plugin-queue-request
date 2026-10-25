---
phase: 01-route-verification-spike
verified: 2026-10-25T23:27:07Z
status: passed
score: 4/4 must-haves verified
has_blocking_gaps: false
overrides_applied: 0
gaps: []
---

## Gap closed post-verification

Original verification found one minor, non-blocking gap: `.planning/REQUIREMENTS.md` checkboxes and traceability table for SPIKE-01..04 were still unchecked/"Pending" despite the work being done. Fixed directly rather than parked to backlog (trivial, zero-risk doc fix): checked all 4 boxes, updated all 4 traceability rows to "Done". Verified via `grep -n "SPIKE-0[1-4]" .planning/REQUIREMENTS.md` — all 8 lines now show `[x]`/`Done`.

# Phase 1: Route Verification Spike Verification Report

**Phase Goal:** The generation route (R1 dryRun capture + own transport vs R2 native swipe + view restore) is chosen with evidence from a live ST 1.19.0 instance, and project docs reflect it
**Verified:** 2026-10-25T23:27:07Z
**Status:** gaps_found (minor, non-blocking — see Gaps Summary)
**Re-verification:** No — initial verification

## Note on scope

This is a spike phase with no shipping product code per `01-CONTEXT.md` decision D-09 (`spike/` is explicitly throwaway, re-runnable diagnostic tooling, not Phase 2 production code). Verification below holds `spike/` to "did it honestly produce the evidence" rather than production-code standards, per the task instructions.

## Goal Achievement

### Observable Truths

Must-haves merged from ROADMAP.md Phase 1 Success Criteria (4) and PLAN frontmatter `must_haves.truths` across all 7 plans (01-01 through 01-07).

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | PROJECT.md Key Decisions records the chosen route with live-instance go/no-go evidence (criteria a-f) (SPIKE-01) | ✓ VERIFIED | `PROJECT.md:68` — "Generation route" row: "Chosen: R1 ... a: PASS, b: PASS w/ documented squash-ON gap, c: PASS, d: PASS, e: not achievable (documented), f: policies confirmed", citing `SPIKE-REPORT.md`. Row is no longer "Pending". |
| 2 | A recorded diff shows a captured queued-swipe prompt matches a native swipe prompt on one CC and one TC backend, gaps documented (SPIKE-02) | ✓ VERIFIED | `captures/MATRIX-RESULTS.md` verdict table: 4/4 combos `STRICT DIFF: none`; squash-ON gap documented separately in `BEHAVIOR-RESULTS.md`. Independently re-ran `node spike/tools/diff-captures.mjs qs-cc-stream-queued.json qs-cc-stream-native.json` against the committed dumps myself: output `STRICT DIFF: none`, exit 0 — matches the claim exactly, not just trusted from SUMMARY. |
| 3 | Stop-with-partial, `power_user.auto_swipe` reachability, and interceptor (Vectors) parity each have a recorded policy (SPIKE-03) | ✓ VERIFIED | `SPIKE-REPORT.md` "## Policies" has three named subsections (Stop with partial, auto_swipe and auto-continue, Interceptor gap), each with Observed/Policy/Source-of-evidence citing `BEHAVIOR-RESULTS.md` and `SOURCE-FINDINGS.md` with concrete line numbers. |
| 4 | PROJECT.md and CLAUDE.md no longer say "serial through native pipeline" unqualified; wording matches chosen route (SPIKE-04) | ✓ VERIFIED | Checked all three files directly: `PROJECT.md:58,69`, `CLAUDE.md:13,44`, `AGENTS.md:8,15` all now read "dry-run `Generate('swipe')` capture, own transport, native cleanup helpers" — no unqualified "native pipeline" occurrence remains in any of the three (`grep -i "native pipeline"` only matches the qualified phrase "not from the native pipeline itself" inside a rationale clause, not a description of execution). |
| 5 | The user approved the route after seeing the evidence (ambiguity-rule checkpoint, CONTEXT.md discretion) | ✓ VERIFIED | `01-07-SUMMARY.md` Task 2 row: "checkpoint:human-verify — User replied 'approve R1'"; `SPIKE-REPORT.md` "Status: APPROVED — R1 (user approved 2026-10-25)". |
| 6 | User's pre-spike ST environment was restored (extensions re-enabled list, junction removed, servers stopped) | ✓ VERIFIED | `SPIKE-REPORT.md` "## Cleanup done": servers verified by PID/image-name and stopped, `disabledExtensions` restored to `["translate","expressions"]` (confirmed valid JSON, BOM fixed), junction removed via `rmdir`, confirmed gone from the ST tree. Remaining manual steps (re-pointing API connections/presets) are explicitly and correctly listed as "user action required", not silently dropped. |

**Score:** 6/6 core truths verified. 1 additional, narrower gap found below (requirement bookkeeping, non-blocking).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `.planning/phases/01-route-verification-spike/SPIKE-REPORT.md` | Verdict table a-f, policies, chosen route, reasoning (D-11) | ✓ VERIFIED | All sections present: Environment, Verdict table, Return shapes, Prompt diff, three Policies subsections, Decision (R1, APPROVED), Reasoning, Consequences for Phase 2, Pre-spike restore list, Cleanup done, Post-decision code review note. |
| `.planning/PROJECT.md` | Key Decisions row for generation route, not Pending | ✓ VERIFIED | Line 68-69, confirmed by direct read. |
| `CLAUDE.md` | Reworded locked decisions / constraints | ✓ VERIFIED | Lines 13, 44. |
| `AGENTS.md` | Reworded locked decisions | ✓ VERIFIED | Lines 8, 15. |
| `spike/manifest.json`, `spike/index.js`, `spike/st-imports.js` | Loadable ST extension, instrumented probes | ✓ VERIFIED | Manifest has `minimum_client_version: 1.19.0`, `hooks.activate: init`; `index.js` exports `init`, implements `guard()` (throwaway-character refusal, D-03), redacted `dump()`, `capture()`/`send()`/`abortOwn()`/`overlap()`/`status()` exactly as described. Re-ran `check-exports.mjs` myself against the live `E:\SillyTavern` 1.19.0 source: 20/20 OK, matching the claimed result. |
| `spike/tools/diff-captures.mjs` | Reproducible prompt diff, non-zero exit on strict difference | ✓ VERIFIED | Re-ran independently (see truth #2); CR-01/WR-01 fixes from `01-REVIEW.md` are present in the current file (CC branch now diffs full body keys, not just `{role,name,content}`; `REDACT_KEY_RE` broadened). |
| `captures/*.json` (32 dump files) | Redacted raw prompt/snapshot/transport evidence | ✓ VERIFIED | All 32 files present. Scanned every committed dump for `sk-...`/`Bearer ...`/unredacted `api_key` value patterns myself — zero hits, confirming the CR-01 remediation claim rather than trusting it. |
| `.planning/REQUIREMENTS.md` | SPIKE-01..04 marked complete, traceability updated | ✗ GAP (minor) | Checkboxes and traceability table still show all 4 as incomplete/Pending. See Gaps Summary. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `spike/index.js` | `spike/st-imports.js` | `import { ... } from './st-imports.js'` | ✓ WIRED | Confirmed in file header; all 12 named imports used in `index.js` (verified via code read, not just existence). |
| `captures/ENVIRONMENT.md` | `SPIKE-REPORT.md` Environment section | copied verbatim | ✓ WIRED | SPIKE-REPORT.md Environment section matches ENVIRONMENT.md facts (version, llama-server, disabled extensions). |
| `captures/qs-*-queued.json`/`qs-*-native.json` | `spike/tools/diff-captures.mjs` | CLI args | ✓ WIRED | Re-ran this exact link myself; produced the claimed `STRICT DIFF: none` output. |
| `SOURCE-FINDINGS.md` | `SPIKE-REPORT.md` Policies/criterion e | citation | ✓ WIRED | SPIKE-REPORT.md's Interceptor gap policy cites `SOURCE-FINDINGS.md "Interceptor parity"` and matching line numbers (`scripts/extensions.js:2024-2043`). |
| `.planning/PROJECT.md` Key Decisions | `SPIKE-REPORT.md` | citation | ✓ WIRED | PROJECT.md row explicitly references SPIKE-REPORT.md and the criteria letters. |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|-------------|--------|----------|
| SPIKE-01 | 01-01, 01-02, 01-07 | Route chosen with live-instance evidence, recorded in PROJECT.md | ✓ SATISFIED (substance) / ✗ BOOKKEEPING GAP (REQUIREMENTS.md not checked off) | SPIKE-REPORT.md + PROJECT.md row verified; REQUIREMENTS.md checkbox/table stale |
| SPIKE-02 | 01-02, 01-05 | Captured prompt matches native swipe prompt, CC + TC, diff recorded | ✓ SATISFIED (substance) / ✗ BOOKKEEPING GAP | MATRIX-RESULTS.md verified + independently re-run; REQUIREMENTS.md stale |
| SPIKE-03 | 01-02, 01-03, 01-06 | Stop-with-partial, auto_swipe, interceptor parity policy recorded | ✓ SATISFIED (substance) / ✗ BOOKKEEPING GAP | SPIKE-REPORT.md Policies section verified; REQUIREMENTS.md stale |
| SPIKE-04 | 01-07 | PROJECT.md/CLAUDE.md reworded off unqualified "native pipeline" | ✓ SATISFIED (substance) / ✗ BOOKKEEPING GAP | Direct grep/read of all 3 docs; REQUIREMENTS.md stale |

No orphaned requirements found — `.planning/REQUIREMENTS.md` "### Route Verification (Spike)" section lists exactly SPIKE-01..04, and all 4 appear in plan frontmatter `requirements:` fields across the phase's plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | `TODO`/`FIXME`/`XXX`/`HACK`/`PLACEHOLDER` scan across `spike/*.js`, `spike/tools/*.mjs`, and phase `.md` files | — | None found (grep returned no matches) |
| `spike/index.js:384` | `nativeStopWorked: null` | Dead/always-null field in evidence output (IN-02 in 01-REVIEW.md) | ℹ️ Info | Documented, known limitation of throwaway tooling (D-09); does not affect any of the 4 SPIKE requirements since this field was never load-bearing for the verdict table |
| `spike/tools/diff-captures.mjs:9` | unused `.captured` unwrap (IN-04) | dead code, no-op given actual dump shape | ℹ️ Info | Harmless; does not affect correctness of the diff this spike relies on |

No blocker-level anti-patterns found. The one critical (CR-01) and one strictness warning (WR-01) from `01-REVIEW.md` were both fixed in commit `b93044d`, and the fix was independently re-verified above (re-ran the diff tool and the secret scan myself rather than trusting the SUMMARY's claim).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Prompt diff tool reproduces "STRICT DIFF: none" for CC-stream combo | `node spike/tools/diff-captures.mjs qs-cc-stream-queued.json qs-cc-stream-native.json` | `Body keys that differ...: (none)` / `STRICT DIFF: none`, exit 0 | ✓ PASS |
| `st-imports.js` exports are real against the (still-present) live 1.19.0 ST source | `node spike/tools/check-exports.mjs` | 20 `OK` lines, 0 `MISSING` | ✓ PASS |
| No unredacted secret-shaped values in any committed capture dump | grep for `sk-...`/`Bearer ...`/raw `api_key` value across `captures/*.json` | 0 matches | ✓ PASS |
| No unresolved debt markers in phase-modified files | grep `TODO\|FIXME\|XXX\|HACK\|PLACEHOLDER` | 0 matches | ✓ PASS |

### Human Verification Required

None. The one checkpoint this phase required (user approval of the chosen route) already occurred during execution (`01-07-SUMMARY.md` Task 2, "User replied 'approve R1'") and is itself part of the verified evidence trail, not an outstanding item for this verification pass.

### Gaps Summary

One minor, non-blocking documentation-bookkeeping gap: `.planning/REQUIREMENTS.md` was declared as a `files_modified` target of plan `01-07` but was never actually edited — the SPIKE-01..04 checkboxes are still `[ ]` and the Traceability table still lists all four as "Pending," even though every plan's SUMMARY.md frontmatter (`requirements-completed`) claims them done, and the underlying work (route decision, prompt-diff evidence, policies, doc rewording) is independently verified as real and substantive in this report. This does not block the phase goal — the route decision itself, backed by live-instance evidence, is sound and the docs that actually drive Phase 2+ (`PROJECT.md`, `CLAUDE.md`, `AGENTS.md`) are correctly updated. It should be closed with a trivial edit (check the 4 boxes, update the 4 traceability rows) before relying on `REQUIREMENTS.md` as a status dashboard for future phases.

**This looks intentional in scope but not in execution** — plan 01-07 clearly intended to update `.planning/REQUIREMENTS.md` (it's listed in `files_modified`) but the edit was missed. No override is suggested; this should simply be fixed. Given its triviality, it can be parked to backlog rather than spawning a follow-up phase.

---

_Verified: 2026-10-25T23:27:07Z_
_Verifier: Claude (bm-verifier)_
