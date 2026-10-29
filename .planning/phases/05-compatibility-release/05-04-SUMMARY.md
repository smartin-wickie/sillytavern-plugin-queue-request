---
phase: 05-compatibility-release
plan: 04
subsystem: release-docs
tags: [readme, license, manifest, compat]
requires: [05-02, 05-03]
provides: [README.md, LICENSE, manifest author]
affects: [manifest.json, .planning/PROJECT.md]
key-files:
  created: [README.md, LICENSE]
  modified: [manifest.json, .planning/PROJECT.md]
decisions:
  - "MIT license, author Sean Martin, version 0.1.0, no homePage (no repo yet), no git tag"
metrics:
  tasks: 3
  completed: 2026-10-28
---

# Phase 5 Plan 04: README and release packaging Summary

README documents install, usage, settings, safety, fidelity gaps and the compat summary table, with no savings claims. MIT LICENSE added and manifest author set.

## Task 1 (checkpoint:decision), resolved by the user

- License: MIT. Repo URL: none yet (no `homePage`; README says the repo URL is pending and has no issues link). Author: Sean Martin (manifest and LICENSE, 2026). Version: 0.1.0 kept. Git tag: none.

## Tasks

- Task 2, README.md: commit 9f1c282. Verify command passes; `grep -ic cache` = 0; `billed as one` count = 1. Command syntax, settings defaults (Enable on, max 5, jump off, notifications All, breaker 3) and wand labels were read from src/. The no-cascade claim is included because cascade-queued is PASS. Compat table uses the matrix results (16 PASS, 0 FAIL, 5 BLOCKED). Deep-Swipe and UserSwipes are stated as untested. TTS and Vector Storage are reported as BLOCKED with the queue side clean. The WR-01 two-tab risk is in the safety section.
- Task 3, manifest/LICENSE/PROJECT.md: commit 57d9a30. Verify command passes (minimum_client_version 1.19.0, js index.js, hooks.activate init, no "cache-friendly" left). The PROJECT.md line now reads as neutral serial execution.
- `npx vitest run`: 17 files, 270 tests passed.

## Deviations from Plan

None. The plan's Task 1 was answered by the user. No push, tag, publish or ls-remote was run.

## Known gaps

- uat-2 (plain HTTP) and Deep-Swipe/UserSwipes remain BLOCKED in the matrix (not part of this plan).

## Self-Check: PASSED

README.md, LICENSE, commits 9f1c282 and 57d9a30 exist.
