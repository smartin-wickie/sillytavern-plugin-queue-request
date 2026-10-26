// Event policy translating ST's global generation events into Runner pause/resume calls
// (GEN-01's "no overlap with native generation" half). The Guard never holds queue state of
// its own (ARCHITECTURE.md §3.2) — it only translates the event stream into Runner method
// calls, and assumes it is not the only listener or emitter on eventSource.

const WATCHED_EVENTS = ['GENERATION_STARTED', 'GENERATION_ENDED', 'GENERATION_STOPPED'];

/**
 * Create the native-generation Guard. `bridge` must expose `eventSource`/`event_types`;
 * `runner` must expose `pause(reason)`/`resume()` (src/runner.js).
 */
export function createGuard({ bridge, runner }) {
  const handlers = [];

  // Event handlers never await directly into runner.wake()'s generation path inline —
  // scheduled via setTimeout(0) so a handler can never be re-entered from inside the same
  // eventSource.emit call stack (Pitfall 6: eventSource.emit awaits each listener in order).
  function schedule(fn) {
    setTimeout(fn, 0);
  }

  function onGenerationStarted(_type, _params, dryRun) {
    // Only a non-dry (real, user-initiated) generation pauses the runner. The runner's own
    // dry-run capture, and any other extension's dry run (e.g. Prompt Inspector's
    // tryGenerate), never pause the queue.
    if (dryRun === false) {
      schedule(() => runner.pause('native'));
    }
  }

  function onGenerationEnded() {
    schedule(() => runner.resume());
  }

  function onGenerationStopped() {
    schedule(() => runner.resume());
  }

  const HANDLER_MAP = {
    GENERATION_STARTED: onGenerationStarted,
    GENERATION_ENDED: onGenerationEnded,
    GENERATION_STOPPED: onGenerationStopped,
  };

  function start() {
    for (const key of WATCHED_EVENTS) {
      const evt = bridge.event_types[key];
      if (!evt) continue;
      const h = HANDLER_MAP[key];
      bridge.eventSource.on(evt, h);
      handlers.push([evt, h]);
    }
  }

  function stop() {
    for (const [evt, h] of handlers.splice(0, handlers.length)) {
      bridge.eventSource.removeListener(evt, h);
    }
  }

  return { start, stop };
}
