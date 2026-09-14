/**
 * Two-account RLS check against a deployed Supabase project.
 *
 * The PGlite suite in scripts/test-database.mjs runs one connection against a
 * local shim, so it cannot prove what two concurrent member sessions can read
 * from each other on a real project. This does that, using only public
 * credentials: two accounts sign up or sign in through the normal auth
 * endpoint, each writes its own private rows through its own session, and each
 * then tries to read the other's.
 *
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/rls-two-account-test.mjs
 *
 * A denied SELECT under RLS is silent: PostgREST returns 200 with an empty
 * array, not 403. That is the reason a leak here would never show up as an
 * error in application logs, and the reason every expectation below is written
 * as a row count rather than a status code.
 *
 * This script never prints the contents of any row it manages to read. A leak
 * is reported as a table name and a count.
 *
 * Two limits, both reported in the output rather than hidden:
 *
 * 1. account, behavior and geo are not in PostgREST's exposed schema list, so a
 *    request for them returns 406 and never reaches RLS. That is a real
 *    protection, but it is not evidence the policy works, and members still hold
 *    USAGE and SELECT on those tables at the SQL level. Those three policies must
 *    be checked by evaluating them under a member's JWT claims, which is what
 *    docs/rls-two-account-report.md records.
 * 2. read_answer_sources 'shared-detail' and trait_repair open up only via
 *    has_verified_outing_with. Nothing can currently write
 *    outing_presence_confirmations, so that gate can never be true, and the
 *    denial here would also pass if the gate logic were wrong. The negative case
 *    is proven; the positive case is not yet reachable.
 *
 * Cleanup: the two accounts persist so reruns are idempotent. Removing them needs
 * the trait sync triggers disabled first, because behavior.sync_from_traits
 * re-inserts into behavior.matrix on DELETE and trips the profiles foreign key.
 * See docs/rls-two-account-report.md for the exact statements.
 */

const URL_BASE = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!URL_BASE || !ANON) {
  console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY (both are public values).');
  process.exit(2);
}

// Fixed accounts so the run is idempotent and cleanup is unambiguous.
const ACCOUNTS = [
  { label: 'A', email: 'rls-probe-a@soultribe-rls.example.com', password: 'Pr0be-A-9f3k2Lq!x' },
  { label: 'B', email: 'rls-probe-b@soultribe-rls.example.com', password: 'Pr0be-B-7x8m4Zt!q' },
];

const results = [];
let failures = 0;

function record(name, expectation, actual, ok, note) {
  results.push({ name, expectation, actual, ok, note });
  if (!ok) failures += 1;
}

