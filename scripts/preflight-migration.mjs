/**
 * Gate for applying migrations to a live database.
 *
 * The failure this prevents already happened: four commits sat unpushed while their
 * migrations were applied to production, so the database was ahead of the committed
 * code. Anyone reading the repo saw a schema that did not exist yet, and anyone
 * reading the database saw objects no commit explained. V1 drifted the same way from
 * the other side, with a schema applied outside the ledger.
 *
 * The rule this encodes: a migration does not run against a live database until the
 * commit containing it is pushed and CI is green for that exact commit.
 *
 *   node scripts/preflight-migration.mjs
 *
 * Exits non-zero with the specific reason when it is not safe to apply. This is a
 * local gate, not a CI step: CI cannot know you are about to run a migration.
 */

import { execFileSync } from 'node:child_process';

const BRANCH = 'main';

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

// Read from the remote rather than a constant, so a moved repository cannot leave this
// gate quietly reporting on somewhere else.
const REPO = (() => {
  const url = git('remote', 'get-url', 'origin');
  const match = /github\.com[:/](.+?)(?:\.git)?$/.exec(url);
  if (!match) {
    console.error(`Cannot read an owner/name from origin (${url}), so CI status cannot be checked.`);
    process.exit(1);
  }
  return match[1];
})();

function gh(...args) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` } }).trim();
  } catch (err) {
    return { error: (err.stderr || err.message || '').toString().trim() };
  }
}

const failures = [];
const notes = [];

const head = git('rev-parse', 'HEAD');
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
console.log(`HEAD    ${head}`);
console.log(`branch  ${branch}\n`);

// 1. The migration must be committed. Applying a file that only exists on disk is the
//    drift this gate exists to stop.
const dirtyMigrations = git('status', '--porcelain', '--', 'supabase/migrations');
if (dirtyMigrations) {
  failures.push('Uncommitted changes under supabase/migrations. Commit the migration first:\n'
    + dirtyMigrations.split('\n').map((line) => `      ${line}`).join('\n'));
}

const dirtyTree = git('status', '--porcelain');
if (dirtyTree && !dirtyMigrations) {
  notes.push(`Working tree has ${dirtyTree.split('\n').length} uncommitted file(s) outside supabase/migrations.`);
}

// 2. The commit must be on the remote, so the schema can be explained by something
//    another person can actually read.
const remoteHead = gh('api', `repos/${REPO}/commits/${BRANCH}`, '--jq', '.sha');
if (typeof remoteHead === 'object') {
  failures.push(`Could not read ${BRANCH} on the remote, so "is it pushed" is unknown: ${remoteHead.error.split('\n')[0]}`);
} else if (remoteHead !== head) {
  const ahead = git('rev-list', '--count', `${remoteHead}..${head}`);
  failures.push(Number(ahead) > 0
    ? `HEAD is ${ahead} commit(s) ahead of origin/${BRANCH}. Push before applying:\n      git push origin ${BRANCH}`
    : `HEAD does not match origin/${BRANCH} (${remoteHead.slice(0, 7)}). Reconcile before applying.`);
}

// 3. CI must have passed for this exact commit. A green run on an earlier commit says
//    nothing about the migration being added now.
const runsRaw = gh('api', `repos/${REPO}/actions/runs?head_sha=${head}&per_page=20`,
  '--jq', '[.workflow_runs[] | {name,status,conclusion,id}]');
if (typeof runsRaw === 'object') {
  failures.push(`Could not read CI status for ${head.slice(0, 7)}: ${runsRaw.error.split('\n')[0]}`);
} else {
  const runs = JSON.parse(runsRaw || '[]');
  const verify = runs.filter((run) => run.name === 'Verify MVP');
  if (!verify.length) {
    failures.push(`No "Verify MVP" run exists for ${head.slice(0, 7)}, so CI has not judged this commit.\n`
      + `      Automatic triggers are not firing on this repo, so dispatch it:\n`
      + `      gh workflow run verify.yml --ref ${BRANCH} && gh run watch $(gh run list -w verify.yml -L1 --json databaseId --jq '.[0].databaseId')`);
  } else if (verify.some((run) => run.status !== 'completed')) {
    failures.push(`CI for ${head.slice(0, 7)} is still running. Wait for it rather than applying now.`);
  } else if (!verify.every((run) => run.conclusion === 'success')) {
    const bad = verify.filter((run) => run.conclusion !== 'success')
      .map((run) => `${run.conclusion} (run ${run.id})`).join(', ');
    failures.push(`CI for ${head.slice(0, 7)} did not pass: ${bad}`);
  } else {
    notes.push(`CI green for ${head.slice(0, 7)} (run ${verify[0].id}).`);
  }
}

for (const note of notes) console.log(`note: ${note}`);

if (failures.length) {
  console.error('\nDo not apply migrations yet:\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error('\nA database ahead of committed code cannot be explained, reviewed or rebuilt.');
  process.exit(1);
}

console.log('\nSafe to apply: the migration is committed, pushed, and CI is green for this commit.');
