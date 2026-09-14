/**
 * Enforces the anti-fabrication rule that AGENTS.md states in prose, so it stops
 * depending on whoever is writing the prompt remembering to restate it.
 *
 * Four patterns, in the code paths where invented data would reach a member:
 *
 *   asAny            `as any` discards the type that would have caught a missing field.
 *   suppressedCheck  @ts-ignore, @ts-expect-error and eslint-disable silence the checker.
 *   nonNullAssertion `x!` asserts presence rather than handling absence.
 *   literalFallback  `|| 'literal'` substitutes an invented value for a missing one.
 *
 * The last is the one that matters most here. `home_area || 'Singapore'` puts a place
 * a member never entered on their profile, and `|| 'Conversational resonance'` writes
 * an explanation sentence nobody's answers support. That is the fabrication the product
 * rules forbid, not a style preference.
 *
 * Existing violations are recorded in fabrication-baseline.json rather than fixed
 * blindly, because several are load-bearing: removing `|| 'Member'` means deciding
 * what a nameless member should render as, which is a product decision, not a
 * mechanical edit. The check fails when a count rises or a new file appears, so new
 * fabrication cannot land while the recorded debt is burned down deliberately.
 *
 *   node scripts/check-fabrication-guards.mjs            verify
 *   node scripts/check-fabrication-guards.mjs --update   re-record the baseline
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const BASELINE = join(ROOT, 'scripts', 'fabrication-baseline.json');

/** Where invented data would reach a member: scoring, explanation text and the API. */
const SCOPE = [
  'packages/core',
  'apps/web/app/api',
  // Matching libs: the scorer, the pair-explanation cache, and the adapters that
  // turn a profile row into the vector matching reads. profileAdapter is where
  // `home_area || 'Singapore'` currently lives — the example AGENTS.md names.
  'apps/web/lib/matching.ts',
  'apps/web/lib/matchExplanationCache.ts',
  'apps/web/lib/matchListState.ts',
  'apps/web/lib/livePresence.ts',
  'apps/web/lib/onboardingSpatial.ts',
  'apps/web/lib/reflectionRanking.ts',
  'apps/web/lib/profileAdapter.ts',
  'apps/web/lib/profileRowAdapter.ts',
];

// Fixtures legitimately build partial objects with `as any`; asserting on a fixture
// cannot mislead a member.
const SKIP_DIR = /(^|\/)(__tests__|node_modules|\.next)(\/|$)/;
const CODE_FILE = /\.(ts|tsx)$/;

const RULES = {
  asAny: '`as any` — restore the type instead',
  suppressedCheck: 'suppressed type or lint check — fix the cause instead',
  nonNullAssertion: '`!` non-null assertion — handle the absent case instead',
  literalFallback: '`|| literal` fallback — an invented value, surface the absence instead',
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

/** Comments hold the suppression directives, so they are read before being removed. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, lead) => lead + ' '.repeat(match.length - lead.length));
}

/** A `!` inside a string is punctuation, so string bodies are blanked for that rule. */
function stripStrings(code) {
  return code.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1?/g, (match) => match[0].repeat(match.length));
}

function scan(file) {
  const source = readFileSync(file, 'utf8');
  const code = stripComments(source);
  const bare = stripStrings(code);
  const counts = {};
  const bump = (rule, n) => { if (n) counts[rule] = (counts[rule] ?? 0) + n; };

  bump('suppressedCheck', (source.match(/@ts-ignore|@ts-expect-error|eslint-disable/g) ?? []).length);
  bump('asAny', (code.match(/\bas\s+any\b/g) ?? []).length);
  bump('literalFallback', (code.match(/\|\|\s*(['"`]|-?\d)/g) ?? []).length);
  bump('nonNullAssertion', (bare.match(/[A-Za-z0-9_)\]]!(?!=)/g) ?? []).length);
  return counts;
}

const found = {};
for (const target of SCOPE) {
  const files = walk(target);
  if (!files.length) {
    console.error(`Anti-fabrication check has no files under ${target}. Coverage silently dropped.`);
    process.exit(1);
  }
  for (const file of files) {
    const counts = scan(file);
    if (Object.keys(counts).length) found[relative(ROOT, file)] = counts;
  }
}

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, `${JSON.stringify(found, null, 2)}\n`);
  const total = Object.values(found).reduce((sum, r) => sum + Object.values(r).reduce((a, b) => a + b, 0), 0);
  console.log(`Recorded ${total} existing violations across ${Object.keys(found).length} files.`);
  process.exit(0);
}

let baseline = {};
try { baseline = JSON.parse(readFileSync(BASELINE, 'utf8')); } catch {
  console.error(`No baseline at ${relative(ROOT, BASELINE)}. Create it with:\n`
    + '  npm run lint:fabrication -- --update');
  process.exit(1);
}

const regressions = [];
const improvements = [];

for (const [file, counts] of Object.entries(found)) {
  for (const [rule, count] of Object.entries(counts)) {
    const allowed = baseline[file]?.[rule] ?? 0;
    if (count > allowed) {
      regressions.push(`${file}: ${rule} went from ${allowed} to ${count}\n      ${RULES[rule]}`);
    } else if (count < allowed) {
      improvements.push(`${file}: ${rule} down from ${allowed} to ${count}`);
    }
  }
}
for (const [file, counts] of Object.entries(baseline)) {
  for (const [rule, allowed] of Object.entries(counts)) {
    const count = found[file]?.[rule] ?? 0;
    if (count < allowed && !improvements.some((line) => line.startsWith(`${file}: ${rule} `))) {
      improvements.push(`${file}: ${rule} down from ${allowed} to ${count}`);
    }
  }
}

const debt = Object.values(found).reduce((sum, r) => sum + Object.values(r).reduce((a, b) => a + b, 0), 0);

if (regressions.length) {
  console.error('Anti-fabrication check failed. New violations in scoring, explanation or API code:\n');
  for (const line of regressions) console.error(`  - ${line}`);
  console.error('\nThese paths decide what a member is told about themselves and other people.');
  console.error('An invented value here is indistinguishable from a real answer once rendered.');
  console.error('If a value can be absent, say so in the interface and handle it.');
  process.exit(1);
}

console.log(`Anti-fabrication check passed: no new violations (${debt} recorded, to burn down).`);
if (improvements.length) {
  console.log('\nImprovements not yet locked in. Run `npm run lint:fabrication -- --update` to ratchet:');
  for (const line of improvements) console.log(`  - ${line}`);
}