async function auth(path, body, token) {
  const res = await fetch(`${URL_BASE}/auth/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: ANON, 'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

/** Sign up, or sign in when the account already exists from an earlier run. */
async function session(account) {
  const up = await auth('signup', { email: account.email, password: account.password });
  if (up.status === 200 && up.json.access_token) {
    return { token: up.json.access_token, id: up.json.user.id, created: true };
  }
  const inn = await auth('token?grant_type=password', { email: account.email, password: account.password });
  if (inn.status !== 200 || !inn.json.access_token) {
    throw new Error(`Could not obtain a session for ${account.label}: ${inn.status} ${JSON.stringify(inn.json)}`);
  }
  return { token: inn.json.access_token, id: inn.json.user.id, created: false };
}

function rest(token) {
  const headers = { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  return {
    async select(table, query, schema) {
      const res = await fetch(`${URL_BASE}/rest/v1/${table}?${query}`, {
        headers: { ...headers, ...(schema ? { 'Accept-Profile': schema } : {}) },
      });
      const body = await res.json().catch(() => null);
      return { status: res.status, rows: Array.isArray(body) ? body : [], body };
    },
    async write(method, table, query, payload, schema) {
      const res = await fetch(`${URL_BASE}/rest/v1/${table}${query ? `?${query}` : ''}`, {
        method,
        headers: {
          ...headers, Prefer: 'return=representation',
          ...(schema ? { 'Content-Profile': schema } : {}),
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      const body = await res.json().catch(() => null);
      return { status: res.status, rows: Array.isArray(body) ? body : [], body };
    },
    async rpc(fn, args) {
      const res = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
        method: 'POST', headers, body: JSON.stringify(args ?? {}),
      });
      const body = await res.json().catch(() => null);
      return { status: res.status, rows: Array.isArray(body) ? body : [], body };
    },
  };
}

/**
 * The profile row must exist first: every private table carries a foreign key to
 * it, and upsert_live_presence fails without it. handle is unique, 3 to 20 chars
 * of [a-z0-9_], and birth_year must put the member over 18.
 */
const PROFILE_SEED = (id, label) => ({
  id, handle: `rls_probe_${label.toLowerCase()}`, display_name: `RLS Probe ${label}`,
  home_area: 'Bishan', birth_year: 1994, status: 'active', bio: 'Temporary RLS probe account.',
});

/** Owner-writable tables, seeded by each member through their own session. */
const OWNED_SEED = (id) => [
  ['profile_answers', { user_id: id, onboarding: { probe: true, secret: 'owner-only-answer' } }],
  ['trait_intent', { user_id: id, intents: ['friendship'], answered: 5 }],
  ['trait_personality', { user_id: id, extraversion: 0.5, answered: 8 }],
  ['trait_emotional', { user_id: id, er_opening_pace: 0.5, answered: 6 }],
  ['trait_communication', { user_id: id, mediums: ['text'], conv_styles: ['deep'], answered: 10 }],
  ['trait_social_rhythm', { user_id: id, availability: ['sat_midday'], answered: 6 }],
  ['trait_experience', { user_id: id, group_size_pref: 0.5, answered: 4 }],
  ['trait_lifestyle', { user_id: id, answered: 5 }],
  ['trait_geography', { user_id: id, home_area: 'Bishan', country: 'Singapore', radius_km: 10, answered: 2 }],
  ['user_interests', { user_id: id, node_id: 1, affinity: 'love' }],
  ['user_values', { user_id: id, value_key: 'ProbePrivateValue', stance: 0.8, importance: 0.9, visibility: 'private' }],
  ['recommendation_preferences', { user_id: id, use_reflections: true }],
];

/** Every surface one member must not be able to read from another. */
const OWNER_ONLY = [
  ['profile_answers', 'user_id', null],
  ['trait_intent', 'user_id', null],
  ['trait_personality', 'user_id', null],
  ['trait_emotional', 'user_id', null],
  ['trait_communication', 'user_id', null],
  ['trait_social_rhythm', 'user_id', null],
  ['trait_experience', 'user_id', null],
  ['trait_lifestyle', 'user_id', null],
  ['trait_geography', 'user_id', null],
  ['user_interests', 'user_id', null],
  ['recommendation_preferences', 'user_id', null],
  ['details', 'user_id', 'account'],
  ['matrix', 'user_id', 'behavior'],
  ['live_presence', 'user_id', 'geo'],
];

async function main() {
  console.log(`Project: ${URL_BASE}\n`);

  const a = await session(ACCOUNTS[0]);
  const b = await session(ACCOUNTS[1]);
  console.log(`A ${a.id} (${a.created ? 'created' : 'existing'})`);
  console.log(`B ${b.id} (${b.created ? 'created' : 'existing'})\n`);
  if (a.id === b.id) throw new Error('Both sessions resolved to the same member.');

  const A = rest(a.token);
  const B = rest(b.token);

  // Each member establishes their own profile and private rows, through their own
  // session, so nothing here depends on a service key.
  for (const [label, client, id] of [['A', A, a.id], ['B', B, b.id]]) {
    const prof = await client.write('POST', 'profiles', '', PROFILE_SEED(id, label));
    if (prof.status >= 400 && prof.status !== 409) {
      console.log(`  seed ${label} profiles -> ${prof.status} ${JSON.stringify(prof.body).slice(0, 200)}`);
    }
    for (const [table, payload] of OWNED_SEED(id)) {
      const res = await client.write('POST', table, '', payload);
      if (res.status >= 400 && res.status !== 409) {
        console.log(`  seed ${label} ${table} -> ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
      }
    }
    // Raw coordinates, written the only way a member is allowed to write them.
    const pres = await client.rpc('upsert_live_presence', {
      p_longitude: label === 'A' ? 103.8198 : 103.8300,
      p_latitude: label === 'A' ? 1.3521 : 1.3600, p_is_online: true,
    });
    if (pres.status >= 400) console.log(`  seed ${label} presence -> ${pres.status} ${JSON.stringify(pres.body).slice(0, 160)}`);
  }

  // A session must see itself. If this fails the whole run is meaningless, because
  // every denial below would be indistinguishable from a broken client.
  for (const [label, client, expected] of [['A', A, a.id], ['B', B, b.id]]) {
    const own = await client.select('profiles', `id=eq.${expected}&select=id`);
    record(`${label} can read its own profile row`, '1 row', `${own.rows.length} rows`, own.rows.length === 1, 'control');
    const ownAnswers = await client.select('profile_answers', `user_id=eq.${expected}&select=user_id`);
    record(`${label} can read its own profile_answers`, '1 row', `${ownAnswers.rows.length} rows`,
      ownAnswers.rows.length === 1, 'control');
  }

  // Confirm the seeds landed, so a later denial is not a vacuous pass.
  const seeded = {};
  for (const [table, key, schema] of OWNER_ONLY) {
    const own = await A.select(table, `${key}=eq.${a.id}&select=${key}`, schema);
    seeded[table] = own.rows.length;
  }
  console.log('Rows A can see of its own:', JSON.stringify(seeded), '\n');

  // The core check: B reads A's private rows.
  //
  // A 406 means PostgREST does not expose that schema at all, so the request never
  // reaches RLS. That is a real protection but it is a different one, and calling it
  // an RLS pass would be false. Those tables are marked and re-checked at the policy
  // level separately.
  for (const [table, key, schema] of OWNER_ONLY) {
    const asB = await B.select(table, `${key}=eq.${a.id}&select=${key}`, schema);
    const label = `${schema ? `${schema}.` : ''}${table}`;
    const note = asB.status === 406
      ? 'NOT VIA RLS: schema not exposed by PostgREST, policy checked separately'
      : seeded[table] === 0 ? 'VACUOUS: A has no row here, denial proves nothing' : `A holds ${seeded[table]}`;
    record(`B cannot read A's ${label}`, '0 rows', `${asB.rows.length} rows (status ${asB.status})`,
      asB.rows.length === 0, note);
  }

  // Real members' protected rows are the asset that matters most.
  const sharedDetail = await B.select('read_answer_sources', 'access=eq.shared-detail&select=user_id');
  record('B cannot read any shared-detail read_answer_sources', '0 rows',
    `${sharedDetail.rows.length} rows`, sharedDetail.rows.length === 0,
    'production holds 5 shared-detail rows belonging to real members');

  const publicSources = await B.select('read_answer_sources', 'access=eq.public&select=user_id');
  record('B may read public read_answer_sources (by design)', '>0 rows',
    `${publicSources.rows.length} rows`, publicSources.rows.length > 0, 'production holds 48 public rows');

  const repair = await B.select('trait_repair', 'select=user_id');
  record('B cannot read trait_repair without a verified outing', '0 rows',
    `${repair.rows.length} rows`, repair.rows.length === 0, 'production holds 1 row');

  // B holds a private value of its own, which it is entitled to read. Only rows
  // belonging to somebody else count as a leak.
  const privateValues = await B.select('user_values', 'visibility=neq.public&select=user_id');
  const foreignValues = privateValues.rows.filter((row) => row.user_id !== b.id).length;
  record('B cannot read other members\' private user_values', '0 foreign rows',
    `${foreignValues} foreign of ${privateValues.rows.length}`, foreignValues === 0,
    'production holds 38 private rows across real members');

  const events = await B.select('interaction_events', 'select=actor_id&limit=200');
  const foreignEvents = events.rows.filter((row) => row.actor_id && row.actor_id !== b.id).length;
  record('B cannot read other members\' interaction_events', '0 foreign rows',
    `${foreignEvents} foreign of ${events.rows.length}`, foreignEvents === 0, 'production holds 5154 rows');

  const allPresence = await B.select('live_presence', 'select=user_id,longitude,latitude', 'geo');
  const foreignPresence = allPresence.rows.filter((row) => row.user_id !== b.id).length;
  record('B cannot enumerate anyone else\'s coordinates', '0 foreign rows',
    `${foreignPresence} foreign of ${allPresence.rows.length}`, foreignPresence === 0, 'both probes wrote a point');

  // The matching path must hand back ids and never coordinates.
  const pool = await B.rpc('filter_local_online_ids', { p_radius_meters: 20000 });
  const leaksCoords = pool.rows.some((row) => 'longitude' in row || 'latitude' in row);
  record('filter_local_online_ids returns ids only', 'no coordinate fields',
    leaksCoords ? 'coordinates present' : `${pool.rows.length} id rows`, !leaksCoords,
    'A is online within range, so this should be a non-empty id list');
  record('filter_local_online_ids does find the other online member', '>=1 row',
    `${pool.rows.length} rows`, pool.rows.length >= 1, 'proves the id path works while coordinates stay hidden');

  // Writes are covered by the same ALL policies, so try to tamper.
  const tamper = await B.write('PATCH', 'trait_personality', `user_id=eq.${a.id}`, { extraversion: 0.99 });
  record('B cannot modify A\'s trait_personality', '0 rows changed',
    `${tamper.rows.length} rows (status ${tamper.status})`, tamper.rows.length === 0, '');

  const destroy = await B.write('DELETE', 'profile_answers', `user_id=eq.${a.id}`);
  record('B cannot delete A\'s profile_answers', '0 rows deleted',
    `${destroy.rows.length} rows (status ${destroy.status})`, destroy.rows.length === 0, '');

  const hijack = await B.write('PATCH', 'profiles', `id=eq.${a.id}`, { bio: 'tampered by B' });
  record('B cannot edit A\'s profile', '0 rows changed',
    `${hijack.rows.length} rows (status ${hijack.status})`, hijack.rows.length === 0, '');

  // Anonymous callers, holding only the key shipped in the browser bundle.
  const anonHeaders = { apikey: ANON, 'Content-Type': 'application/json' };
  for (const [table, schema] of [['profile_answers', null], ['trait_intent', null],
    ['read_answer_sources', null], ['details', 'account'], ['matrix', 'behavior'], ['live_presence', 'geo']]) {
    const res = await fetch(`${URL_BASE}/rest/v1/${table}?select=user_id`, {
      headers: { ...anonHeaders, ...(schema ? { 'Accept-Profile': schema } : {}) },
    });
    const body = await res.json().catch(() => null);
    const rows = Array.isArray(body) ? body : [];
    record(`anon cannot read ${schema ? `${schema}.` : ''}${table}`, '0 rows',
      `${rows.length} rows (status ${res.status})`, rows.length === 0, 'anon key is public in the bundle');
  }

  // profiles is intentionally cross-readable; confirm what that exposes.
  const otherProfile = await B.select('profiles', `id=eq.${a.id}&select=*`);
  record('B may read A\'s profile row (by design)', '1 row',
    `${otherProfile.rows.length} rows`, otherProfile.rows.length === 1, '');
  const exposed = Object.keys(otherProfile.rows[0] ?? {});
  const forbidden = exposed.filter((col) => /phone|email|password|token/i.test(col));
  record('a cross-read profile carries no phone or contact column', 'none',
    forbidden.length ? forbidden.join(',') : 'none', forbidden.length === 0, `${exposed.length} columns exposed`);

  // Report.
  console.log(`${'PASS/FAIL'.padEnd(6)} ${'CHECK'.padEnd(62)} EXPECTED -> ACTUAL`);
  for (const r of results) {
    console.log(`${(r.ok ? 'pass' : 'FAIL').padEnd(6)} ${r.name.padEnd(62)} ${r.expectation} -> ${r.actual}`
      + (r.note ? `   [${r.note}]` : ''));
  }
  const vacuousCount = results.filter((r) => r.note?.startsWith('VACUOUS')).length;
  console.log(`\n${results.length - failures}/${results.length} passed, ${failures} failed`
    + (vacuousCount ? `, ${vacuousCount} vacuous (no data present to protect)` : ''));
  process.exit(failures ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(2); });
