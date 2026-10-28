// Resume / discard prompt shown when stored queued swipes are found for the chat. Content is
// built from DOM nodes with textContent only: model and api names come from the chat file and
// must never be parsed as markup. No ST modules are imported at top level; everything is read
// from SillyTavern.getContext() at call time.

/**
 * Ask whether to resume the saved queue. Resolves 'resume', 'discard' or 'dismiss'. Only the
 * explicit Discard button yields 'discard'; Esc or closing the popup is 'dismiss'.
 */
export async function showResumePopup({ count, model, api, connectionNote }) {
  const { callGenericPopup, POPUP_TYPE, POPUP_RESULT } = SillyTavern.getContext();

  const content = document.createElement('div');
  const title = document.createElement('h3');
  title.textContent = 'Resume queued swipes?';
  content.appendChild(title);

  const body = document.createElement('p');
  body.textContent = `${count} queued swipe(s) are saved for this chat.`;
  content.appendChild(body);

  const modelLine = document.createElement('p');
  modelLine.textContent = typeof model === 'string' && model !== ''
    ? `Queued with ${model} (${api ?? 'unknown'}).`
    : 'They will use your current connection.';
  content.appendChild(modelLine);

  if (connectionNote && typeof connectionNote === 'object') {
    const note = document.createElement('p');
    note.textContent = `Connection changed since queueing: now ${connectionNote.model ?? 'unknown'} (${connectionNote.api ?? 'unknown'}).`;
    content.appendChild(note);
  }

  const result = await callGenericPopup(content, POPUP_TYPE.CONFIRM, '', {
    okButton: 'Resume queue',
    cancelButton: 'Discard queue',
  });

  if (result === POPUP_RESULT.AFFIRMATIVE) return 'resume';
  if (result === POPUP_RESULT.NEGATIVE) return 'discard';
  return 'dismiss';
}

const FIELD_LABEL = { model: 'model', api: 'api', preset: 'preset' };

function describeConnection(conn, changed) {
  const c = conn ?? {};
  const val = (f) => (c[f] === null || c[f] === undefined || c[f] === '' ? 'unknown' : String(c[f]));
  const has = (f) => changed.includes(f);
  const head = has('model') ? val('model') : 'the same model';
  const parts = [];
  if (has('api')) parts.push(val('api'));
  if (has('preset')) parts.push(`preset ${val('preset')}`);
  return parts.length ? `${head} (${parts.join(', ')})` : head;
}

/**
 * Ask whether to continue the queue on a changed connection. Resolves 'continue' only for the
 * explicit OK button; the cancel button, Esc and close all resolve 'keep'. Only the changed fields
 * are listed. Values are rendered with textContent only.
 */
export async function showConnectionPopup({ changed = [], old, current }) {
  const { callGenericPopup, POPUP_TYPE, POPUP_RESULT } = SillyTavern.getContext();

  const content = document.createElement('div');
  const title = document.createElement('h3');
  title.textContent = 'Connection changed';
  content.appendChild(title);

  const was = document.createElement('p');
  was.textContent = `These swipes were queued with ${describeConnection(old, changed)}.`;
  content.appendChild(was);

  const now = document.createElement('p');
  now.textContent = `Now active: ${describeConnection(current, changed)}.`;
  content.appendChild(now);

  const ask = document.createElement('p');
  ask.textContent = 'Continue with the current connection?';
  content.appendChild(ask);

  const result = await callGenericPopup(content, POPUP_TYPE.CONFIRM, '', {
    okButton: 'Continue queue',
    cancelButton: 'Keep paused',
  });
  return result === POPUP_RESULT.AFFIRMATIVE ? 'continue' : 'keep';
}
