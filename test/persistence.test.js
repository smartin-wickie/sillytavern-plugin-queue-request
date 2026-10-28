import { describe, expect, it } from 'vitest';
import { EXPIRY_MS, loadStored, serialize } from '../src/persistence.js';
import { hash } from '../src/fingerprint.js';

const NOW = 1_800_000_000_000;

function makeCtx(chat) {
  const theChat = chat ?? [
    { name: 'u', mes: 'hi', is_user: true },
    { name: 'Bot', mes: 'hello', swipes: ['hello'] },
  ];
  return { chatId: 'live-chat', chatMetadata: { integrity: 'live-int' }, chat: theChat };
}

function stored(overrides = {}) {
  return {
    id: 'a',
    createdAt: NOW - 1000,
    target: { mesId: 1, chatLength: 2, swipe0Hash: hash('hello'), name: 'Bot' },
    connection: { api: 'openai', model: 'm', preset: null },
    ...overrides,
  };
}

function blob(items) {
  return { version: 1, items };
}

describe('serialize', () => {
  it('writes only whitelisted keys and only queued/running items', () => {
    const items = [
      {
        id: 'a',
        createdAt: new Date(NOW),
        status: 'running',
        attempts: 2,
        reason: 'x',
        prompt: 'SECRET',
        text: 'SECRET',
        fingerprint: { chatId: 'c', integrity: 'i', mesId: 1, chatLength: 2, swipe0Hash: 'h', name: 'Bot' },
      },
      { id: 'b', createdAt: new Date(NOW), status: 'done', fingerprint: {} },
      { id: 'c', createdAt: new Date(NOW), status: 'failed', fingerprint: {} },
    ];
    const out = serialize(items);
    expect(Object.keys(out).sort()).toEqual(['items', 'version']);
    expect(out.items).toHaveLength(1);
    expect(Object.keys(out.items[0]).sort()).toEqual(['connection', 'createdAt', 'id', 'target']);
    expect(Object.keys(out.items[0].target).sort()).toEqual(['chatLength', 'mesId', 'name', 'swipe0Hash']);
    expect(Object.keys(out.items[0].connection).sort()).toEqual(['api', 'model', 'preset']);
    expect(out.items[0].createdAt).toBe(NOW);
    expect(JSON.stringify(out)).not.toContain('SECRET');
    expect(out.items[0].connection).toEqual({ api: null, model: null, preset: null });
  });
});

describe('loadStored', () => {
  it('ignores non-objects and unknown versions', () => {
    for (const raw of [null, undefined, 5, 'x', [], { version: 2, items: [] }, { items: [] }]) {
      expect(loadStored(raw, makeCtx(), NOW)).toEqual({ items: [], dropped: 0, rawCount: 0, ignored: true });
    }
  });

  it('ignores non-array items', () => {
    expect(loadStored({ version: 1, items: {} }, makeCtx(), NOW).ignored).toBe(true);
  });

  it('keeps a valid item and rebuilds the fingerprint from the live chat', () => {
    const r = loadStored(blob([stored()]), makeCtx(), NOW);
    expect(r.dropped).toBe(0);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({
      id: 'a',
      status: 'queued',
      attempts: 0,
      fingerprint: { chatId: 'live-chat', integrity: 'live-int', mesId: 1, chatLength: 2, name: 'Bot' },
      connection: { api: 'openai', model: 'm', preset: null },
    });
    expect(r.items[0].createdAt).toBeInstanceOf(Date);
  });

  it('drops expired and far-future items', () => {
    const r = loadStored(
      blob([stored({ createdAt: NOW - EXPIRY_MS - 1 }), stored({ id: 'f', createdAt: NOW + 6 * 60 * 1000 })]),
      makeCtx(),
      NOW,
    );
    expect(r.items).toHaveLength(0);
    expect(r.dropped).toBe(2);
  });

  it('drops target mismatches', () => {
    const cases = [
      { mesId: 0 },
      { chatLength: 3 },
      { swipe0Hash: 'zzz' },
      { name: 'Other' },
    ];
    for (const patch of cases) {
      const s = stored();
      s.target = { ...s.target, ...patch };
      expect(loadStored(blob([s]), makeCtx(), NOW).items).toHaveLength(0);
    }
  });

  it('drops when the target is a user or system message or missing', () => {
    const userChat = [{ name: 'u', mes: 'hi' }, { name: 'Bot', mes: 'hello', is_user: true }];
    expect(loadStored(blob([stored()]), makeCtx(userChat), NOW).items).toHaveLength(0);
    const sysChat = [{ name: 'u', mes: 'hi' }, { name: 'Bot', mes: 'hello', is_system: true }];
    expect(loadStored(blob([stored()]), makeCtx(sysChat), NOW).items).toHaveLength(0);
    expect(loadStored(blob([stored()]), makeCtx([]), NOW).items).toHaveLength(0);
  });

  it('drops malformed items without throwing', () => {
    const bad = [
      null,
      'x',
      stored({ id: 5 }),
      stored({ createdAt: 'now' }),
      stored({ createdAt: Infinity }),
      stored({ target: null }),
      stored({ target: { mesId: 'a', chatLength: 2, swipe0Hash: 'h', name: 'n' } }),
      stored({ connection: { api: 1, model: null, preset: null } }),
      stored({ connection: null }),
    ];
    const r = loadStored(blob(bad), makeCtx(), NOW);
    expect(r.items).toHaveLength(0);
    expect(r.dropped).toBe(bad.length);
  });

  it('caps at maxItems and counts overflow as dropped', () => {
    const many = Array.from({ length: 25 }, (_, i) => stored({ id: `i${i}` }));
    const r = loadStored(blob(many), makeCtx(), NOW, { maxItems: 20 });
    expect(r.items).toHaveLength(20);
    expect(r.rawCount).toBe(25);
    expect(r.dropped).toBe(5);
  });

  it('keeps items after a rename since only name on the message is compared', () => {
    const ctx = makeCtx();
    ctx.chatId = 'renamed-chat';
    const r = loadStored(blob([stored()]), ctx, NOW);
    expect(r.items[0].fingerprint.chatId).toBe('renamed-chat');
  });
});
