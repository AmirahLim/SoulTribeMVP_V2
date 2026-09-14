import {getSupabaseServerClient} from '../../../../lib/supabaseServer';
import {validAvatarPath,AVATAR_EXTENSION_MIME} from '../../../../lib/privateAvatar';

export async function GET(_request: Request, context: {params: Promise<{path: string[]}>}) {
  const headers = {'Cache-Control':'private, no-store'};
  try {
    const client = await getSupabaseServerClient();
    const {data:{user},error:authError} = await client.auth.getUser();
    if (authError || !user) return new Response('Please sign in', {status:401,headers});
    const {path} = await context.params;
    if (path.length !== 2 || !validAvatarPath(path.join('/')))
      return new Response('Invalid photo path', {status:400,headers});
    // The member's session and Storage RLS authorize access; no service key.
    const {data,error} = await client.storage.from('avatars').download(path.join('/'));
    if (error || !data) return new Response('Photo unavailable', {status:404,headers});
    // nosniff is set, so the declared type must match the stored bytes.
    const extension = path[1].split('.').pop()!.toLowerCase();
    const contentType = data.type || AVATAR_EXTENSION_MIME[extension] || 'application/octet-stream';
    return new Response(data, {headers:{...headers,'Content-Type':contentType,'X-Content-Type-Options':'nosniff'}});
  } catch {
    return new Response('Photo could not be loaded', {status:503,headers});
  }
}
