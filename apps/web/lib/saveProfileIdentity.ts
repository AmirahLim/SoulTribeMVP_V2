import { getSupabaseBrowserClient } from './supabase';
import { isInlinePhoto } from './privateAvatar';

export interface ProfileIdentity {
  display_name: string;
  home_area: string;
  bio: string;
  avatar_url: string;
}

/** Require an acknowledged row before the caller updates its portrait or cache. */
export async function saveProfileIdentity(userId: string, draft: ProfileIdentity): Promise<ProfileIdentity> {
  const identity = { ...draft, display_name: draft.display_name.trim(), home_area: draft.home_area.trim(), bio: draft.bio.trim() };
  if (!userId) throw new Error('Please sign in again.');
  if (!identity.display_name) throw new Error('Please enter your name.');
  // An editor loaded before a photo moved to the bucket still holds the inline
  // copy. Leave the column alone rather than rewriting it or clearing the photo.
  const { avatar_url: editedAvatar, ...withoutAvatar } = identity;
  const update = isInlinePhoto(editedAvatar) ? withoutAvatar : identity;
  const { data, error } = await getSupabaseBrowserClient().from('profiles')
    .update(update).eq('id', userId).select('id,display_name,home_area,bio,avatar_url').single();
  if (error || !data) throw new Error('Your changes could not be saved. Please try again.');
  return {display_name:data.display_name,home_area:data.home_area,bio:data.bio,avatar_url:data.avatar_url};
}
