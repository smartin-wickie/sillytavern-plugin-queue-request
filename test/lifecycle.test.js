import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLifecycle } from '../src/lifecycle.js';
import { hash } from '../src/fingerprint.js';

const EVENT_TYPES = {
  MESSAGE_EDITED: 'MESSAGE_EDITED',
  MESSAGE_DELETED: 'MESSAGE_DELETED',
  MESSAGE_SENT: 'MESSAGE_SENT',
  MESSAGE_RECEIVED: 'MESSAGE_RECEIVED',
  MESSAGE_UPDATED: 'MESSAGE_UPDATED',
};

function makeEventSource() {
  const listeners = new Map();
  return {
    on(evt, h) {
      if (!listeners.has(evt)) listeners.set(evt, new Set());
      listeners.get(evt).add(h);
    },
    removeListener(evt, h) {
      listeners.get(evt)?.delete(h);
    },
    emit(evt, ...args) {
      for (const h of listeners.get(evt) ?? []) h(...args);
    },
    listenerCount(evt) {
      return listeners.get(evt)?.size ?? 0;
    },
  };
}

function makeCtx(chat, extra = {}) {
  return { chatId: 'c1', chatMetadata: { integrity: 'i1' }, chat, ...extra };
}

function fpFor(chat, mesId) {
  const m = chat[mesId];
  return {
    chatId: 'c1',
    integrity: 'i1',
    mesId,
    chatLength: chat.length,
    swipe0Hash: hash(m.swipes?.[0] ?? m.mes),
    name: m.name,
  };
}

