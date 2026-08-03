// Minimal typed event bus (docs/70 M1.1). Used by UI/render to observe sim events without the
// sim knowing about them. Listener order is registration order, so dispatch is deterministic.

export type Listener<T> = (payload: T) => void;

export class EventBus<Events extends Record<string, unknown>> {
  private readonly listeners = new Map<keyof Events, Listener<never>[]>();

  /** Subscribe; returns an unsubscribe function. */
  on<K extends keyof Events>(type: K, fn: Listener<Events[K]>): () => void {
    const list = (this.listeners.get(type) ?? []) as Listener<Events[K]>[];
    list.push(fn);
    this.listeners.set(type, list as Listener<never>[]);
    return () => this.off(type, fn);
  }

  off<K extends keyof Events>(type: K, fn: Listener<Events[K]>): void {
    const list = this.listeners.get(type) as Listener<Events[K]>[] | undefined;
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const list = this.listeners.get(type) as Listener<Events[K]>[] | undefined;
    if (!list) return;
    for (const fn of [...list]) fn(payload); // copy so handlers may unsubscribe mid-dispatch
  }

  clear(): void {
    this.listeners.clear();
  }
}
