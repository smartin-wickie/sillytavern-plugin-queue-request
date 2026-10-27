// Wand-menu entries (QUEUE-05): two more thin callers into the same store/runner/cancelAll
// primitives the badge control and dropdown already use. No per-chat state here, so this
// registers once on APP_READY and never needs to re-render on CHAT_CHANGED/message events the
// way the per-message badge does.
import { eventSource, event_types, ctx } from './st-bridge.js';
import { buildFingerprint } from './fingerprint.js';

/**
 * Register the "Queue swipe" / "Cancel all queued" entries into ST's wand (extensions) menu.
 */
export function registerWandMenu({ store, runner, cancelAll, canQueue }) {
  function render() {
    if ($('#qs-wand-entry').length) return; // idempotent across repeated APP_READY-adjacent calls

    const entry = $(`
      <div id="qs-wand-entry" class="extension_container">
        <div id="qs-wand-queue" class="list-group-item flex-container flexGap5 alignItemsCenter interactable" tabindex="0">
          <i class="fa-solid fa-clock"></i>
          <span>Queue swipe</span>
        </div>
        <div id="qs-wand-cancel" class="list-group-item flex-container flexGap5 alignItemsCenter interactable" tabindex="0">
          <i class="fa-solid fa-xmark"></i>
          <span>Cancel all queued</span>
        </div>
      </div>
    `);

    // Mirrors ui.js's onControlClick exactly — never diverge from this sequence.
    entry.find('#qs-wand-queue').on('click', () => {
      if (!canQueue()) return;
      const n = store.pendingCount() + store.runningCount();
      if (n >= store.getMaxQueueSize()) return;
      const c = ctx();
      const target = buildFingerprint(c, c.chat.length - 1);
      const result = store.add(target);
      if (!result.ok) return;
      runner.wake();
    });

    entry.find('#qs-wand-cancel').on('click', () => cancelAll(store, runner));

    $('#extensionsMenu').append(entry);
  }

  eventSource.on(event_types.APP_READY, render);
}
