// Pure connection diff. Compares the connection recorded when a swipe was queued with the live
// one and names the fields that differ. A field is skipped when either side is unknown so that
// a missing value never triggers a spurious pause.

const FIELDS = ['api', 'model', 'preset'];

function known(v) {
  return v !== null && v !== undefined && v !== '';
}

/**
 * Return the names of the fields in ['api', 'model', 'preset'] that differ between `old` and
 * `cur`. Fields that are null, undefined or '' on either side are ignored. A missing snapshot
 * on either side yields [].
 */
export function diffConnection(old, cur) {
  if (!old || !cur || typeof old !== 'object' || typeof cur !== 'object') return [];
  return FIELDS.filter((f) => known(old[f]) && known(cur[f]) && old[f] !== cur[f]);
}
