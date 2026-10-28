// Pure mapping from runner pause-reason codes to the user-facing copy. Static literals only;
// stored or remote strings never flow through here.
const PRIORITY = ['takeover', 'restored', 'inspector', 'connection', 'failures', 'native'];

const LABELS = {
  restored: 'restored after reload',
  connection: 'connection changed',
  inspector: 'Prompt Inspector is on',
  takeover: 'taken over from another tab',
};

/** Short label for one reason code; '' when unknown. `failures` takes `{ failures }`. */
export function pauseReasonLabel(code, { failures } = {}) {
  if (code === 'failures') return `${Number(failures) || 0} failures in a row`;
  return LABELS[code] ?? '';
}

/** Dropdown status line for the active reason set; '' when nothing is paused. */
export function statusLineFor(reasons, { failures } = {}) {
  if (!Array.isArray(reasons) || reasons.length === 0) return '';
  const primary = PRIORITY.find((r) => reasons.includes(r));
  if (primary === undefined) return '';
  if (primary === 'native') return 'Waiting for your generation to finish';
  const label = pauseReasonLabel(primary, { failures });
  return label ? `Paused: ${label}` : '';
}
