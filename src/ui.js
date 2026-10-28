import { canQueue, promptInspectorEnabled, eventSource, event_types, MODULE_NAME, extension_settings } from './st-bridge.js';
import { cancelAll, resumeQueue, enqueue } from './queueActions.js';
import { pauseReasonLabel, statusLineFor } from './pauseLabels.js';
import { createRunAccumulator } from './toastAccumulator.js';

const CONTROL_CLASS = 'qs-queue-control';
const RENDER_RETRY_MS = 250;
const RENDER_RETRY_LIMIT = 20;
const CONTROL_DISABLED_CLASS = 'qs-queue-control--disabled';
const BADGE_CLASS = 'qs-queue-badge';
const IDLE_TITLE = 'Queue a swipe';
const READONLY_TITLE = 'Queue is managed in another tab';
const READONLY_STATUS = 'Managed in another tab';
const INSPECTOR_TITLE = 'Turn off Prompt Inspector to queue swipes';

// Cancel dropdown (D-01-D-04): anchored to the badge, never a modal popup.
const DROPDOWN_CLASS = 'qs-queue-dropdown';
const DROPDOWN_OPEN_CLASS = 'qs-queue-dropdown--open';
const DROPDOWN_ROWS_CLASS = 'qs-dropdown-rows';
const DROPDOWN_ROW_CLASS = 'qs-dropdown-row';
const DROPDOWN_CANCEL_ITEM_CLASS = 'qs-dropdown-cancel-item';
const DROPDOWN_CANCEL_RUNNING_CLASS = 'qs-dropdown-cancel-running';
const DROPDOWN_CANCEL_ALL_CLASS = 'qs-dropdown-cancel-all';
const DROPDOWN_STATUS_CLASS = 'qs-dropdown-status';
const DROPDOWN_RESUME_CLASS = 'qs-dropdown-resume';

// The paused reason worth showing: anything except a bare 'native' wait (which is just a
// "waiting for your generation" status line, not a user-actionable pause).
function visiblePauseReason(runner) {
  const reasons = runner.getPauseReasons?.() ?? [];
  const actionable = reasons.filter((r) => r !== 'native');
  if (actionable.length === 0) return null;
  return runner.getPrimaryReason?.() ?? actionable[0];
}

function failureCount(runner) {
  return runner.getFailureCount?.() ?? 0;
}

// UI-03's coalesced-summary reason labels — short form for the "{reasons}" slot in a combined
// toast (e.g. "API error, empty reply"), distinct from any full-sentence per-item string since
// no per-item toast exists anymore. Static literals selected by a reason-code lookup, never
// string-built from the underlying error object. 'stale' (and any other unrecognized reason)
// never reaches runner.onItemFailed at all (runner.js's own filter), so it never appears here.
const SHORT_FAILURE_LABELS = {
  api: 'API error',
  empty: 'empty reply',
  cancelled: 'cancelled',
};

// D-12's live-read discipline: never cache extension_settings[MODULE_NAME] in a variable,
// always re-read it fresh at the point of use — mirrors store.js's getMaxQueueSize() pattern.
function getNotificationStyle() {
  return extension_settings[MODULE_NAME]?.notificationStyle ?? 'all';
}

/**
 * Append (or remove) the queue-swipe control next to the swipe arrows on the latest message,
 * per the QUEUE-08 visibility gate. Re-created per render rather than delegated, so a direct
 * click listener on the fresh element is correct and avoids double-binding.
 */
// Exported so a settings change that affects canQueue() (currently only the Enable toggle)
// can force the same re-render injectControl's own ST-event listeners already trigger,
// rather than leaving a stale control/icon visible until the next unrelated chat event.
export function injectControl(store, runner) {
  const lastMes = document.querySelector('.last_mes');
  const swipeRightEl = lastMes?.querySelector('.swipe_right');

  // A message stops being `.last_mes` on every subsequent chat turn, but its previously-injected
  // control is never otherwise removed (it isn't ST's DOM to manage). Without this sweep, orphaned
  // controls accumulate and the unscoped lookups below start targeting the wrong, stale element.
  document.querySelectorAll(`.${CONTROL_CLASS}`).forEach((el) => {
    if (el !== lastMes?.querySelector(`.${CONTROL_CLASS}`)) el.remove();
  });

  if (!canQueue()) {
    lastMes?.querySelector(`.${CONTROL_CLASS}`)?.remove();
    return;
  }

  if (!swipeRightEl || lastMes.querySelector(`.${CONTROL_CLASS}`)) {
    renderQueueState(store, runner);
    return;
  }

  const control = document.createElement('div');
  control.className = CONTROL_CLASS;
  control.title = IDLE_TITLE;
  control.innerHTML = '<i class="fa-solid fa-clock"></i>';
  control.addEventListener('click', () => onControlClick(store, runner));

  swipeRightEl.insertAdjacentElement('afterend', control);

  renderQueueState(store, runner);
}

