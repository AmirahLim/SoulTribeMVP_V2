# 03 — Data Model

Supabase / Postgres. Every table has RLS enabled. Migrations in `supabase/migrations/`.

Live scaling layout (account / behavior / geo isolation, spatial-first matching, broadcast-only live pings) is defined in `docs/three-box-foundation.md` and `20261009000000_three_box_foundation.sql`. Do not put live coordinates on `profiles` or expose another user's point through the Data API.

Design principle: **typed columns for anything the matching engine reads** (fast, indexable,
type-safe), **jsonb for open-ended extras**. Do not put the trait vector in one giant jsonb blob
— you will need to query and audit it.

---

## 1. Identity

```sql
create table profiles (
  id                uuid primary key references auth.users on delete cascade,
  handle            text unique not null check (handle ~ '^[a-z0-9_]{3,20}$'),
  display_name      text not null,
  avatar_url        text,
  bio               text check (char_length(bio) <= 280),
  home_area         text not null,              -- Singapore planning area code
  birth_year        int  not null check (birth_year between 1930 and extract(year from now())::int - 18),
  age_pref_min      int  default 21,
  age_pref_max      int  default 99,
  profile_version   int  not null default 1,    -- bumped on any trait change; invalidates caches
  confidence        numeric(4,3) not null default 0,
  tier              text not null default 'free' check (tier in ('free','host_plus')),
  status            text not null default 'active'
                    check (status in ('active','paused','under_review','banned')),
  created_at        timestamptz not null default now()
);
```

`tier` exists now purely so the 6-person cap has something to key off. `host_plus` is not
purchasable in v0.1.

---

## 2. Trait storage

One row per user per dimension. All trait values are `numeric(4,3)` in `[0,1]`, or arrays of
enum text for set-valued traits. `answered` counts how many questions in that dimension the user
has completed — this drives `confidence`.

```sql
create table trait_personality (
  user_id uuid primary key references profiles on delete cascade,
  openness numeric(4,3), conscientiousness numeric(4,3), extraversion numeric(4,3),
  agreeableness numeric(4,3), emotional_stability numeric(4,3),
  serious_playful numeric(4,3), intensity_easygoing numeric(4,3),
  assertive_accommodating numeric(4,3), novelty_seeking numeric(4,3),
  intellectual_curiosity numeric(4,3),
  answered int not null default 0, updated_at timestamptz not null default now()
);

create table trait_communication (
  user_id uuid primary key references profiles on delete cascade,
  -- behaviour / expectation pairs (see matching spec §3.2)
  contact_frequency_self numeric(4,3), contact_frequency_expect numeric(4,3),
  response_speed_self    numeric(4,3), response_speed_expect    numeric(4,3),
  initiation_self        numeric(4,3), initiation_expect        numeric(4,3),
  message_length numeric(4,3), direct_diplomatic numeric(4,3), high_context_literal numeric(4,3),
  mediums    text[] not null default '{}',  -- text|voice_note|call|in_person_first|memes
  conv_styles text[] not null default '{}', -- deep|debate|emotional|banter|gossip|random|activity
  answered int not null default 0, updated_at timestamptz not null default now()
);

create table trait_social_rhythm (
  user_id uuid primary key references profiles on delete cascade,
  availability     text[] not null default '{}',  -- 'mon_evening','sat_midday', … 28 slots
  fri_night boolean default false, sat_night boolean default false,
  planning_horizon numeric(4,3),   -- 0 same-day … 1 several weeks
  social_freq_self numeric(4,3), social_freq_expect numeric(4,3),
  preferred_duration numeric(4,3), -- 0 quick coffee … 1 whole day
  energy_peak numeric(4,3),        -- 0 morning … 1 late night
  answered int not null default 0, updated_at timestamptz not null default now()
);

create table trait_intent (
  user_id uuid primary key references profiles on delete cascade,
  intents text[] not null default '{}',   -- 15 tags, see brief
  depth   int not null default 2 check (depth between 0 and 4),
  -- 0 activity acquaintance, 1 casual, 2 regular, 3 close, 4 inner circle
  open_to_hosting boolean default false,
  answered int not null default 0, updated_at timestamptz not null default now()
);

create table trait_emotional (
  user_id uuid primary key references profiles on delete cascade,
  -- Emotional Rhythm
  er_opening_pace      numeric(4,3),
  er_cadence_need      numeric(4,3), er_cadence_expect numeric(4,3),
  er_reassurance_need  numeric(4,3), er_reassurance_offer numeric(4,3),
  er_recovery_time     numeric(4,3),
  er_conflict_approach numeric(4,3),   -- 0 avoid … 1 address directly
  -- static style
  expressiveness numeric(4,3), vulnerability_comfort numeric(4,3), affection numeric(4,3),
  advice_vs_listening_self numeric(4,3), advice_vs_listening_expect numeric(4,3),
  reliability_self numeric(4,3), reliability_expect numeric(4,3),
  boundary_clarity numeric(4,3),
  answered int not null default 0, updated_at timestamptz not null default now()
);

create table trait_lifestyle (
  user_id uuid primary key references profiles on delete cascade,
  budget_band int check (budget_band between 0 and 4),  -- free|<20|20-50|50-100|100+
  alcohol text check (alcohol in ('none','occasional','regular')),
  smoking text check (smoking in ('none','occasional','regular')),
  activity_level numeric(4,3), travel_frequency numeric(4,3), life_stage text,
  work_schedule text[], food_prefs text[], pets text[],
  accessibility_needs text[] default '{}',
  dealbreakers text[] default '{}',   -- 'smoking','alcohol_present', …
  answered int not null default 0, updated_at timestamptz not null default now()
);

create table trait_experience (
  user_id uuid primary key references profiles on delete cascade,
  settings text[] not null default '{}',      -- quiet|busy|outdoors|indoors|intimate|high_energy
  group_size_pref numeric(4,3),               -- 0 = 1:1 … 1 = large groups
  orientation text[] not null default '{}',   -- conversation_first|activity_first|either
  novelty numeric(4,3),
  answered int not null default 0, updated_at timestamptz not null default now()
);

create table trait_geography (
  user_id uuid primary key references profiles on delete cascade,
  home_area text not null,
  radius_minutes jsonb not null default
    '{"coffee":20,"dining":30,"active":45,"cultural":35,"nightlife":40,"creative":35}',
  answered int not null default 0, updated_at timestamptz not null default now()
);
```

