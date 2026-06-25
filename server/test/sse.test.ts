import { describe, it, expect, vi } from 'vitest';
import { RunBus, streamRunEvents } from '../src/platform/sse.js';

const RUN_ID = 'run-1';

/** Decode a yielded SSE frame's `data` payload back into the RunEvent. */
function payload(frame: { id: string; event: string; data: string }) {
  return JSON.parse(frame.data) as { runId: string; seq: number; kind: string; msg: string };
}

describe('streamRunEvents', () => {
  it('replays buffered events first, in order, before live ones', async () => {
    const bus = new RunBus();
    // Buffered BEFORE the generator subscribes — must be replayed first.
    bus.publish(RUN_ID, 'info', 'first');
    bus.publish(RUN_ID, 'info', 'second');

    const it = streamRunEvents(bus, RUN_ID);

    const f1 = await it.next();
    expect(f1.done).toBe(false);
    expect(f1.value).toMatchObject({ id: '1', event: 'info' });
    expect(payload(f1.value!).msg).toBe('first');

    const f2 = await it.next();
    expect(f2.done).toBe(false);
    expect(f2.value).toMatchObject({ id: '2', event: 'info' });
    expect(payload(f2.value!).msg).toBe('second');

    await it.return?.(undefined); // clean up the generator
  });

  it('streams a live event published after iteration has started', async () => {
    const bus = new RunBus();
    const it = streamRunEvents(bus, RUN_ID);

    // Drive past the (empty) replay so the generator is awaiting live events.
    // Do NOT await before publishing — the queue is empty, so next() is pending.
    const pending = it.next();
    bus.publish(RUN_ID, 'info', 'third');

    const f = await pending;
    expect(f.done).toBe(false);
    expect(payload(f.value!).msg).toBe('third');

    await it.return?.(undefined);
  });

  it('finishes (done:true) when the run completes', async () => {
    const bus = new RunBus();
    const it = streamRunEvents(bus, RUN_ID);

    const pending = it.next(); // queue empty → awaiting either an event or done
    bus.complete(RUN_ID);

    const f = await pending;
    expect(f.done).toBe(true);
    expect(f.value).toBeUndefined();
  });

  it('unsubscribes in finally and yields nothing further after completion', async () => {
    const bus = new RunBus();

    // RunBus exposes no listener introspection, so capture the unsubscribe
    // returned by subscribe() and assert the generator's finally invoked it.
    let unsubscribed = 0;
    const realSubscribe = bus.subscribe.bind(bus);
    vi.spyOn(bus, 'subscribe').mockImplementation((id, listener) => {
      const off = realSubscribe(id, listener);
      return () => {
        unsubscribed += 1;
        off();
      };
    });

    const it = streamRunEvents(bus, RUN_ID);

    const pending = it.next();
    bus.complete(RUN_ID);
    const done = await pending;
    expect(done.done).toBe(true);

    // finally must have run the unsubscribe exactly once.
    expect(unsubscribed).toBe(1);

    // A late publish must not throw, and the finished generator yields no more.
    expect(() => bus.publish(RUN_ID, 'info', 'late')).not.toThrow();
    const after = await it.next();
    expect(after.done).toBe(true);
    expect(after.value).toBeUndefined();
  });
});
