// Wiring-only entry point. Construction of real modules happens here; no logic lives in this file.
const MODULE_NAME = 'queuedSwipes';

const DEFAULT_SETTINGS = {
  maxQueueSize: 5,
};

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

  // TODO(Task 3 of this plan): import and register src/ui.js's queue control here.
}
