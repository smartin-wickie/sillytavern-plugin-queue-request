// Generation Adapter (GEN-02/03/04/05/06): dry-run Generate('swipe') prompt capture, an
// own-transport send, and native-equivalent post-processing. Mirrors the pattern Phase 1's
// spike (spike/index.js capture()/send()/abortOwn()) proved live against ST 1.19.0 — this is
// new production code, not a copy of the frozen spike file (Phase 1 D-09).
import * as bridge from './st-bridge.js';

/**
 * JSON-safe clone. structuredClone() throws DataCloneError on the textgenerationwebui/llama.cpp
 * generate_data, which carries a non-cloneable parseSequenceBreakers function property; the JSON
 * round-trip drops it the same way the spike's own dumps already did. Load-bearing, not a style
 * choice — do not swap for structuredClone.
 */
function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Idle-gated dry-run capture of the exact native swipe prompt (GEN-02). Duplicates the Runner's
 * own idle-gate on purpose, as a last-line-of-defense. Arms on the dry-run GENERATION_STARTED,
 * captures the cloned generate_data on the next dry-run GENERATE_AFTER_DATA, and always removes
 * both listeners via finally. `{ signal }` is passed to every Generate('swipe', ...) call.
 */
export async function capture({ signal }) {
  if (bridge.isGenerating() || bridge.swipeState() !== 'none') {
    throw new Error('not idle');
  }

  let armed = false;
  let captured = null;

  const onStart = (type, _params, dryRun) => {
    if (type === 'swipe' && dryRun === true) armed = true;
  };
  const onData = (data, dryRun) => {
    if (armed && dryRun === true) {
      captured = jsonClone(data);
      armed = false;
    }
  };

  bridge.eventSource.on(bridge.event_types.GENERATION_STARTED, onStart);
  bridge.eventSource.makeLast(bridge.event_types.GENERATE_AFTER_DATA, onData);

  try {
    await bridge.Generate('swipe', { signal }, true);
  } finally {
    bridge.eventSource.removeListener(bridge.event_types.GENERATION_STARTED, onStart);
    bridge.eventSource.removeListener(bridge.event_types.GENERATE_AFTER_DATA, onData);
  }

  if (!captured) {
    throw new Error('capture failed: no dry-run GENERATE_AFTER_DATA seen');
  }
  return captured;
}

/**
 * Send the captured prompt over an own transport — never a non-dry Generate (GEN-03/GEN-05).
 * Chat Completion: sendOpenAIRequest('swipe', ...) — never 'quiet', which drops the Claude
 * assistant_prefill and disables multi-swipe n. Handles both the streaming generator-function
 * return shape and the plain JSON return shape. Text Completion: plain fetch to the native
 * generate endpoint. An abort is a normal cancellation outcome, not a thrown error — it resolves
 * with `{ aborted: true, getMessage: '', reasoning: '' }` instead of rethrowing.
 */
export async function send(captured, signal) {
  try {
    const c = bridge.ctx();
    if (c.mainApi === 'openai') {
      const r = await bridge.sendOpenAIRequest('swipe', captured.prompt, signal);
      if (typeof r === 'function') {
        let last = { text: '', state: {} };
        for await (const chunk of r()) last = chunk;
        return { getMessage: last.text ?? '', reasoning: last.state?.reasoning ?? '', aborted: false };
      }
      return {
        getMessage: bridge.extractMessageFromData(r),
        reasoning: bridge.extractReasoningFromData(r) ?? '',
        aborted: false,
      };
    }

    const res = await fetch(bridge.getGenerateUrl(c.mainApi), {
      method: 'POST',
      headers: c.getRequestHeaders(),
      body: JSON.stringify(captured),
      signal,
    });
    if (!res.ok) throw new Error('generation failed: ' + res.status);
    const json = await res.json();
    return {
      getMessage: bridge.extractMessageFromData(json),
      reasoning: bridge.extractReasoningFromData(json) ?? '',
      aborted: false,
    };
  } catch (err) {
    if (err?.name === 'AbortError' || signal.aborted) {
      return { aborted: true, getMessage: '', reasoning: '' };
    }
    throw err;
  }
}

/**
 * Native-equivalent post-processing (GEN-04) — the exact function native non-streaming
 * onSuccess calls: stop-string trimming, regex, name trimming, markdown fixups. An aborted
 * result is never cleaned — it unconditionally returns empty text, never running cleanUpMessage
 * on partial text. Reasoning is parsed via parseReasoningFromString only when the user's
 * auto_parse setting is on; otherwise it passes through as-is. Signature wiring for
 * Claude-thinking blocks is out of scope for this plan (no Phase 2 requirement needs it).
 */
export function cleanAndExtract({ getMessage, reasoning, aborted }) {
  if (aborted) {
    return { text: '', reasoning: '', signature: null };
  }

  const text = bridge.cleanUpMessage({
    getMessage,
    isImpersonate: false,
    isContinue: false,
    displayIncompleteSentences: false,
  });

  const c = bridge.ctx();
  const finalReasoning = c.powerUserSettings?.reasoning?.auto_parse
    ? bridge.parseReasoningFromString(reasoning)
    : reasoning;

  return { text, reasoning: finalReasoning, signature: null };
}

/**
 * Abort only this adapter's own in-flight AbortController. Never touches ST's native
 * stopGeneration()/global abortController (cancel policy: abort own controller + discard
 * app-side; never rely on the abort cutting off an already-buffered fast response).
 */
export async function abortOwn(ownController) {
  if (!ownController) throw new Error('no own request in flight');
  ownController.abort();
  return { aborted: ownController.signal.aborted };
}

/**
 * GEN-06: success is an observable, non-empty, non-aborted text result — never "the promise
 * resolved". The Runner uses this predicate, not promise resolution, to decide outcome.
 */
export function isSuccessful({ text, aborted }) {
  return !aborted && typeof text === 'string' && text.length > 0;
}
