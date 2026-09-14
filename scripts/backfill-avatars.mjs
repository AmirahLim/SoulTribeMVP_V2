#!/usr/bin/env node
/**
 * Moves legacy inline base64 photos out of profiles.avatar_url into the private
 * avatars bucket.
 *
 * This is not a SQL migration and cannot be one. A bucket object's bytes live
 * behind the Storage API, not in Postgres; inserting into storage.objects would
 * only record an object that does not exist. So the upload runs here, over the
 * Storage API, with the service key.
 *
 * Two passes, deliberately separate, because for these members the inline copy is
 * the only copy of their photograph. The write pass uploads and verifies and never
 * touches profiles. The switch pass repoints the column only where it is still
 * byte-identical to the original the ledger recorded.
 *
 *   node scripts/backfill-avatars.mjs --pass=report
 *   node scripts/backfill-avatars.mjs --pass=write    [--commit]
 *   node scripts/backfill-avatars.mjs --pass=export   --out=DIR
 *   node scripts/backfill-avatars.mjs --pass=switch   [--commit]
 *   node scripts/backfill-avatars.mjs --pass=rollback --user=UUID [--commit]
 *
 * Nothing is written without --commit. Photo bytes are never logged.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'avatars';
const MAX_BYTES = 4 * 1024 * 1024;
const MIME_EXTENSION = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAGIC_PREFIX = { jpg: 'ffd8ff', png: '89504e47', webp: '52494646' };

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  return [key, rest.length ? rest.join('=') : 'true'];
}));
const pass = args.get('pass');
const commit = args.get('commit') === 'true';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY (the service key) before running.');
  process.exit(2);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const short = (id) => String(id).slice(0, 8);
/** Must stay identical to privateAvatarUrl in apps/web/lib/privateAvatar.ts. */
const appUrl = (path) => '/api/avatar?path=' + encodeURIComponent(path);

