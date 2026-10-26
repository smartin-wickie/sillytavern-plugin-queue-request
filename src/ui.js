import { ctx, canQueue, eventSource, event_types } from './st-bridge.js';
import { buildFingerprint } from './fingerprint.js';

const CONTROL_CLASS = 'qs-queue-control';

// GUARD-05's 3 locked toast variants (D-08/D-09) — static literals selected by a reason-code
// lookup, never string-built from the underlying error object. 'stale' (and any other
// unrecognized reason) intentionally has no entry here and never reaches a toast.
const FAILURE_MESSAGES = {
  api: 'Queued swipe failed: API error',
  empty: 'Queued swipe failed: empty reply',
  cancelled: 'Queued swipe failed: cancelled',
};

/**
 * Append (or remove) the queue-swipe control next to the swipe arrows on the latest message,
 * per the QUEUE-08 visibility gate. Re-created per render rather than delegated, so a direct
 * click listener on the fresh element is correct and avoids double-binding.
 */
function injectControl(store, runner) {
  const lastMes = document.querySelector('.last_mes');
  const swipeRightEl = lastMes?.querySelector('.swipe_right');

  if (!canQueue()) {
    lastMes?.querySelector(`.${CONTROL_CLASS}`)?.remove();
    return;
  }

  if (!swipeRightEl || lastMes.querySelector(`.${CONTROL_CLASS}`)) {
    return;
  }

  const control = document.createElement('div');
  control.className = CONTROL_CLASS;
  control.title = 'Queue a swipe';
  control.innerHTML = '<i class="fa-solid fa-clock"></i>';
  control.addEventListener('click', () => onControlClick(store, runner));

  swipeRightEl.insertAdjacentElement('afterend', control);
}

// Enqueue a swipe request for the latest message and wake the runner. A full queue (store.add()
// returning { ok: false }) is silently ignored for now — the disabled-state UI/tooltip for a
// full queue is 02-05-PLAN.md's job, not this plan's.
function onControlClick(store, runner) {
  const c = ctx();
  const target = buildFingerprint(c, c.chat.length - 1);
  const result = store.add(target);
  if (!result.ok) return;
  runner.wake();
}

/**
 * Register the control and its re-render triggers. Call once from index.js's init(), passing
 * the single store/runner instance for the loaded chat.
 */
export function registerQueueControl({ store, runner }) {
  const render = () => injectControl(store, runner);
  eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, render);
  eventSource.on(event_types.MESSAGE_SWIPED, render);
  eventSource.on(event_types.CHAT_CHANGED, render);
  eventSource.on(event_types.APP_READY, render);

  // GUARD-05: render exactly one of the 3 locked toast strings per failed item, never raw
  // backend/error text. 'stale' drops are excluded upstream (runner.js) and never reach here.
  runner.onItemFailed(({ reason }) => {
    const msg = FAILURE_MESSAGES[reason];
    if (!msg) return;
    toastr.warning(msg, undefined, { preventDuplicates: true });
  });
}
