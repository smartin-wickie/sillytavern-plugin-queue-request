// Pure run-boundary accumulator (UI-03). A "run" spans from the queue leaving empty
// (0 -> nonzero) to it draining back to empty (nonzero -> 0); this module tracks
// completed/failure counts for exactly one run at a time and hands back a drained
// snapshot only when that boundary is actually crossed — never on an in-between
// change (Pitfall 2: mid-run count changes must never reset the accumulator).

/**
 * Create a run-boundary accumulator with no ST/DOM dependencies, so it is fully
 * unit-testable in isolation from the rest of the extension.
 */
export function createRunAccumulator() {
  let run = null; // null when idle; { completed, failures: Map<reason, count> } while active

  /**
   * Report whether the queue is currently active (pending+running > 0).
   * - false -> true (no run active yet): starts a new run, returns null (nothing to flush).
   * - true -> false (a run is active): ends it, returns the drained { completed, failures }.
   * - Anything else (active stays active, or idle stays idle): no boundary crossed,
   *   returns undefined and leaves any in-progress run untouched.
   */
  function noteActivity(isActive) {
    if (isActive && !run) {
      run = { completed: 0, failures: new Map() };
      return null;
    }
    if (!isActive && run) {
      const drained = run;
      run = null;
      return drained;
    }
    return undefined;
  }

  /** Increment the active run's completed count, auto-starting a run if none is active yet. */
  function recordDone() {
    if (!run) run = { completed: 0, failures: new Map() };
    run.completed += 1;
  }

  /** Increment the active run's failure count for `reason`, auto-starting a run if needed. */
  function recordFailed(reason) {
    if (!run) run = { completed: 0, failures: new Map() };
    run.failures.set(reason, (run.failures.get(reason) ?? 0) + 1);
  }

  /** Return to the initial inactive state, discarding any in-progress run's counts. */
  function reset() {
    run = null;
  }

  return { noteActivity, recordDone, recordFailed, reset };
}
