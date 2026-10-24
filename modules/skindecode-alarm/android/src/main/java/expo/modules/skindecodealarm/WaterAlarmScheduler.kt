package expo.modules.skindecodealarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import java.util.Calendar

object WaterAlarmScheduler {
  private const val PREFS = "skindecode_native_alarms"
  private const val IDS = "water_ids"
  private const val SNOOZE_REQUEST_OFFSET = 20_000

  fun cancel(context: Context) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val ids = prefs.getStringSet(IDS, emptySet()).orEmpty()
    ids.forEach { raw ->
      raw.toIntOrNull()?.let { id ->
        cancelPending(manager, context, id, Intent(context, WaterAlarmReceiver::class.java))
        val snoozeIntent = Intent(context, WaterAlarmReceiver::class.java).setAction(WaterAlarmReceiver.ACTION_FIRE_SNOOZE)
        cancelPending(manager, context, id + SNOOZE_REQUEST_OFFSET, snoozeIntent)
        NotificationManagerCompat.from(context).cancel(id)
        cancelLegacyAppAction(context, id + 30_000, "log")
        cancelLegacyAppAction(context, id + 30_000, "open")
      }
    }
    // Clear already-posted alarms from older builds; their action launched a stale app deep link.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      val notifications = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
      try {
        notifications.activeNotifications
          .filter { it.notification.channelId == "skindecode_water_alarm" }
          .forEach { notifications.cancel(it.tag, it.id) }
      } catch (_: SecurityException) { }
    }
    prefs.edit().remove(IDS).remove("hours").remove("minutes").remove("owner_id").apply()
  }

  private fun cancelLegacyAppAction(context: Context, requestCode: Int, action: String) {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    launch.action = Intent.ACTION_VIEW
    launch.data = Uri.parse("skindecode:///water-reminder?action=$action")
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    PendingIntent.getActivity(context, requestCode, launch, PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)?.cancel()
  }

  private fun cancelPending(manager: AlarmManager, context: Context, requestCode: Int, intent: Intent) {
    val pending = PendingIntent.getBroadcast(context, requestCode, intent, PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)
    if (pending != null) manager.cancel(pending)
  }

  fun schedule(context: Context, times: List<Pair<Int, Int>>, userId: String) {
    val ids = mutableSetOf<String>()
    try {
      times.forEach { (hour, minute) ->
        if (hour !in 0..23 || minute !in 0..59) return@forEach
        val id = 8100 + hour * 60 + minute
        ids.add(id.toString())
        scheduleOne(context, id, hour, minute)
      }
    } catch (error: Exception) {
      cancel(context)
      throw error
    }
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putStringSet(IDS, ids)
      .putString("hours", times.joinToString(",") { it.first.toString() })
      .putString("minutes", times.joinToString(",") { it.second.toString() })
      .apply()
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("owner_id", userId).apply()
  }

  fun scheduleOne(context: Context, id: Int, hour: Int, minute: Int) {
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val at = Calendar.getInstance().apply {
      set(Calendar.HOUR_OF_DAY, hour); set(Calendar.MINUTE, minute); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
      if (timeInMillis <= System.currentTimeMillis()) add(Calendar.DAY_OF_YEAR, 1)
    }
    val intent = Intent(context, WaterAlarmReceiver::class.java).putExtra("alarm_id", id).putExtra("hour", hour).putExtra("minute", minute)
    val pending = PendingIntent.getBroadcast(context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val show = PendingIntent.getActivity(context, id, Intent(context, WaterAlarmActivity::class.java).putExtra("alarm_id", id).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    manager.setAlarmClock(AlarmManager.AlarmClockInfo(at.timeInMillis, show), pending)
  }

  fun scheduleSnooze(context: Context, alarmId: Int, minutes: Int = 10) {
    val requestCode = alarmId + SNOOZE_REQUEST_OFFSET
    val intent = Intent(context, WaterAlarmReceiver::class.java)
      .setAction(WaterAlarmReceiver.ACTION_FIRE_SNOOZE)
      .putExtra("alarm_id", alarmId)
      .putExtra("snooze", true)
    val pending = PendingIntent.getBroadcast(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val at = System.currentTimeMillis() + minutes.coerceIn(5, 30) * 60_000L
    val show = PendingIntent.getActivity(context, requestCode, Intent(context, WaterAlarmActivity::class.java).putExtra("alarm_id", alarmId).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    manager.setAlarmClock(AlarmManager.AlarmClockInfo(at, show), pending)
  }

  fun restore(context: Context) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val hours = prefs.getString("hours", "").orEmpty().split(',').mapNotNull { it.toIntOrNull() }
    val minutes = prefs.getString("minutes", "").orEmpty().split(',').mapNotNull { it.toIntOrNull() }
    val ownerId = prefs.getString("owner_id", "").orEmpty()
    if (hours.size == minutes.size && ownerId.isNotEmpty()) schedule(context, hours.zip(minutes), ownerId)
  }
}
