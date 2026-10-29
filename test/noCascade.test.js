import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFingerprint } from '../src/fingerprint.js';
import { createStore } from '../src/store.js';
import { createRunner } from '../src/runner.js';
import { appendSwipe } from '../src/appender.js';

vi.mock('../src/adapter.js', () => ({
  abortOwn: vi.fn(async (c) => {
    c.abort();
    return { aborted: c.signal.aborted };
  }),
}));

// The real appender runs against this fake st-bridge (the real one imports ST's script.js,
// unresolvable under Node). `Generate` and the ctx's `generate` alias are reachable from the
// appender through it, so the "never generates" assertions below can actually fail.
const fake = vi.hoisted(() => ({ ctx: null, settings: {}, Generate: vi.fn() }));
vi.mock('../src/st-bridge.js', () => ({
  MODULE_NAME: 'queuedSwipes',
  get extension_settings() {
    return { queuedSwipes: fake.settings };
  },
  ctx: () => fake.ctx,
  isGenerating: () => false,
  swipeState: () => 'none',
  ensureSwipes: () => {},
  updateSwipeCounter: async () => {},
  getGeneratingApi: () => 'openai',
  getGeneratingModel: () => 'test-model',
  Generate: fake.Generate,
}));

const root = join(import.meta.dirname, '..');

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

function makeCtx(message) {
  const swipe = {
    right: vi.fn(),
    // Mirrors native navigation and records, at call time, whether the target swipe already
    // existed: a swipe.to past the end would make ST generate a new swipe.
    landed: [],
    to: vi.fn((_e, _dir, opts) => {
      swipe.landed.push(opts.forceSwipeId < opts.message.swipes.length);
      opts.message.swipe_id = opts.forceSwipeId;
    }),
    refresh: vi.fn(),
    state: () => 'none',
    isAllowed: () => true,
  };
  return {
    chatId: 'chat-1',
    chatMetadata: { integrity: null },
    chat: [message],
    swipe,
    generate: vi.fn(),
    saveChat: vi.fn(async () => {}),
  };
}

/** Queue three swipes and drain them through the runner with the real appender. */
async function drain(ctx) {
  const bridge = { ctx: () => ctx, isGenerating: () => false, swipeState: () => 'none' };
  const store = createStore({ bridge, maxQueueSize: 5 });
  for (let i = 0; i < 3; i++) store.add(buildFingerprint(ctx, 0));
  let n = 0;
  const generate = vi.fn(async () => ({ text: `reply ${++n}`, meta: { started: new Date() } }));
  const runner = createRunner({ bridge, store, generate, append: appendSwipe });
  await runner.wake();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  return { generate };
}

describe('no cascade into extra generations (COMP-02)', () => {
  beforeEach(() => {
    fake.settings = {};
    fake.Generate.mockClear();
  });

  it('draining the queue (autoJump off) appends without any navigation or generation', async () => {
    const m = { mes: 'hello', name: 'Bot', is_user: false };
    const ctx = makeCtx(m);
    fake.ctx = ctx;
    const { generate } = await drain(ctx);

    expect(generate).toHaveBeenCalledTimes(3);
    expect(m.swipes).toEqual(['hello', 'reply 1', 'reply 2', 'reply 3']);
    expect(m.swipe_id).toBe(0);
    expect(ctx.swipe.right).not.toHaveBeenCalled();
    expect(ctx.swipe.to).not.toHaveBeenCalled();
    expect(ctx.generate).not.toHaveBeenCalled();
    expect(fake.Generate).not.toHaveBeenCalled();
  });

  it('autoJump only ever swipe.to()s an existing swipe, never past the end', async () => {
    fake.settings = { autoJump: true };
    const m = { mes: 'hello', name: 'Bot', is_user: false };
    const ctx = makeCtx(m);
    fake.ctx = ctx;
    await drain(ctx);

    expect(m.swipes).toHaveLength(4);
    expect(ctx.swipe.to).toHaveBeenCalledTimes(3);
    const targets = ctx.swipe.to.mock.calls.map(([, , opts]) => opts.forceSwipeId);
    expect(targets).toEqual([1, 2, 3]);
    expect(ctx.swipe.landed).toEqual([true, true, true]);
    for (const [, , opts] of ctx.swipe.to.mock.calls) {
      expect(Number.isInteger(opts.forceSwipeId)).toBe(true);
      expect(opts.forceMesId).toBe(0);
      expect(opts.message).toBe(m);
    }
    expect(ctx.swipe.right).not.toHaveBeenCalled();
    expect(ctx.generate).not.toHaveBeenCalled();
    expect(fake.Generate).not.toHaveBeenCalled();
  });

  it('autoJump does not move a user who is reading an older swipe', async () => {
    fake.settings = { autoJump: true };
    const m = {
      mes: 'a',
      name: 'Bot',
      is_user: false,
      swipe_id: 0,
      swipes: ['a', 'b'],
      swipe_info: [{}, {}],
    };
    const ctx = makeCtx(m);
    fake.ctx = ctx;
    await drain(ctx);

    expect(m.swipes).toHaveLength(5);
    expect(m.swipe_id).toBe(0);
    expect(ctx.swipe.to).not.toHaveBeenCalled();
    expect(ctx.swipe.right).not.toHaveBeenCalled();
  });

  const files = [
    ...readdirSync(join(root, 'src'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => join(root, 'src', f)),
    join(root, 'index.js'),
  ];

  it('no source file triggers auto-continue or swipe.right', () => {
    for (const f of files) {
      const code = stripComments(readFileSync(f, 'utf8'));
      expect(code, f).not.toContain('triggerAutoContinue');
      expect(code, f).not.toContain('option_continue');
      expect(code, f).not.toContain('swipe.right(');
    }
  });

  it("the extension's only Generate/generate call anywhere is adapter.js's dry run", () => {
    // `Generate(` (ST's export) and `.generate(` (the getContext() alias). The runner's bare
    // `generate(item, ...)` is the injected adapter wrapper from index.js, not ST's.
    const pattern = /\bGenerate\s*\(|\.generate\s*\(/g;
    const hits = [];
    for (const f of files) {
      const code = stripComments(readFileSync(f, 'utf8'));
      for (const _ of code.matchAll(pattern)) hits.push(f);
    }
    expect(hits).toEqual([join(root, 'src', 'adapter.js')]);
    const adapter = stripComments(readFileSync(join(root, 'src', 'adapter.js'), 'utf8'));
    expect(adapter).toMatch(/Generate\('swipe',\s*\{[^}]*\},\s*true\)/);
  });
});
