import * as bridge from './st-bridge.js';

/**
 * Append `text` as a new swipe on the message at `mesId`, mirroring native `/addswipe`
 * (ARCHITECTURE.md §1.5/§2.2) without ever switching swipe_id. Returns 'ok' on success,
 * 'defer' if ST is mid-generation (the append race, never append then), or 'stale' if the
 * target is no longer the last AI message.
 */
export async function appendSwipe(mesId, text, meta) {
  // Idle-gate first: never append while ST is mid-generation (SWIPE-04).
  if (bridge.isGenerating() || bridge.swipeState() !== 'none') {
    return 'defer';
  }

  const c = bridge.ctx();
  const m = c.chat[mesId];
  if (!m || mesId !== c.chat.length - 1 || m.is_user || m.is_system) {
    return 'stale';
  }

  if (!Array.isArray(m.swipes)) {
    m.swipe_id = 0;
    m.swipes = [m.mes];
    m.swipe_info = [{
      send_date: m.send_date,
      gen_started: m.gen_started,
      gen_finished: m.gen_finished,
      // JSON round-trip, not structuredClone — `extra` is ST-originated, extension-writable
      // data that can carry a non-cloneable value (same rationale as adapter.js's jsonClone).
      extra: JSON.parse(JSON.stringify(m.extra ?? {})),
    }];
  } else {
    bridge.ensureSwipes(m);
  }

  // Single synchronous block, no await between the two pushes (Pitfall 24/25).
  m.swipes.push(text);
  m.swipe_info.push({
    send_date: new Date().toISOString(),
    gen_started: meta.started,
    gen_finished: new Date(),
    extra: {
      api: bridge.getGeneratingApi(),
      model: bridge.getGeneratingModel(),
      reasoning: meta.reasoning ?? '',
      reasoning_duration: null,
      reasoning_signature: meta.signature ?? null,
    },
  });
  // swipe_id is never mutated here (SWIPE-03).

  c.chatMetadata.tainted = true;

  await bridge.updateSwipeCounter(mesId, { message: m });
  c.swipe.refresh();
  await c.saveChat(); // = saveChatConditional

  return 'ok';
}
