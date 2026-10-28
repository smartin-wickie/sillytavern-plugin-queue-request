// Cross-tab state mirror. The owning tab publishes a validated display snapshot of its queue;
// a read-only tab applies it so it can show the queue live without ever touching chat data.
// No ST imports: store, runner, ownership and persistence helpers are injected.

const PUBLISH_DELAY_MS = 250;

export function createMirror({ store, runner, ownership, buildSnapshot, parseSnapshot, timers = {} }) {
  const setT = timers.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = timers.clearTimeout ?? ((h) => clearTimeout(h));
  let pending = null;
  let started = false;

  function publishNow() {
    pending = null;
    if (!ownership.isOwner() || store.isReadOnly()) return;
    ownership.publishState(buildSnapshot({
      items: store.getItems(),
      completed: store.getCompleted(),
      reasons: runner.getPauseReasons?.() ?? [],
      failures: runner.getConsecutiveFailures?.() ?? 0,
    }));
  }

  function schedulePublish() {
    if (pending !== null) return;
    if (!ownership.isOwner() || store.isReadOnly()) return;
    pending = setT(publishNow, PUBLISH_DELAY_MS);
  }

  function applyStored() {
    if (!store.isReadOnly()) return;
    const parsed = parseSnapshot(ownership.readState()?.snapshot);
    if (parsed) store.applySnapshot(parsed);
  }

  function onReadOnly() {
    if (store.isReadOnly()) applyStored();
    else schedulePublish();
  }

  function start() {
    if (started) return;
    started = true;
    store.onChange(schedulePublish);
    runner.onStateChange(schedulePublish);
    store.onReadOnlyChange(onReadOnly);
    ownership.onState(applyStored);
    applyStored();
  }

  function stop() {
    if (!started) return;
    started = false;
    store.offChange(schedulePublish);
    runner.offStateChange?.(schedulePublish);
    store.offReadOnlyChange(onReadOnly);
    ownership.offState(applyStored);
    if (pending !== null) clearT(pending);
    pending = null;
  }

  return { start, stop };
}