// Re-render the badge and disabled/tooltip state onto the control inside the current `.last_mes`
// — never a document-wide lookup, which would match an orphaned control still sitting on an
// earlier message first (document order). Looked up fresh every call, never a cached reference.
function renderQueueState(store, runner) {
  const control = document.querySelector('.last_mes')?.querySelector(`.${CONTROL_CLASS}`);
  if (!control) return;
  renderBadge(control, store, runner);
  renderDisabledState(control, store);
  renderDropdown(control, store, runner);
}

// UI-01: badge shows the live pending+running count, hidden entirely (never rendered as `0`)
// when the queue is empty. While an item is actively generating, a spinner icon is prepended
// alongside the count; the control icon itself never spins or pulses (D-07).
function renderBadge(control, store, runner) {
  const n = store.pendingCount() + store.runningCount();
  let badge = control.querySelector(`.${BADGE_CLASS}`);

  if (n === 0) {
    badge?.remove();
    return;
  }

  if (!badge) {
    badge = document.createElement('span');
    badge.className = BADGE_CLASS;
    // Toggle the cancel dropdown open/closed. stopPropagation() keeps this click from also
    // reaching the document-level outside-click listener (registerQueueControl), which would
    // otherwise immediately re-close the dropdown this same click just opened.
    badge.addEventListener('click', (event) => {
      event.stopPropagation();
      const panel = control.querySelector(`.${DROPDOWN_CLASS}`);
      panel?.classList.toggle(DROPDOWN_OPEN_CLASS);
    });
    control.appendChild(badge);
  }

  // Built from DOM nodes, never `.innerHTML =`, even though `n` is always a small integer here
  // (Security Domain V5 — keep the pattern injection-safe regardless of the data source).
  badge.textContent = '';
  const pausedReason = visiblePauseReason(runner);
  if (store.isReadOnly()) {
    const lock = document.createElement('i');
    lock.className = 'fa-solid fa-lock';
    badge.appendChild(lock);
    badge.title = READONLY_TITLE;
    badge.setAttribute('aria-label', READONLY_TITLE);
  } else if (pausedReason) {
    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-pause';
    badge.appendChild(icon);
    const text = `Queue paused (${pauseReasonLabel(pausedReason, { failures: failureCount(runner) })})`;
    badge.title = text;
    badge.setAttribute('aria-label', text);
  } else {
    badge.removeAttribute('title');
    badge.removeAttribute('aria-label');
    if (store.runningCount() > 0) {
      const spinner = document.createElement('i');
      spinner.className = 'fa-solid fa-spinner fa-spin';
      badge.appendChild(spinner);
    }
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

  // Prompt Inspector's toggle emits no event, so this render can lag until the next render
  // event; the click-time gate in enqueue() is the actual enforcement.
  if (store.isReadOnly()) {
    control.classList.add(CONTROL_DISABLED_CLASS);
    control.title = READONLY_TITLE;
  } else if (promptInspectorEnabled()) {
    control.classList.add(CONTROL_DISABLED_CLASS);
    control.title = INSPECTOR_TITLE;
  } else if (n >= maxQueueSize) {
    control.classList.add(CONTROL_DISABLED_CLASS);
    control.title = `Queue full (${n}/${maxQueueSize})`;
  } else {
    control.classList.remove(CONTROL_DISABLED_CLASS);
    control.title = IDLE_TITLE;
  }
}

// Cancel dropdown (D-01-D-04): anchored to the badge, lists every pending item with a
// per-item cancel, plus Cancel running / Cancel all. The panel element is created once per
// `control` and persists across re-renders (so toggling it open survives the next
// store.onChange-triggered re-render); its row list is rebuilt from a fresh store.getItems()
// read on every call, never a cached array.
function renderDropdown(control, store, runner) {
  let panel = control.querySelector(`.${DROPDOWN_CLASS}`);
  if (!panel) {
    panel = document.createElement('div');
    panel.className = DROPDOWN_CLASS;
    control.appendChild(panel);
  }

  // Built from DOM nodes/textContent only, never innerHTML with dynamic data (Security Domain
  // V5/threat T-03-01-03) — rows carry only an ordinal label, never prompt/model text.
  panel.textContent = '';

  const header = document.createElement('div');
  header.className = 'qs-dropdown-header';
  header.appendChild(document.createTextNode('Queued swipes'));
  panel.appendChild(header);

  const rows = document.createElement('div');
  rows.className = DROPDOWN_ROWS_CLASS;
  const readOnly = store.isReadOnly();
  const pending = store.getItems().filter((i) => i.status === 'queued');
  pending.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = DROPDOWN_ROW_CLASS;
    row.appendChild(document.createTextNode(`Swipe request ${index + 1}`));
    if (readOnly) {
      rows.appendChild(row);
      return;
    }

    const cancelItem = document.createElement('i');
    cancelItem.className = `fa-solid fa-xmark ${DROPDOWN_CANCEL_ITEM_CLASS}`;
    cancelItem.addEventListener('click', (event) => {
      event.stopPropagation();
      // T-03-01-01 (Pitfall 1): re-check status immediately before drop — the runner may have
      // promoted this same item to 'running' between render and click. Silently no-op if so;
      // the next re-render reflects reality and the user can use Cancel running instead.
      const current = store.getItems().find((i) => i.id === item.id);
      if (current?.status !== 'queued') return;
      store.drop(item.id, 'cancelled');
    });
    row.appendChild(cancelItem);
    rows.appendChild(row);
  });
  panel.appendChild(rows);

  const statusText = readOnly
    ? READONLY_STATUS
    : statusLineFor(runner.getPauseReasons?.() ?? [], { failures: failureCount(runner) });
  if (statusText) {
    const status = document.createElement('div');
    status.className = DROPDOWN_STATUS_CLASS;
    status.textContent = statusText;
    panel.appendChild(status);
  }

  if (readOnly) {
    if (store.pendingCount() + store.runningCount() === 0) panel.classList.remove(DROPDOWN_OPEN_CLASS);
    return;
  }

  if (visiblePauseReason(runner)) {
    const resumeBtn = document.createElement('button');
    resumeBtn.type = 'button';
    resumeBtn.className = DROPDOWN_RESUME_CLASS;
    resumeBtn.textContent = 'Resume queue';
    resumeBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      resumeQueue(store, runner);
    });
    panel.appendChild(resumeBtn);
  }

  if (store.runningCount() > 0) {
    const cancelRunning = document.createElement('button');
    cancelRunning.type = 'button';
    cancelRunning.className = DROPDOWN_CANCEL_RUNNING_CLASS;
    cancelRunning.appendChild(document.createTextNode('Cancel running'));
    cancelRunning.addEventListener('click', (event) => {
      event.stopPropagation();
      runner.abortRunning();
    });
    panel.appendChild(cancelRunning);
  }

  const cancelAllBtn = document.createElement('button');
  cancelAllBtn.type = 'button';
  cancelAllBtn.className = DROPDOWN_CANCEL_ALL_CLASS;
  cancelAllBtn.appendChild(document.createTextNode('Cancel all'));
  cancelAllBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    cancelAll(store, runner);
  });
  panel.appendChild(cancelAllBtn);

  // Nothing left to anchor the dropdown to once pending+running drains to 0 — close it rather
  // than render an empty "nothing queued" panel (UI-SPEC Copywriting Contract, empty state).
  if (store.pendingCount() + store.runningCount() === 0) {
    panel.classList.remove(DROPDOWN_OPEN_CLASS);
  }
}

