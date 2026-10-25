// Verifies every named re-export in st-imports.js exists as an export of the target ST module.
// Usage: node check-exports.mjs [root]  (root = directory that holds st-imports.js as served by ST)
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = 'E:/SillyTavern/public/scripts/extensions/third-party/qs-route-spike';
const root = resolve(process.argv[2] ?? defaultRoot);
const importsFile = existsSync(resolve(root, 'st-imports.js'))
    ? resolve(root, 'st-imports.js')
    : resolve(dirname(fileURLToPath(import.meta.url)), '..', 'st-imports.js');
const src = readFileSync(importsFile, 'utf8').replace(/\/\/.*$/gm, '');

const re = /export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let missing = 0;
let m;
while ((m = re.exec(src)) !== null) {
    const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    const target = resolve(root, m[2]);
    let text = '';
    try {
        text = readFileSync(target, 'utf8');
    } catch {
        for (const n of names) {
            console.log(`MISSING ${n} ${target} (file unreadable)`);
            missing++;
        }
        continue;
    }
    // Collect names inside every `export { ... }` block (without `from`), honoring `as` aliases.
    const blockNames = new Set();
    const blockRe = /export\s*\{([^}]*)\}(?!\s*from)/g;
    let b;
    while ((b = blockRe.exec(text)) !== null) {
        for (const part of b[1].split(',')) {
            const p = part.trim();
            if (!p) continue;
            const as = p.split(/\s+as\s+/);
            blockNames.add((as[1] ?? as[0]).trim());
        }
    }
    for (const n of names) {
        const declRe = new RegExp(`export\\s+(async\\s+)?(function\\*?|const|let|var|class)\\s+${escape(n)}\\b`);
        const ok = declRe.test(text) || blockNames.has(n);
        console.log(`${ok ? 'OK' : 'MISSING'} ${n} ${target}`);
        if (!ok) missing++;
    }
}
process.exit(missing ? 1 : 0);
