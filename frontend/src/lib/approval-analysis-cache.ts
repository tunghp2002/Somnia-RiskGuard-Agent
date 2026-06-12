const databaseName = "riskguard-approval-analysis";
const databaseVersion = 1;
const storeName = "history";

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

function cacheKey(walletAddress: string) {
  return walletAddress.toLowerCase();
}

export async function readApprovalAnalysisHistory<T>(walletAddress: string | undefined) {
  if (!walletAddress) {
    return [];
  }

  try {
    const value = await useStore<T[] | undefined>(
      "readonly",
      (store) => store.get(cacheKey(walletAddress)),
    );
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export async function writeApprovalAnalysisHistory(
  walletAddress: string | undefined,
  history: unknown[],
) {
  if (!walletAddress) {
    return;
  }

  try {
    await useStore<IDBValidKey>("readwrite", (store) =>
      store.put(history, cacheKey(walletAddress)),
    );
  } catch {
    // Browser cache writes should never block approval analysis.
  }
}
