# Phase 1: Route Verification Spike - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-25
**Phase:** 01-route-verification-spike
**Areas discussed:** Spike environment, Spike artifact form

---

## Spike environment

| Question | Options | Selected |
|----------|---------|----------|
| Where does live ST run? | Existing local install / Fresh separate install / Docker | Existing local install |
| CC backend | OpenRouter / OpenAI-Anthropic direct / Local OpenAI-compatible | Local OpenAI-compatible |
| TC backend | KoboldCpp / llama.cpp server / Ooba-TabbyAPI / Remote TC API | llama.cpp server |
| Vectors parity test | Enable Vectors live / Source-read only | Source-read only |
| One llama.cpp server for both? | One server / Separate servers | One server |
| Streaming modes | Both modes, both backends / Streaming off only | Both modes, both backends |
| Other extensions during spike | Disable / Leave as-is | Disable |
| ST version | On 1.19.0 / Older, will update / Staging / Not sure | Older, will update |
| Backup before update | Fresh backup / Existing backup enough / User handles update | Existing backup enough |
| Disable method | Toggle in Extensions UI / Separate ST user | Toggle in Extensions UI |

**Notes:** User gave the install location `E:\SillyTavern`. A check found the release branch at 1.14.0 and 26 user extensions, including PromptInspector.

---

## Spike artifact form

| Question | Options | Selected |
|----------|---------|----------|
| Spike form | Minimal real extension / Console snippets / Both | Minimal real extension |
| Spike code after | Keep under spike/, not reused / Evolve into Phase 2 / Delete | Keep under spike/, not reused |
| Install method | Junction from repo / Copy files / Clone into data/default-user/extensions | Junction from repo |
| Evidence format | SPIKE-REPORT.md + raw JSON dumps / Report only | SPIKE-REPORT.md + raw JSON dumps |

---

## Claude's Discretion

The user did not select these areas, so the research defaults apply:
- go/no-go rule (hard blockers a/c/d; checkpoint if ambiguous)
- stop-with-partial policy
- auto_swipe policy
- interceptor gap policy
- spike folder naming

## Deferred Ideas

None.
