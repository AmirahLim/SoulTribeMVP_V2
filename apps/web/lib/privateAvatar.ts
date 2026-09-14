/** Stable app URL; never persist an expiring signed URL or expose the bucket. */
export function privateAvatarUrl(path: string): string {
  return '/api/avatar?path=' + encodeURIComponent(path);
}
export const AVATAR_EXTENSION_MIME: Record<string, string> = {
  jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
};
export function validAvatarPath(path: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/avatar-[0-9a-f-]+\.(jpg|png|webp)$/i.test(path);
}
/** An inline base64 photo costs a whole image on every profile row, and the
 * account.details trigger copies it again. Photos belong in the private bucket,
 * so a data: URI is never written back to a column. */
export function isInlinePhoto(value: string | null | undefined): boolean {
  return (value ?? '').trim().toLowerCase().startsWith('data:');
}
