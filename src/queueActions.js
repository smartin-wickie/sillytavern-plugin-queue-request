// Shared cancel-all implementation (D-03, QUEUE-06/07). The one place every cancel-all surface
// in this phase (badge dropdown, wand menu, /queuecancel, progress-bar stop) calls — reuses
// store.drop()/runner.abortRunning() with no new store API, per 03-RESEARCH.md Pattern 2.

/**
 * Drop every pending ('queued') item with reason 'cancelled', then abort the currently-running
 * item (if any) via runner.abortRunning(). Returns the total number of items cancelled —
 * pending items dropped here, plus 1 if a running item was actually aborted.
 */
export function cancelAll(store, runner) {
  const pending = store.getItems().filter((i) => i.status === 'queued');
  for (const item of pending) store.drop(item.id, 'cancelled');
  const { aborted } = runner.abortRunning();
  return pending.length + (aborted ? 1 : 0);
}

/**
 * The single Resume entry point shared by the dropdown and the progress bar. Clears every pause
 * reason on the runner and returns its wake promise.
 */
export function resumeQueue(store, runner) {
  return runner.resumeAll();
}
