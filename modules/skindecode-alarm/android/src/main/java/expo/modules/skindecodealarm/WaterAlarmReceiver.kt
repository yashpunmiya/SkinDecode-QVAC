package expo.modules.skindecodealarm

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

class WaterAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getIntExtra("alarm_id", 8190)
    if (intent.action == ACTION_SNOOZE_ALARM) {
      WaterAlarmScheduler.scheduleSnooze(context, id)
      NotificationManagerCompat.from(context).cancel(id)
      return
    }
    if (intent.action == ACTION_LOG_WATER) {
      NativeWaterLogStore.record(context)
      NotificationManagerCompat.from(context).cancel(id)
      return
    }

    val hour = intent.getIntExtra("hour", 12)
    val minute = intent.getIntExtra("minute", 0)
    if (!intent.getBooleanExtra("snooze", false)) WaterAlarmScheduler.scheduleOne(context, id, hour, minute)

    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26) {
      val channel = NotificationChannel(CHANNEL, "Water reminders", NotificationManager.IMPORTANCE_HIGH).apply {
        setSound(null, null)
        enableVibration(false)
      }
      manager.createNotificationChannel(channel)
    }
    val open = PendingIntent.getActivity(context, id, Intent(context, WaterAlarmActivity::class.java)
      .putExtra("alarm_id", id).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val snoozeAction = PendingIntent.getBroadcast(context, id + ACTION_REQUEST_OFFSET,
      Intent(context, WaterAlarmReceiver::class.java).setAction(ACTION_SNOOZE_ALARM).putExtra("alarm_id", id),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val drinkAction = PendingIntent.getBroadcast(context, id + DRINK_REQUEST_OFFSET,
      Intent(context, WaterAlarmReceiver::class.java).setAction(ACTION_LOG_WATER).putExtra("alarm_id", id),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val notification = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(context.applicationInfo.icon)
      .setContentTitle("A little water, a little pause")
      .setContentText("A gentle moment to drink some water")
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setAutoCancel(true)
      .setFullScreenIntent(open, true)
      .setContentIntent(open)
      .addAction(0, "Snooze 10 min", snoozeAction)
      .addAction(0, "I Drank It", drinkAction)
      .build()
    try { NotificationManagerCompat.from(context).notify(id, notification) } catch (_: SecurityException) { }
  }

  companion object {
    const val ACTION_SNOOZE_ALARM = "com.skindecode.action.SNOOZE_WATER_ALARM"
    const val ACTION_FIRE_SNOOZE = "com.skindecode.action.FIRE_SNOOZED_WATER_ALARM"
    const val ACTION_LOG_WATER = "com.skindecode.action.LOG_WATER_INTAKE"
    private const val CHANNEL = "skindecode_water_alarm"
    private const val ACTION_REQUEST_OFFSET = 20_000
    private const val DRINK_REQUEST_OFFSET = 30_000
  }
}

class AlarmRestoreReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) { WaterAlarmScheduler.restore(context) }
}
