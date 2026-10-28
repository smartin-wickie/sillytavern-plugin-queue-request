import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLifecycle } from '../src/lifecycle.js';
import { hash } from '../src/fingerprint.js';
import { buildSnapshot } from '../src/persistence.js';

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

describe('handleChatChanged', () => {
  const NOW = new Date('2026-10-27T12:00:00Z').getTime();

  function chatSetup({ stored, promptResume, popups } = {}) {
    const chat = [
      { name: 'u', mes: 'hi', is_user: true },
      { name: 'Bot', mes: 'hello', swipes: ['hello'] },
    ];
    const state = {
      ctx: {
        chatId: 'c1',
        chat,
        chatMetadata: { integrity: 'i1', queuedSwipes: stored },
      },
      key: 'av/c1',
    };
    const eventSource = makeEventSource();
    const bridge = {
      eventSource,
      event_types: { ...EVENT_TYPES, CHAT_CHANGED: 'CHAT_CHANGED' },
      ctx: () => state.ctx,
      chatKey: () => state.key,
      isGenerating: () => state.generating === true,
    };
    const store = {
      getItems: () => [],
      clear: vi.fn(() => 2),
      persist: vi.fn(),
      unbind: vi.fn(),
      rebind: vi.fn(),
      bindChat: vi.fn(),
    };
    const runner = {
      pause: vi.fn(),
      resume: vi.fn(),
      invalidate: vi.fn(),
      resetCounters: vi.fn(),
      abortRunning: vi.fn(),
    };
    const toast = vi.fn();
    const lifecycle = createLifecycle({ bridge, store, runner, toast, moduleName: 'queuedSwipes', promptResume, popups });
    lifecycle.start();
    return { bridge, state, eventSource, store, runner, toast, lifecycle };
  }

  function validBlob(n = 1, createdAt = NOW - 1000) {
    return {
      version: 1,
      items: Array.from({ length: n }, (_, i) => ({
        id: `s${i}`,
        createdAt,
        target: { mesId: 1, chatLength: 2, swipe0Hash: hash('hello'), name: 'Bot' },
        connection: { api: null, model: null, preset: null },
      })),
    };
  }

  beforeEach(() => vi.setSystemTime(NOW));

  it('runs the switch prefix synchronously in the documented order', () => {
    const s = chatSetup({ stored: validBlob() });
    s.eventSource.emit('CHAT_CHANGED');
    const order = (fn) => fn.mock.invocationCallOrder[0];
    expect(s.runner.pause).toHaveBeenCalledWith('restored');
    expect(order(s.runner.pause)).toBeLessThan(order(s.runner.abortRunning));
    expect(order(s.runner.abortRunning)).toBeLessThan(order(s.store.rebind));
    expect(s.runner.abortRunning).toHaveBeenCalledWith({ disposition: 'requeue' });
    expect(s.runner.resume.mock.calls.map((c) => c[0])).toEqual(['failures', 'connection', 'takeover']);
    expect(s.store.bindChat).not.toHaveBeenCalled();
  });

  it('a distinct chat switch resets the failure counters', () => {
    const s = chatSetup({ stored: validBlob() });
    s.eventSource.emit('CHAT_CHANGED');
    expect(s.runner.resetCounters).toHaveBeenCalledTimes(1);
  });

  it('never persists between unbind and bindChat', async () => {
    const s = chatSetup({ stored: validBlob() });
    s.eventSource.emit('CHAT_CHANGED');
    await vi.runAllTimersAsync();
    const unbindAt = s.store.unbind.mock.invocationCallOrder[0];
    const bindAt = s.store.bindChat.mock.invocationCallOrder[0];
    for (const o of s.store.persist.mock.invocationCallOrder) {
      expect(o < unbindAt || o > bindAt).toBe(true);
    }
  });

  it('loads valid stored items, keeps restored pause, prompts once', async () => {
    const promptResume = vi.fn();
    const s = chatSetup({ stored: validBlob(2), promptResume });
    s.eventSource.emit('CHAT_CHANGED');
    await vi.runAllTimersAsync();
    expect(s.store.bindChat).toHaveBeenCalledWith('av/c1', 'i1');
    const loaded = s.store.rebind.mock.calls.at(-1)[0];
    expect(loaded).toHaveLength(2);
    expect(s.runner.resume).not.toHaveBeenCalledWith('restored');
    expect(promptResume).toHaveBeenCalledTimes(1);
    expect(promptResume.mock.calls[0][0].count).toBe(2);
    expect(s.toast).not.toHaveBeenCalled();
  });

  it('same-chat reload does nothing but persist', async () => {
    const s = chatSetup({ stored: validBlob() });
    s.eventSource.emit('CHAT_CHANGED');
    await vi.runAllTimersAsync();
    vi.clearAllMocks();
    s.eventSource.emit('CHAT_CHANGED');
    await vi.runAllTimersAsync();
    expect(s.store.persist).toHaveBeenCalledTimes(1);
    expect(s.runner.pause).not.toHaveBeenCalled();
    expect(s.runner.abortRunning).not.toHaveBeenCalled();
    expect(s.store.rebind).not.toHaveBeenCalled();
  });

  it('dropped items toast once and persist immediately; empty result resumes restored', async () => {
    const s = chatSetup({ stored: validBlob(2, NOW - 25 * 3600 * 1000) });
    s.eventSource.emit('CHAT_CHANGED');
    await vi.runAllTimersAsync();
    expect(s.toast).toHaveBeenCalledTimes(1);
    expect(s.toast).toHaveBeenCalledWith(
      'Dropped 2 saved queued swipe(s): the message changed or they expired.',
    );
    expect(s.store.persist).toHaveBeenCalledWith({ immediate: true });
    expect(s.runner.resume).toHaveBeenCalledWith('restored');
  });

  it('unknown version leaves metadata untouched and loads nothing', async () => {
    const s = chatSetup({ stored: { version: 9, items: [1] } });
    s.eventSource.emit('CHAT_CHANGED');
    await vi.runAllTimersAsync();
    expect(s.toast).not.toHaveBeenCalled();
    expect(s.store.rebind.mock.calls.at(-1)[0]).toEqual([]);
    expect(s.state.ctx.chatMetadata.queuedSwipes).toEqual({ version: 9, items: [1] });
  });

  it('switch to a chat with no key stays unbound and resumes restored', async () => {
    const s = chatSetup();
    s.state.key = null;
    s.eventSource.emit('CHAT_CHANGED');
    await vi.runAllTimersAsync();
    expect(s.store.bindChat).not.toHaveBeenCalled();
    expect(s.runner.resume).toHaveBeenCalledWith('restored');
  });

  it('a distinct switch does not clear the inspector reason', () => {
    const s = chatSetup();
    s.eventSource.emit('CHAT_CHANGED');
    expect(s.runner.resume).not.toHaveBeenCalledWith('inspector');
  });

  describe('resume popup flow', () => {
    function withPopup(result, blob = validBlob(2)) {
      const showResume = vi.fn(async () => result);
      const s = chatSetup({ stored: blob, popups: { showResume } });
      return { ...s, showResume };
    }

    it('resume answer resumes the restored reason', async () => {
      const s = withPopup('resume');
      s.eventSource.emit('CHAT_CHANGED');
      await vi.runAllTimersAsync();
      expect(s.showResume).toHaveBeenCalledTimes(1);
      expect(s.showResume).toHaveBeenCalledWith({ count: 2, model: null, api: null });
      expect(s.runner.resume).toHaveBeenCalledWith('restored');
    });

    it('discard clears the store, toasts, and releases the pause', async () => {
      const s = withPopup('discard');
      s.eventSource.emit('CHAT_CHANGED');
      await vi.runAllTimersAsync();
      expect(s.store.clear).toHaveBeenCalledWith('discarded');
      expect(s.toast).toHaveBeenCalledWith('Discarded 2 queued swipe(s).');
      expect(s.runner.resume).toHaveBeenCalledWith('restored');
    });

    it.each([null, undefined, 'dismiss', 'whatever'])('answer %s keeps everything stored and paused', async (answer) => {
      const s = withPopup(answer);
      s.eventSource.emit('CHAT_CHANGED');
      await vi.runAllTimersAsync();
      expect(s.store.clear).not.toHaveBeenCalled();
      expect(s.runner.resume).not.toHaveBeenCalledWith('restored');
      expect(s.toast).not.toHaveBeenCalled();
    });

    it('defers while a native generation runs', async () => {
      const s = withPopup('resume');
      s.state.generating = true;
      s.eventSource.emit('CHAT_CHANGED');
      await vi.advanceTimersByTimeAsync(1200);
      expect(s.showResume).not.toHaveBeenCalled();
      s.state.generating = false;
      await vi.advanceTimersByTimeAsync(600);
      expect(s.showResume).toHaveBeenCalledTimes(1);
    });

    it('aborts silently when the chat key changed meanwhile', async () => {
      const s = withPopup('resume');
      s.state.generating = true;
      s.eventSource.emit('CHAT_CHANGED');
      await vi.advanceTimersByTimeAsync(100);
      s.state.key = 'av/other';
      s.state.generating = false;
      await vi.advanceTimersByTimeAsync(600);
      expect(s.showResume).not.toHaveBeenCalled();
    });

    it('prompts once per load and never for zero valid items', async () => {
      const s = withPopup('dismiss');
      s.eventSource.emit('CHAT_CHANGED');
      await vi.runAllTimersAsync();
      s.eventSource.emit('CHAT_CHANGED');
      await vi.runAllTimersAsync();
      expect(s.showResume).toHaveBeenCalledTimes(1);
      const empty = withPopup('resume', { version: 1, items: [] });
      empty.eventSource.emit('CHAT_CHANGED');
      await vi.runAllTimersAsync();
      expect(empty.showResume).not.toHaveBeenCalled();
    });

    describe('connection handling', () => {
      const old = { api: 'openai', model: 'gpt-x', preset: 'p1' };

      function withConn(result, snapshot, showConnection) {
        const blob = validBlob(2);
        blob.items.forEach((it) => { it.connection = { ...old }; });
        const showResume = vi.fn(async () => result);
        const s = chatSetup({ stored: blob, popups: { showResume, showConnection } });
        s.bridge.connectionSnapshot = () => snapshot;
        return { ...s, showResume };
      }

      it('merges a mismatch into ONE resume popup and consent updates connections', async () => {
        const cur = { api: 'openai', model: 'gpt-y', preset: 'p1' };
        const showConnection = vi.fn();
        const s = withConn('resume', cur, showConnection);
        s.store.setConnectionAll = vi.fn();
        s.eventSource.emit('CHAT_CHANGED');
        await vi.runAllTimersAsync();
        expect(s.showResume).toHaveBeenCalledTimes(1);
        expect(s.showResume).toHaveBeenCalledWith({
          count: 2, model: 'gpt-x', api: 'openai', connectionNote: { model: 'gpt-y', api: 'openai' },
        });
        expect(showConnection).not.toHaveBeenCalled();
        expect(s.store.setConnectionAll).toHaveBeenCalledWith(cur);
        expect(s.runner.resume).toHaveBeenCalledWith('restored');
        expect(s.store.clear).not.toHaveBeenCalled();
      });

      it('no connectionNote and no setConnectionAll when unchanged', async () => {
        const s = withConn('resume', { ...old }, vi.fn());
        s.store.setConnectionAll = vi.fn();
        s.eventSource.emit('CHAT_CHANGED');
        await vi.runAllTimersAsync();
        expect(s.showResume).toHaveBeenCalledWith({ count: 2, model: 'gpt-x', api: 'openai' });
        expect(s.store.setConnectionAll).not.toHaveBeenCalled();
      });

      it('dismiss on the combined popup does not update connections', async () => {
        const s = withConn('dismiss', { ...old, model: 'gpt-y' }, vi.fn());
        s.store.setConnectionAll = vi.fn();
        s.eventSource.emit('CHAT_CHANGED');
        await vi.runAllTimersAsync();
        expect(s.store.setConnectionAll).not.toHaveBeenCalled();
      });

      describe('runner onConnectionChanged', () => {
        function gateSetup(answer) {
          const showConnection = vi.fn(async () => answer);
          const s = withConn('dismiss', { ...old }, showConnection);
          let handler = null;
          s.runner.onConnectionChanged = vi.fn((h) => { handler = h; });
          s.runner.offConnectionChanged = vi.fn();
          s.store.setConnectionAll = vi.fn();
          s.lifecycle.stop();
          s.lifecycle.start();
          const cur = { api: 'openai', model: 'gpt-z', preset: 'p1' };
          s.bridge.connectionSnapshot = () => cur;
          return { ...s, showConnection, fire: () => handler({ changed: ['model'], old, current: cur }), cur };
        }

        it('continue updates all connections and resumes', async () => {
          const s = gateSetup('continue');
          s.fire();
          await vi.runAllTimersAsync();
          expect(s.showConnection).toHaveBeenCalledWith({ changed: ['model'], old, current: s.cur });
          expect(s.store.setConnectionAll).toHaveBeenCalledWith(s.cur);
          expect(s.runner.resume).toHaveBeenCalledWith('connection');
        });

        it.each(['keep', null, undefined])('answer %s stays paused', async (answer) => {
          const s = gateSetup(answer);
          s.fire();
          await vi.runAllTimersAsync();
          expect(s.store.setConnectionAll).not.toHaveBeenCalled();
          expect(s.runner.resume).not.toHaveBeenCalledWith('connection');
        });

        it('does not stack a second popup while one is open', async () => {
          let release;
          const s = gateSetup('continue');
          s.showConnection.mockImplementation(() => new Promise((r) => { release = r; }));
          s.fire();
          s.fire();
          await vi.runAllTimersAsync();
          expect(s.showConnection).toHaveBeenCalledTimes(1);
          release('keep');
          await vi.runAllTimersAsync();
        });

        it('is silent when the chat key changed before the popup', async () => {
          const s = gateSetup('continue');
          s.fire();
          s.state.key = 'av/other';
          await vi.runAllTimersAsync();
          expect(s.showConnection).not.toHaveBeenCalled();
        });
      });
    });

    it('passes the oldest item connection to the popup', async () => {
      const blob = validBlob(2);
      blob.items[0].connection = { api: 'openai', model: 'gpt-x', preset: null };
      const s = withPopup('dismiss', blob);
      s.eventSource.emit('CHAT_CHANGED');
      await vi.runAllTimersAsync();
      expect(s.showResume).toHaveBeenCalledWith({ count: 2, model: 'gpt-x', api: 'openai' });
    });
  });
});