/** Decode and prove the bytes are the image type they claim to be. */
function inspect(dataUri) {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(String(dataUri).trim());
  if (!match) return { ok: false, state: 'decode_failed', error: 'Not a base64 data URI' };
  const declaredMime = match[1].toLowerCase();
  const extension = MIME_EXTENSION[declaredMime];
  if (!extension) return { ok: false, state: 'mime_unsupported', declaredMime,
    error: `MIME ${declaredMime} is outside the bucket allowlist` };
  const payload = match[2];
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload) || payload.length % 4 !== 0)
    return { ok: false, state: 'decode_failed', declaredMime, error: 'Base64 payload is malformed' };
  let bytes;
  try { bytes = Buffer.from(payload, 'base64'); }
  catch (e) { return { ok: false, state: 'decode_failed', declaredMime, error: String(e) }; }
  if (!bytes.length) return { ok: false, state: 'decode_failed', declaredMime, error: 'Decoded to zero bytes' };
  if (bytes.length > MAX_BYTES) return { ok: false, state: 'too_large', declaredMime,
    error: `Decoded ${bytes.length} bytes exceeds the ${MAX_BYTES} byte bucket limit` };
  const magic = bytes.subarray(0, 4).toString('hex');
  if (!magic.startsWith(MAGIC_PREFIX[extension]))
    return { ok: false, state: 'decode_failed', declaredMime,
      error: `Bytes begin ${magic}, which is not ${declaredMime}` };
  return { ok: true, declaredMime, extension, bytes,
    sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** The only authority on whether a photo is safely in the bucket. */
async function verify(storagePath, expectedSha) {
  const { data, error } = await db.storage.from(BUCKET).download(storagePath);
  if (error || !data) return { ok: false, error: error?.message ?? 'No object returned' };
  const stored = Buffer.from(await data.arrayBuffer());
  const storedSha = createHash('sha256').update(stored).digest('hex');
  if (storedSha !== expectedSha)
    return { ok: false, error: `Stored object hashes ${storedSha}, expected ${expectedSha}` };
  return { ok: true, bytes: stored.length };
}

async function recordLedger(entry) {
  const { error } = await db.from('avatar_backfill').upsert(entry, { onConflict: 'user_id' });
  if (error) throw new Error(`Ledger write failed for ${short(entry.user_id)}: ${error.message}`);
}

async function inlineRows() {
  const { data, error } = await db.from('profiles').select('id,avatar_url').like('avatar_url', 'data:%');
  if (error) throw new Error(`Could not read profiles: ${error.message}`);
  return data ?? [];
}

async function ledgerRows(states) {
  let query = db.from('avatar_backfill').select('*');
  if (states) query = query.in('state', states);
  const { data, error } = await query;
  if (error) throw new Error(`Could not read the ledger: ${error.message}`);
  return data ?? [];
}

async function writePass() {
  const rows = await inlineRows();
  console.log(`${rows.length} profile row(s) still hold an inline photo.`);
  let verified = 0; const problems = [];

  for (const row of rows) {
    const found = inspect(row.avatar_url);
    if (!found.ok) {
      // The column is left exactly as it is. A member never loses their photo
      // because this script could not read it.
      problems.push({ id: row.id, state: found.state, error: found.error });
      console.error(`  ${short(row.id)} ${found.state}: ${found.error} — column untouched`);
      // No byte count, hash or target path is known, and none is invented.
      if (commit) await recordLedger({
        user_id: row.id, original_avatar_url: row.avatar_url,
        declared_mime: found.declaredMime ?? 'unknown', decoded_bytes: null,
        decoded_sha256: null, storage_path: null, state: found.state, error: found.error,
      });
      continue;
    }

    const { bytes, sha256, extension, declaredMime } = found;
    // Content addressed, so a re-run computes the same path and is idempotent.
    const storagePath = `${row.id}/avatar-${sha256.slice(0, 32)}.${extension}`;
    console.log(`  ${short(row.id)} ${declaredMime} ${bytes.length} bytes -> ${storagePath}`);
    if (!commit) continue;

    await recordLedger({
      user_id: row.id, original_avatar_url: row.avatar_url, declared_mime: declaredMime,
      decoded_bytes: bytes.length, decoded_sha256: sha256, storage_path: storagePath,
      state: 'pending', error: null,
    });

    // An "already exists" error is expected on a re-run. Verification, not the
    // upload result, decides the outcome, so nothing is ever overwritten blindly.
    const upload = await db.storage.from(BUCKET)
      .upload(storagePath, bytes, { contentType: declaredMime, upsert: false });
    const check = await verify(storagePath, sha256);
    if (!check.ok) {
      const detail = [upload.error?.message, check.error].filter(Boolean).join('; ');
      problems.push({ id: row.id, state: 'target_conflict', error: detail });
      console.error(`  ${short(row.id)} not verified: ${detail} — column untouched`);
      await recordLedger({
        user_id: row.id, original_avatar_url: row.avatar_url, declared_mime: declaredMime,
        decoded_bytes: bytes.length, decoded_sha256: sha256, storage_path: storagePath,
        state: 'target_conflict', error: detail,
      });
      continue;
    }
    await recordLedger({
      user_id: row.id, original_avatar_url: row.avatar_url, declared_mime: declaredMime,
      decoded_bytes: bytes.length, decoded_sha256: sha256, storage_path: storagePath,
      state: 'verified', error: null,
    });
    verified += 1;
    console.log(`  ${short(row.id)} verified in the bucket (${check.bytes} bytes)`);
  }

  console.log(commit
    ? `\nWrite pass complete: ${verified} verified, ${problems.length} needing attention. No profile row was modified.`
    : '\nDry run only. Re-run with --commit to upload.');
  if (problems.length) process.exitCode = 1;
}

async function exportPass() {
  const out = args.get('out');
  if (!out) { console.error('Pass --out=DIR to choose where the export is written.'); process.exit(2); }
  await mkdir(out, { recursive: true });
  const entries = await ledgerRows(['verified', 'switched']);
  for (const entry of entries) {
    const found = inspect(entry.original_avatar_url);
    if (!found.ok) { console.error(`  ${short(entry.user_id)} could not be exported: ${found.error}`); continue; }
    const file = `${out}/${entry.user_id}.${found.extension}`;
    await writeFile(file, found.bytes);
    console.log(`  ${short(entry.user_id)} ${found.bytes.length} bytes -> ${file}`);
  }
  console.log(`\nExported ${entries.length} photo(s) from the ledger originals. Keep this off-database copy until the ledger is dropped.`);
}

async function switchPass() {
  const entries = await ledgerRows(['verified', 'switched']);
  console.log(`${entries.length} ledger entry/entries eligible to switch.`);
  let switched = 0, alreadyDone = 0; const skipped = [];

  for (const entry of entries) {
    // Re-verify: the object could have been removed since the write pass.
    const check = await verify(entry.storage_path, entry.decoded_sha256);
    if (!check.ok) {
      skipped.push({ id: entry.user_id, error: check.error });
      console.error(`  ${short(entry.user_id)} not switching, bucket object failed re-verification: ${check.error}`);
      continue;
    }
    const target = appUrl(entry.storage_path);
    console.log(`  ${short(entry.user_id)} -> ${target}`);
    if (!commit) continue;

    // Guarded by the original value: if the member changed their photo since the
    // write pass this matches nothing, and we leave their newer photo alone.
    const { data: updated, error } = await db.from('profiles')
      .update({ avatar_url: target })
      .eq('id', entry.user_id).eq('avatar_url', entry.original_avatar_url)
      .select('id,avatar_url');
    if (error) {
      skipped.push({ id: entry.user_id, error: error.message });
      console.error(`  ${short(entry.user_id)} update failed: ${error.message}`);
      continue;
    }
    if (!updated?.length) {
      const { data: current } = await db.from('profiles')
        .select('avatar_url').eq('id', entry.user_id).maybeSingle();
      if (current?.avatar_url === target) { alreadyDone += 1; console.log(`  ${short(entry.user_id)} already switched`); }
      else {
        skipped.push({ id: entry.user_id, error: 'Column no longer holds the recorded original; a newer photo was left in place' });
        console.error(`  ${short(entry.user_id)} skipped: the column changed since the write pass`);
      }
      if (current?.avatar_url === target) await recordLedger({ ...entry, state: 'switched', error: null });
      continue;
    }
    await recordLedger({ ...entry, state: 'switched', error: null });
    switched += 1;
  }

  console.log(commit
    ? `\nSwitch pass complete: ${switched} switched, ${alreadyDone} already done, ${skipped.length} skipped. Originals remain in the ledger for rollback.`
    : '\nDry run only. Re-run with --commit to repoint the column.');
  if (skipped.length) process.exitCode = 1;
}

async function rollbackPass() {
  const user = args.get('user');
  if (!user) { console.error('Pass --user=UUID to choose whose photo is restored.'); process.exit(2); }
  const { data: entry, error } = await db.from('avatar_backfill')
    .select('*').eq('user_id', user).maybeSingle();
  if (error) throw new Error(`Could not read the ledger: ${error.message}`);
  if (!entry) { console.error(`No ledger entry for ${user}. Nothing to restore.`); process.exit(1); }
  console.log(`Restoring ${short(user)} to the recorded original (${entry.decoded_bytes} bytes, ${entry.declared_mime}).`);
  if (!commit) { console.log('Dry run only. Re-run with --commit to restore.'); return; }
  const { error: restoreError } = await db.from('profiles')
    .update({ avatar_url: entry.original_avatar_url }).eq('id', user);
  if (restoreError) throw new Error(`Restore failed: ${restoreError.message}`);
  await recordLedger({ ...entry, state: 'verified', error: 'Rolled back to the inline original' });
  console.log('Restored. The account.details trigger republishes it automatically.');
}

async function reportPass() {
  const inline = await inlineRows();
  const inlineBytes = inline.reduce((total, row) => total + Buffer.byteLength(row.avatar_url), 0);
  console.log(`profiles rows still inline: ${inline.length} (${inlineBytes} bytes)`);
  const entries = await ledgerRows();
  const byState = {};
  for (const entry of entries) byState[entry.state] = (byState[entry.state] ?? 0) + 1;
  console.log('ledger by state:', Object.keys(byState).length ? byState : '(empty)');
  for (const entry of entries) {
    if (!entry.storage_path || !entry.decoded_sha256) {
      console.log(`  ${short(entry.user_id)} ${entry.state} (no stored object) ${entry.error ?? ''}`);
      continue;
    }
    const check = await verify(entry.storage_path, entry.decoded_sha256);
    console.log(`  ${short(entry.user_id)} ${entry.state} ${entry.storage_path} ${check.ok ? 'object verified' : 'OBJECT PROBLEM: ' + check.error}`);
  }
}

const passes = { write: writePass, switch: switchPass, export: exportPass, rollback: rollbackPass, report: reportPass };
if (!passes[pass]) {
  console.error(`Choose --pass=${Object.keys(passes).join('|')}`);
  process.exit(2);
}
await passes[pass]();
