# Engineering foundations — review notes

This branch addresses the five priorities from the repository assessment. It is a reviewable implementation, not confirmation of a production rollout.

## Changes

1. Security: restrict credential forwarding to the Unsplash download endpoint without redirects; preserve value visibility and account status; check bilateral blocks/reports for pair explanations; enforce membership consent and protected account fields in Postgres.
2. Profiles: remove sample answer defaults and silent legacy backfill; scope browser caches to accounts; save original answers and trait edits atomically through `save_profile_bundle`; keep full text in owner-only `profile_answers`; propagate errors, reload answers, and permit cleared deeper answers. MBTI and desired friend qualities no longer overwrite stored self-reported traits.
3. Outings: atomic `create_pitch` creates the host seat and invitations together; guests accept invitations, hosts approve requests; acceptance locks the outing row and checks capacity. Host type and capacity policy are separate from paid tier. Cancellation, withdrawal and removal retain history. Pending requests are visible and Past uses end time.
4. Real-world loop: accepted-member logistics and outing chat, block/report controls, private outing updates, attendance-validated reflections, opt-in bounded repeat-preference ranking and private continuation checks. Untouched reflection fields remain unanswered. Recording attendance completes the outing.
5. Presentation/discovery: public profile projection and authenticated Connection Notes avoid client-side access to private vectors and generic fallback perspectives. New profile/notes surfaces use warm light colors. Exact own answers are available in a private portrait section. Activity category reaches server ranking; real candidate filtering and viewer retrieval are corrected. Repository instructions and CI describe the current architecture.

## Database rollout

Apply all migrations in order to staging. New migrations are:

- `20260911000000_consent_and_private_context.sql`
- `20260912000000_atomic_profile_saving.sql`
- `20260913000000_outcomes_and_atomic_pitch.sql`
- `20261009000000_three_box_foundation.sql` (account / behavior / geo isolation, spatial-first match RPC, owner-only live presence)

The client requires these migrations. No live Supabase project was inspected or changed. Compare the actual live schema with committed history before applying them. Existing databases may have manual changes or dirty data that a clean migration run cannot reveal.

Old browser data is intentionally not automatically migrated: generated sample fields had uncertain provenance. Existing server-side historical traits and values need an explicit provenance audit; this branch does not claim to identify or repair every previously contaminated row. Raw deeper answers remain private rather than being published automatically.

## Working policies for review

Invitations do not reserve seats. Host policy defaults are six for individuals and thirty for communities, with optional maximum capacity. These defaults are implementation hypotheses. The composer allows explicit capacity; partner verification and waitlist automation are not implemented.

Reflections influence repeat-preference ranking only after the author opts in, with a maximum 0.03 boost (`repeat-preference-v1`). This is a configurable implementation hypothesis, not a scientifically validated formula. It never changes profile traits. Continuation reports are private author statements, not proof of a mutual relationship.

Only public venues are supported in protected logistics. Fine-grained reveal policies, moderation operations, verification, payments/refunds and Standing policy remain product work. Some legacy self-profile/navigation styling remains dark; the new light surfaces are not a completed app-wide redesign.

## Verification and release limits

TypeScript, core/web tests and local database security checks are available through the root scripts and CI. Local database checks use PGlite and Supabase auth/storage shims. They check fresh migration application, consent, capacity exhaustion, access revocation, account protection, bilateral blocks, private answer ownership, rollback and reflection eligibility. They do not simulate simultaneous network clients or audit the live database.

A production build passed on both the foundations commit and the follow-up code. TypeScript, the existing test suites and database checks also passed again after the follow-up. Review found and fixed a host-draft loss issue: refreshing chat or sending a message must not reload unsaved meeting details. Editing/saving stays disabled until the initial logistics read succeeds, and the context resets when the outing or viewer changes. The interactive regression scenario still needs browser verification.

Browser visual and keyboard QA was attempted against the local production server, but the connected browser refused the address with `ERR_BLOCKED_BY_CLIENT`. This is not a passing browser check. Staging Supabase integration, simultaneous acceptance tests and deployment smoke checks remain release gates. This branch is not merged or deployed.

## Remaining release work

- Browser QA on a reachable preview: verify mobile layouts, keyboard focus, form labels, failure/retry states, and the host-draft scenario (edit venue, refresh chat, send a message, then save; the draft must survive).
- Staging integration: compare the existing schema with migration history before applying changes. Use separate host, invitee and nonmember test accounts to check consent, private logistics/chat, bilateral blocking and revocation after removal.
- Concurrent acceptance: send two acceptance requests from separate clients for one remaining seat. Exactly one may succeed, capacity must remain valid, and a retry must not create duplicate history or notifications.
- Historical data audit: identify the provenance of stored sample-derived answers before proposing any remediation. Do not automatically delete or reinterpret ambiguous answers.
- Publish the branch and open a PR against `main` after the GitHub integration has write access. The previous attempt returned 403, `Resource not accessible by integration`; no PR was created. Do not merge.
- Deployment and smoke checks remain pending. The current authorization covers implementation and a PR, not a production rollout.

Waitlist automation, final Standing presentation, expanded venue rules, verification and payments remain open product decisions, not silently assigned implementation tasks.
