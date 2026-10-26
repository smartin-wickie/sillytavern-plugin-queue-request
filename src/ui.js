import { ctx, canQueue, eventSource, event_types } from './st-bridge.js';
import { appendSwipe } from './appender.js';

const CONTROL_CLASS = 'qs-queue-control';

/**
 * Append (or remove) the queue-swipe control next to the swipe arrows on the latest message,
 * per the QUEUE-08 visibility gate. Re-created per render rather than delegated, so a direct
 * click listener on the fresh element is correct and avoids double-binding.
 */
function injectControl() {
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
  control.addEventListener('click', onControlClick);

  swipeRightEl.insertAdjacentElement('afterend', control);
}

// Stub for this plan only — 02-02-PLAN.md replaces this body with store.add() + runner.wake().
async function onControlClick() {
  const c = ctx();
  await appendSwipe(c.chat.length - 1, '[queued-swipes stub placeholder — replaced by real generation in 02-03-PLAN.md]', {
    started: new Date(),
    reasoning: '',
    signature: null,
  });
}

/** Register the control and its re-render triggers. Call once from index.js's init(). */
export function registerQueueControl() {
  eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, injectControl);
  eventSource.on(event_types.MESSAGE_SWIPED, injectControl);
  eventSource.on(event_types.CHAT_CHANGED, injectControl);
  eventSource.on(event_types.APP_READY, injectControl);
}
