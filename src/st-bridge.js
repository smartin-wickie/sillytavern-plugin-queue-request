// The only module in this extension that imports SillyTavern internals directly.
// Everything else reaches ST exclusively through this file's exports, so a future ST
// internals move only requires edits here.
import {
  Generate,
  isGenerating,
  cleanUpMessage,
  extractMessageFromData,
  stopGeneration,
  getGeneratingApi,
  getGeneratingModel,
  ensureSwipes,
  updateSwipeCounter,
  isStreamingEnabled,
  getGenerateUrl,
} from '../../../../../script.js';
import { sendOpenAIRequest, oai_settings } from '../../../../openai.js';
import { extractReasoningFromData, parseReasoningFromString } from '../../../../reasoning.js';
import { extensionNames, getExtensionManifest, extension_settings } from '../../../../extensions.js';
import { eventSource, event_types } from '../../../../events.js';

export {
  Generate,
  isGenerating,
  cleanUpMessage,
  extractMessageFromData,
  stopGeneration,
  getGeneratingApi,
  getGeneratingModel,
  ensureSwipes,
  updateSwipeCounter,
  isStreamingEnabled,
  getGenerateUrl,
  sendOpenAIRequest,
  oai_settings,
  extractReasoningFromData,
  parseReasoningFromString,
  extensionNames,
  getExtensionManifest,
  extension_settings,
  eventSource,
  event_types,
};

// Centralizes the module name constant so other modules (e.g. ui.js's live
// notification-style read) don't each re-declare their own copy of this string.
export const MODULE_NAME = 'queuedSwipes';

/** Fresh-context accessor. Never cache the return value across an `await`. */
export const ctx = () => SillyTavern.getContext();

/** Current swipe state ('none' when idle), or null if the API is unavailable. */
export function swipeState() {
  return ctx().swipe?.state?.() ?? null;
}

/**
 * Stable identity of the live chat for persistence binding: avatar + '/' + chatId. Null for
 * group chats or when the character or chat id is missing.
 */
export function chatKey(c) {
  if (!c || c.groupId) return null;
  if (c.characterId === undefined || c.characterId === null) return null;
  if (!c.chatId) return null;
  const avatar = c.characters?.[c.characterId]?.avatar;
  if (!avatar) return null;
  return `${avatar}/${c.chatId}`;
}

/**
 * The single QUEUE-08 visibility gate: is the latest message in the current chat eligible
 * for a queued swipe right now? Reuses ctx().swipe.isAllowed() as the primary signal rather
 * than re-deriving message-swipeable logic, and additionally excludes group chats explicitly
 * (independent of isAllowed()'s own handling).
 */
export function canQueue() {
  const c = ctx();
  if (c.groupId) return false;
  const settings = extension_settings[MODULE_NAME];
  if (settings && settings.enabled === false) return false;
  return Boolean(c.swipe?.isAllowed?.());
}

/**
 * Is the Prompt Inspector extension both installed/enabled and switched on? It stores its toggle
 * in localStorage and emits no event, so this must be polled at the point of use. Policy-level
 * check: Prompt Inspector skips the dry run the capture depends on.
 */
export function promptInspectorEnabled() {
  try {
    if (localStorage.getItem('promptInspectorEnabled') !== 'true') return false;
    const disabled = extension_settings.disabledExtensions ?? [];
    return (extensionNames ?? []).some(
      (n) => getExtensionManifest(n)?.display_name === 'Prompt Inspector' && !disabled.includes(n),
    );
  } catch {
    return false;
  }
}

/**
 * Feature-detect each re-exported ST import. Logs one console.warn per missing capability at
 * call time (not at module load), so a late ST API change surfaces only when actually probed.
 */
export function capabilities() {
  const probes = {
    Generate: typeof Generate === 'function',
    isGenerating: typeof isGenerating === 'function',
    cleanUpMessage: typeof cleanUpMessage === 'function',
    extractMessageFromData: typeof extractMessageFromData === 'function',
    stopGeneration: typeof stopGeneration === 'function',
    getGeneratingApi: typeof getGeneratingApi === 'function',
    getGeneratingModel: typeof getGeneratingModel === 'function',
    ensureSwipes: typeof ensureSwipes === 'function',
    updateSwipeCounter: typeof updateSwipeCounter === 'function',
    isStreamingEnabled: typeof isStreamingEnabled === 'function',
    getGenerateUrl: typeof getGenerateUrl === 'function',
    sendOpenAIRequest: typeof sendOpenAIRequest === 'function',
    extractReasoningFromData: typeof extractReasoningFromData === 'function',
    parseReasoningFromString: typeof parseReasoningFromString === 'function',
  };
  for (const [name, present] of Object.entries(probes)) {
    if (!present) {
      console.warn('[queuedSwipes]', `missing capability: ${name}`);
    }
  }
  return probes;
}
