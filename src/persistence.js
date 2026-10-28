// Pure (de)serialisation of the queue for chat_metadata storage. The stored blob lives in an
// importable chat file, so loadStored treats it as untrusted: it never throws and validates
// every field type. Only ids, timestamps, hashes, names and connection names are written.
import { hash } from './fingerprint.js';

export const SCHEMA_VERSION = 1;
export const EXPIRY_MS = 24 * 60 * 60 * 1000;
const FUTURE_SKEW_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ITEMS = 20;

function strOrNull(v) {
  return typeof v === 'string' ? v : null;
}

function toMs(createdAt) {
  if (createdAt instanceof Date) return createdAt.getTime();
  if (typeof createdAt === 'number') return createdAt;
  return Date.now();
}

/** Build the v1 stored shape from live store items (queued/running only, no status). */
export function serialize(items) {
  const out = [];
  for (const item of items ?? []) {
    if (item.status !== 'queued' && item.status !== 'running') continue;
    const fp = item.fingerprint ?? {};
    const conn = item.connection ?? {};
    out.push({
      id: item.id,
      createdAt: toMs(item.createdAt),
      target: {
        mesId: fp.mesId,
        chatLength: fp.chatLength,
        swipe0Hash: fp.swipe0Hash,
        name: fp.name,
      },
      connection: {
        api: strOrNull(conn.api),
        model: strOrNull(conn.model),
        preset: strOrNull(conn.preset),
      },
    });
  }
  return { version: SCHEMA_VERSION, items: out };
}

function isNullOrString(v) {
  return v === null || typeof v === 'string';
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function validShape(it) {
  if (!isObject(it)) return false;
  if (typeof it.id !== 'string' || it.id === '') return false;
  if (typeof it.createdAt !== 'number' || !Number.isFinite(it.createdAt)) return false;
  const t = it.target;
  if (!isObject(t)) return false;
  if (!Number.isFinite(t.mesId) || !Number.isFinite(t.chatLength)) return false;
  if (typeof t.swipe0Hash !== 'string' || typeof t.name !== 'string') return false;
  const c = it.connection;
  if (!isObject(c)) return false;
  return isNullOrString(c.api) && isNullOrString(c.model) && isNullOrString(c.preset);
}

function targetMatches(t, chat) {
  if (t.mesId !== chat.length - 1 || t.chatLength !== chat.length) return false;
  const m = chat[t.mesId];
  if (!m || m.is_user || m.is_system) return false;
  const text = m.swipes?.[0] ?? m.mes;
  if (typeof text !== 'string') return false;
  if (hash(text) !== t.swipe0Hash) return false;
  return t.name === m.name;
}

/**
 * Validate a stored blob against the live chat. Returns { items, dropped, rawCount, ignored }.
 * Kept items come back as queued with attempts 0 and a fingerprint rebuilt from the live chat.
 */
export function loadStored(raw, ctx, now = Date.now(), { maxItems = DEFAULT_MAX_ITEMS } = {}) {
  const ignoredResult = { items: [], dropped: 0, rawCount: 0, ignored: true };
  if (!isObject(raw) || raw.version !== SCHEMA_VERSION || !Array.isArray(raw.items)) {
    return ignoredResult;
  }
  const rawCount = raw.items.length;
  const considered = raw.items.slice(0, Math.max(0, maxItems));
  const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
  const kept = [];
  const seen = new Set();
  for (const it of considered) {
    if (!validShape(it)) continue;
    // Item ids address the queue (run, cancel, done), so a duplicate would act on the wrong item.
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    const age = now - it.createdAt;
    if (age > EXPIRY_MS) continue;
    if (-age > FUTURE_SKEW_MS) continue;
    if (!targetMatches(it.target, chat)) continue;
    kept.push({
      id: it.id,
      createdAt: new Date(it.createdAt),
      status: 'queued',
      attempts: 0,
      fingerprint: {
        chatId: ctx.chatId ?? null,
        integrity: ctx.chatMetadata?.integrity ?? null,
        mesId: it.target.mesId,
        chatLength: it.target.chatLength,
        swipe0Hash: it.target.swipe0Hash,
        name: it.target.name,
      },
      connection: {
        api: it.connection.api,
        model: it.connection.model,
        preset: it.connection.preset,
      },
    });
  }
  return { items: kept, dropped: rawCount - kept.length, rawCount, ignored: false };
}

const SNAPSHOT_REASONS = ['takeover', 'restored', 'inspector', 'connection', 'failures', 'native'];

function nonNegInt(v) {
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

/**
 * Build the owner's published display snapshot from live store items and runner state. It
 * carries the stored-schema version so a tab taking over can load it through loadStored.
 */
export function buildSnapshot({ items, completed, reasons, failures } = {}) {
  const out = [];
  for (const item of items ?? []) {
    if (item.status !== 'queued' && item.status !== 'running') continue;
    const fp = item.fingerprint ?? {};
    const conn = item.connection ?? {};
    out.push({
      id: item.id,
      status: item.status,
      createdAt: toMs(item.createdAt),
      target: {
        mesId: fp.mesId,
        chatLength: fp.chatLength,
        swipe0Hash: fp.swipe0Hash,
        name: fp.name,
      },
      connection: {
        api: strOrNull(conn.api),
        model: strOrNull(conn.model),
        preset: strOrNull(conn.preset),
      },
    });
  }
  return {
    version: SCHEMA_VERSION,
    items: out.slice(0, DEFAULT_MAX_ITEMS),
    completed: nonNegInt(completed),
    reasons: (Array.isArray(reasons) ? reasons : []).filter((r) => SNAPSHOT_REASONS.includes(r)),
    failures: nonNegInt(failures),
  };
}

/** Validate an untrusted snapshot from another tab; returns the clean shape or null. */
export function parseSnapshot(raw) {
  if (!isObject(raw) || !Array.isArray(raw.items)) return null;
  if (!Number.isFinite(raw.completed) || !Number.isFinite(raw.failures)) return null;
  if (!Array.isArray(raw.reasons)) return null;
  const items = [];
  for (const it of raw.items.slice(0, DEFAULT_MAX_ITEMS)) {
    if (!isObject(it)) return null;
    if (typeof it.id !== 'string' || it.id === '') return null;
    if (it.status !== 'queued' && it.status !== 'running') return null;
    if (!Number.isFinite(it.createdAt)) return null;
    items.push({
      id: it.id,
      status: it.status,
      createdAt: it.createdAt,
      target: isObject(it.target) ? it.target : {},
      connection: isObject(it.connection) ? it.connection : {},
    });
  }
  return {
    items,
    completed: nonNegInt(raw.completed),
    reasons: raw.reasons.filter((r) => SNAPSHOT_REASONS.includes(r)),
    failures: nonNegInt(raw.failures),
  };
}
