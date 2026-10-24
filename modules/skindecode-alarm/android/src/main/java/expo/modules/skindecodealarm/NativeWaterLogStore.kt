package expo.modules.skindecodealarm

import android.content.Context
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object NativeWaterLogStore {
  private const val ALARM_PREFS = "skindecode_native_alarms"
  private const val SUMMARY_PREFS = "skindecode_water_summary"
  private const val PENDING_KEY = "pending_water_logs"
  private val lock = Any()

  fun record(context: Context): Boolean = synchronized(lock) {
    val alarms = context.getSharedPreferences(ALARM_PREFS, Context.MODE_PRIVATE)
    val userId = alarms.getString("owner_id", "").orEmpty()
    if (userId.isEmpty()) return@synchronized false
    val date = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
    val actionId = java.util.UUID.randomUUID().toString()
    val entry = "$userId|$date|$actionId"
    val summary = context.getSharedPreferences(SUMMARY_PREFS, Context.MODE_PRIVATE)
    val key = "$userId|$date"
    val pending = summary.getStringSet(PENDING_KEY, emptySet()).orEmpty().toMutableSet()
    if (pending.add(entry)) {
      val glasses = summary.getInt("$key|glasses", 0).coerceAtLeast(0)
      summary.edit().putStringSet(PENDING_KEY, pending).putInt("$key|glasses", glasses + 1).commit()
    }
    true
  }

  fun pendingLogs(context: Context, userId: String): List<String> {
    val prefix = "$userId|"
    return context.getSharedPreferences(SUMMARY_PREFS, Context.MODE_PRIVATE)
      .getStringSet(PENDING_KEY, emptySet()).orEmpty()
      .filter { it.startsWith(prefix) }
      // Keep the date with the ID; JS uses it to apply the intake to the correct local day.
      .map { it.removePrefix(prefix) }
  }

  fun acknowledge(context: Context, userId: String, date: String, ids: List<String>) = synchronized(lock) {
    val prefix = "$userId|$date|"
    val prefs = context.getSharedPreferences(SUMMARY_PREFS, Context.MODE_PRIVATE)
    val pending = prefs.getStringSet(PENDING_KEY, emptySet()).orEmpty().toMutableSet()
    ids.forEach { pending.remove(prefix + it) }
    prefs.edit().putStringSet(PENDING_KEY, pending).commit()
  }

  fun clearUser(context: Context, userId: String) = synchronized(lock) {
    val prefix = "$userId|"
    val summary = context.getSharedPreferences(SUMMARY_PREFS, Context.MODE_PRIVATE)
    val editor = summary.edit()
    summary.all.keys.filter { it.startsWith(prefix) }.forEach { editor.remove(it) }
    val pending = summary.getStringSet(PENDING_KEY, emptySet()).orEmpty().filterNot { it.startsWith(prefix) }.toSet()
    editor.putStringSet(PENDING_KEY, pending).commit()
    val alarms = context.getSharedPreferences(ALARM_PREFS, Context.MODE_PRIVATE)
    if (alarms.getString("owner_id", "").orEmpty() == userId) alarms.edit().remove("owner_id").commit()
  }
}
