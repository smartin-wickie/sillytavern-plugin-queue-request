// Event policy translating ST's global generation events into Runner pause/resume calls
// (GEN-01's "no overlap with native generation" half). The Guard never holds queue state of
// its own (ARCHITECTURE.md §3.2) — it only translates the event stream into Runner method
// calls, and assumes it is not the only listener or emitter on eventSource.

const WATCHED_EVENTS = ['GENERATION_STARTED', 'GENERATION_ENDED', 'GENERATION_STOPPED'];
const WATCHDOG_MS = 500;
const WATCHDOG_IDLE_TICKS = 2;

/**
 * Create the native-generation Guard. `bridge` must expose `eventSource`/`event_types`;
 * `runner` must expose `pause(reason)`/`resume(reason)`/`getPauseReasons()` (src/runner.js).
 * `lifecycle` is optional: `onNativeStart(type)` runs when a native generation begins and
 * `onNativeEnd()` runs when it ends, before the 'native' pause reason is released.
 */
export function createGuard({ bridge, runner, lifecycle }) {
  const handlers = [];
  let watchdog = null;
  let idleTicks = 0;

  // Event handlers never await directly into runner.wake()'s generation path inline —
  // scheduled via setTimeout(0) so a handler can never be re-entered from inside the same
  // eventSource.emit call stack (Pitfall 6: eventSource.emit awaits each listener in order).
  function schedule(fn) {
    setTimeout(fn, 0);
  }

  function clearWatchdog() {
    if (watchdog !== null) {
      clearInterval(watchdog);
      watchdog = null;
    }
    idleTicks = 0;
  }

  // Release only the 'native' pause reason. The lifecycle hook runs first so the queue can
  // re-fingerprint a target that a native Continue edited before the queue is allowed to resume.
  function endNative() {
    clearWatchdog();
    lifecycle?.onNativeEnd?.();
    runner.resume('native');
  }

  function bridgeIdle() {
    return !bridge.isGenerating() && bridge.swipeState() === 'none';
  }

  // Safety net for a missed GENERATION_ENDED: if ST reports idle on two consecutive polls while
  // 'native' is still held, release it.
  function startWatchdog() {
    clearWatchdog();
    if (typeof bridge.isGenerating !== 'function' || typeof bridge.swipeState !== 'function') return;
    watchdog = setInterval(() => {
      if (!runner.getPauseReasons().includes('native')) {
        clearWatchdog();
        return;
      }
      if (!bridgeIdle()) {
        idleTicks = 0;
        return;
      }
      idleTicks += 1;
      if (idleTicks >= WATCHDOG_IDLE_TICKS) endNative();
    }, WATCHDOG_MS);
  }

  function onGenerationStarted(type, _params, dryRun) {
    // Only a non-dry (real, user-initiated) generation pauses the runner. The runner's own
    // dry-run capture, and any other extension's dry run (e.g. Prompt Inspector's
    // tryGenerate), never pause the queue.
    if (dryRun === false) {
      schedule(() => {
        runner.pause('native');
        lifecycle?.onNativeStart?.(type);
        startWatchdog();
      });
    }
  }

  // Native Stop is foreign to the queue (queue cancel uses its own controller), so it only
  // clears the 'native' reason like a normal end.
  function onGenerationEnded() {
    schedule(endNative);
  }

  function onGenerationStopped() {
    schedule(endNative);
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
    clearWatchdog();
  }

  return { start, stop };
}
