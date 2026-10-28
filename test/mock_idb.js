/**
 * Lightweight in-memory IndexedDB mock for unit testing db.js in Node.js
 */

export function installMockIDB() {
  const databaseStores = new Map();

  globalThis.indexedDB = {
    open(name, version) {
      const req = {
        result: null,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null
      };

      setTimeout(() => {
        if (!databaseStores.has(name)) {
          databaseStores.set(name, new Map());
        }
        const dbStores = databaseStores.get(name);

        const db = {
          objectStoreNames: {
            contains(storeName) {
              return dbStores.has(storeName);
            }
          },
          createObjectStore(storeName, opts) {
            if (!dbStores.has(storeName)) {
              dbStores.set(storeName, new Map());
            }
          },
          transaction(storeNames, mode) {
            const tx = {
              oncomplete: null,
              onerror: null,
              objectStore(storeName) {
                const store = dbStores.get(storeName);
                return {
                  get(key) {
                    const r = { result: null, onsuccess: null, onerror: null };
                    setTimeout(() => {
                      r.result = store.get(key) || null;
                      if (r.onsuccess) r.onsuccess({ target: r });
                    }, 0);
                    return r;
                  },
                  getAll() {
                    const r = { result: [], onsuccess: null, onerror: null };
                    setTimeout(() => {
                      r.result = Array.from(store.values());
                      if (r.onsuccess) r.onsuccess({ target: r });
                    }, 0);
                    return r;
                  },
                  put(val) {
                    const r = { onsuccess: null, onerror: null };
                    setTimeout(() => {
                      const key = val.id || 'default';
                      store.set(key, { ...val });
                      if (r.onsuccess) r.onsuccess({ target: r });
                      if (tx.oncomplete) tx.oncomplete();
                    }, 0);
                    return r;
                  },
                  delete(key) {
                    const r = { onsuccess: null, onerror: null };
                    setTimeout(() => {
                      store.delete(key);
                      if (r.onsuccess) r.onsuccess({ target: r });
                    }, 0);
                    return r;
                  },
                  clear() {
                    const r = { onsuccess: null, onerror: null };
                    setTimeout(() => {
                      store.clear();
                      if (r.onsuccess) r.onsuccess({ target: r });
                      if (tx.oncomplete) tx.oncomplete();
                    }, 0);
                    return r;
                  }
                };
              }
            };
            return tx;
          }
        };

        req.result = db;

        if (req.onupgradeneeded) {
          req.onupgradeneeded({ target: { result: db } });
        }
        if (req.onsuccess) {
          req.onsuccess({ target: req });
        }
      }, 0);

      return req;
    }
  };
}
