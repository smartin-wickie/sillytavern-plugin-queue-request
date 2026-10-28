# Phase 5: Compatibility & Release - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md. This log keeps the alternatives that were considered.

**Date:** 2026-10-28
**Phase:** 05-compatibility-release
**Areas discussed:** Test matrix method, Cascade + gap warnings
**Areas not selected (Claude's discretion):** README scope, Release packaging

## Test matrix method

| Question | Options | Selected |
|----------|---------|----------|
| Who runs the matrix? | User live checklist / Claude drives browser / Mix | Claude drives browser |
| Pass bar | Smoke / Smoke + interaction cases / Full regression | Smoke: queue 2-3, all append, no errors |
| Fold Phase 4 HUMAN-UAT? | Yes, same session / No | Yes, same session |
| Missing extensions | Install from GitHub / User installs / Skip | Other: "Disable Deep-swipe and other external plugins" (read as: already installed; baseline with all third-party disabled, then enable one at a time) |
| Isolation | One at a time + all-on / One at a time / All together | One at a time, then all-on run |
| Where to record | 05-COMPAT-MATRIX.md / README only | 05-COMPAT-MATRIX.md in phase dir |

## Cascade + gap warnings

| Question | Options | Selected |
|----------|---------|----------|
| auto_swipe warning | Toast once per session / Toast + settings note / README only | Toast once per session on first queue |
| Interceptor warning | Toast naming extensions / README only / Block queueing | Toast once per session, names extensions |
| Squash warning | Fold into same toast / README only | Fold into same once-per-session warning |
| Prove COMP-02 | Live + unit test / Live only | Live test + unit test |

## Claude's Discretion
- README structure and depth; release packaging (version, homePage, LICENSE). Ask the user before choosing a license or publishing.

## Deferred Ideas
None.
