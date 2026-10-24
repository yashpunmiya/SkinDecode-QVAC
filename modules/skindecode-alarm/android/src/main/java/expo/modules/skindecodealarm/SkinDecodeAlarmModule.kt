package expo.modules.skindecodealarm

import android.app.AlarmManager
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SkinDecodeAlarmModule : Module() {
  private var waterLogPreferences: SharedPreferences? = null
  private var waterLogPreferenceListener: SharedPreferences.OnSharedPreferenceChangeListener? = null

  override fun definition() = ModuleDefinition {
    Name("SkinDecodeAlarm")
    Events("waterLogRecorded")

    // A notification action can be tapped while React Native is already active
    // (for example with the notification shade open), so AppState alone is not
    // a reliable signal to refresh the Home counter.
    OnCreate {
      val preferences = requireNotNull(appContext.reactContext)
        .getSharedPreferences("skindecode_water_summary", Context.MODE_PRIVATE)
      val listener = SharedPreferences.OnSharedPreferenceChangeListener { changed, key ->
        if (key == "pending_water_logs" && !changed.getStringSet(key, emptySet()).isNullOrEmpty()) {
          sendEvent("waterLogRecorded", mapOf("pending" to true))
        }
      }
      waterLogPreferences = preferences
      waterLogPreferenceListener = listener
      preferences.registerOnSharedPreferenceChangeListener(listener)
    }

    OnDestroy {
      waterLogPreferenceListener?.let { listener -> waterLogPreferences?.unregisterOnSharedPreferenceChangeListener(listener) }
      waterLogPreferenceListener = null
      waterLogPreferences = null
    }

    Function("isAvailable") { true }
    Function("getPendingWaterLogs") { userId: String ->
      NativeWaterLogStore.pendingLogs(requireNotNull(appContext.reactContext), userId)
    }
    AsyncFunction("acknowledgeWaterLogIds") { userId: String, localDate: String, ids: List<String> ->
      NativeWaterLogStore.acknowledge(requireNotNull(appContext.reactContext), userId, localDate, ids)
    }
    Function("hasPermission") {
      val context = requireNotNull(appContext.reactContext)
      val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || manager.canScheduleExactAlarms()) &&
        (Build.VERSION.SDK_INT < 34 || (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).canUseFullScreenIntent())
    }
    AsyncFunction("requestPermission") { ->
      val context = requireNotNull(appContext.reactContext)
      val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !manager.canScheduleExactAlarms()) {
        openAlarmSettings(context, Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
        return@AsyncFunction false
      }
      if (Build.VERSION.SDK_INT >= 34 && !(context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).canUseFullScreenIntent()) {
        openAlarmSettings(context, Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT)
        return@AsyncFunction false
      }
      true
    }
    AsyncFunction("openPermissionSettings") { ->
      val context = requireNotNull(appContext.reactContext)
      val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      val action = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !manager.canScheduleExactAlarms()) Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM else Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT
      openAlarmSettings(context, action)
    }
    AsyncFunction("updateWaterSnapshot") { userId: String, localDate: String, glasses: Int, goal: Int ->
      val context = requireNotNull(appContext.reactContext)
      val key = "$userId|$localDate"
      context.getSharedPreferences("skindecode_water_summary", Context.MODE_PRIVATE).edit()
        .putInt("$key|glasses", glasses.coerceAtLeast(0))
        .putInt("$key|goal", goal.coerceIn(1, 12))
        .apply()
    }
    AsyncFunction("setWaterReminderOwner") { userId: String ->
      val context = requireNotNull(appContext.reactContext)
      context.getSharedPreferences("skindecode_native_alarms", Context.MODE_PRIVATE).edit().putString("owner_id", userId).commit()
    }
    AsyncFunction("clearUserData") { userId: String ->
      NativeWaterLogStore.clearUser(requireNotNull(appContext.reactContext), userId)
    }
    AsyncFunction("scheduleDaily") { hours: List<Int>, minutes: List<Int> ->
      require(hours.size == minutes.size) { "Invalid alarm schedule" }
      val context = requireNotNull(appContext.reactContext)
      val ownerId = context.getSharedPreferences("skindecode_native_alarms", Context.MODE_PRIVATE).getString("owner_id", "").orEmpty()
      WaterAlarmScheduler.cancel(context)
      if (ownerId.isNotEmpty()) WaterAlarmScheduler.schedule(context, hours.zip(minutes), ownerId)
    }
    AsyncFunction("scheduleSnooze") { minutes: Int ->
      val context = requireNotNull(appContext.reactContext)
      val currentId = context.getSharedPreferences("skindecode_native_alarms", Context.MODE_PRIVATE)
        .getStringSet("water_ids", emptySet()).orEmpty().firstOrNull()?.toIntOrNull() ?: 8190
      WaterAlarmScheduler.scheduleSnooze(context, currentId, minutes)
    }
    AsyncFunction("cancelAll") { -> WaterAlarmScheduler.cancel(requireNotNull(appContext.reactContext)) }
  }

  private fun openAlarmSettings(context: Context, action: String) {
    val intent = Intent(action, Uri.parse("package:${context.packageName}"))
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
  }
}
