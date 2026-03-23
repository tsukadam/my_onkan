export type UserSettingsStore = {
  chordPickQuestionCount?: number
  fixedEndQuestionCount?: number
  fixedEndWhiteKeysOnly?: boolean
  fixedEndLimitLeapToOctave?: boolean
}

const DB_NAME = 'myonkan_user_settings'
const DB_VERSION = 1
const STORE = 'settings'
const KEY = 'ui'

type SettingsRow = { key: string; value: UserSettingsStore }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' })
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

export async function loadUserSettings(): Promise<UserSettingsStore> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readonly')
  const store = tx.objectStore(STORE)
  const req = store.get(KEY)
  const row = await new Promise<SettingsRow | undefined>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as SettingsRow | undefined)
    req.onerror = () => reject(req.error ?? new Error('get failed'))
  })
  await txDone(tx)
  db.close()
  return row?.value ?? {}
}

export async function saveUserSettings(settings: UserSettingsStore): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  const store = tx.objectStore(STORE)
  store.put({ key: KEY, value: settings } satisfies SettingsRow)
  await txDone(tx)
  db.close()
}
