export type SavedClip = {
  id: string;
  label: string;
  createdAt: number;
  blob: Blob;
  mimeType: string;
};

const DATABASE = 'tiffany-speaks-local';
const STORE = 'practice-clips';

function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in window)) return Promise.reject(new Error('Local clip storage is unavailable in this browser.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local clip storage.'));
  });
}

async function useStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason: Error) => void) => void): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    run(tx.objectStore(STORE), resolve, reject);
    tx.oncomplete = () => db.close();
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Local clip operation failed.')); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Local clip operation was cancelled.')); };
  });
}

export function listClips(): Promise<SavedClip[]> {
  return useStore('readonly', (store, resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve((request.result as SavedClip[]).sort((a, b) => b.createdAt - a.createdAt));
    request.onerror = () => reject(request.error ?? new Error('Could not load saved clips.'));
  });
}

export function saveClip(clip: SavedClip): Promise<void> {
  return useStore('readwrite', (store, resolve, reject) => {
    const request = store.put(clip);
    request.onsuccess = () => resolve(undefined);
    request.onerror = () => reject(request.error ?? new Error('Could not save this clip.'));
  });
}

export function removeClip(id: string): Promise<void> {
  return useStore('readwrite', (store, resolve, reject) => {
    const request = store.delete(id);
    request.onsuccess = () => resolve(undefined);
    request.onerror = () => reject(request.error ?? new Error('Could not delete this clip.'));
  });
}
