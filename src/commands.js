// Slash-command entry points onto the same store/runner/cancelAll primitives the badge
// control and dropdown already use (QUEUE-03/04). No new clamp/cancel logic is derived here —
// `/queueswipe`'s clamp math mirrors `ui.js`'s `onControlClick` exactly, and `/queuecancel`
// calls the shared `cancelAll(store, runner)` helper from `queueActions.js`.
import { ctx, extension_settings, MODULE_NAME } from './st-bridge.js';
import { buildFingerprint } from './fingerprint.js';

/**
 * Register `/queueswipe [count]`, `/queuecancel`, `/queuestatus` via ST's SlashCommandParser.
 * Feedback is toastr-only plus the command's string return value (D-06/D-07/D-08) — never a
 * chat-visible system message.
 */
export function registerCommands({ store, runner, cancelAll }) {
  const { SlashCommandParser, SlashCommand, SlashCommandArgument, ARGUMENT_TYPE } = SillyTavern.getContext();

  SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'queueswipe',
    helpString: 'Queue N additional swipes for the last AI message (default 1).',
    returns: 'number of swipes actually queued',
    unnamedArgumentList: [SlashCommandArgument.fromProps({
      description: 'count',
      typeList: [ARGUMENT_TYPE.NUMBER],
      defaultValue: '1',
      isRequired: false,
    })],
    callback: async (_namedArgs, unnamed) => {
      // Gate on the Enable toggle directly (not st-bridge.js's canQueue()): canQueue() also
      // calls c.swipe?.isAllowed?.(), which ST's own isGenerating()/is_send_press check makes
      // false for the *entire* duration of any slash-command callback (confirmed live, 03-02's
      // SUMMARY — is_send_press stays true through the whole send pipeline a slash command runs
      // inside of). Calling canQueue() verbatim here would make /queueswipe always report
      // "disabled" regardless of the Enable setting, a regression already investigated and
      // reverted once this phase. This check reads only the live `enabled` flag instead.
      const settings = extension_settings[MODULE_NAME];
      if (settings && settings.enabled === false) {
        toastr.warning('Queued swipes are disabled or unavailable right now.');
        return '0';
      }

      // Re-read room fresh on every single invocation — never cached across calls — so a
      // scripted `/times N {: /queueswipe :}` loop cannot enqueue past getMaxQueueSize().
      const requested = Math.max(1, Number(unnamed) || 1);
      const max = store.getMaxQueueSize();
      const current = store.pendingCount() + store.runningCount();
      const room = Math.max(0, max - current);

      if (room === 0) {
        toastr.warning(`Queue is already full (${max} max).`);
        return '0';
      }

      const toAdd = Math.min(requested, room);
      const c = ctx();
      const target = buildFingerprint(c, c.chat.length - 1);
      let added = 0;
      for (let i = 0; i < toAdd; i++) {
        const result = store.add(target);
        if (!result.ok) break;
        added++;
      }
      if (added > 0) runner.wake();

      if (added === requested) {
        toastr.info(`Queued ${added} swipe(s).`);
      } else {
        toastr.warning(`Queue full — added ${added} of ${requested} requested.`);
      }
      return String(added);
    },
  }));

  SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'queuecancel',
    helpString: 'Cancel all queued and the currently running swipe.',
    returns: 'number of items cancelled',
    callback: async () => {
      const n = cancelAll(store, runner);
      toastr.info(n > 0 ? `Cancelled ${n} queued swipe(s).` : 'Queue is already empty.');
      return String(n);
    },
  }));

  SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'queuestatus',
    helpString: 'Report pending/running queue counts.',
    returns: 'one-line status string',
    callback: async () => {
      const running = store.runningCount();
      const pending = store.pendingCount();
      const max = store.getMaxQueueSize();
      const text = running + pending === 0
        ? 'Queue: empty.'
        : `Queue: ${running} running, ${pending} pending (${max} max).`;
      toastr.info(text);
      return text;
    },
  }));
}
