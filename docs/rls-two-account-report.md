# Two-account RLS verification against the deployed project

Run date: 2026-09-14. Project `hmmiqomkapoevnmdhkra` (`ap-southeast-1`, Singapore),
Postgres 17.6. This is the gate AGENTS.md names: "staging Supabase and real
concurrent-client checks remain a release gate".

Harness: `scripts/rls-two-account-test.mjs` (`npm run test:rls`). Two accounts sign
up through the public auth endpoint, each writes its own private rows through its
own session, then each tries to read the other's. The run uses only the publishable
key, so it needs no service credentials.

## Which project is production

Both deployments serve `hmmiqomkapoevnmdhkra`, confirmed by reading the project ref
out of the client bundle that every visitor already downloads:

| Deployment | Supabase project in bundle |
| --- | --- |
| `soultribemvpv1.vercel.app` | `hmmiqomkapoevnmdhkra` |
| `soul-tribe-mvp-v2-web.vercel.app` | `hmmiqomkapoevnmdhkra` |

The second project, `fwkocmhjyixrocsubyoq` (`ap-northeast-1`, Tokyo), serves no
deployment, holds one auth user, and has 43 migrations applied against
production's 11. Nothing points at it.

## Result

37 of 37 network checks passed, and 13 of 13 policy-level checks passed. No member
could read, modify or delete another member's private data by any route tried.

### Denied, with real data present to steal

Each of these had rows belonging to somebody else at the time of the read, so the
denial is substantive rather than an empty table returning nothing.

| Surface | Rows held by others | Read by the wrong member |
| --- | --- | --- |
| `profile_answers` | 1 (seeded) + 4 real | 0 |
| `trait_intent`, `trait_personality`, `trait_emotional`, `trait_communication`, `trait_social_rhythm`, `trait_experience`, `trait_lifestyle`, `trait_geography` | 1 seeded each, 11–12 real each | 0 each |
| `trait_repair` | 1 real | 0 |
| `read_answer_sources` where `access = 'shared-detail'` | 5 real | 0 |
| `user_values` where `visibility <> 'public'` | 38 real | 0 |
| `user_interests` | 1 seeded + 33 real | 0 |
| `recommendation_preferences` | 1 seeded | 0 |
| `interaction_events` | 5154 real | 0 |
| `account.details` (phone) | 1 seeded + 12 real | 0 |
| `behavior.matrix` | 1 seeded + 12 real | 0 |
| `geo.live_presence` (raw coordinates) | 1 seeded | 0 |

Controls that prove the harness was really reading: each member read its own
profile and its own `profile_answers` (1 row each), and both members read the 48
`access = 'public'` rows in `read_answer_sources`. A client that returned nothing
for everything would have failed these.

### Writes

Member B could not `PATCH` A's `trait_personality`, `DELETE` A's `profile_answers`,
or `PATCH` A's `profiles` row. All returned zero affected rows.

### Anonymous callers

Holding only the publishable key that ships in the browser bundle, an anonymous
caller read 0 rows from `profile_answers`, `trait_intent`, `read_answer_sources`,
`account.details`, `behavior.matrix` and `geo.live_presence`.

### Coordinates specifically

`filter_local_online_ids` returned one id and no coordinate fields while both
probes were online 1.2 km apart. That is the contract in AGENTS.md holding up:
matching receives user ids, never raw points.

## Two things the network test cannot prove, and how they were covered

