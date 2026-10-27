# Phase 4: Lifecycle, Persistence & Spend Safety - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-27
**Phase:** 04-lifecycle-persistence-spend-safety
**Areas discussed:** Stale & expiry on load, Target-change edge cases, Multi-tab ownership, Circuit breaker default

---

## Stale & expiry on load

| Question | Options | Selected |
|----------|---------|----------|
| Age expiry for stored items | 24h fixed / No age expiry / 7 days fixed | 24h fixed |
| Item stored as `running` at refresh | Demote to queued / Drop it | Demote to queued |
| On-load stale check | Fingerprint + age / Fingerprint only | Fingerprint + age |

## Target-change edge cases

| Question | Options | Selected |
|----------|---------|----------|
| Continue on target message | Re-fingerprint, keep queue / Clear + toast / Silent stale drop (current behavior) | Re-fingerprint, keep queue |
| Edit of a non-swipe-0 swipe on target | Clear any target edit / Only if it affects the prompt | Clear any target edit |
| Manual native swipe on target | Queue continues / Count native swipe as one queued item | Queue continues |

**Notes:** Claude corrected its own option text after the answer. A swipe prompt excludes the target message, so Continue only needs an identity-key refresh and does not change prompt content. The re-fingerprint also covers in-flight and parked items.

## Multi-tab ownership

| Question | Options | Selected |
|----------|---------|----------|
| Owner rule | First tab wins / Last focused tab wins | First tab wins |
| Owner tab switches chat | Other tab takes over, paused / Ownership stays with owner tab | Take over, paused |
| Takeover latency | A few seconds (~2s heartbeat, ~5s timeout) / You decide | A few seconds |

**Notes:** Claude added D-10: a throttled former owner must demote itself to read-only, so two tabs never run the same chat's queue at once.

## Circuit breaker default

| Question | Options | Selected |
|----------|---------|----------|
| Default threshold | Keep 3, fix REQUIREMENTS / Change to 2 | Keep 3, fix REQUIREMENTS |
| Counter persistence | In-memory, resets / Persist per chat | In-memory, resets |

## Claude's Discretion

- Multi-tab transport and exact timings, persistence schema details, preset identifier for SAFE-02, Prompt Inspector detection, GUARD-06 and GUARD-03 mechanics.

## Deferred Ideas

None.
