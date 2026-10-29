// Combined, once-per-tab-session warning about behaviours queued swipes skip (auto-swipe
// filtering, extension prompt interceptors, Chat Completion system-message squashing).
// Pure module: no ST or DOM imports; storage and toast are injected. maybeWarn never throws, so
// it can never block queueing.
const STORAGE_KEY = 'qs_gap_warned';
const TOAST_TIMEOUT_MS = 10000;

/** One sentence per active gap. Empty when nothing is active. */
export function formatGapLines(gaps) {
  const lines = [];
  if (gaps?.autoSwipe) {
    lines.push('Auto-swipe filtering is not applied to queued results.');
  }
  if (gaps?.interceptors?.length) {
    // Plain text: toastr escapes the message itself (escapeHtml: true, set globally by ST and
    // forced per call below), so escaping here would show `&amp;` etc. in the toast.
    const names = gaps.interceptors.map((n) => String(n)).join(', ');
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
      toast.warning(`Queued swipes skip some behaviours. ${lines.join(' ')}`, { timeOut: TOAST_TIMEOUT_MS, escapeHtml: true });
      markWarned();
      return true;
    } catch {
      return false;
    }
  }

  return { maybeWarn };
}