### Values (row per value, because of per-value visibility)

```sql
create table user_values (
  user_id    uuid references profiles on delete cascade,
  value_key  text not null,              -- family|ambition|growth|creativity|…
  stance     numeric(4,3) not null,
  importance numeric(4,3) not null,      -- how much it matters that friends share it
  visibility text not null default 'matching_only'
             check (visibility in ('private','matching_only','public')),
  primary key (user_id, value_key)
);
```
`visibility = 'private'` rows are excluded from scoring **and** never leave the server.

### Interest graph

```sql
create extension if not exists ltree;

create table interest_nodes (
  id serial primary key,
  parent_id int references interest_nodes,
  name text not null,
  path ltree not null,                    -- 'art.contemporary.installation.teamlab'
  approved boolean not null default true  -- user-suggested nodes start false
);
create index on interest_nodes using gist (path);

create table user_interests (
  user_id  uuid references profiles on delete cascade,
  node_id  int references interest_nodes,
  affinity text not null check (affinity in ('love','regular','learning','curious')),
  primary key (user_id, node_id)
);
```

Seed the tree with ~250 nodes across 12 roots (art, music, food, fitness, outdoors, film & TV,
books & ideas, games, making & craft, tech & building, travel, community & causes). Users can
suggest new leaves; new leaves enter `approved = false` and are normalised by the cheaper model
in a nightly job before becoming matchable.

---

## 3. Matching artefacts

```sql
create table match_scores (
  user_a uuid references profiles on delete cascade,
  user_b uuid references profiles on delete cascade,
  resonance numeric(4,3) not null,
  logistics numeric(4,3) not null,
  rank_score numeric(5,4) not null,
  gated boolean not null default false,
  contributions jsonb not null,        -- per-dimension breakdown, for audit
  version_a int not null, version_b int not null,
  computed_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)              -- store each pair once, canonical order
);

create table match_explanations (
  user_a uuid, user_b uuid,
  click_text    text not null,
  friction_text text not null check (char_length(friction_text) > 0), -- friction is mandatory
  generated_by  text not null,          -- model id, or 'template_fallback'
  version_a int not null, version_b int not null,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b)
);

create table match_surfaced (            -- what we actually showed, and when
  id bigserial primary key,
  viewer_id uuid references profiles on delete cascade,
  shown_id  uuid references profiles on delete cascade,
  week_of   date not null,
  action    text check (action in ('none','saved','pitched_to','hidden')),
  shown_at  timestamptz not null default now(),
  unique (viewer_id, shown_id, week_of)
);
```

Recompute policy: on `profile_version` bump, invalidate that user's rows in both tables and
re-queue. Max 5 new people surfaced per viewer per week (`match_surfaced` enforces it).

---

## 4. Pitch Outings — host control and the cap