function setup({ chat, statuses = ['queued', 'running'] } = {}) {
  const theChat = chat ?? [
    { name: 'u', mes: 'hi' },
    { name: 'a', mes: 'one' },
    { name: 'a', mes: 'two', swipes: ['two'] },
  ];
  const state = { ctx: makeCtx(theChat) };
  const eventSource = makeEventSource();
  const bridge = { eventSource, event_types: EVENT_TYPES, ctx: () => state.ctx };
  const items = statuses.map((status, i) => ({
    id: `i${i}`,
    status,
    fingerprint: fpFor(theChat, theChat.length - 1),
  }));
  const calls = [];
  const store = {
    getItems: () => items.slice(),
    clear: vi.fn((reason) => {
      calls.push('clear');
      let n = 0;
      for (const it of items) {
        if (it.status === 'queued' || it.status === 'running') {
          it.status = 'failed';
          it.reason = reason;
          n += 1;
        }
      }
      return n;
    }),
    refingerprintAll: vi.fn(),
  };
  const runner = {
    invalidate: vi.fn(() => calls.push('invalidate')),
    abortRunning: vi.fn(() => calls.push('abort')),
  };
  const toast = vi.fn(() => calls.push('toast'));
  const lifecycle = createLifecycle({ bridge, store, runner, toast });
  lifecycle.start();
  return { chat: theChat, state, eventSource, bridge, items, store, runner, toast, lifecycle, calls };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createLifecycle', () => {
  it('edit of the target clears with toast naming the count, in the documented order', async () => {
    const s = setup();
    s.eventSource.emit('MESSAGE_EDITED', 2);
    await vi.runAllTimersAsync();
    expect(s.toast).toHaveBeenCalledWith('Cleared 2 queued swipe(s): the message was edited.');
    expect(s.calls).toEqual(['invalidate', 'clear', 'abort', 'toast']);
    expect(s.runner.abortRunning).toHaveBeenCalledWith({ disposition: 'discard' });
  });

  it('edit of an earlier message and MESSAGE_UPDATED do nothing', async () => {
    const s = setup();
    s.eventSource.emit('MESSAGE_EDITED', 1);
    s.eventSource.emit('MESSAGE_UPDATED', 2);
    await vi.runAllTimersAsync();
    expect(s.store.clear).not.toHaveBeenCalled();
    expect(s.toast).not.toHaveBeenCalled();
  });

  it('delete of the target clears; delete elsewhere does nothing', async () => {
    const s = setup();
    s.eventSource.emit('MESSAGE_DELETED', 2);
    await vi.runAllTimersAsync();
    expect(s.store.clear).not.toHaveBeenCalled();

    s.chat.pop();
    s.state.ctx = makeCtx(s.chat);
    s.eventSource.emit('MESSAGE_DELETED', 2);
    await vi.runAllTimersAsync();
    expect(s.toast).toHaveBeenCalledWith('Cleared 2 queued swipe(s): the message was deleted.');
  });

  it('delete during a chat switch (status chat) does nothing', async () => {
    const s = setup();
    s.state.ctx = makeCtx(s.chat, { chatId: 'other' });
    s.eventSource.emit('MESSAGE_DELETED', 0);
    await vi.runAllTimersAsync();
    expect(s.store.clear).not.toHaveBeenCalled();
  });

  it('MESSAGE_SENT clears with the sent copy', async () => {
    const s = setup();
    s.eventSource.emit('MESSAGE_SENT', 3);
    await vi.runAllTimersAsync();
    expect(s.toast).toHaveBeenCalledWith('Cleared 2 queued swipe(s): a new message was sent.');
  });

  it('MESSAGE_RECEIVED clears only for a later id and a non swipe/continue type', async () => {
    const s = setup();
    s.eventSource.emit('MESSAGE_RECEIVED', 2, 'normal');
    s.eventSource.emit('MESSAGE_RECEIVED', 3, 'swipe');
    s.eventSource.emit('MESSAGE_RECEIVED', 3, 'continue');
    await vi.runAllTimersAsync();
    expect(s.store.clear).not.toHaveBeenCalled();

    s.eventSource.emit('MESSAGE_RECEIVED', 3, 'normal');
    await vi.runAllTimersAsync();
    expect(s.toast).toHaveBeenCalledWith('Cleared 2 queued swipe(s): a new message was sent.');
  });

  it('with no active items nothing happens', async () => {
    const s = setup({ statuses: ['done', 'failed'] });
    s.eventSource.emit('MESSAGE_EDITED', 2);
    s.eventSource.emit('MESSAGE_SENT', 3);
    await vi.runAllTimersAsync();
    expect(s.store.clear).not.toHaveBeenCalled();
    expect(s.runner.invalidate).not.toHaveBeenCalled();
    expect(s.toast).not.toHaveBeenCalled();
  });

  it('no toast when clear reports 0', async () => {
    const s = setup();
    s.store.clear.mockReturnValue(0);
    s.eventSource.emit('MESSAGE_SENT', 3);
    await vi.runAllTimersAsync();
    expect(s.toast).not.toHaveBeenCalled();
  });

  it('Continue re-fingerprints the queue when the chat is otherwise unchanged', () => {
    const s = setup();
    s.lifecycle.onNativeStart('continue');
    s.chat[2].mes = 'two and more';
    s.chat[2].swipes = ['two and more'];
    s.lifecycle.onNativeEnd();
    expect(s.store.refingerprintAll).toHaveBeenCalledTimes(1);
    expect(s.store.refingerprintAll.mock.calls[0][0].swipe0Hash).toBe(hash('two and more'));
    s.lifecycle.onNativeEnd();
    expect(s.store.refingerprintAll).toHaveBeenCalledTimes(1);
  });

  it('Continue where the chat changed does nothing', () => {
    const s = setup();
    s.lifecycle.onNativeStart('continue');
    s.chat.push({ name: 'u', mes: 'new' });
    s.lifecycle.onNativeEnd();
    expect(s.store.refingerprintAll).not.toHaveBeenCalled();
  });

  it('onNativeStart with another type records nothing', () => {
    const s = setup();
    s.lifecycle.onNativeStart('normal');
    s.lifecycle.onNativeEnd();
    expect(s.store.refingerprintAll).not.toHaveBeenCalled();
  });

  it('stop() removes the listeners', async () => {
    const s = setup();
    expect(s.eventSource.listenerCount('MESSAGE_EDITED')).toBe(1);
    s.lifecycle.stop();
    expect(s.eventSource.listenerCount('MESSAGE_EDITED')).toBe(0);
    s.eventSource.emit('MESSAGE_EDITED', 2);
    await vi.runAllTimersAsync();
    expect(s.store.clear).not.toHaveBeenCalled();
  });
});
