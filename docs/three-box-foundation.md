# Three-box foundation

Scale matching without mixing identity, traits, and live location. Postgres schemas:

| Box | Schema / table | Contents | Change rate |
|---|---|---|---|
| 1 Account details | `account.details` | Username, avatar, phone | Rare |
| 2 Behavioral matrix | `behavior.matrix` | Integers 0–100 (`social_energy`, `spontaneity`, …) | Occasional |
| 3 Live geo | `geo.live_presence` | Coordinates + online flag | High |

`public.profiles` and `trait_*` remain the existing app tables. Triggers copy identity into Box 1 and 0–1 traits into Box 2. New location writes go only to Box 3.

## Rule 1 — spatial filter first

`filter_local_online_ids(radius_meters)` (authenticated RPC):

1. Load the caller’s live point (online, with coordinates).
2. Keep other **currently online** members within the radius (haversine; PostGIS `ST_DWithin` when the extension is available in hosted Supabase).
3. Drop bilateral blocks.
4. Return **up to 200 user IDs**, never lat/lng.

`POST /api/matches` calls this RPC with the member JWT **before** loading trait rows. If the caller has no live point, the pool is empty (no global 150k scan).

## Rule 2 — no disk writes for live pings

Use `broadcastLiveOutingAlert` / `subscribeLiveOutingAlerts` (Realtime broadcast). Do not insert ephemeral “live ping” rows. Durable outing notices may still use `outing_notifications`. Messages starting with `live ping:` are rejected.

Do not add `geo` tables to `supabase_realtime`.

## Rule 3 — protect the gateways

RLS on all three box tables is `user_id = auth.uid()` only. Matching uses the RPC so the client never queries another member’s `geo.live_presence` row.

Clients update their own point with `upsert_live_presence` / `upsertLivePresence`.
