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

1. Load the caller’s live point (online, with coordinates, `updated_at` within 15 minutes).
2. Keep other **currently present** members within the radius (haversine; PostGIS `ST_DWithin` when the extension is available in hosted Supabase). Currently present means `is_online` **and** a live write in the last 15 minutes. There is no heartbeat; expiry is evaluated on read.
3. Drop bilateral blocks.
4. Return **up to 200 user IDs**, never lat/lng.

If that pool is under 200, `filter_local_area_ids()` fills from other **active** profiles whose `home_area` matches the caller’s, still IDs only, still skipping blocks, still capped so the combined pool is 200. Matching then scores that combined set.

`POST /api/matches` calls these RPCs with the member JWT **before** loading trait rows. A missing live point is not a global 150k scan: the spatial RPC returns empty and the area RPC uses the saved neighbourhood label. Do not write home-area centroids into `geo.live_presence`.

## Rule 2 — no disk writes for live pings

Use `broadcastLiveOutingAlert` / `subscribeLiveOutingAlerts` (Realtime broadcast). Do not insert ephemeral “live ping” rows. Durable outing notices may still use `outing_notifications`. Messages starting with `live ping:` are rejected.

Do not add `geo` tables to `supabase_realtime`.

## Rule 3 — protect the gateways

RLS on all three box tables is `user_id = auth.uid()` only. Matching uses the RPC so the client never queries another member’s `geo.live_presence` row.

Clients update their own point with `upsert_live_presence` / `upsertLivePresence`.
