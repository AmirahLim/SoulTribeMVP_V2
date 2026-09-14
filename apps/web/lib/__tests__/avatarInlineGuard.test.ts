import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { isInlinePhoto, validAvatarPath, privateAvatarUrl } from '../privateAvatar';
import { saveProfileIdentity } from '../saveProfileIdentity';
import { saveOnboardingToSupabase } from '../supabaseOnboarding';

const captured = vi.hoisted(() => ({ updates: [] as Record<string, unknown>[], bundles: [] as Record<string, unknown>[] }));

vi.mock('../supabase', () => ({
  checkIsSupabaseConfigured: () => true,
  getSupabaseBrowserClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'member-1' } }, error: null }) },
    rpc: async (_name: string, args: Record<string, unknown>) => {
      captured.bundles.push(args);
      return { error: null };
    },
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        captured.updates.push(payload);
        return {
          eq: () => ({
            select: () => ({
              single: async () => ({
                data: {
                  id: 'member-1', display_name: 'Member', home_area: 'Singapore',
                  bio: 'A bio', avatar_url: '/api/avatar?path=stored',
                },
                error: null,
              }),
            }),
          }),
        };
      },
    }),
  }),
}));

const INLINE = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA==';
const uuid = '12345678-1234-1234-1234-123456789abc';
const onboarding = {
  displayName: 'Member', handle: 'member', homeArea: 'Singapore',
  q1Finding: [], q2Feelings: [], q4Connected: [], q5Availability: [],
  q6Outings: [], q8Qualities: [],
};

beforeEach(() => { captured.updates = []; captured.bundles = []; });

describe('Private avatar paths cover every stored image type', () => {
  it('accepts the three bucket types and still rejects active or foreign content', () => {
    for (const ext of ['jpg', 'png', 'webp']) expect(validAvatarPath(`${uuid}/avatar-abc.${ext}`)).toBe(true);
    for (const bad of [
      `${uuid}/avatar-abc.svg`, `${uuid}/avatar-abc.gif`, `${uuid}/avatar-abc.jpg.svg`,
      `${uuid}/../secret.jpg`, 'https://example.com/a.jpg', `${uuid}/photo.jpg`,
    ]) expect(validAvatarPath(bad)).toBe(false);
  });

  it('recognises an inline photo regardless of case, and passes bucket or remote URLs through', () => {
    expect(isInlinePhoto(INLINE)).toBe(true);
    expect(isInlinePhoto('DATA:image/png;base64,AAAA')).toBe(true);
    expect(isInlinePhoto('  data:image/png;base64,AAAA')).toBe(true);
    for (const keep of [privateAvatarUrl(`${uuid}/avatar-abc.jpg`), 'https://example.com/a.jpg', '', null, undefined])
      expect(isInlinePhoto(keep)).toBe(false);
  });
});

describe('No write path persists an inline photo', () => {
  it('leaves avatar_url untouched when an editor still holds the inline copy', async () => {
    await saveProfileIdentity('member-1', {
      display_name: 'Member', home_area: 'Singapore', bio: 'A bio', avatar_url: INLINE,
    });

    expect(captured.updates).toHaveLength(1);
    expect(captured.updates[0]).not.toHaveProperty('avatar_url');
    expect(captured.updates[0]).toMatchObject({ display_name: 'Member', bio: 'A bio' });
  });

  it('still saves a bucket-backed photo through the identity form', async () => {
    const stored = privateAvatarUrl(`${uuid}/avatar-abc.jpg`);
    await saveProfileIdentity('member-1', {
      display_name: 'Member', home_area: 'Singapore', bio: 'A bio', avatar_url: stored,
    });

    expect(captured.updates[0]).toHaveProperty('avatar_url', stored);
  });

  it('does not carry an onboarding device preview into the profile bundle', async () => {
    await saveOnboardingToSupabase('member-1', { ...onboarding, avatarUrl: INLINE } as never);

    expect(captured.bundles).toHaveLength(1);
    expect((captured.bundles[0].p_profile as Record<string, unknown>).avatar_url).toBeNull();
  });

  it('keeps a bucket-backed photo in the onboarding bundle', async () => {
    const stored = privateAvatarUrl(`${uuid}/avatar-abc.jpg`);
    await saveOnboardingToSupabase('member-1', { ...onboarding, avatarUrl: stored } as never);

    expect((captured.bundles[0].p_profile as Record<string, unknown>).avatar_url).toBe(stored);
  });

  it('no longer offers a public URL or an inline fallback in the upload helper', () => {
    const source = readFileSync(new URL('../avatarUpload.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('getPublicUrl');
    expect(source).not.toContain('avatar_url: finalPhotoUrl');
    expect(source).toContain('privateAvatarUrl(uploadData.path)');
  });
});
