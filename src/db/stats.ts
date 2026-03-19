import type { StatsStore } from '../stats/storage'

const DB_NAME = 'myonkan'
const DB_VERSION = 2
const STORE = 'stats'

type StatsRow = { questionId: string; attempts: number; correct: number }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'questionId' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction error'))
  })
}

export async function loadAllStats(): Promise<StatsStore> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readonly')
  const store = tx.objectStore(STORE)
  const req = store.getAll()

  const rows = await new Promise<StatsRow[]>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as StatsRow[])
    req.onerror = () => reject(req.error ?? new Error('getAll failed'))
  })
  await txDone(tx)
  db.close()

  const out: StatsStore = {}
  for (const r of rows) out[r.questionId] = { attempts: r.attempts, correct: r.correct }
  return out
}

export async function saveAllStats(storeObj: StatsStore): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  const store = tx.objectStore(STORE)
  store.clear()
  for (const [questionId, st] of Object.entries(storeObj)) {
    store.put({ questionId, attempts: st.attempts, correct: st.correct } satisfies StatsRow)
  }
  await txDone(tx)
  db.close()
}

