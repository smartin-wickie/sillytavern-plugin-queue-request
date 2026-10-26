// Pure target-identity utility (no DOM/bridge access beyond the ctx/bridge argument passed in),
// so it is Vitest-unit-testable without a live ST instance (D-10).
//
// A fingerprint is a stable key for "is this still the same target message", re-checked
// immediately before every capture and again before every append (GUARD-04) — never trust
// the event stream alone as the sole invalidation gate.

/**
 * Cheap, non-cryptographic djb2-variant hash. Exact implementation reused from spike/index.js
 * (lines ~99-103) — do not invent a different hash.
 */
export function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16) + ':' + str.length;
}

/**
 * Build a fingerprint for the message at `mesId` from a live `ctx` (SillyTavern.getContext()
 * shape). Pure: reads only from the `ctx` object passed in.
 */
export function buildFingerprint(ctx, mesId) {
  const m = ctx.chat[mesId];
  return {
    chatId: ctx.chatId ?? null,
    integrity: ctx.chatMetadata?.integrity ?? null,
    mesId,
    chatLength: ctx.chat.length,
    swipe0Hash: hash(m.swipes?.[0] ?? m.mes),
    name: m.name,
  };
}

/**
 * Re-validate `fp` against the *current* chat state. Always calls `bridge.ctx()` fresh
 * internally — never accepts a pre-fetched context object as its only data source — so this
 * naturally re-reads the live chat rather than comparing against a stale snapshot.
 */
export function fingerprintMatches(bridge, fp) {
  const ctx = bridge.ctx();

  if ((ctx.chatId ?? null) !== fp.chatId) return false;
  if ((ctx.chatMetadata?.integrity ?? null) !== fp.integrity) return false;
  if (ctx.chat.length !== fp.chatLength) return false;
  if (fp.mesId !== ctx.chat.length - 1) return false;

  const m = ctx.chat[fp.mesId];
  if (!m) return false;
  if (hash(m.swipes?.[0] ?? m.mes) !== fp.swipe0Hash) return false;

  return true;
}
