import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fetchRadarOutings, fetchGoingOutings, fetchUserPitches, RADAR_LIMIT } from '../outingsStore';
import * as supabaseModule from '../supabase';

vi.mock('../supabase', async () => {
  const actual = await vi.importActual<typeof supabaseModule>('../supabase');
  return {
    ...actual,
    checkIsSupabaseConfigured: vi.fn(() => true),
    getSupabaseBrowserClient: vi.fn(),
  };
});

function thenable(result: { data: unknown; error: unknown }) {
  const q: Record<string, unknown> = {};
  const next = () => q;
  q.select = next;
  q.eq = next;
  q.in = next;
  q.order = next;
  q.limit = next;
  q.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return q;
}

describe('Step 6l — Outings Store Invariants & Hard Demo Rule', () => {
  const mockUserId = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    vi.clearAllMocks();
    (supabaseModule.checkIsSupabaseConfigured as ReturnType<typeof vi.fn>).mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. With a real userId and a mocked client returning zero rows, all three functions return [] — never demo items', async () => {
    const mockFrom = vi.fn().mockImplementation(() => thenable({ data: [], error: null }));
    (supabaseModule.getSupabaseBrowserClient as ReturnType<typeof vi.fn>).mockReturnValue({ from: mockFrom });

    const radar = await fetchRadarOutings(mockUserId);
    const going = await fetchGoingOutings(mockUserId);
    const pitches = await fetchUserPitches(mockUserId);

    expect(radar).toEqual([]);
    expect(going).toEqual([]);
    expect(pitches).toEqual([]);
    expect(mockFrom).toHaveBeenCalledWith('active_pitches');
  });

  it('2. With a real userId and a mocked client returning an error, the error propagates and logs [SoulTribe] details', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mockDbError = { code: 'PGRST116', message: 'Database query execution failed', details: 'col error', hint: 'run migration' };
    const mockFrom = vi.fn().mockImplementation(() => thenable({ data: null, error: mockDbError }));
    (supabaseModule.getSupabaseBrowserClient as ReturnType<typeof vi.fn>).mockReturnValue({ from: mockFrom });

    await expect(fetchRadarOutings(mockUserId)).rejects.toThrow(/PGRST116/);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[SoulTribe]'),
      expect.objectContaining({ code: 'PGRST116', message: 'Database query execution failed' })
    );

    await expect(fetchGoingOutings(mockUserId)).rejects.toThrow(/PGRST116/);
    await expect(fetchUserPitches(mockUserId)).rejects.toThrow(/PGRST116/);
  });

  it('3. No item with isHostDemo: true is ever returned when a real userId is present', async () => {
    const mockFrom = vi.fn().mockImplementation((table: string) => {
      if (table === 'active_pitches') {
        return thenable({
          data: [
            {
              id: 'real-outing-1',
              host_id: '00000000-0000-0000-0000-000000000002',
              title: 'Real Outing',
              pitch: 'Real pitch',
              activity_category: 'coffee',
              area: 'Orchard',
              starts_at: '2026-09-10T10:00:00Z',
              max_participants: 6,
              state: 'open',
              is_demo: false,
            },
            {
              id: 'demo-outing-1',
              host_id: '00000000-0000-0000-0000-000000000099',
              title: 'Demo Outing',
              pitch: 'Demo pitch',
              activity_category: 'coffee',
              area: 'Tiong Bahru',
              starts_at: '2026-09-10T10:00:00Z',
              max_participants: 6,
              state: 'open',
              is_demo: true,
            },
          ],
          error: null,
        });
      }
      if (table === 'profiles') {
        return thenable({
          data: [
            { id: '00000000-0000-0000-0000-000000000002', display_name: 'Real Host', avatar_url: '', is_demo: false },
            { id: '00000000-0000-0000-0000-000000000099', display_name: 'Demo Host', avatar_url: '', is_demo: true },
          ],
          error: null,
        });
      }
      return thenable({ data: [], error: null });
    });
    (supabaseModule.getSupabaseBrowserClient as ReturnType<typeof vi.fn>).mockReturnValue({ from: mockFrom });

    const radar = await fetchRadarOutings(mockUserId);
    expect(radar).toHaveLength(1);
    expect(radar[0].id).toBe('real-outing-1');
    expect(radar.every((i) => !i.isHostDemo)).toBe(true);
  });

  it('4. A real outing with no engine-computed fit renders with fitBadge: undefined', async () => {
    const mockFrom = vi.fn().mockImplementation((table: string) => {
      if (table === 'active_pitches') {
        return thenable({
          data: [{
            id: 'real-outing-2',
            host_id: '00000000-0000-0000-0000-000000000003',
            title: 'Botanical Walk',
            pitch: 'Walk around Fort Canning',
            activity_category: 'active',
            area: 'Fort Canning',
            starts_at: '2026-09-10T10:00:00Z',
            max_participants: 6,
            state: 'open',
            is_demo: false,
          }],
          error: null,
        });
      }
      if (table === 'profiles') {
        return thenable({
          data: [{ id: '00000000-0000-0000-0000-000000000003', display_name: 'Sarah', avatar_url: '', is_demo: false }],
          error: null,
        });
      }
      return thenable({ data: [], error: null });
    });
    (supabaseModule.getSupabaseBrowserClient as ReturnType<typeof vi.fn>).mockReturnValue({ from: mockFrom });

    const radar = await fetchRadarOutings(mockUserId);
    expect(radar).toHaveLength(1);
    expect(radar[0].fitBadge).toBeUndefined();
  });

  it('5. Radar reads active_pitches in start time order with a bounded page', async () => {
    const source = readFileSync(resolve(__dirname, '../outingsStore.ts'), 'utf8');
    expect(source).toContain(".from('active_pitches')");
    expect(source).toContain('.order(\'starts_at\')');
    expect(source).toContain(`limit(RADAR_LIMIT)`);
    expect(RADAR_LIMIT).toBe(50);
    expect(source).not.toMatch(/fetchRadarOutings[\s\S]*\.eq\('state', 'open'\)/);
  });
});
