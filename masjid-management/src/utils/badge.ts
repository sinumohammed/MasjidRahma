// Tiny IndexedDB-backed counter for the home-screen app icon badge (Badging
// API). Used from both the service worker (increments on each push) and the
// main thread (clears when the user opens/returns to the app) - IndexedDB is
// available in both contexts, unlike localStorage which the SW can't reach.
const DB_NAME = 'masjid-rahma-badge'
const STORE_NAME = 'kv'
const COUNT_KEY = 'count'

function openBadgeDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function incrementBadgeCount(): Promise<number> {
  const db = await openBadgeDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const getReq = store.get(COUNT_KEY)
    getReq.onsuccess = () => {
      const next = ((getReq.result as number) || 0) + 1
      store.put(next, COUNT_KEY)
    }
    tx.oncomplete = () => resolve(getReq.result ? (getReq.result as number) + 1 : 1)
    tx.onerror = () => reject(tx.error)
  })
}

export async function clearBadgeCount(): Promise<void> {
  const db = await openBadgeDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(0, COUNT_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
