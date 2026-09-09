import { describe, expect, it, vi } from 'vitest';
import { filterLocalOnlineIds, reportBrowserLivePresence, upsertLivePresence } from '../livePresence';

describe('live presence and spatial RPC', () => {
  it('calls filter_local_online_ids with the travel radius and returns unique IDs', async () => {
    const rpc = vi.fn(async () => ({
      data: [{ user_id: 'a' }, { user_id: 'a' }, { user_id: 'b' }],
      error: null,
    }));
    await expect(filterLocalOnlineIds(10000, () => ({ rpc } as any))).resolves.toEqual(['a', 'b']);
    expect(rpc).toHaveBeenCalledWith('filter_local_online_ids', { p_radius_meters: 10000 });
  });

  it('writes the signed-in member point before matching can see them', async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    await upsertLivePresence(103.8, 1.3, true, () => ({ rpc } as any));
    expect(rpc).toHaveBeenCalledWith('upsert_live_presence', {
      p_longitude: 103.8,
      p_latitude: 1.3,
      p_is_online: true,
    });
  });

  it('reports browser coordinates through upsert_live_presence', async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    await expect(reportBrowserLivePresence(async () => ({ longitude: 103.8, latitude: 1.3 }), () => ({ rpc } as any))).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('upsert_live_presence', expect.objectContaining({ p_longitude: 103.8, p_latitude: 1.3 }));
  });
});
