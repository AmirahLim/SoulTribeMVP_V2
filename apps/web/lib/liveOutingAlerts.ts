import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from './supabase';

export const LIVE_OUTING_ALERT_EVENT = 'live-ping';

function channelName(outingId: string) {
  return `live-outing-alerts:${outingId}`;
}

function validOutingId(outingId: string) {
  return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(outingId);
}

/** Stream an ephemeral outing alert. Do not insert into outing_notifications or any other table. */
export async function broadcastLiveOutingAlert(
  outingId: string,
  message: string,
  clientFactory = getSupabaseBrowserClient,
): Promise<void> {
  if (!validOutingId(outingId)) throw new Error('Invalid outing');
  const client = clientFactory();
  const channel = client.channel(channelName(outingId), { config: { broadcast: { self: false } } });
  await new Promise<void>((resolve, reject) => {
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve();
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error('Live alert channel unavailable'));
    });
  });
  try {
    const sent = await channel.send({
      type: 'broadcast',
      event: LIVE_OUTING_ALERT_EVENT,
      payload: { message, at: Date.now() },
    });
    if (sent !== 'ok') throw new Error('Live alert was not delivered');
  } finally {
    await client.removeChannel(channel);
  }
}

/** Listen for in-memory outing pings. Event payloads are not durable database rows. */
export function subscribeLiveOutingAlerts(
  outingId: string,
  onAlert: (message: string) => void,
  clientFactory: () => Pick<SupabaseClient, 'channel' | 'removeChannel'> = getSupabaseBrowserClient,
): () => void {
  if (!validOutingId(outingId)) return () => {};
  const client = clientFactory();
  const channel: RealtimeChannel = client.channel(channelName(outingId));
  channel.on('broadcast', { event: LIVE_OUTING_ALERT_EVENT }, ({ payload }) => {
    if (payload && typeof payload.message === 'string') onAlert(payload.message);
  });
  channel.subscribe();
  return () => {
    void Promise.resolve(client.removeChannel(channel)).catch(() => {});
  };
}
