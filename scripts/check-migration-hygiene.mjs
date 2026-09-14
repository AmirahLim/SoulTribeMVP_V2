/**
 * Fails when two migrations share a version prefix.
 *
 * Supabase keys the migration ledger on the numeric prefix, not the filename. Two
 * files sharing a prefix means the first one applied records that version as done
 * and the second is then treated as already applied and silently skipped. Nothing
 * errors, the schema is simply missing whatever the skipped file contained, and it
 * surfaces much later as an unexplained absence. V1 shipped that pair.
 *
 * A filename whose prefix cannot be read is the same failure with a different
 * cause: it has no version to compare, so it cannot be checked at all.
 */

import { readdirSync } from 'node:fs';

const DIR = new URL('../supabase/migrations/', import.meta.url);
const NAME = /^(\d{14})_[a-z0-9_]+\.sql$/;

const files = readdirSync(DIR).filter((name) => name.endsWith('.sql')).sort();
const byVersion = new Map();
const malformed = [];

for (const file of files) {
  const match = NAME.exec(file);
  if (!match) { malformed.push(file); continue; }
  const existing = byVersion.get(match[1]) ?? [];
  byVersion.set(match[1], [...existing, file]);
}

const duplicates = [...byVersion].filter(([, group]) => group.length > 1);
const problems = [];

for (const [version, group] of duplicates) {
  problems.push(`version ${version} is claimed by ${group.length} files, so all but one will be skipped:\n`
    + group.map((file) => `    ${file}`).join('\n'));
}
for (const file of malformed) {
  problems.push(`${file} does not match <14-digit timestamp>_<lower_snake_case>.sql, so its version cannot be read`);
}

if (problems.length) {
  console.error(`Migration hygiene failed in supabase/migrations (${files.length} files):\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\nRename the later file to a unique timestamp. Do not edit an already-applied migration.');
  process.exit(1);
}

console.log(`Migration hygiene passed: ${files.length} files, ${byVersion.size} unique versions.`);
