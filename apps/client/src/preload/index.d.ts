import type { LeTopeirasApi } from '../shared/ipc';

declare global {
  interface Window {
    api: LeTopeirasApi;
  }
}

export {};
