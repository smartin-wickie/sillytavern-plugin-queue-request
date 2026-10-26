// Wiring-only entry point. Construction of real modules happens here; no logic lives in this file.
import * as bridge from './src/st-bridge.js';
import { createStore } from './src/store.js';
import { createRunner } from './src/runner.js';
import { appendSwipe } from './src/appender.js';
import { registerQueueControl } from './src/ui.js';

const MODULE_NAME = 'queuedSwipes';

const DEFAULT_SETTINGS = {
  maxQueueSize: 5,
};

// Stub generator for this plan only — 02-03-PLAN.md replaces this with the real Generation
// Adapter (dry-run capture + own transport) without touching the Runner's control flow.
async function stubGenerate() {
  await new Promise((resolve) => setTimeout(resolve, 50));
  return {
    text: '[queued-swipes stub placeholder — replaced by real generation in 02-03-PLAN.md]',
    meta: { started: new Date(), reasoning: '', signature: null },
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
  const store = createStore({ bridge, maxQueueSize: extensionSettings[MODULE_NAME].maxQueueSize });
  const runner = createRunner({ bridge, store, generate: stubGenerate, append: appendSwipe });

  registerQueueControl({ store, runner });
}
