// Route spike extension: instrumented, read-only probes of ST generation internals.
// Evidence tooling only. It never appends swipes, never runs a non-dry Generate and never writes chat data.
import {
    isGenerating,
    cleanUpMessage,
    extractMessageFromData,
    isStreamingEnabled,
    getGenerateUrl,
    sendOpenAIRequest,
    oai_settings,
    extractReasoningFromData,
    eventSource,
    event_types,
} from './st-imports.js';

const THROWAWAY_NAME = 'QS Spike Throwaway';
const REDACT_KEYS = ['proxy_password', 'custom_include_headers', 'api_key', 'custom_url'];
const LOG_EVENTS = [
    'GENERATION_STARTED',
    'GENERATION_AFTER_COMMANDS',
    'GENERATE_BEFORE_COMBINE_PROMPTS',
    'GENERATE_AFTER_COMBINE_PROMPTS',
    'CHAT_COMPLETION_PROMPT_READY',
    'GENERATE_AFTER_DATA',
    'GENERATION_ENDED',
    'GENERATION_STOPPED',
    'MESSAGE_RECEIVED',
    'MESSAGE_SWIPED',
    'CHAT_CHANGED',
    'CHARACTER_MESSAGE_RENDERED',
];

const state = {
    ownController: null,
    lastCapture: null,
};

const ctx = () => SillyTavern.getContext();
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(err) {
    console.error('[qsSpike]', err);
    return err;
}

/** Refuse to run unless the active chat is the throwaway single-character chat with an AI last message (D-03). */
function guard() {
    const c = ctx();
    if (c.name2 !== THROWAWAY_NAME) throw fail(new Error('qsSpike: wrong character'));
    if (c.groupId) throw fail(new Error('qsSpike: group chat not allowed'));
    const last = c.chat[c.chat.length - 1];
    if (!last || last.is_user) throw fail(new Error('qsSpike: last message must be an AI message'));
    return c;
}

function backendKey() {
    return ctx().mainApi === 'openai' ? 'cc' : 'tc';
}

function streamKey() {
    return isStreamingEnabled() ? 'stream' : 'nostream';
}

function fileName(kind, label) {
    return `qs-${backendKey()}-${streamKey()}${label ? '-' + label : ''}-${kind}.json`;
}

function stableStringify(value) {
    const seen = new WeakSet();
    const walk = (v) => {
        if (v && typeof v === 'object') {
            if (seen.has(v)) return '[circular]';
            seen.add(v);
            if (Array.isArray(v)) return v.map(walk);
            return Object.fromEntries(Object.keys(v).sort().map((k) => [k, walk(v[k])]));
        }
        return v;
    };
    return JSON.stringify(walk(value));
}

function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16) + ':' + str.length;
}

/** Upload a redacted JSON dump to user/files; fall back to a browser download. */
async function dump(name, obj) {
    const replacer = (k, v) => (REDACT_KEYS.includes(k) ? '[redacted]' : v);
    const text = JSON.stringify(obj, replacer, 2);
    try {
        const data = btoa(unescape(encodeURIComponent(text)));
        const res = await fetch('/api/files/upload', {
            method: 'POST',
            headers: ctx().getRequestHeaders(),
            body: JSON.stringify({ name, data }),
        });
        if (!res.ok) throw new Error(`upload failed: ${res.status}`);
        const out = await res.json();
        console.log('[qsSpike] dumped', name, out);
        return out;
    } catch (err) {
        fail(err);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        a.download = name;
        a.click();
        return { fallback: 'download', name };
    }
}

function snapshot() {
    const c = ctx();
    const last = c.chat[c.chat.length - 1] ?? {};
    const chatEl = document.querySelector('#chat');
    const lastMes = document.querySelector('#chat .mes.last_mes') ?? [...document.querySelectorAll('#chat .mes')].pop();
    const stopBtn = document.querySelector('#mes_stop');
    const swipeRight = lastMes?.querySelector('.swipe_right');
    const sendBut = document.querySelector('#send_but');
    return {
        chatHash: hash(stableStringify(c.chat)),
        chatMetadataHash: hash(stableStringify(c.chatMetadata)),
        swipeId: last.swipe_id ?? null,
        swipesLength: Array.isArray(last.swipes) ? last.swipes.length : null,
        genStarted: last.gen_started ?? null,
        genFinished: last.gen_finished ?? null,
        scrollTop: chatEl ? chatEl.scrollTop : null,
        lastMesHash: lastMes ? hash(lastMes.outerHTML) : null,
        mesStopDisplay: stopBtn ? getComputedStyle(stopBtn).display : null,
        swipeRightDisplay: swipeRight ? getComputedStyle(swipeRight).display : null,
        sendDisabled: sendBut ? sendBut.classList.contains('displayNone') || sendBut.disabled : null,
        isGenerating: isGenerating(),
        swipeState: c.swipe?.state?.() ?? null,
        logprobsFlag: oai_settings?.request_logprobs ?? c.textCompletionSettings?.logprobs ?? null,
    };
}

function compareSnapshots(before, after) {
    const equal = {};
    for (const k of Object.keys(before)) equal[k] = before[k] === after[k];
    equal.all = Object.values(equal).every(Boolean);
    return equal;
}

/** Subscribe to the generation-related events; returns {log, stop}. */
function startEventLog() {
    const log = [];
    const handlers = [];
    let ordinal = 0;
    for (const key of LOG_EVENTS) {
        const evt = event_types[key];
        if (!evt) continue;
        const h = (...args) => {
            let dryRun;
            if (key === 'GENERATION_STARTED' || key === 'GENERATION_AFTER_COMMANDS') dryRun = args[2];
            else if (key === 'GENERATE_AFTER_DATA') dryRun = args[1];
            else if (args[0] && typeof args[0] === 'object' && 'dryRun' in args[0]) dryRun = args[0].dryRun;
            log.push({ ordinal: ordinal++, name: key, dryRun: dryRun ?? null });
        };
        eventSource.on(evt, h);
        handlers.push([evt, h]);
    }
    return {
        log,
        stop() {
            for (const [evt, h] of handlers) eventSource.removeListener(evt, h);
        },
    };
}

