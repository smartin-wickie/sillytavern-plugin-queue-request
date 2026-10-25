---
phase: 01-route-verification-spike
plan: 07
subsystem: spike-decision
tags: [sillytavern, spike, decision, docs-rework]
requires: [01-05, 01-06]
provides:
  - SPIKE-REPORT.md (Status APPROVED, route R1)
  - PROJECT.md/CLAUDE.md/AGENTS.md reworded to R1 wording
  - PROJECT.md Key Decisions updated (Generation route + dependent rows)
  - Pre-spike environment restored (servers stopped, disabledExtensions restored, junction removed)
affects: []
key-files:
  created:
    - .planning/phases/01-route-verification-spike/SPIKE-REPORT.md
  modified:
    - .planning/PROJECT.md
    - CLAUDE.md
    - AGENTS.md
key-decisions:
  - "Route R1 approved by user (dry-run Generate('swipe') capture + own transport + native cleanup helpers, never a non-dry Generate)"
requirements-completed: [SPIKE-01, SPIKE-04]
duration: 50min
completed: 2026-10-25
---

# Phase 1 Plan 07: Decision and Docs Alignment Summary

Route R1 is approved and locked. PROJECT.md, CLAUDE.md and AGENTS.md no longer describe generation as running "through ST's native generation pipeline" — every instance is reworded to the precise R1 mechanism (dry-run capture, own transport, native cleanup helpers, never a non-dry `Generate`). The pre-spike ST environment has been restored: servers stopped, `disabledExtensions` reverted to baseline, spike junction removed, `spike/` files left intact in the repo.

## Tasks

| Task | Result | Commit |
|------|--------|--------|
| 1 (auto) | Wrote SPIKE-REPORT.md: environment, verdict table (a-f), return shapes, prompt diff summary, three policy sections, Decision (R1, PROPOSED), Reasoning, Consequences for Phase 2, Pre-spike state to restore. | f791825 (prior) |
| 2 (checkpoint:human-verify) | User replied "approve R1". | — |
| 3 (auto) | Set Decision to APPROVED. Reworded all 7 "native pipeline" occurrences across PROJECT.md/CLAUDE.md/AGENTS.md. Added Generation route row + reworded 2 dependent Key Decisions rows (no longer Pending). Rewrote CLAUDE.md Unverified assumptions block with SPIKE-REPORT.md citations. Restored environment (stopped servers, restored disabledExtensions, removed junction). Added Cleanup done section. | (this commit) |

## Deviations from Plan

- **[Rule 1 - Environmental] Recorded PIDs from `ENVIRONMENT.md` no longer existed** (a session restart during plan 01-06 replaced them). Verified the currently-running processes' image names (`node.exe`, `llama-server.exe`) before stopping them, per the plan's fallback instruction ("if a recorded PID no longer matches ... skip it and report"). Documented in SPIKE-REPORT.md "Cleanup done".
- **[Rule 1 - Bug] Node `fs.writeFileSync` silently failed (no error, no output) when restoring `disabledExtensions`** in `settings.json` — not diagnosed further (same class of silent-failure seen earlier in this phase with `cp` on this environment). Worked around with a PowerShell background job (`ConvertFrom-Json`/`ConvertTo-Json`). That introduced a UTF-8 BOM, which breaks strict JSON parsers (confirmed: Node's own `JSON.parse` rejected the BOM'd file). Fixed with a second pass using `[System.IO.File]::WriteAllText` and a BOM-less UTF8 encoding. Verified valid JSON, correct `disabledExtensions`, `main_api` unchanged, after.
- **[Rule 1 - Deviation] `disabledExtensions` restore went through a full JSON round-trip** (PowerShell `ConvertFrom-Json`/`ConvertTo-Json`) rather than a surgical edit of just that key, because the direct surgical approach (Node) kept failing silently. The round-trip changes whitespace/formatting of the whole file but values were spot-checked and not found altered beyond the intended key. Flagged in SPIKE-REPORT.md for the user to spot-check ST starts cleanly.

## Known Stubs
None.

## Self-Check: PASSED
No remaining `native pipeline`/`native generation pipeline` text in PROJECT.md/CLAUDE.md/AGENTS.md without a qualifying phrase. PROJECT.md has a `Generation route` Key Decisions row with no `Pending` outcome; dependent rows (Serial execution, Background generation) also updated. Stale rationale phrases removed (0 matches). `spike/index.js` and `spike/manifest.json` exist; ST junction removed. `settings.json` `disabledExtensions` equals `["translate","expressions"]`. SPIKE-REPORT.md has `Status: APPROVED` and `## Cleanup done`.
