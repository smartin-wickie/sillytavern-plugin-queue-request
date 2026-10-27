// Settings panel wiring (SET-01). Renders settings.html into #extensions_settings2 and wires
// all 5 fields to extension_settings[MODULE_NAME], live-read/live-write at the point of use
// (D-12) — no field ever caches a settings reference across its own handler invocation.
import { MODULE_NAME } from './st-bridge.js';
import { HARD_MAX_QUEUE } from './store.js';

// Resolves this extension's own template folder dynamically rather than hardcoding a folder
// name no source in this repo confirms. For a correctly-installed extension the regex always
// matches `.../extensions/<folder>/settings.js`; the fallback string is defensive only.
const EXTENSION_NAME = (() => {
  const path = new URL(import.meta.url).pathname;
  const match = path.match(/\/extensions\/((?:third-party\/)?[^/]+)\//);
  return match ? match[1] : 'third-party/queued-swipes';
})();

/**
 * Render the Queued Swipes settings panel into the Extensions drawer and wire every field to
 * live-read/live-write extension_settings[MODULE_NAME]. `store` is the single, per-extension-
 * lifetime store instance index.js's init() already constructed — closed over here so the
 * "Max queue size" field can call store.setMaxQueueSize() and change the running cap
 * immediately, not just persist the new value (closing the gap D-12 otherwise leaves open).
 */
export async function registerSettingsPanel({ store } = {}) {
  const { renderExtensionTemplateAsync } = SillyTavern.getContext();
  const html = await renderExtensionTemplateAsync(EXTENSION_NAME, 'settings', {});
  $('#extensions_settings2').append(html);

  // Initialize every control from the live settings object (read fresh, not from a cached
  // reference), so re-opening the drawer later always reflects whatever was last saved.
  const current = SillyTavern.getContext().extensionSettings[MODULE_NAME];
  $('#qs_enabled').prop('checked', current.enabled !== false);
  $('#qs_max_queue').val(current.maxQueueSize ?? 5);
  $('#qs_auto_jump').prop('checked', current.autoJump === true);
  $('#qs_notification_style').val(current.notificationStyle ?? 'all');
  $('#qs_circuit_breaker').val(current.circuitBreakerThreshold ?? 3);

  $('#qs_enabled').on('change', function () {
    SillyTavern.getContext().extensionSettings[MODULE_NAME].enabled = $(this).prop('checked');
    SillyTavern.getContext().saveSettingsDebounced();
  });

  $('#qs_max_queue').on('input', function () {
    const clamped = Math.min(HARD_MAX_QUEUE, Math.max(1, Number($(this).val()) || 1));
    SillyTavern.getContext().extensionSettings[MODULE_NAME].maxQueueSize = clamped;
    SillyTavern.getContext().saveSettingsDebounced();
    // Makes the running store's enforced cap change on this same tick (D-12's "no reload
    // required" promise) — without this call, store.js's effectiveCap() would keep enforcing
    // whatever cap was configured at createStore() construction time until a full page reload.
    store?.setMaxQueueSize(clamped);
  });

  $('#qs_auto_jump').on('change', function () {
    SillyTavern.getContext().extensionSettings[MODULE_NAME].autoJump = $(this).prop('checked');
    SillyTavern.getContext().saveSettingsDebounced();
  });

  $('#qs_notification_style').on('change', function () {
    SillyTavern.getContext().extensionSettings[MODULE_NAME].notificationStyle = $(this).val();
    SillyTavern.getContext().saveSettingsDebounced();
  });

  $('#qs_circuit_breaker').on('input', function () {
    const clamped = Math.min(10, Math.max(1, Number($(this).val()) || 3));
    SillyTavern.getContext().extensionSettings[MODULE_NAME].circuitBreakerThreshold = clamped;
    SillyTavern.getContext().saveSettingsDebounced();
  });
}
