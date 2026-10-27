// Top-of-chat progress bar (UI-02). Shows a live completed/total count while any item is
// pending or running, with a stop control that performs the exact same action as the badge
// dropdown's "Cancel all" (D-03) — not a separate cancellation code path. Registered once on
// APP_READY, like the wand menu: it has no per-chat state and hides itself at zero rather than
// needing per-chat teardown.
import { eventSource, event_types } from './st-bridge.js';

const BAR_ID = 'qs-progress-bar';
const BAR_CLASS = 'qs-progress-bar';
const VISIBLE_CLASS = 'qs-progress-bar--visible';

/**
 * Register the top-of-chat progress bar. `cancelAll` is injected (not re-derived) so the stop
 * control is behaviorally identical to every other cancel-all surface in this phase.
 */
export function registerProgressBar({ store, runner, cancelAll }) {
  let completed = 0;
  let wasActive = false;

  // Idempotency guard: only ever insert the bar once, mirroring the wand-menu's own
  // `$('#qs-wand-entry').length` check (Pitfall 3 — DOM target may not exist yet at init()
  // time; guard against re-insertion on a later APP_READY-adjacent call instead).
  function render() {
    if ($(`#${BAR_ID}`).length) return;

    const bar = $(`<div id="${BAR_ID}" class="${BAR_CLASS}"></div>`);
    const fill = $('<div class="qs-progress-bar-fill"></div>');
    const label = $('<span class="qs-progress-bar-label"></span>');
    const stop = $('<button type="button" class="qs-progress-bar-stop" title="Stop queue"><i class="fa-solid fa-stop"></i></button>');

    stop.on('click', () => cancelAll(store, runner));

    bar.append(fill, label, stop);

    // Progress bar insertion point — exact selector pending live confirmation against ST
    // 1.19.0 (03-RESEARCH.md Open Question #2); falls back to inserting before #chat if
    // #sheld isn't present.
    const sheld = $('#sheld');
    if (sheld.length) {
      sheld.prepend(bar);
    } else {
      $('#chat').before(bar);
    }
  }

  // Denominator is always computed live (completed + pending + running), never a fixed
  // snapshot — grows immediately if the user queues more mid-run (UI-SPEC "numbers are
  // always live" rule). `completed` resets to 0 only on an active -> inactive transition,
  // never mid-run (Pitfall 2's same discipline as the toast accumulator).
  function update() {
    const pending = store.pendingCount();
    const running = store.runningCount();
    const active = pending + running > 0;

    if (!active && wasActive) completed = 0;
    wasActive = active;

    const bar = document.getElementById(BAR_ID);
    if (!bar) return;

    if (!active) {
      bar.classList.remove(VISIBLE_CLASS);
      return;
    }

    bar.classList.add(VISIBLE_CLASS);
    const total = completed + pending + running;
    bar.querySelector('.qs-progress-bar-label').textContent = `${completed} / ${total}`;
    bar.querySelector('.qs-progress-bar-fill').style.width = `${total > 0 ? (completed / total) * 100 : 0}%`;
  }

  store.onChange(update);
  runner.onItemDone(() => {
    completed += 1;
    update();
  });

  eventSource.on(event_types.APP_READY, () => {
    render();
    update();
  });
}