// Enqueue a swipe request for the latest message and wake the runner. Re-checks the same
// full-queue condition renderDisabledState() uses before ever enqueueing — a
// disabled-looking-but-still-wired control is a real bug class, not just a cosmetic gap.
function onControlClick(store, runner) {
  // injectControl() only re-checks canQueue() on specific ST re-render events (see
  // registerSettingsPanel's forced refresh for the one gap that leaves: the Enable toggle
  // itself isn't one of them), so the control can briefly remain in the DOM after the
  // setting flips off. This is the actual enforcement point — without it, a still-visible
  // stale control would successfully queue a swipe even with Enable unchecked (confirmed
  // live, SET-01 Task 3).
  if (store.isReadOnly()) return;
  if (!canQueue()) return;
  const n = store.pendingCount() + store.runningCount();
  if (n >= store.getMaxQueueSize()) return;

  enqueue(store, runner, 1);
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
  // A native swipe fires MESSAGE_SWIPED while ST is busy, so canQueue() is false and the control
  // is removed; a stopped generation renders no message, so nothing above restores it. ST clears
  // its busy state some time after GENERATION_ENDED, so poll briefly until canQueue() holds.
  const renderAfterGeneration = () => {
    let tries = 0;
    const tick = () => {
      if (canQueue() || tries >= RENDER_RETRY_LIMIT) {
        render();
        return;
      }
      tries += 1;
      setTimeout(tick, RENDER_RETRY_MS);
    };
    setTimeout(tick, 0);
  };
  eventSource.on(event_types.GENERATION_ENDED, renderAfterGeneration);
  eventSource.on(event_types.GENERATION_STOPPED, renderAfterGeneration);

  // The badge/disabled-state must also update on every queue mutation, not only on the DOM
  // re-render events above — a click that fills the queue must disable the control immediately,
  // without waiting for the next CHARACTER_MESSAGE_RENDERED/MESSAGE_SWIPED event. A control that
  // went missing (see above) is re-injected here rather than silently skipped.
  const refresh = () => {
    if (document.querySelector('.last_mes')?.querySelector(`.${CONTROL_CLASS}`)) {
      renderQueueState(store, runner);
    } else {
      render();
    }
  };
  store.onChange(refresh);
  store.onReadOnlyChange(refresh);
  runner.onStateChange(refresh);

  // Correct on first render too, not only after the first onChange/re-render event fires.
  renderQueueState(store, runner);

  // Safety pauses always toast, regardless of the notification-style setting.
  runner.onBreakerTrip(({ n }) => {
    toastr.warning(
      `Queue paused after ${n} failures in a row. Check your connection, then resume from the queue badge.`,
      '',
      { preventDuplicates: true },
    );
  });
  runner.onInspectorPause(() => {
    toastr.warning('Queue paused: Prompt Inspector is on. Turn it off, then resume.', '', { preventDuplicates: true });
  });

  // UI-03: one coalesced summary toast per queue run, replacing Phase 2's per-item toast.
  const acc = createRunAccumulator();

  store.onReset(() => acc.reset());

  function flush({ completed, failures }) {
    if (completed === 0 && failures.size === 0) return;
    if (failures.size === 0) {
      if (getNotificationStyle() === 'all') {
        toastr.success(`${completed} queued swipe(s) completed.`);
      }
      return;
    }
    const reasons = [...failures.keys()].map((r) => SHORT_FAILURE_LABELS[r] ?? r).join(', ');
    const failed = [...failures.values()].reduce((a, b) => a + b, 0);
    if (getNotificationStyle() !== 'off') {
      toastr.warning(`${completed} completed, ${failed} failed (${reasons}).`);
    }
  }

  // Run boundary (Pitfall 2): only the 0->nonzero and nonzero->0 transitions of
  // pendingCount()+runningCount() start/drain a run — this subscriber coexists alongside
  // the renderQueueState subscriber above, both on the same store.onChange event.
  store.onChange(() => {
    const active = store.pendingCount() + store.runningCount() > 0;
    const drained = acc.noteActivity(active);
    if (drained) flush(drained);
  });
  runner.onItemDone(() => acc.recordDone());
  // 'stale' drops are excluded upstream (runner.js's notifyFailed) and never reach here, so
  // they never enter the accumulator either — unchanged from Phase 2's exclusion rule.
  runner.onItemFailed(({ reason }) => acc.recordFailed(reason));

  // Cancel dropdown dismissal: any click outside both the dropdown panel and the badge that
  // opens it closes every open dropdown instance, without cancelling anything (D-01, UI-SPEC
  // "click outside closes it, no confirmation needed"). Registered once here, not per-control.
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (target.closest?.(`.${DROPDOWN_CLASS}`) || target.closest?.(`.${BADGE_CLASS}`)) return;
    document.querySelectorAll(`.${DROPDOWN_CLASS}.${DROPDOWN_OPEN_CLASS}`).forEach((panel) => {
      panel.classList.remove(DROPDOWN_OPEN_CLASS);
    });
  });
}
