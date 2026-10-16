import { useSyncExternalStore } from 'react';

export type DelayActivityKind = 'api' | 'ui' | 'ui-handoff';

interface DelayActivity {
  id: string;
  kind: DelayActivityKind;
  deadline: number;
  order: number;
}

export interface DelayActivitySnapshot {
  active: boolean;
  remainingSeconds: number;
  completing: boolean;
}

const INACTIVE_SNAPSHOT: DelayActivitySnapshot = Object.freeze({
  active: false,
  remainingSeconds: 0,
  completing: false,
});

export function createDelayActivityStore({
  now = () => Date.now(),
  schedule = (listener: () => void, interval: number) => setInterval(listener, interval),
  cancel = (timer: ReturnType<typeof setInterval>) => clearInterval(timer),
} = {}) {
  const activities = new Map<string, DelayActivity>();
  const listeners = new Set<() => void>();
  let sequence = 0;
  let ticker: ReturnType<typeof setInterval> | null = null;
  let snapshot = INACTIVE_SNAPSHOT;

  const buildSnapshot = (): DelayActivitySnapshot => {
    if (activities.size === 0) return INACTIVE_SNAPSHOT;
    const currentTime = now();
    const ordered = Array.from(activities.values()).sort((left, right) => right.order - left.order);
    const displayedActivity = ordered.find((activity) => activity.deadline > currentTime) ?? ordered[0];
    const remainingSeconds = Math.max(0, Math.ceil((displayedActivity.deadline - currentTime) / 1000));
    return { active: true, remainingSeconds, completing: remainingSeconds === 0 };
  };

  const emit = () => {
    const next = buildSnapshot();
    if (
      next.active === snapshot.active
      && next.remainingSeconds === snapshot.remainingSeconds
      && next.completing === snapshot.completing
    ) return;
    snapshot = next;
    listeners.forEach((listener) => listener());
  };

  const syncTicker = () => {
    if (activities.size > 0 && ticker === null) ticker = schedule(emit, 200);
    if (activities.size === 0 && ticker !== null) {
      cancel(ticker);
      ticker = null;
    }
  };

  const start = (sampledSeconds: number, kind: DelayActivityKind) => {
    if (sampledSeconds <= 0) {
      syncTicker();
      emit();
      return null;
    }
    const id = `delay-activity-${++sequence}`;
    activities.set(id, { id, kind, deadline: now() + sampledSeconds * 1000, order: sequence });
    syncTicker();
    emit();
    return id;
  };

  const finish = (id: string | null) => {
    if (id === null || !activities.delete(id)) return;
    syncTicker();
    emit();
  };

  const handoff = (id: string | null) => {
    if (id === null) return;
    const activity = activities.get(id);
    if (!activity) return;
    activities.set(id, { ...activity, kind: 'ui-handoff', deadline: now() });
    emit();
  };

  return {
    start,
    finish,
    handoff,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset() {
      activities.clear();
      syncTicker();
      emit();
    },
  };
}

export const delayActivityStore = createDelayActivityStore();

export function useDelayActivity() {
  return useSyncExternalStore(
    delayActivityStore.subscribe,
    delayActivityStore.getSnapshot,
    delayActivityStore.getSnapshot,
  );
}
