import { ctx, canQueue, eventSource, event_types } from './st-bridge.js';
import { buildFingerprint } from './fingerprint.js';

const CONTROL_CLASS = 'qs-queue-control';
const CONTROL_DISABLED_CLASS = 'qs-queue-control--disabled';
const BADGE_CLASS = 'qs-queue-badge';
const IDLE_TITLE = 'Queue a swipe';

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
    renderQueueState(store);
    return;
  }

  const control = document.createElement('div');
  control.className = CONTROL_CLASS;
  control.title = IDLE_TITLE;
  control.innerHTML = '<i class="fa-solid fa-clock"></i>';
  control.addEventListener('click', () => onControlClick(store, runner));

  swipeRightEl.insertAdjacentElement('afterend', control);

  renderQueueState(store);
}

// Re-render the badge and disabled/tooltip state onto whichever `.qs-queue-control` element is
// currently in the DOM. Looked up fresh every call (never a cached reference) because
// injectControl() recreates the control element on CHARACTER_MESSAGE_RENDERED/MESSAGE_SWIPED/
// CHAT_CHANGED — a stale element reference would silently stop updating.
function renderQueueState(store) {
  const control = document.querySelector(`.${CONTROL_CLASS}`);
  if (!control) return;
  renderBadge(control, store);
  renderDisabledState(control, store);
}

// UI-01: badge shows the live pending+running count, hidden entirely (never rendered as `0`)
// when the queue is empty. While an item is actively generating, a spinner icon is prepended
// alongside the count; the control icon itself never spins or pulses (D-07).
function renderBadge(control, store) {
  const n = store.pendingCount() + store.runningCount();
  let badge = control.querySelector(`.${BADGE_CLASS}`);

  if (n === 0) {
    badge?.remove();
    return;
  }

  if (!badge) {
    badge = document.createElement('span');
    badge.className = BADGE_CLASS;
    control.appendChild(badge);
  }

  // Built from DOM nodes, never `.innerHTML =`, even though `n` is always a small integer here
  // (Security Domain V5 — keep the pattern injection-safe regardless of the data source).
  badge.textContent = '';
  if (store.runningCount() > 0) {
    const spinner = document.createElement('i');
    spinner.className = 'fa-solid fa-spinner fa-spin';
    badge.appendChild(spinner);
  }
  badge.appendChild(document.createTextNode(String(n)));
}

// D-06: disable the control at the queue's max cap, with a live-numbered tooltip — never the
// literal string "5/5". Reads the same pendingCount()+runningCount() >= maxQueueSize condition
// the click handler re-checks, both sourced from store.getMaxQueueSize() (the same cap add()
// itself enforces) so the two checks cannot independently drift apart.
function renderDisabledState(control, store) {
  const n = store.pendingCount() + store.runningCount();
  const maxQueueSize = store.getMaxQueueSize();

  if (n >= maxQueueSize) {
    control.classList.add(CONTROL_DISABLED_CLASS);
    control.title = `Queue full (${n}/${maxQueueSize})`;
  } else {
    control.classList.remove(CONTROL_DISABLED_CLASS);
    control.title = IDLE_TITLE;
  }
}

// Enqueue a swipe request for the latest message and wake the runner. Re-checks the same
// full-queue condition renderDisabledState() uses before ever calling store.add() — a
// disabled-looking-but-still-wired control is a real bug class, not just a cosmetic gap.
function onControlClick(store, runner) {
  const n = store.pendingCount() + store.runningCount();
  if (n >= store.getMaxQueueSize()) return;

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

  // The badge/disabled-state must also update on every queue mutation, not only on the DOM
  // re-render events above — a click that fills the queue must disable the control immediately,
  // without waiting for the next CHARACTER_MESSAGE_RENDERED/MESSAGE_SWIPED event.
  store.onChange(() => renderQueueState(store));

  // Correct on first render too, not only after the first onChange/re-render event fires.
  renderQueueState(store);

  // GUARD-05: render exactly one of the 3 locked toast strings per failed item, never raw
  // backend/error text. 'stale' drops are excluded upstream (runner.js) and never reach here.
  runner.onItemFailed(({ reason }) => {
    const msg = FAILURE_MESSAGES[reason];
    if (!msg) return;
    toastr.warning(msg, undefined, { preventDuplicates: true });
  });
}
