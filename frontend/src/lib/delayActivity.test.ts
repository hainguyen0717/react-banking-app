import { describe, expect, it, vi } from 'vitest';
import { createDelayActivityStore } from './delayActivity';

describe('delay activity store', () => {
  it('shows the newest counting activity and falls back to an older outstanding activity', () => {
    let now = 1000;
    const callback = vi.fn();
    const store = createDelayActivityStore({
      now: () => now,
      schedule: ((listener: () => void) => { callback.mockImplementation(listener); return 1; }) as typeof setInterval,
      cancel: vi.fn(),
    });
    const older = store.start(60, 'api');
    const newer = store.start(1, 'ui');
    expect(store.getSnapshot()).toEqual({ active: true, remainingSeconds: 1, completing: false });
    store.finish(newer);
    expect(store.getSnapshot()).toEqual({ active: true, remainingSeconds: 60, completing: false });
    store.finish(older);
    expect(store.getSnapshot()).toEqual({ active: false, remainingSeconds: 0, completing: false });
  });

  it('prefers an older counting activity over newer completed activity and keeps each independently active', () => {
    let now = 1000;
    const callback = vi.fn();
    const store = createDelayActivityStore({
      now: () => now,
      schedule: ((listener: () => void) => { callback.mockImplementation(listener); return 1; }) as typeof setInterval,
      cancel: vi.fn(),
    });
    const older = store.start(60, 'api');
    const newer = store.start(1, 'ui');
    now = 2500;
    callback();
    expect(store.getSnapshot()).toEqual({ active: true, remainingSeconds: 59, completing: false });
    store.finish(older);
    expect(store.getSnapshot()).toEqual({ active: true, remainingSeconds: 0, completing: true });
    store.finish(newer);
    expect(store.getSnapshot()).toEqual({ active: false, remainingSeconds: 0, completing: false });
  });

  it('keeps a handoff independently active while showing a newer API countdown', () => {
    const store = createDelayActivityStore({ now: () => 1000 });
    const ui = store.start(2, 'ui');
    store.handoff(ui);
    const api = store.start(3, 'api');
    expect(store.getSnapshot()).toEqual({ active: true, remainingSeconds: 3, completing: false });
    store.finish(api);
    expect(store.getSnapshot()).toEqual({ active: true, remainingSeconds: 0, completing: true });
    store.finish(ui);
    expect(store.getSnapshot()).toEqual({ active: false, remainingSeconds: 0, completing: false });
  });
});
