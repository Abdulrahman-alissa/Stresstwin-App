package expo.modules.stresstwinkeyboard

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/**
 * A keyboard (InputMethodService) and the host app run in the same Android
 * process/UID when both are declared by the same package, so a plain SQLite
 * file under the app's data directory is readable from both without needing
 * ContentProvider ceremony. Only aggregated, content-free snapshots are ever
 * written here (see BehavioralFeatureCollector's privacy invariant).
 */
class LocalSnapshotStore(context: Context) :
    SQLiteOpenHelper(context.applicationContext, "stresstwin_keyboard_buffer.db", null, 1) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS snapshots (
                client_snapshot_id     TEXT PRIMARY KEY,
                window_start           TEXT NOT NULL,
                typing_speed_cps       REAL,
                inter_key_interval_ms  REAL,
                backspace_rate         REAL,
                correction_rate        REAL,
                pause_frequency        REAL,
                typing_bursts          INTEGER,
                typing_interruptions   INTEGER,
                char_count             INTEGER,
                session_duration       INTEGER NOT NULL
            )
            """.trimIndent()
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        db.execSQL("DROP TABLE IF EXISTS snapshots")
        onCreate(db)
    }

    fun insert(s: FeatureSnapshot) {
        val values = ContentValues().apply {
            put("client_snapshot_id", s.clientSnapshotId)
            put("window_start", s.windowStartIso)
            put("typing_speed_cps", s.typingSpeedCps)
            put("inter_key_interval_ms", s.interKeyIntervalMs)
            put("backspace_rate", s.backspaceRate)
            put("correction_rate", s.correctionRate)
            put("pause_frequency", s.pauseFrequency)
            put("typing_bursts", s.typingBursts)
            put("typing_interruptions", s.typingInterruptions)
            put("char_count", s.charCount)
            put("session_duration", s.sessionDuration)
        }
        writableDatabase.insertWithOnConflict("snapshots", null, values, SQLiteDatabase.CONFLICT_IGNORE)
    }

    /** Reads and removes everything buffered — called by the JS bridge's drainSnapshots(). */
    fun drainAll(): List<FeatureSnapshot> {
        val db = writableDatabase
        val out = mutableListOf<FeatureSnapshot>()
        db.rawQuery("SELECT * FROM snapshots ORDER BY window_start ASC LIMIT 2000", null).use { c ->
            while (c.moveToNext()) {
                out.add(
                    FeatureSnapshot(
                        clientSnapshotId = c.getString(c.getColumnIndexOrThrow("client_snapshot_id")),
                        windowStartIso = c.getString(c.getColumnIndexOrThrow("window_start")),
                        typingSpeedCps = c.getDoubleOrNull("typing_speed_cps"),
                        interKeyIntervalMs = c.getDoubleOrNull("inter_key_interval_ms"),
                        backspaceRate = c.getDoubleOrNull("backspace_rate"),
                        correctionRate = c.getDoubleOrNull("correction_rate"),
                        pauseFrequency = c.getDoubleOrNull("pause_frequency"),
                        typingBursts = c.getIntOrNull("typing_bursts"),
                        typingInterruptions = c.getIntOrNull("typing_interruptions"),
                        charCount = c.getIntOrNull("char_count"),
                        sessionDuration = c.getInt(c.getColumnIndexOrThrow("session_duration")),
                    )
                )
            }
        }
        if (out.isNotEmpty()) db.delete("snapshots", null, null)
        return out
    }

    private fun android.database.Cursor.getDoubleOrNull(col: String): Double? {
        val i = getColumnIndexOrThrow(col)
        return if (isNull(i)) null else getDouble(i)
    }

    private fun android.database.Cursor.getIntOrNull(col: String): Int? {
        val i = getColumnIndexOrThrow(col)
        return if (isNull(i)) null else getInt(i)
    }
}
