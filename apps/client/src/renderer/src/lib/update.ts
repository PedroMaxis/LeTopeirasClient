import { Store } from './store';

/** Version of a downloaded update waiting for a restart; `dismissed` hides the prompt. */
export const update = new Store<{ version: string | null; dismissed: boolean }>({
  version: null,
  dismissed: false,
});

const setReady = (version: string | null) => {
  if (version) update.set(() => ({ version, dismissed: false }));
};

void window.api.getReadyUpdate().then(setReady, () => {});
window.api.onUpdateReady(setReady);

export function dismissUpdate(): void {
  update.set((s) => ({ ...s, dismissed: true }));
}
