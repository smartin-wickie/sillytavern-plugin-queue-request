import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildFingerprint } from '../src/fingerprint.js';
import { createStore } from '../src/store.js';
import { createRunner } from '../src/runner.js';

vi.mock('../src/adapter.js', () => ({
  abortOwn: vi.fn(async (c) => {
    c.abort();
    return { aborted: c.signal.aborted };
  }),
}));

const root = join(import.meta.dirname, '..');

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

describe('no cascade into extra generations (COMP-02)', () => {
  it('draining the queue never swipes right, continues, or starts a non-dry Generate', async () => {
    const swipe = { right: vi.fn(), to: vi.fn(), state: () => 'none', isAllowed: () => true };
    const Generate = vi.fn();
    const continueClicks = vi.fn();
    const ctx = {
      chatId: 'chat-1',
      chatMetadata: { integrity: null },
      chat: [{ mes: 'hello', name: 'Bot', is_user: false }],
      swipe,
      Generate,
      generate: Generate,
    };
    const bridge = { ctx: () => ctx, isGenerating: () => false, swipeState: () => 'none' };
    const store = createStore({ bridge, maxQueueSize: 5 });
    for (let i = 0; i < 3; i++) store.add(buildFingerprint(ctx, 0));

    const generate = vi.fn(async () => ({ text: 'reply', meta: { started: new Date() } }));
    const append = vi.fn();
    const stub = { click: continueClicks };
    const runner = createRunner({ bridge, store, generate, append });

    await runner.wake();
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(generate).toHaveBeenCalledTimes(3);
    expect(append).toHaveBeenCalledTimes(3);
    expect(swipe.right).not.toHaveBeenCalled();
    expect(swipe.to).not.toHaveBeenCalled();
    for (const call of Generate.mock.calls) expect(call[2]).toBe(true);
    expect(Generate).not.toHaveBeenCalled();
    expect(stub.click).not.toHaveBeenCalled();
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

  it("adapter.js's only Generate call is the dry run", () => {
    const code = stripComments(readFileSync(join(root, 'src', 'adapter.js'), 'utf8'));
    const calls = code.match(/Generate\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(code).toMatch(/Generate\('swipe',\s*\{[^}]*\},\s*true\)/);
  });
});
