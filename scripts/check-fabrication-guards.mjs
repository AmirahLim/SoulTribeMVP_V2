/**
 * Anti-fabrication check. Two behaviours, same scoped paths:
 *
 *   Hard ban  — @ts-ignore and @ts-expect-error. Currently zero, so any hit fails.
 *   Ratchet   — as any / : any, || 'literal', || 80. Fails only if a count rises.
 *
 * The ratchet never rewrites its baseline. A legitimate reduction is printed as
 * something a person can lower by hand; doing it automatically would let a bad
 * commit that happens to delete an unrelated occurrence hide a new one.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const BASELINE_PATH = join(ROOT, 'scripts', 'fabrication-baseline.json');

const SCOPE = [
  'packages/core',
  'apps/web/app/api',
  'apps/web/lib/matching.ts',
  'apps/web/lib/profileAdapter.ts',
  'apps/web/lib/profileRowAdapter.ts',
];

const SKIP_DIR = /(^|\/)(__tests__|node_modules|\.next)(\/|$)/;
const CODE_FILE = /\.(ts|tsx)$/;

const PATTERNS = {
  any: {
    // as any and : any — both discard the type that would have caught a missing field.
    regex: /\bas\s+any\b|:\s*any\b/g,
    why: 'as any / : any discards the type that would have caught a missing field',
  },
  stringFallback: {
    // || 'Tiong Bahru' / || 'Singapore' — an invented value a member cannot tell from an answer.
    regex: /\|\|\s*(['"`])/g,
    why: "|| 'literal' substitutes an invented value a member cannot tell from an answer",
  },
  numberFallback: {
    // || 80 — a numeric default pretending to be a measured trait.
    regex: /\|\|\s*-?\d+(?:\.\d+)?\b/g,
    why: '|| <number> pretends a default is a measured trait',
  },
};

function walk(target) {
  const abs = join(ROOT, target);
  let stat;
  try { stat = statSync(abs); } catch { return []; }
  if (stat.isFile()) return CODE_FILE.test(abs) ? [abs] : [];
  return readdirSync(abs).flatMap((entry) => {
    const next = join(abs, entry);
    if (SKIP_DIR.test(next)) return [];
    return statSync(next).isDirectory() ? walk(relative(ROOT, next)) : CODE_FILE.test(next) ? [next] : [];
  });
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, lead) => lead + ' '.repeat(match.length - lead.length));
}

const files = [];
for (const target of SCOPE) {
  const found = walk(target);
  if (!found.length) {
    console.error(`Anti-fabrication check has no files under ${target}. Coverage silently dropped.`);
    process.exit(1);
  }
  files.push(...found);
}

const banned = [];
const counts = { any: 0, stringFallback: 0, numberFallback: 0 };

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file);
  for (const kind of ['@ts-ignore', '@ts-expect-error']) {
    const hits = source.split(kind).length - 1;
    if (hits) banned.push(`${rel}: ${hits} ${kind}`);
  }
  const code = stripComments(source);
  for (const [name, { regex }] of Object.entries(PATTERNS)) {
    counts[name] += (code.match(regex) ?? []).length;
  }
}

if (banned.length) {
  console.error('Anti-fabrication hard ban failed. @ts-ignore / @ts-expect-error are at a zero baseline:\n');
  for (const line of banned) console.error(`  - ${line}`);
  process.exit(1);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
} catch {
  console.error(`No baseline at ${relative(ROOT, BASELINE_PATH)}.`);
  process.exit(1);
}

const regressions = [];
const reductions = [];
for (const name of Object.keys(PATTERNS)) {
  const allowed = baseline[name];
  if (typeof allowed !== 'number') {
    regressions.push(`${name}: baseline missing`);
    continue;
  }
  if (counts[name] > allowed) {
    regressions.push(`${name}: ${allowed} → ${counts[name]}  (${PATTERNS[name].why})`);
  } else if (counts[name] < allowed) {
    reductions.push(`${name}: ${allowed} → ${counts[name]}`);
  }
}

if (regressions.length) {
  console.error('Anti-fabrication ratchet failed. A count rose:\n');
  for (const line of regressions) console.error(`  - ${line}`);
  console.error('\nDo not raise the baseline to make this pass. Remove the new occurrence.');
  process.exit(1);
}

console.log(`Anti-fabrication check passed. any=${counts.any} stringFallback=${counts.stringFallback} numberFallback=${counts.numberFallback}`);
if (reductions.length) {
  console.log('\nCounts are below baseline. The baseline can be lowered by hand in scripts/fabrication-baseline.json:');
  for (const line of reductions) console.log(`  - ${line}`);
  console.log('This check will not lower it for you.');
}
