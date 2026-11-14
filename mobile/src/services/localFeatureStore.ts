/**
 * localFeatureStore
 * ──────────────────
 * Durable on-device queue for 15-second behavioral feature snapshots.
 *
 * Why this exists: requirement is "15-second collection, 10-minute cloud
 * sync" — the two must be decoupled so a temporarily offline device never
 * loses collected snapshots. Everything lands here first; the sync service
 * (keyboardSync.ts) drains it on its own schedule and only deletes rows
 * after a confirmed server ack.
 *
 * Storage: expo-sqlite (bundled with Expo, works in managed + dev-client
 * builds, survives app restarts unlike in-memory state).
 */
import * as SQLite from 'expo-sqlite'

export interface FeatureSnapshot {
  client_snapshot_id: string   // uuid, generated at capture time — used for server-side de-dup
  window_start: string          // ISO timestamp
  typing_speed_cps?: number | null
  inter_key_interval_ms?: number | null
  backspace_rate?: number | null
  correction_rate?: number | null
  pause_frequency?: number | null
  typing_bursts?: number | null
  typing_interruptions?: number | null
  char_count?: number | null
  session_duration: number
  synced: 0 | 1
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null

function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('stresstwin_local.db').then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS feature_snapshots (
          client_snapshot_id   TEXT PRIMARY KEY NOT NULL,
          window_start         TEXT NOT NULL,
          typing_speed_cps     REAL,
          inter_key_interval_ms REAL,
          backspace_rate       REAL,
          correction_rate      REAL,
          pause_frequency      REAL,
          typing_bursts        INTEGER,
          typing_interruptions INTEGER,
          char_count           INTEGER,
          session_duration     INTEGER NOT NULL DEFAULT 15,
          synced                INTEGER NOT NULL DEFAULT 0,
          created_at            TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_snapshots_unsynced ON feature_snapshots(synced);
      `)
      return db
    })
  }
  return dbPromise
}

// Lightweight pub/sub so the UI (LiveKeyboardData) can refresh the moment a new
// snapshot lands instead of waiting for the next poll.
type Listener = () => void
const listeners = new Set<Listener>()
export function subscribeSnapshots(fn: Listener) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Called every ~15s by the collector (native bridge pull or JS-side timer). */
export async function enqueueSnapshot(s: FeatureSnapshot) {
  const db = await getDb()
  const res = await db.runAsync(
    `INSERT OR IGNORE INTO feature_snapshots
      (client_snapshot_id, window_start, typing_speed_cps, inter_key_interval_ms,
       backspace_rate, correction_rate, pause_frequency, typing_bursts,
       typing_interruptions, char_count, session_duration, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      s.client_snapshot_id, s.window_start,
      s.typing_speed_cps ?? null, s.inter_key_interval_ms ?? null,
      s.backspace_rate ?? null, s.correction_rate ?? null,
      s.pause_frequency ?? null, s.typing_bursts ?? null,
      s.typing_interruptions ?? null, s.char_count ?? null,
      s.session_duration,
    ]
  )
  if (res.changes > 0) listeners.forEach(fn => { try { fn() } catch {} })
}

/** Newest-first aggregate snapshots (numbers only — there is no text field) for the live panel. */
export async function getRecentSnapshots(limit = 20): Promise<FeatureSnapshot[]> {
  const db = await getDb()
  return db.getAllAsync<FeatureSnapshot>(
    `SELECT * FROM feature_snapshots ORDER BY window_start DESC LIMIT ?`,
    [limit]
  )
}

/** Pulled by the ~10-minute sync job. Caps batch size so a huge backlog after a long offline stretch is uploaded in chunks rather than one giant payload. */
export async function getPendingSnapshots(limit = 500): Promise<FeatureSnapshot[]> {
  const db = await getDb()
  const rows = await db.getAllAsync<FeatureSnapshot>(
    `SELECT * FROM feature_snapshots WHERE synced = 0 ORDER BY window_start ASC LIMIT ?`,
    [limit]
  )
  return rows
}

export async function markSynced(clientSnapshotIds: string[]) {
  if (clientSnapshotIds.length === 0) return
  const db = await getDb()
  const placeholders = clientSnapshotIds.map(() => '?').join(',')
  await db.runAsync(
    `UPDATE feature_snapshots SET synced = 1 WHERE client_snapshot_id IN (${placeholders})`,
    clientSnapshotIds
  )
}

/** Housekeeping: drop synced rows older than a few days so the local DB doesn't grow unbounded. */
export async function purgeOldSynced(olderThanDays = 3) {
  const db = await getDb()
  await db.runAsync(
    `DELETE FROM feature_snapshots WHERE synced = 1 AND created_at < datetime('now', ?)`,
    [`-${olderThanDays} days`]
  )
}

export async function countPending(): Promise<number> {
  const db = await getDb()
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) as n FROM feature_snapshots WHERE synced = 0`
  )
  return row?.n ?? 0
}
