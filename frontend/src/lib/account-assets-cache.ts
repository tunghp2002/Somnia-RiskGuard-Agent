import type { AccountAssetSnapshot } from "@/lib/blockscout-api";

export interface CachedAccountAssetSnapshot {
  fetchedAt: number;
  snapshot: AccountAssetSnapshot;
  updatedAt?: number;
}

const databaseName = "riskguard-account-assets";
const databaseVersion = 1;
const storeName = "snapshots";

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase() {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is unavailable"));
  }

  databasePromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
  });

  return databasePromise;
}

function useStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  return openDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(storeName, mode);
        const request = run(transaction.objectStore(storeName));

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
      }),
  );
}

export async function readCachedAccountAssets(key: string) {
  try {
    return await useStore<CachedAccountAssetSnapshot | undefined>("readonly", (store) => store.get(key));
  } catch {
    return undefined;
  }
}

export async function writeCachedAccountAssets(key: string, value: CachedAccountAssetSnapshot) {
  try {
    await useStore<IDBValidKey>("readwrite", (store) => store.put(value, key));
  } catch {
    // Cache writes should never block the dashboard.
  }
}
