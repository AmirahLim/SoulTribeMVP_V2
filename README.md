# Soul Tribe

Friendship-first discovery, intentional outings and private reflections. This is an existing MVP, not a starter template.

Read `AGENTS.md` and `docs/00-current-product-direction.md` for current product intent. Older numbered specs and `exports/` remain historical references.

## Stack and local development

Node.js 22, npm workspaces, Next.js 16 / React 19 / TypeScript / Tailwind 3, Supabase.

```sh
npm ci
npm run dev
```

Configure the existing app environment using `apps/web/.env.example` if available. The app requires `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Server matching requires `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`; never expose either through a public environment variable. Unsplash image search optionally uses `UNSPLASH_ACCESS_KEY`.

Matching filters currently-online members by distance (`filter_local_online_ids`) before scoring traits. See `docs/three-box-foundation.md`.

## Verification

```sh
npm run typecheck
npm test
npm run test:db
npm run build
```

`test:db` applies every committed migration to local PGlite with minimal Supabase auth/storage shims, then checks data ownership, account fields, invitation consent, capacity, chat/logistics access, reflection eligibility and transactional rollback. It is not a test of a deployed Supabase project or simultaneous network clients.

## Engineering foundations branch

See `docs/engineering-implementation.md` for implementation coverage, migration ordering, open policies and remaining release checks. Apply and test migrations in staging before deploying the client that calls `save_profile_bundle` and `create_pitch`. Do not deploy these client changes against the old schema.