const SIDE_EFFECT_EVENTS = ['MESSAGE_RECEIVED', 'MESSAGE_SWIPED', 'CHARACTER_MESSAGE_RENDERED'];

/** Idle-gated dry-run swipe capture with an own abort signal (criteria a and b). */
async function capture({ label, holdMs = 0, withSignal = true } = {}) {
    const c = guard();
    if (isGenerating() || c.swipe?.state?.() !== 'none') throw fail(new Error('not idle'));

    const before = snapshot();
    const events = startEventLog();
    state.ownController = new AbortController();
    let armed = false;
    let captured = null;

    const onStart = async (type, _params, dryRun) => {
        if (type === 'swipe' && dryRun === true) {
            armed = true;
            if (holdMs > 0) await delay(holdMs);
        }
    };
    const onData = (data, dryRun) => {
        if (armed && dryRun === true) {
            captured = structuredClone(data);
            armed = false;
        }
    };
    eventSource.on(event_types.GENERATION_STARTED, onStart);
    eventSource.makeLast(event_types.GENERATE_AFTER_DATA, onData);

    try {
        await c.generate('swipe', withSignal ? { signal: state.ownController.signal } : {}, true);
    } catch (err) {
        fail(err);
        throw err;
    } finally {
        eventSource.removeListener(event_types.GENERATION_STARTED, onStart);
        eventSource.removeListener(event_types.GENERATE_AFTER_DATA, onData);
        events.stop();
    }
    if (!captured) throw fail(new Error('capture failed: no dry-run GENERATE_AFTER_DATA seen'));

    const after = snapshot();
    const equal = compareSnapshots(before, after);
    const sideEffectEvents = events.log.filter((e) => SIDE_EFFECT_EVENTS.includes(e.name));
    state.lastCapture = captured;

    await dump(fileName('queued', label), captured);
    await dump(fileName('snapshot', label), {
        label: label ?? null,
        withSignal,
        holdMs,
        before,
        after,
        equal,
        eventLog: events.log,
        sideEffectEvents,
    });

    return {
        equal: equal.all,
        sideEffectEvents: sideEffectEvents.length,
        promptMessages: Array.isArray(captured.prompt) ? captured.prompt.length : null,
        promptChars: typeof captured.prompt === 'string' ? captured.prompt.length : null,
    };
}

/** Send the last captured prompt over an own transport (criterion c). The result is never appended. */
async function send({ label, holdForAbort = false } = {}) {
    const c = guard();
    if (!state.lastCapture) throw fail(new Error('no capture yet; run capture() first'));
    const captured = state.lastCapture;
    const before = snapshot();
    state.ownController = new AbortController();
    const signal = state.ownController.signal;

    let shape;
    let rawLength = 0;
    let getMessage = '';
    let reasoning = '';
    let aborted = false;

    try {
        if (c.mainApi === 'openai') {
            const r = await sendOpenAIRequest('swipe', captured.prompt, signal);
            if (typeof r === 'function') {
                shape = 'generator';
                let last = { text: '', state: {} };
                let first = true;
                for await (const chunk of r()) {
                    last = chunk;
                    if (first && holdForAbort) {
                        first = false;
                        await delay(2000);
                    }
                }
                getMessage = last.text ?? '';
                reasoning = last.state?.reasoning ?? '';
                rawLength = getMessage.length;
            } else {
                shape = 'json';
                rawLength = JSON.stringify(r).length;
                getMessage = extractMessageFromData(r);
                reasoning = extractReasoningFromData(r) ?? '';
            }
        } else {
            shape = 'json';
            const res = await fetch(getGenerateUrl('textgenerationwebui'), {
                method: 'POST',
                headers: c.getRequestHeaders(),
                body: JSON.stringify(captured),
                cache: 'no-cache',
                signal,
            });
            if (!res.ok) throw new Error(`text completion failed: ${res.status}`);
            const json = await res.json();
            rawLength = JSON.stringify(json).length;
            getMessage = extractMessageFromData(json);
            reasoning = extractReasoningFromData(json) ?? '';
        }
    } catch (err) {
        if (err?.name === 'AbortError' || signal.aborted) aborted = true;
        else throw fail(err);
    }

    const cleanedText = aborted
        ? ''
        : cleanUpMessage({
            getMessage,
            isImpersonate: false,
            isContinue: false,
            displayIncompleteSentences: false,
        });
    const after = snapshot();
    const equal = compareSnapshots(before, after);

    const result = {
        shape: shape ?? null,
        rawLength,
        cleanedText,
        cleanedLength: cleanedText.length,
        reasoning,
        aborted,
    };
    await dump(fileName(aborted ? 'abort' : 'transport', label), { ...result, snapshotEqual: equal.all, before, after, equal });
    return { shape: result.shape, cleanedLength: result.cleanedLength, aborted, snapshotEqual: equal.all };
}

export async function init() {
    const api = {
        capture,
        send,
        snapshot: async () => {
            guard();
            const snap = snapshot();
            await dump(fileName('snapshot', 'manual'), snap);
            return snap;
        },
        dump: async (name, obj) => {
            guard();
            return dump(name, obj);
        },
        guard,
    };
    window.qsSpike = api;
    console.log('[qsSpike] ready, ST', ctx().version ?? 'unknown');
}
