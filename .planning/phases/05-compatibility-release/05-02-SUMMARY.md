---
phase: 05-compatibility-release
plan: 02
subsystem: compatibility
tags: [compat, live-test, gap-toast]
requires: [05-01]
provides: [COMP-01 matrix]
affects: [README compat section (05-04)]
key-files:
  created:
    - .planning/phases/05-compatibility-release/05-COMPAT-MATRIX.md
    - .planning/phases/05-compatibility-release/evidence/state-snapshot.json
    - .planning/phases/05-compatibility-release/evidence/*.jpg
  modified: []
decisions:
  - "User decision (2026-10-28): do not install UserSwipes or any other swipe plugin; keep queue/swipe plugins disabled while testing. Deep-Swipe and UserSwipes rows are BLOCKED."
  - "ST URL is http://127.0.0.1:8000/ (not 8001); LM Studio is the custom endpoint on 127.0.0.1:5000."
metrics:
  completed: 2026-10-28
status: complete
---

# Phase 5 Plan 02: Live COMP-01 Compatibility Session Summary

Queued Swipes ran cleanly next to every extension that could be tested on the user's ST 1.19.0. The result is 11 PASS, 0 FAIL and 4 BLOCKED. The D-06 gap toast behaved as designed in a live browser.

## What ran

- **Preflight:** ST 1.19.0 'release' (06bde939f) at :8000. mainApi `openai` with custom source to LM Studio. Model switched from `dark-desires-32b-v1.5` to `satyr-v0.1-4b` for the session. Throwaway chat "QS Spike Throwaway".
- **Install sync:** the ST copy of the extension (`data/default-user/extensions/queued-swipes`) is a plain copy, not a junction, and it predated 05-01. The runtime files (`index.js`, `src/*.js`, manifest, html, css) were copied from the repo before testing.
- **Baseline and solo rows:** Prompt Inspector (disabled), MessageSummarize, Parameter Randomizer, WebSearch, TTS, Summarize and Vector Storage. Then one combined run and four gap-toast checks. All results are in `05-COMPAT-MATRIX.md`.
- **Restore:** `disabledExtensions`, the custom model and TTS enable were set back to the snapshot values. Checked after a reload.

## Deviations

- **UserSwipes was not installed and Deep-Swipe was not enabled.** This followed the user's instruction for this session. Both rows are BLOCKED, so ROADMAP criterion 1 is only partly met for those two extensions.
- **TTS own-job check is BLOCKED.** The voice map has the default voice set to disabled. The queue side passed, and TTS spoke 0 times during queued appends.
- **Vector Storage injection check is BLOCKED.** The extension was never configured by the user.
- **Fewer items per solo row.** Solo rows queued 2 items, not 3. The plan allows 2-3, and each item took about 1 minute.
- **Extension toggles were set by JS, then the page reloaded.** The plan called for UI toggles. The JS path wrote `extension_settings.disabledExtensions` and called `saveSettingsDebounced()`, which is the same effect as the UI toggles.
- **The Chrome tab group closed during the no-gaps drain.** The check was finished in a new tab. The item still appended (24 -> 25).

## Self-Check: PASSED

- The plan's automated verify scripts for Tasks 2, 3 and 4 pass.
- The snapshot has no secrets (grep count 0).
