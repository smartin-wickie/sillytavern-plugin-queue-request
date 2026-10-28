import { describe, expect, it } from 'vitest';
import { buildFingerprint, fingerprintMatches, fingerprintStatus, hash } from '../src/fingerprint.js';

function makeCtx(overrides = {}) {
  return {
    chatId: 'chat-1',
    chatMetadata: { integrity: 'integrity-1' },
    chat: [{ mes: 'hello world', name: 'Bot', is_user: false }],
    ...overrides,
  };
}

function makeBridge(ctx) {
  return { ctx: () => ctx };
}

describe('hash', () => {
  it('is deterministic for the same input', () => {
    expect(hash('hello')).toBe(hash('hello'));
  });

  it('differs for different input', () => {
    expect(hash('hello')).not.toBe(hash('goodbye'));
  });
});

describe('buildFingerprint', () => {
  it('reads chatId, integrity, mesId, chatLength, swipe0Hash, name from the live ctx', () => {
    const ctx = makeCtx();
    const fp = buildFingerprint(ctx, 0);
    expect(fp).toEqual({
      chatId: 'chat-1',
      integrity: 'integrity-1',
      mesId: 0,
      chatLength: 1,
      swipe0Hash: hash('hello world'),
      name: 'Bot',
    });
  });

  it('prefers swipes[0] over mes when swipes exist', () => {
    const ctx = makeCtx({
      chat: [{ mes: 'original', swipes: ['first swipe', 'second swipe'], name: 'Bot', is_user: false }],
    });
    const fp = buildFingerprint(ctx, 0);
    expect(fp.swipe0Hash).toBe(hash('first swipe'));
  });

  it('defaults chatId/integrity to null when absent on ctx', () => {
    const ctx = makeCtx({ chatId: undefined, chatMetadata: {} });
    const fp = buildFingerprint(ctx, 0);
    expect(fp.chatId).toBeNull();
    expect(fp.integrity).toBeNull();
  });
});

describe('fingerprintMatches', () => {
  it('returns true when nothing in the chat has changed', () => {
    const ctx = makeCtx();
    const bridge = makeBridge(ctx);
    const fp = buildFingerprint(ctx, 0);
    expect(fingerprintMatches(bridge, fp)).toBe(true);
  });

  it('calls bridge.ctx() fresh rather than relying on a pre-fetched object', () => {
    const ctx = makeCtx();
    const fp = buildFingerprint(ctx, 0);
    let calls = 0;
    const bridge = { ctx: () => { calls += 1; return ctx; } };
    fingerprintMatches(bridge, fp);
    expect(calls).toBeGreaterThan(0);
  });

  it('returns false when chat.length has grown since fp was built', () => {
    const ctx = makeCtx();
    const fp = buildFingerprint(ctx, 0);
    ctx.chat.push({ mes: 'new reply', name: 'Bot', is_user: false });
    const bridge = makeBridge(ctx);
    expect(fingerprintMatches(bridge, fp)).toBe(false);
  });

  it('returns false when chat.length has shrunk since fp was built', () => {
    const ctx = makeCtx({
      chat: [
        { mes: 'first', name: 'User', is_user: true },
        { mes: 'second', name: 'Bot', is_user: false },
      ],
    });
    const fp = buildFingerprint(ctx, 1);
    ctx.chat.pop();
    const bridge = makeBridge(ctx);
    expect(fingerprintMatches(bridge, fp)).toBe(false);
  });

  it('returns false when the content at fp.mesId no longer hashes to fp.swipe0Hash (message edited)', () => {
    const ctx = makeCtx();
    const fp = buildFingerprint(ctx, 0);
    ctx.chat[0].mes = 'edited content';
    const bridge = makeBridge(ctx);
    expect(fingerprintMatches(bridge, fp)).toBe(false);
  });

  it('returns false when fp.mesId is no longer the last message', () => {
    const ctx = makeCtx({
      chat: [
        { mes: 'first', name: 'Bot', is_user: false },
        { mes: 'second', name: 'User', is_user: true },
      ],
    });
    const fp = buildFingerprint(ctx, 0);
    const bridge = makeBridge(ctx);
    expect(fingerprintMatches(bridge, fp)).toBe(false);
  });

  it('returns false when chatId differs from the fingerprint (wrong chat)', () => {
    const ctx = makeCtx();
    const fp = buildFingerprint(ctx, 0);
    ctx.chatId = 'chat-2';
    const bridge = makeBridge(ctx);
    expect(fingerprintMatches(bridge, fp)).toBe(false);
  });

  it('returns false when chatMetadata.integrity differs from the fingerprint', () => {
    const ctx = makeCtx();
    const fp = buildFingerprint(ctx, 0);
    ctx.chatMetadata.integrity = 'integrity-2';
    const bridge = makeBridge(ctx);
    expect(fingerprintMatches(bridge, fp)).toBe(false);
  });
});

describe('fingerprintStatus', () => {
  it("returns 'ok' when nothing changed and matches fingerprintMatches", () => {
    const ctx = makeCtx();
    const fp = buildFingerprint(ctx, 0);
    const bridge = makeBridge(ctx);
    expect(fingerprintStatus(bridge, fp)).toBe('ok');
    expect(fingerprintMatches(bridge, fp)).toBe(true);
  });

  it("returns 'chat' for a different chatId or integrity", () => {
    const ctx = makeCtx();
    const fp = buildFingerprint(ctx, 0);
    ctx.chatId = 'chat-2';
    expect(fingerprintStatus(makeBridge(ctx), fp)).toBe('chat');
    ctx.chatId = 'chat-1';
    ctx.chatMetadata.integrity = 'other';
    expect(fingerprintStatus(makeBridge(ctx), fp)).toBe('chat');
  });

  it("returns 'target' for edited text, extra message, or missing message", () => {
    const ctx = makeCtx();
    const fp = buildFingerprint(ctx, 0);
    ctx.chat[0].mes = 'edited';
    expect(fingerprintStatus(makeBridge(ctx), fp)).toBe('target');
    ctx.chat[0].mes = 'hello world';
    ctx.chat.push({ mes: 'x', name: 'U', is_user: true });
    expect(fingerprintStatus(makeBridge(ctx), fp)).toBe('target');
    ctx.chat.length = 0;
    expect(fingerprintStatus(makeBridge(ctx), fp)).toBe('target');
  });
});