```sql
create table outings (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references profiles on delete cascade,
  title text not null check (char_length(title) between 4 and 80),
  pitch  text not null check (char_length(pitch) between 20 and 600),
  activity_category text not null
    check (activity_category in ('coffee','dining','active','cultural','nightlife','creative')),
  interest_node_id int references interest_nodes,
  area text not null,
  starts_at timestamptz not null,
  duration_minutes int not null,
  budget_band int not null check (budget_band between 0 and 4),
  orientation text not null check (orientation in ('conversation_first','activity_first','either')),
  setting text not null,
  max_participants int not null default 6,      -- includes host
  visibility text not null default 'invite_only'
    check (visibility in ('invite_only','requestable')),
  state text not null default 'draft'
    check (state in ('draft','open','confirmed','completed','cancelled')),
  created_at timestamptz not null default now()
);

create table outing_members (
  outing_id uuid references outings on delete cascade,
  user_id   uuid references profiles on delete cascade,
  role   text not null default 'guest' check (role in ('host','guest')),
  state  text not null default 'invited'
         check (state in ('invited','requested','accepted','declined','removed')),
  invited_at timestamptz default now(),
  responded_at timestamptz,
  primary key (outing_id, user_id)
);
```

### Cap enforcement — the database is the authority

```sql
create or replace function enforce_outing_cap() returns trigger as $$
declare
  cap int; taken int;
begin
  select o.max_participants into cap from outings o where o.id = new.outing_id;

  -- free-tier hosts are hard-capped at 6 regardless of what max_participants says
  if (select p.tier from outings o join profiles p on p.id = o.host_id
      where o.id = new.outing_id) = 'free' then
    cap := least(cap, 6);
  end if;

  select count(*) into taken from outing_members m
   where m.outing_id = new.outing_id
     and m.state in ('accepted','invited')      -- holds a seat while pending
     and m.user_id <> new.user_id;

  if taken + 1 > cap then
    raise exception 'OUTING_FULL: % of % seats taken', taken, cap
      using errcode = 'check_violation';
  end if;
  return new;
end $$ language plpgsql;

create trigger trg_outing_cap
  before insert or update of state on outing_members
  for each row when (new.state in ('invited','accepted'))
  execute function enforce_outing_cap();
```

Note: **invitations hold a seat.** A host who invites six people cannot invite a seventh while
those are pending — this is deliberate, it stops over-inviting and racing.

### Host control rules (enforce in RLS + API)

- Only `host_id` may insert `outing_members` rows in state `invited`.
- Only `host_id` may move a `requested` row to `accepted` or `declined`.
- A guest may only change *their own* row between `invited → accepted/declined`, or
  `accepted → declined`, or insert their own row as `requested` (and only when
  `visibility = 'requestable'`).
- Only the host may set `state = 'confirmed'` or `'cancelled'` on the outing.
- Only the host may set a member to `removed`. Removal is logged and the guest is notified
  neutrally, without a reason field exposed to them.

---

## 5. Artifacts and feedback

```sql
create table outing_records (              -- the persistent artifact
  outing_id uuid primary key references outings on delete cascade,
  headline  text,                          -- one line worth keeping
  photo_urls text[] default '{}',
  attended  uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table rhythm_checks (
  outing_id uuid references outings on delete cascade,
  author_id uuid references profiles on delete cascade,
  about_id  uuid references profiles on delete cascade,   -- null = about the outing itself
  would_meet_again int check (would_meet_again between 1 and 5),
  energy_read  text check (energy_read in ('quieter','as_expected','livelier')),
  pace_read    text check (pace_read in ('slower','as_expected','faster')),
  note text,
  created_at timestamptz not null default now(),
  primary key (outing_id, author_id, about_id)
);
```

Rhythm checks are **never shown to the person they are about.** They feed §10 of the matching
spec and nothing else. Make this explicit in the UI copy at the point of asking.

---

## 6. Safety

```sql
create table blocks (
  blocker_id uuid references profiles on delete cascade,
  blocked_id uuid references profiles on delete cascade,
  created_at timestamptz default now(),
  primary key (blocker_id, blocked_id)
);

create table reports (
  id bigserial primary key,
  reporter_id uuid references profiles,
  reported_id uuid references profiles,
  outing_id uuid references outings,
  category text not null,
  detail text,
  state text not null default 'open' check (state in ('open','reviewing','actioned','dismissed')),
  created_at timestamptz default now()
);
```

Blocks are **bidirectional in effect**: a block hides both directions everywhere, including in
outing candidate lists and in any group the other person is already in.

---

## 7. RLS summary

| Table | Read | Write |
|---|---|---|
| `profiles` | Self always; others only via a surfaced match or shared outing | Self only |
| `trait_*` | **Self only.** Never expose another user's raw traits to the client. | Self only |
| `user_values` | Self only | Self only |
| `match_scores` | **Nobody.** Server-side only. | Service role only |
| `match_explanations` | Either party in the pair | Service role only |
| `outings` | Host, members, and — if `requestable` — matched users in range | Host only |
| `outing_members` | Host and members | Per host-control rules above |
| `rhythm_checks` | **Author only.** Never the subject. | Author only |

The client never receives a compatibility number. The matching endpoint returns ordered people
plus explanation text — nothing else.

---

## 8. Shared types

`packages/core/domain/` exports Zod schemas that are the single source of truth for both the
Next.js app and the future Expo app. Generate Supabase types with the CLI, then wrap them —
do not let generated DB types leak into UI components.