**PostgREST does not expose `account`, `behavior` or `geo`.** Requests for those
schemas return 406 before RLS is consulted. Calling that an RLS pass would be
false. Members do still hold `USAGE` on those schemas and `SELECT` on
`geo.live_presence` at the SQL level, so if the exposed schema list ever grows, RLS
becomes the only barrier. Those policies were therefore evaluated directly under
member B's JWT claims (`set local request.jwt.claims`, `set local role
authenticated`), which is the same mechanism `auth.uid()` reads from in a real
request:

| Check under B's claims | Result |
| --- | --- |
| `auth.uid()` resolves to B | true |
| own `account.details` / `behavior.matrix` / `geo.live_presence` | 1 row each (control) |
| A's `account.details` / `behavior.matrix` / `geo.live_presence` | 0 each |
| every row of `account.details` (14 exist) | 1, its own |
| every row of `behavior.matrix` (14 exist) | 1, its own |
| every row of `geo.live_presence` (2 exist) | 1, its own |
| any `phone` not its own | 0 |

**The shared-detail gate's positive case is unreachable.** `read_answer_sources`
`'shared-detail'` and `trait_repair` open only when `has_verified_outing_with` is
true, which requires `outing_presence_confirmations` rows. That table has RLS on,
no policies, and no grants to `authenticated`, so no member can ever write one, and
the table is empty. The denial above is real, but it would also pass if the gate
logic were wrong. Worth a positive-path test once presence confirmation is
writable.

## Findings that need attention

**1. A member's profile could not be deleted. Fixed.** This was an erasure
problem, not a performance one. `behavior.sync_from_traits()` is attached to
`trait_personality` and `trait_experience` as `AFTER INSERT OR DELETE OR UPDATE`
and unconditionally upserts into `behavior.matrix`. Deleting a profile cascades to
the trait rows, the delete trigger fires, and the re-insert fails the
`matrix_user_id_fkey` foreign key because the profile is already gone:

```
ERROR: 23503: insert or update on table "matrix" violates foreign key constraint
  "matrix_user_id_fkey"
DETAIL: Key (user_id)=(...) is not present in table "profiles".
CONTEXT: PL/pgSQL function sync_from_traits() line 9
```

Cleanup for this run needed the triggers disabled to get around it.

`supabase/migrations/20261016000000_behavior_sync_survives_member_deletion.sql`
fixes it: the function now returns early when no profile row exists, and retires the
derived row rather than leaving nulls when the last source trait is removed. The
regression test in `scripts/test-database.mjs` reproduces the original
`matrix_user_id_fkey` failure without the migration and passes with it. Verified on
production afterwards by creating a member with both trait rows and deleting it with
both triggers live: the delete succeeded and left nothing in `profiles`,
`behavior.matrix`, `account.details`, `trait_personality` or `trait_experience`.

**2. Eleven tables have RLS enabled and zero policies.** `composed_read_cache`,
`match_explanations`, `onboarding_drafts`, `onboarding_funnel_events`,
`outing_presence_confirmations`, `peer_observations`, `peer_read_checks`,
`peer_signal_releases`, `profile_name_archive`, `read_phrase_history` and
`avatar_backfill`. None grant `SELECT` to `authenticated` or `anon`, so they deny
at the privilege layer, which is fail-safe. Two consequences worth separating:
`avatar_backfill` is service-role-only by design, but
`outing_presence_confirmations` being unwritable is what makes finding 2 above
unreachable, and that looks unintended.

**3. `public.spatial_ref_sys` has RLS disabled** and is readable by `anon`. It is
PostGIS's EPSG reference data and carries no member data. No action beyond knowing
why the advisor flags it.

**4. Production is behind the repo's migration ledger.** 46 migration files exist;
`supabase_migrations.schema_migrations` on production records 11, though 45 public
tables are present. Production schema has been applied partly outside the ledger,
so the ledger cannot be trusted to tell you what is deployed.

## What was created and removed

Two accounts, `rls-probe-a@soultribe-rls.example.com` and
`rls-probe-b@soultribe-rls.example.com`, with profiles, one row in each private
table, and one live presence point each. Both were `status = 'active'` with
`is_online = true`, so they were briefly discoverable by real members near Bishan.
Both are deleted. Verified afterwards: 0 probe rows in `auth.users`, `profiles`,
`profile_answers`, `trait_intent`, `user_values`, `account.details`,
`behavior.matrix`; `geo.live_presence` back to 0 rows; 12 real profiles and 14 real
auth users intact; both sync triggers re-enabled.

If a rerun needs cleaning up:

```sql
alter table public.trait_personality disable trigger behavior_sync_personality;
alter table public.trait_experience  disable trigger behavior_sync_experience;
delete from public.profiles where handle like 'rls_probe_%';
delete from auth.users where email like 'rls-probe-%';
alter table public.trait_personality enable trigger behavior_sync_personality;
alter table public.trait_experience  enable trigger behavior_sync_experience;
```

## Scope

Two concurrent sessions, not many. Storage object policies for the `avatars` bucket
are not covered here. Outing membership policies (`outing_messages`,
`outing_logistics`, `outing_members`) were not exercised with a real shared outing,
because no outing existed with two confirmed members; those tables were empty and
any denial would have been vacuous.
