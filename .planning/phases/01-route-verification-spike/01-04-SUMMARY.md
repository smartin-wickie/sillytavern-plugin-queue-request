---
phase: 01-route-verification-spike
plan: 04
subsystem: spike-bench
tags: [sillytavern, llama.cpp, bench]
requires: [01-02]
provides:
  - llama-server on 127.0.0.1:8080 (dolphin-2.9-llama3-8b Q8, --jinja)
  - ST 1.19.0 on 127.0.0.1:8001 with qs-route-spike loaded
  - QS Spike Throwaway chat ready, 26 user extensions disabled
affects: [01-05, 01-06]
key-files:
  modified:
    - .planning/phases/01-route-verification-spike/captures/ENVIRONMENT.md
    - spike/index.js
key-decisions:
  - "TC runs use Instruct Mode OFF (fixed); no instruct template applied"
requirements-completed: []
duration: 40min
completed: 2026-10-25
---

# Phase 1 Plan 04: Live Bench Setup Summary

llama-server and ST 1.19.0 are running, the spike loads without import errors, and the throwaway chat is ready for the capture matrix.

## Tasks

| Task | Result | Commit |
|------|--------|--------|
| 1 Start servers | Run inline by the orchestrator so the servers outlive any subagent. llama-server PID 55716 (:8080), ST PID 29100 (:8001). /health ok, CC 200, TC 200, ST 200. | 8e3f31e |
| 2 Operator GUI setup | User confirmed version 1.19.0 (06bde939f), 26 user extensions off, CC + TC connections, presets, character `QS Spike Throwaway`, WI entry Sticky 3. `qsSpike.status()` and `snapshot()` ran. | fix commit after 8e3f31e |

## Deviations from Plan
- **[Rule 1 - Bug] spike `status()` version was null.** It sent `POST /version`, but ST serves `GET /version` (src/server-main.js:272). Fixed to `fetch('/version')`. Direct GET confirms 1.19.0.
- **Operator confusion on "character".** The first attempt failed the guard (`wrong character`) because the name was put on the user persona. Fixed by creating a chat character. Instructions in future checkpoints must say "chat character (Character Management), not persona".
- **Instruct template:** not chosen; Instruct Mode is OFF. Accepted as the fixed TC config.
- Bundled extensions left on, so the original `translate`/`expressions` disabled entries are absent from the spike-session list. Restore uses the D-07 baseline.

## Known Stubs
None.

## Self-Check: PASSED
ENVIRONMENT.md has `## Spike session setup`, `--port 8080`, `--host 127.0.0.1`, `llama-server PID: 55716`, `ST PID: 29100`, 26 disabled names, status output. `GET /version` returns 1.19.0.
