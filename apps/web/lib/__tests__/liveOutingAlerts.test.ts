import { describe, expect, it, vi } from 'vitest';
import { broadcastLiveOutingAlert, LIVE_OUTING_ALERT_EVENT, subscribeLiveOutingAlerts } from '../liveOutingAlerts';

const outingId = '11111111-1111-4111-8111-111111111111';

describe('live outing alerts', () => {
  it('broadcasts over a Realtime channel and never writes a table', async () => {
    const send = vi.fn(async () => 'ok');
    const removeChannel = vi.fn(async () => 'ok');
    const channel = {
      subscribe: vi.fn((cb: (status: string) => void) => { cb('SUBSCRIBED'); return channel; }),
      send,
    };
    const from = vi.fn();
    const client = { channel: vi.fn(() => channel), removeChannel, from };
    await broadcastLiveOutingAlert(outingId, 'Now nearby', () => client as any);
    expect(from).not.toHaveBeenCalled();
    expect(client.channel).toHaveBeenCalledWith(`live-outing-alerts:${outingId}`, expect.any(Object));
    expect(send).toHaveBeenCalledWith({
      type: 'broadcast',
      event: LIVE_OUTING_ALERT_EVENT,
      payload: expect.objectContaining({ message: 'Now nearby' }),
    });
    expect(removeChannel).toHaveBeenCalledWith(channel);
  });

  it('subscribes to broadcast events only', () => {
    const on = vi.fn((_type, _filter, cb) => { cb({ payload: { message: 'ping' } }); return channel; });
    const channel = { on, subscribe: vi.fn() };
    const client = { channel: vi.fn(() => channel), removeChannel: vi.fn() };
    const heard: string[] = [];
    const stop = subscribeLiveOutingAlerts(outingId, (message) => heard.push(message), () => client as any);
    expect(on).toHaveBeenCalledWith('broadcast', { event: LIVE_OUTING_ALERT_EVENT }, expect.any(Function));
    expect(heard).toEqual(['ping']);
    stop();
    expect(client.removeChannel).toHaveBeenCalledWith(channel);
  });
});