describe('ownership integration', () => {
  const NOW = new Date('2026-10-27T12:00:00Z').getTime();
  const READONLY = "This chat's queue is managed in another tab. Showing it read-only here.";
  const TAKEOVER = 'This tab now manages the queue. It is paused; resume from the queue badge.';

  function blob(n = 1) {
    return {
      version: 1,
      items: Array.from({ length: n }, (_, i) => ({
        id: `s${i}`,
        createdAt: NOW - 1000,
        target: { mesId: 1, chatLength: 2, swipe0Hash: hash('hello'), name: 'Bot' },
        connection: { api: null, model: null, preset: null },
      })),
    };
  }

  function ownSetup({ role = 'owner', stored, snapshot } = {}) {
    const chat = [
      { name: 'u', mes: 'hi', is_user: true },
      { name: 'Bot', mes: 'hello', swipes: ['hello'] },
    ];
    const state = {
      ctx: { chatId: 'c1', chat, chatMetadata: { integrity: 'i1', queuedSwipes: stored } },
      key: 'av/c1',
    };
    const eventSource = makeEventSource();
    const bridge = {
      eventSource,
      event_types: { ...EVENT_TYPES, CHAT_CHANGED: 'CHAT_CHANGED' },
      ctx: () => state.ctx,
      chatKey: () => state.key,
      isGenerating: () => false,
    };
    const calls = [];
    const store = {
      getItems: () => [],
      clear: vi.fn(() => 0),
      persist: vi.fn(),
      unbind: vi.fn(),
      rebind: vi.fn(),
      bindChat: vi.fn(),
      setReadOnly: vi.fn((f) => calls.push(`ro:${f}`)),
    };
    const runner = {
      pause: vi.fn((r) => calls.push(`pause:${r}`)),
      resume: vi.fn((r) => calls.push(`resume:${r}`)),
      invalidate: vi.fn(() => calls.push('invalidate')),
      resetCounters: vi.fn(),
      abortRunning: vi.fn((o) => calls.push(`abort:${o?.disposition}`)),
    };
    let roleCb = null;
    const ownership = {
      claim: vi.fn(async () => {
        calls.push('claim');
        return { role };
      }),
      release: vi.fn(() => calls.push('release')),
      onRoleChange: vi.fn((cb) => {
        roleCb = cb;
      }),
      offRoleChange: vi.fn(),
      readState: vi.fn(() => (snapshot ? { snapshot } : null)),
    };
    const toast = vi.fn();
    const popups = { showResume: vi.fn(async () => 'dismiss') };
    const lifecycle = createLifecycle({
      bridge,
      store,
      runner,
      toast,
      moduleName: 'queuedSwipes',
      popups,
      ownership,
    });
    lifecycle.start();
    return {
      state,
      eventSource,
      store,
      runner,
      toast,
      popups,
      ownership,
      lifecycle,
      calls,
      fireRole: (c) => roleCb(c),
    };
  }

  beforeEach(() => vi.setSystemTime(NOW));

  it('closes the claim window in the sync prefix and releases before claiming', async () => {
    const s = ownSetup({ stored: blob() });
    s.eventSource.emit('CHAT_CHANGED');
    expect(s.store.setReadOnly).toHaveBeenCalledWith(true);
    expect(s.ownership.release).toHaveBeenCalledTimes(1);
    expect(s.ownership.claim).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(s.calls.indexOf('release')).toBeLessThan(s.calls.indexOf('claim'));
    expect(s.calls.indexOf('claim')).toBeLessThan(s.calls.indexOf('ro:false'));
  });

  it('owner claim loads the queue and offers the resume popup', async () => {
    const s = ownSetup({ stored: blob(2) });
    s.eventSource.emit('CHAT_CHANGED');
    await vi.runAllTimersAsync();
    expect(s.store.setReadOnly).toHaveBeenLastCalledWith(false);
    expect(s.store.bindChat).toHaveBeenCalled();
    expect(s.popups.showResume).toHaveBeenCalledTimes(1);
  });

  it('read-only claim does not load, prompt or resume, and toasts once', async () => {
    const s = ownSetup({ role: 'readonly', stored: blob() });
    s.eventSource.emit('CHAT_CHANGED');
    await vi.runAllTimersAsync();
    expect(s.store.bindChat).not.toHaveBeenCalled();
    expect(s.popups.showResume).not.toHaveBeenCalled();
    expect(s.runner.resume).not.toHaveBeenCalledWith('restored');
    expect(s.toast.mock.calls.filter((c) => c[0] === READONLY)).toHaveLength(1);
    expect(s.store.setReadOnly).toHaveBeenLastCalledWith(true);
    // Same-chat reload never re-claims or re-toasts.
    s.eventSource.emit('CHAT_CHANGED');
    await vi.runAllTimersAsync();
    expect(s.ownership.claim).toHaveBeenCalledTimes(1);
    expect(s.toast.mock.calls.filter((c) => c[0] === READONLY)).toHaveLength(1);
  });

  it('a newer CHAT_CHANGED invalidates a stale claim result', async () => {
    const s = ownSetup({ stored: blob() });
    let resolveFirst;
    s.ownership.claim.mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)));
    s.eventSource.emit('CHAT_CHANGED');
    await vi.runAllTimersAsync();
    s.state.key = 'av/c2';
    s.state.ctx = { ...s.state.ctx, chatId: 'c2', chatMetadata: { integrity: 'i2' } };
    s.eventSource.emit('CHAT_CHANGED');
    resolveFirst({ role: 'owner' });
    await vi.runAllTimersAsync();
    expect(s.store.bindChat).toHaveBeenCalledTimes(1);
    expect(s.store.bindChat).toHaveBeenCalledWith('av/c2', 'i2');
  });

  it('takeover with items rebinds paused, toasts, and never opens a popup', async () => {
    const s = ownSetup({ role: 'readonly', stored: blob(2) });
    s.eventSource.emit('CHAT_CHANGED');
    await vi.runAllTimersAsync();
    s.calls.length = 0;
    s.fireRole({ role: 'owner', reason: 'takeover' });
    expect(s.store.setReadOnly).toHaveBeenLastCalledWith(false);
    expect(s.store.rebind.mock.lastCall[0]).toHaveLength(2);
    expect(s.calls.indexOf('pause:takeover')).toBeGreaterThan(-1);
    expect(s.calls.indexOf('pause:takeover')).toBeLessThan(s.calls.indexOf('resume:restored'));
    expect(s.toast).toHaveBeenCalledWith(TAKEOVER);
    await vi.runAllTimersAsync();
    expect(s.popups.showResume).not.toHaveBeenCalled();
  });

  it('takeover with an empty queue is silent and not paused', async () => {
    const s = ownSetup({ role: 'readonly' });
    s.eventSource.emit('CHAT_CHANGED');
    await vi.runAllTimersAsync();
    s.fireRole({ role: 'owner', reason: 'takeover' });
    expect(s.toast).not.toHaveBeenCalledWith(TAKEOVER);
    expect(s.runner.pause).not.toHaveBeenCalledWith('takeover');
    expect(s.runner.resume).toHaveBeenCalledWith('restored');
  });

  it('takeover prefers a valid mirror snapshot over chat metadata', async () => {
    const s = ownSetup({ role: 'readonly', stored: blob(1), snapshot: blob(2) });
    s.eventSource.emit('CHAT_CHANGED');
    await vi.runAllTimersAsync();
    s.fireRole({ role: 'owner', reason: 'takeover' });
    expect(s.store.rebind.mock.lastCall[0]).toHaveLength(2);
  });

  function builtSnapshot(n) {
    const fp = { mesId: 1, chatLength: 2, swipe0Hash: hash('hello'), name: 'Bot' };
    return buildSnapshot({
      items: Array.from({ length: n }, (_, i) => ({
        id: `p${i}`,
        status: 'queued',
        createdAt: new Date(NOW - 1000),
        fingerprint: fp,
        connection: {},
      })),
      completed: 0,
      reasons: ['restored'],
      failures: 0,
    });
  }

  it('takeover restores items from a snapshot published by buildSnapshot (CR-01)', async () => {
    const s = ownSetup({ role: 'readonly', stored: blob(3), snapshot: builtSnapshot(2) });
    s.eventSource.emit('CHAT_CHANGED');
    await vi.runAllTimersAsync();
    s.fireRole({ role: 'owner', reason: 'takeover' });
    expect(s.store.rebind.mock.lastCall[0].map((i) => i.id)).toEqual(['p0', 'p1']);
    expect(s.toast).toHaveBeenCalledWith(TAKEOVER);
  });

  it('takeover falls back to chat metadata when the snapshot is unusable (CR-01)', async () => {
    const s = ownSetup({ role: 'readonly', stored: blob(3), snapshot: { items: [] } });
    s.eventSource.emit('CHAT_CHANGED');
    await vi.runAllTimersAsync();
    s.fireRole({ role: 'owner', reason: 'takeover' });
    expect(s.store.rebind.mock.lastCall[0]).toHaveLength(3);
  });

  it('demotion invalidates, aborts with discard, then goes read-only, without a toast', async () => {
    const s = ownSetup({ stored: blob() });
    s.eventSource.emit('CHAT_CHANGED');
    await vi.runAllTimersAsync();
    s.calls.length = 0;
    s.toast.mockClear();
    s.fireRole({ role: 'readonly', reason: 'demoted' });
    expect(s.calls).toEqual(['invalidate', 'abort:discard', 'ro:true']);
    expect(s.toast).not.toHaveBeenCalled();
  });

  it('start and stop subscribe and unsubscribe the role listener', () => {
    const s = ownSetup();
    expect(s.ownership.onRoleChange).toHaveBeenCalledTimes(1);
    s.lifecycle.stop();
    expect(s.ownership.offRoleChange).toHaveBeenCalledTimes(1);
  });

  it('no chat key leaves the store writable', async () => {
    const s = ownSetup();
    s.state.key = null;
    s.eventSource.emit('CHAT_CHANGED');
    await vi.runAllTimersAsync();
    expect(s.ownership.claim).not.toHaveBeenCalled();
    expect(s.store.setReadOnly).toHaveBeenLastCalledWith(false);
  });
});
