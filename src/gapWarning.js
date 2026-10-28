// Combined, once-per-tab-session warning about behaviours queued swipes skip (auto-swipe
// filtering, extension prompt interceptors, Chat Completion system-message squashing).
// Pure module: no ST or DOM imports; storage and toast are injected. maybeWarn never throws, so
// it can never block queueing.
const STORAGE_KEY = 'qs_gap_warned';
const TOAST_TIMEOUT_MS = 10000;

/** Escape the characters that matter for HTML interpolation (toastr renders HTML). */
export function escapeName(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** One sentence per active gap. Empty when nothing is active. */
export function formatGapLines(gaps) {
  const lines = [];
  if (gaps?.autoSwipe) {
    lines.push('Auto-swipe filtering is not applied to queued results.');
  }
  if (gaps?.interceptors?.length) {
    const names = gaps.interceptors.map(escapeName).join(', ');
    lines.push(`Prompt interceptors (${names}) may not run on queued swipes, though they run on normal swipes.`);
  }
  if (gaps?.squash) {
    lines.push('Chat Completion system-message squash is not applied to queued swipes.');
  }
  return lines;
}

export function createGapWarner({ storage } = {}) {
  let warnedInMemory = false;

  function alreadyWarned() {
    if (warnedInMemory) return true;
    try {
      return storage?.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  function markWarned() {
    warnedInMemory = true;
    try {
      storage?.setItem(STORAGE_KEY, '1');
    } catch {
      // In-memory flag already covers this page load.
    }
  }

  /** Returns true only when a toast was actually emitted. */
  function maybeWarn(gaps, toast) {
    try {
      const lines = formatGapLines(gaps);
      if (lines.length === 0) return false;
      if (alreadyWarned()) return false;
      toast.warning(`Queued swipes skip some behaviours. ${lines.join(' ')}`, { timeOut: TOAST_TIMEOUT_MS });
      markWarned();
      return true;
    } catch {
      return false;
    }
  }

  return { maybeWarn };
}
