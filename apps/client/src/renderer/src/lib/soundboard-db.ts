// The person's own soundboard sounds. They stay on this PC (IndexedDB), never on the server.

const DB_NAME = 'letopeiras-soundboard';
const STORE = 'sounds';

export interface CustomSound {
  id: number;
  name: string;
  emoji: string;
  /** The audio file as it was picked. */
  bytes: ArrayBuffer;
}

export type NewCustomSound = Omit<CustomSound, 'id'>;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB indisponível'));
  });
}

/** Runs one request in a transaction and closes the database after it. */
async function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = action(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Falha ao salvar o som'));
    });
  } finally {
    db.close();
  }
}

export const listCustomSounds = (): Promise<CustomSound[]> =>
  run('readonly', (store) => store.getAll() as IDBRequest<CustomSound[]>);

export const addCustomSound = (sound: NewCustomSound): Promise<number> =>
  run('readwrite', (store) => store.add(sound) as IDBRequest<number>);

export const putCustomSound = (sound: CustomSound): Promise<IDBValidKey> =>
  run('readwrite', (store) => store.put(sound));

export const removeCustomSound = (id: number): Promise<undefined> =>
  run('readwrite', (store) => store.delete(id));
