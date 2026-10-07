import { Store } from './store';

export interface Toast {
  id: number;
  text: string;
  kind: 'error' | 'info';
}

let nextId = 1;

export const toasts = new Store<{ list: Toast[] }>({ list: [] });

export function showToast(text: string, kind: Toast['kind'] = 'error'): void {
  const toast = { id: nextId++, text, kind };
  toasts.set((s) => ({ list: [...s.list.slice(-3), toast] }));
  setTimeout(() => dismissToast(toast.id), 6000);
}

export function dismissToast(id: number): void {
  toasts.set((s) => ({ list: s.list.filter((t) => t.id !== id) }));
}
