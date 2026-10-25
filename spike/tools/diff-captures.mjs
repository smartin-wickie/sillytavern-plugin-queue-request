// Strict diff of two captured generation payloads.
// Usage: node diff-captures.mjs <queued.json> <native.json>
// Chat Completion payloads carry `prompt` as a message array; Text Completion payloads carry it as a string.
// Exit code 0 when identical, 1 on any strict difference.
import { readFileSync } from 'node:fs';
import { inspect } from 'node:util';

function load(path) {
    const obj = JSON.parse(readFileSync(path, 'utf8'));
    return obj && typeof obj === 'object' && obj.captured ? obj.captured : obj;
}

function sortKeys(v) {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') {
        return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
    }
    return v;
}

const norm = (v) => JSON.stringify(sortKeys(v), null, 2);

function lineDiff(a, b) {
    const al = String(a).split('\n');
    const bl = String(b).split('\n');
    const out = [];
    const n = Math.max(al.length, bl.length);
    for (let i = 0; i < n; i++) {
        if (al[i] !== bl[i]) {
            if (al[i] !== undefined) out.push(`- ${i + 1}: ${al[i]}`);
            if (bl[i] !== undefined) out.push(`+ ${i + 1}: ${bl[i]}`);
        }
    }
    return out;
}

const [, , pa, pb] = process.argv;
if (!pa || !pb) {
    console.error('usage: node diff-captures.mjs <queued.json> <native.json>');
    process.exit(2);
}

const a = load(pa);
const b = load(pb);
let diffs = 0;

if (Array.isArray(a.prompt) || Array.isArray(b.prompt)) {
    const ap = Array.isArray(a.prompt) ? a.prompt : [];
    const bp = Array.isArray(b.prompt) ? b.prompt : [];
    console.log(`Chat Completion: queued ${ap.length} messages, native ${bp.length} messages`);
    let firstShown = false;
    for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
        const x = ap[i] && { role: ap[i].role, name: ap[i].name, content: ap[i].content };
        const y = bp[i] && { role: bp[i].role, name: bp[i].name, content: bp[i].content };
        if (norm(x) !== norm(y)) {
            diffs++;
            if (!firstShown) {
                console.log(`first differing message index: ${i}`);
                firstShown = true;
            }
            console.log(`--- message ${i} ---`);
            for (const l of lineDiff(norm(x), norm(y))) console.log(l);
        }
    }
    const ccKeys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => k !== 'prompt').sort();
    const ccRows = ccKeys.filter((k) => norm(a[k]) !== norm(b[k]));
    console.log('\nBody keys that differ (expect none; dry-run capture and native send use the same live settings):');
    if (ccRows.length === 0) console.log('  (none)');
    for (const k of ccRows) {
        console.log(`  ${k}: queued=${inspect(a[k])} native=${inspect(b[k])}`);
        diffs++;
    }
} else {
    const sa = typeof a.prompt === 'string' ? a.prompt : '';
    const sb = typeof b.prompt === 'string' ? b.prompt : '';
    console.log(`Text Completion: queued ${sa.length} chars, native ${sb.length} chars`);
    if (sa !== sb) {
        diffs++;
        for (const l of lineDiff(sa, sb)) console.log(l);
    }
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => k !== 'prompt').sort();
    const rows = keys.filter((k) => norm(a[k]) !== norm(b[k]));
    console.log('\nBody keys that differ (expect `stream` only):');
    if (rows.length === 0) console.log('  (none)');
    for (const k of rows) {
        console.log(`  ${k}: queued=${inspect(a[k])} native=${inspect(b[k])}`);
        diffs++;
    }
}

console.log(diffs === 0 ? 'STRICT DIFF: none' : `STRICT DIFF: ${diffs} differences`);
process.exit(diffs === 0 ? 0 : 1);
