import { useSyncExternalStore } from 'react';

/** Minimal observable state container; state is replaced, never mutated. */
export class Store<T> {
  private listeners = new Set<() => void>();

  constructor(private state: T) {}

  get = (): T => this.state;

  set(update: Partial<T> | ((state: T) => Partial<T>)): void {
    const patch = typeof update === 'function' ? update(this.state) : update;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

/** Subscribes to a slice of a store. The selector must return a stable reference. */
export function useStore<T, S>(store: Store<T>, selector: (state: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}
