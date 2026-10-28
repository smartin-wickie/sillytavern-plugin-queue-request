// Wiring-only entry point. Construction of real modules happens here; no logic lives in this file.
import * as bridge from './src/st-bridge.js';
import { MODULE_NAME } from './src/st-bridge.js';
import { createStore } from './src/store.js';
import { createRunner } from './src/runner.js';
import { createGuard } from './src/guard.js';
import { createLifecycle } from './src/lifecycle.js';
import { createOwnership } from './src/ownership.js';
import { appendSwipe } from './src/appender.js';
import { showResumePopup, showConnectionPopup } from './src/popups.js';
import { registerQueueControl } from './src/ui.js';
import { registerCommands } from './src/commands.js';
import { registerWandMenu } from './src/wandMenu.js';
import { registerProgressBar } from './src/progressBar.js';
import { registerSettingsPanel } from './src/settings.js';
import { cancelAll, configureQueueActions } from './src/queueActions.js';
import { capture, send, cleanAndExtract, isSuccessful } from './src/adapter.js';

const DEFAULT_SETTINGS = {
  maxQueueSize: 5,
  enabled: true,
  autoJump: false,
  notificationStyle: 'all',
  circuitBreakerThreshold: 3,
};

/**
 * Real Generation Adapter-backed generator passed into createRunner(). The runner owns the
 * per-item AbortController and passes its signal in here (never reused across items); this
 * function sequences capture -> send -> cleanAndExtract and resolves a typed result per
 * adapter.isSuccessful() — never throwing out of the happy path. A thrown error from
 * capture()/send() (network failure, HTTP non-2xx) is normalized to { error: 'api' }; a
 * resolved-but-unsuccessful result is { error: 'cancelled' } when the send was aborted,
 * otherwise { error: 'empty' }. `item` is accepted but unused: capture() derives the prompt
 * from live ST state, not from the queued item.
 */
async function generate(item, { signal } = {}) {
  const started = new Date();

  let sent;
  try {
    const captured = await capture({ signal });
    sent = await send(captured, signal);
  } catch (err) {
    return { error: 'api' };
  }

  const cleaned = cleanAndExtract(sent);

  if (!isSuccessful({ text: cleaned.text, aborted: sent.aborted })) {
    return { error: sent.aborted ? 'cancelled' : 'empty' };
  }

  return {
    text: cleaned.text,
    meta: { started, reasoning: cleaned.reasoning, signature: cleaned.signature },
  };
}

/**
 * Merge default settings into extensionSettings[MODULE_NAME] key-by-key, never replacing the
 * whole object, so settings keys added by a later upgrade are preserved across reloads. Only
 * saves when a key was actually missing and added.
 */
function ensureSettings(extensionSettings, saveSettingsDebounced) {
  extensionSettings[MODULE_NAME] ??= {};
  const settings = extensionSettings[MODULE_NAME];
  let changed = false;
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (!(key in settings)) {
      settings[key] = value;
      changed = true;
    }
  }
  if (changed) {
    saveSettingsDebounced();
  }
}

export async function init() {
  const { extensionSettings, saveSettingsDebounced } = SillyTavern.getContext();
  ensureSettings(extensionSettings, saveSettingsDebounced);

  // Exactly one store/runner instance per loaded chat, not one per click.
  const store = createStore({
    bridge,
    maxQueueSize: extensionSettings[MODULE_NAME].maxQueueSize,
    moduleName: MODULE_NAME,
  });
  // Created before the runner so the runner can gate on it. A throwing localStorage property
  // access yields a null storage, and the module then fails open (this tab runs as owner).
  let storage = null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  const ownership = createOwnership({ storage, win: window });
  const runner = createRunner({
    bridge,
    store,
    generate,
    append: appendSwipe,
    isOwner: () => ownership.isOwner(),
    getThreshold: () => bridge.extension_settings[MODULE_NAME]?.circuitBreakerThreshold,
  });
  configureQueueActions({
    bridge,
    toast: {
      info: (m) => toastr.info(m, '', { preventDuplicates: true }),
      warning: (m) => toastr.warning(m, '', { preventDuplicates: true }),
    },
  });
  const lifecycle = createLifecycle({
    bridge,
    store,
    runner,
    ownership,
    moduleName: MODULE_NAME,
    popups: { showResume: showResumePopup, showConnection: showConnectionPopup },
    toast: (m) => toastr.info(m, '', { preventDuplicates: true }),
  });
  const guard = createGuard({ bridge, runner, lifecycle });
  guard.start();
  ownership.start();
  lifecycle.start();
  // A chat may already be open when the extension initialises (CHAT_CHANGED already fired);
  // the dedupe in handleChatChanged makes repeated calls harmless.
  if (SillyTavern.getContext().chatId) lifecycle.handleChatChanged();
  bridge.eventSource.on(bridge.event_types.APP_READY, () => lifecycle.handleChatChanged());

  registerQueueControl({ store, runner });
  registerCommands({ store, runner, cancelAll });
  registerWandMenu({ store, runner, cancelAll, canQueue: bridge.canQueue });
  registerProgressBar({ store, runner, cancelAll });
  await registerSettingsPanel({ store, runner });
}
