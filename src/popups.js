// Resume / discard prompt shown when stored queued swipes are found for the chat. Content is
// built from DOM nodes with textContent only: model and api names come from the chat file and
// must never be parsed as markup. No ST modules are imported at top level; everything is read
// from SillyTavern.getContext() at call time.

/**
 * Ask whether to resume the saved queue. Resolves 'resume', 'discard' or 'dismiss'. Only the
 * explicit Discard button yields 'discard'; Esc or closing the popup is 'dismiss'.
 */
export async function showResumePopup({ count, model, api }) {
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

  const result = await callGenericPopup(content, POPUP_TYPE.CONFIRM, '', {
    okButton: 'Resume queue',
    cancelButton: 'Discard queue',
  });

  if (result === POPUP_RESULT.AFFIRMATIVE) return 'resume';
  if (result === POPUP_RESULT.NEGATIVE) return 'discard';
  return 'dismiss';
}
