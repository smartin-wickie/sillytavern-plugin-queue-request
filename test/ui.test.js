import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Replaces st-bridge.js, which imports ST's script.js and cannot resolve under Node. `canQueue` and
// `swipe.isAllowed()` share one rule here: a swipe in progress or a generation blocks queueing,
// as isSwipingAllowed() does at script.js:9162-9173.
const st = vi.hoisted(() => ({
  listeners: new Map(),
  swipeState: 'none',
  generating: false,
  groupChat: false,
}));

vi.mock('../src/st-bridge.js', () => ({
  MODULE_NAME: 'queuedSwipes',
  extension_settings: { queuedSwipes: {} },
  event_types: {
    CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
    MESSAGE_SWIPED: 'message_swiped',
    CHAT_CHANGED: 'chat_changed',
    APP_READY: 'app_ready',
    GENERATION_ENDED: 'generation_ended',
    GENERATION_STOPPED: 'generation_stopped',
  },
  eventSource: {
    on: (name, fn) => {
      st.listeners.set(name, [...(st.listeners.get(name) ?? []), fn]);
    },
  },
  canQueue: () => !st.groupChat && !st.generating && st.swipeState === 'none',
  isGenerating: () => st.generating,
  swipeState: () => st.swipeState,
  promptInspectorEnabled: () => false,
}));

vi.mock('../src/queueActions.js', () => ({
  cancelAll: vi.fn(),
  resumeQueue: vi.fn(),
  enqueue: vi.fn(),
}));

const { registerQueueControl, injectControl } = await import('../src/ui.js');

class FakeElement {
  constructor() {
    this.className = '';
    this.title = '';
    this.children = [];
    this.parent = null;
    this.classList = {
      add: (c) => {
        if (!this.classList.contains(c)) this.className = `${this.className} ${c}`.trim();
      },
      remove: (c) => {
        this.className = this.className.split(/\s+/).filter((x) => x !== c).join(' ');
      },
      contains: (c) => this.className.split(/\s+/).includes(c),
      toggle: (c) => (this.classList.contains(c) ? this.classList.remove(c) : this.classList.add(c)),
    };
  }

  set textContent(_value) {
    this.children = [];
  }

  set innerHTML(_value) {
    this.children = [];
  }

  addEventListener() {}

  setAttribute() {}

  removeAttribute() {}

  appendChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  insertAdjacentElement(_position, el) {
    el.parent = this.parent;
    this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, el);
    return el;
  }

  remove() {
    if (!this.parent) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }

  querySelectorAll(selector) {
    const wanted = selector.split('.').filter(Boolean);
    const found = [];
    const walk = (el) => {
      for (const child of el.children) {
        if (!(child instanceof FakeElement)) continue;
        if (wanted.every((c) => child.classList.contains(c))) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

function element(className, parent) {
  const el = new FakeElement();
  el.className = className;
  parent?.appendChild(el);
  return el;
}

const CONTROL = '.qs-queue-control';
// Longer than the 20 x 250ms retry budget used once no swipe is in progress.
const PAST_RETRY_BUDGET_MS = 6000;

let root;
let store;
let runner;
let queueChanged;

const controls = () => root.querySelectorAll(CONTROL);

function emit(name) {
  for (const fn of st.listeners.get(name) ?? []) fn();
}

/** ST's order for paging to an existing swipe: script.js:9995, then :10315, then :10099. */
function beginPaging() {
  st.swipeState = 'swiping';
  emit('message_swiped');
}

function endPaging() {
  st.swipeState = 'none';
}

beforeEach(() => {
  vi.useFakeTimers();
  st.listeners.clear();
  st.swipeState = 'none';
  st.generating = false;
  st.groupChat = false;

  root = new FakeElement();
  const lastMes = element('mes last_mes', root);
  element('swipe_right', element('swipeRightBlock', lastMes));

  vi.stubGlobal('document', {
    querySelector: (s) => root.querySelector(s),
    querySelectorAll: (s) => root.querySelectorAll(s),
    createElement: () => new FakeElement(),
    createTextNode: (text) => ({ text }),
    addEventListener: () => {},
  });

  queueChanged = [];
  store = {
    pendingCount: () => 0,
    runningCount: () => 0,
    getMaxQueueSize: () => 5,
    isReadOnly: () => false,
    getItems: () => [],
    onChange: (fn) => queueChanged.push(fn),
    onReadOnlyChange: () => {},
    onReset: () => {},
  };
  runner = {
    onStateChange: () => {},
    onBreakerTrip: () => {},
    onInspectorPause: () => {},
    onItemDone: () => {},
    onItemFailed: () => {},
  };

  registerQueueControl({ store, runner });
  injectControl(store, runner);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('queue control while paging between swipes', () => {
  it('is still there after paging to a previous swipe', async () => {
    expect(controls()).toHaveLength(1);

    beginPaging();
    await vi.advanceTimersByTimeAsync(300);
    endPaging();
    await vi.advanceTimersByTimeAsync(300);

    expect(controls()).toHaveLength(1);
  });

  it('is not removed during the swipe animation', async () => {
    beginPaging();
    expect(controls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(controls()).toHaveLength(1);
  });

  it('survives a swipe held past the retry budget by a slow MESSAGE_SWIPED listener', async () => {
    beginPaging();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(controls()).toHaveLength(1);

    endPaging();
    await vi.advanceTimersByTimeAsync(300);
    expect(controls()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('comes back after a long swipe when it was already missing', async () => {
    controls()[0].remove();

    beginPaging();
    await vi.advanceTimersByTimeAsync(PAST_RETRY_BUDGET_MS);
    expect(controls()).toHaveLength(0);

    endPaging();
    await vi.advanceTimersByTimeAsync(300);
    expect(controls()).toHaveLength(1);
  });

  it('stays single when paging repeatedly with overlapping retries', async () => {
    beginPaging();
    await vi.advanceTimersByTimeAsync(100);
    endPaging();
    beginPaging();
    await vi.advanceTimersByTimeAsync(100);
    endPaging();
    await vi.advanceTimersByTimeAsync(600);

    expect(controls()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('queue changes racing a swipe', () => {
  it('leaves a present control in place when the queue changes mid-swipe', async () => {
    beginPaging();
    for (const fn of queueChanged) fn();
    expect(controls()).toHaveLength(1);

    endPaging();
    await vi.advanceTimersByTimeAsync(300);
    expect(controls()).toHaveLength(1);
  });

  it('does not double-inject when a queue change restores the control before the retry fires', async () => {
    controls()[0].remove();

    beginPaging();
    await vi.advanceTimersByTimeAsync(100);
    for (const fn of queueChanged) fn();
    expect(controls()).toHaveLength(0);

    endPaging();
    for (const fn of queueChanged) fn();
    expect(controls()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(600);
    expect(controls()).toHaveLength(1);
  });
});

describe('queue control around a native generation', () => {
  it('hides during a swipe that generates, then returns when the swipe ends', async () => {
    // Overswipe path: Generate starts right after the emit (script.js:10317-10320) and endSwipe
    // awaits it, so swipeState stays 'swiping' for the whole generation.
    beginPaging();
    st.generating = true;
    await vi.advanceTimersByTimeAsync(300);
    expect(controls()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(controls()).toHaveLength(0);

    st.generating = false;
    emit('generation_ended');
    await vi.advanceTimersByTimeAsync(100);
    expect(controls()).toHaveLength(0);

    endPaging();
    await vi.advanceTimersByTimeAsync(300);
    expect(controls()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns after a stopped generation', async () => {
    controls()[0].remove();
    emit('generation_stopped');
    await vi.advanceTimersByTimeAsync(300);
    expect(controls()).toHaveLength(1);
  });
});

describe('when queueing is not transiently blocked', () => {
  it('gives up after the retry budget and leaves no control in a group chat', async () => {
    st.groupChat = true;
    emit('message_swiped');

    await vi.advanceTimersByTimeAsync(PAST_RETRY_BUDGET_MS);

    expect(controls()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
