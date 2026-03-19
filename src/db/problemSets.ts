export type DbQuestion = {
  id: number
  text: string
}

export type DbProblemSet = {
  title: string
  questions: DbQuestion[]
  createdAt: number
  updatedAt: number
}

const DB_NAME = 'myonkan'
const DB_VERSION = 2
const STORE = 'problemSets'
const STATS_STORE = 'stats'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'title' })
      }
      if (!db.objectStoreNames.contains(STATS_STORE)) {
        db.createObjectStore(STATS_STORE, { keyPath: 'questionId' })
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

export async function listProblemSets(): Promise<Array<Pick<DbProblemSet, 'title' | 'updatedAt' | 'createdAt'>>> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readonly')
  const store = tx.objectStore(STORE)
  const req = store.getAll()

  const rows = await new Promise<DbProblemSet[]>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as DbProblemSet[])
    req.onerror = () => reject(req.error ?? new Error('getAll failed'))
  })
  await txDone(tx)
  db.close()

  return rows
    .map((r) => ({ title: r.title, updatedAt: r.updatedAt, createdAt: r.createdAt }))
    .sort((a, b) => a.title.localeCompare(b.title))
}

export async function getProblemSet(title: string): Promise<DbProblemSet | null> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readonly')
  const store = tx.objectStore(STORE)
  const req = store.get(title)

  const row = await new Promise<DbProblemSet | undefined>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as DbProblemSet | undefined)
    req.onerror = () => reject(req.error ?? new Error('get failed'))
  })
  await txDone(tx)
  db.close()
  return row ?? null
}

export async function putProblemSet(input: { title: string; questions: DbQuestion[] }): Promise<void> {
  const now = Date.now()
  const existing = await getProblemSet(input.title)
  const row: DbProblemSet = {
    title: input.title,
    questions: input.questions,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }

  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).put(row)
  await txDone(tx)
  db.close()
}

export async function deleteProblemSet(title: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).delete(title)
  await txDone(tx)
  db.close()
}

export async function listAllProblemSets(): Promise<DbProblemSet[]> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readonly')
  const req = tx.objectStore(STORE).getAll()
  const rows = await new Promise<DbProblemSet[]>((resolve, reject) => {
    req.onsuccess = () => resolve((req.result as DbProblemSet[]) ?? [])
    req.onerror = () => reject(req.error ?? new Error('getAll failed'))
  })
  await txDone(tx)
  db.close()
  return rows.sort((a, b) => a.title.localeCompare(b.title))
}

export async function replaceAllProblemSets(
  rows: Array<{ title: string; questions: DbQuestion[] }>,
): Promise<void> {
  const now = Date.now()
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  const store = tx.objectStore(STORE)
  store.clear()
  for (const row of rows) {
    store.put({
      title: row.title,
      questions: row.questions,
      createdAt: now,
      updatedAt: now,
    } satisfies DbProblemSet)
  }
  await txDone(tx)
  db.close()
}

