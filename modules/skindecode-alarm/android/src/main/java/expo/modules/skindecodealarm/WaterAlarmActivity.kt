package expo.modules.skindecodealarm

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.content.res.ColorStateList
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Gravity
import android.view.WindowManager
import android.view.animation.OvershootInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.core.app.NotificationManagerCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class WaterAlarmActivity : Activity() {
  companion object {
    private const val AUTO_DISMISS_AFTER_MS = 5 * 60 * 1000L
    private const val STATE_AUTO_DISMISS_AT = "water_alarm_auto_dismiss_at"
  }

  private val autoDismissHandler = Handler(Looper.getMainLooper())
  private var autoDismissAtElapsed = 0L
  private val autoDismiss = object : Runnable {
    override fun run() {
      val remaining = autoDismissAtElapsed - SystemClock.elapsedRealtime()
      if (remaining <= 0L) {
        finish()
      } else {
        autoDismissHandler.postDelayed(this, remaining)
      }
    }
  }

  private val ink = Color.rgb(36, 56, 47)
  private val muted = Color.rgb(112, 128, 119)
  private val forest = Color.rgb(48, 91, 75)
  private val softGreen = Color.rgb(238, 245, 239)
  private val alarmId by lazy { intent.getIntExtra("alarm_id", 8190) }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    autoDismissAtElapsed = savedInstanceState?.getLong(STATE_AUTO_DISMISS_AT)
      ?.takeIf { it > 0L }
      ?: (SystemClock.elapsedRealtime() + AUTO_DISMISS_AFTER_MS)
    if (SystemClock.elapsedRealtime() >= autoDismissAtElapsed) {
      finish()
      return
    }
    scheduleAutoDismiss()
    NotificationManagerCompat.from(this).cancel(alarmId)
    if (Build.VERSION.SDK_INT >= 27) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    }
    // Let Android's normal display timeout turn off the screen; this card must
    // never hold a wake lock while unattended.
    window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or WindowManager.LayoutParams.FLAG_DIM_BEHIND)
    window.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
    window.attributes = window.attributes.apply { dimAmount = 0.58f }
    window.statusBarColor = Color.TRANSPARENT
    window.navigationBarColor = Color.TRANSPARENT
    WindowCompat.setDecorFitsSystemWindows(window, false)
    WindowInsetsControllerCompat(window, window.decorView).show(WindowInsetsCompat.Type.statusBars() or WindowInsetsCompat.Type.navigationBars())

    val root = FrameLayout(this).apply { setBackgroundColor(Color.argb(132, 18, 34, 28)); isClickable = true }
    val card = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      setPadding(dp(19), dp(17), dp(19), dp(16))
      background = rounded(Color.WHITE, 27)
      elevation = dp(18).toFloat()
      clipChildren = false
      clipToPadding = false
    }

    val top = FrameLayout(this).apply { layoutParams = LinearLayout.LayoutParams(-1, dp(25)) }
    top.addView(TextView(this).apply {
      text = "×"
      textSize = 20f
      gravity = Gravity.CENTER
      setTextColor(muted)
      background = rounded(Color.rgb(247, 249, 247), 18)
      setOnClickListener { finish() }
    }, FrameLayout.LayoutParams(dp(29), dp(29), Gravity.END or Gravity.TOP))
    card.addView(top)

    val mascotStage = FrameLayout(this).apply {
      layoutParams = LinearLayout.LayoutParams(-1, dp(166)).apply { topMargin = dp(2) }
      clipChildren = false
      clipToPadding = false
    }
    mascotStage.addView(ImageView(this).apply {
      setImageResource(R.drawable.water_mascot)
      scaleType = ImageView.ScaleType.FIT_CENTER
      contentDescription = "SkinDecode water mascot"
      translationY = -dp(7).toFloat()
    }, FrameLayout.LayoutParams(dp(190), dp(190), Gravity.CENTER))
    card.addView(mascotStage)

    card.addView(TextView(this).apply {
      text = "A little water break"
      textSize = 20f
      setTextColor(ink)
      typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
      gravity = Gravity.CENTER
    }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(2); bottomMargin = dp(14) })

    val (glasses, goal) = currentWaterSummary()
    val summary = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(14), dp(12), dp(14), dp(12))
      background = rounded(softGreen, 16)
    }
    val summaryHeader = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
    }
    summaryHeader.addView(TextView(this).apply {
      text = "WATER TODAY"
      textSize = 9f
      letterSpacing = 0.12f
      setTextColor(muted)
      typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    }, LinearLayout.LayoutParams(0, -2, 1f))
    summaryHeader.addView(TextView(this).apply {
      text = "$glasses / $goal glasses"
      textSize = 14f
      setTextColor(ink)
      typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    })
    summary.addView(summaryHeader)
    summary.addView(ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
      max = goal
      progress = glasses.coerceAtMost(goal)
      progressTintList = ColorStateList.valueOf(forest)
      progressBackgroundTintList = ColorStateList.valueOf(Color.rgb(215, 228, 217))
      isIndeterminate = false
    }, LinearLayout.LayoutParams(-1, dp(6)).apply { topMargin = dp(9) })
    card.addView(summary, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(13) })

    val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER; setBackgroundColor(Color.TRANSPARENT) }
    actions.addView(actionButton("Snooze", false) { snooze() }, LinearLayout.LayoutParams(0, dp(47), 1f).apply { rightMargin = dp(6) })
    actions.addView(actionButton("I Drank It", true) { logWater() }, LinearLayout.LayoutParams(0, dp(47), 1f).apply { leftMargin = dp(6) })
    card.addView(actions)

    root.addView(card, FrameLayout.LayoutParams(-1, -2, Gravity.CENTER).apply { leftMargin = dp(24); rightMargin = dp(24) })
    setContentView(root)
    card.scaleX = 0.92f
    card.scaleY = 0.92f
    card.alpha = 0f
    card.animate().scaleX(1f).scaleY(1f).alpha(1f).setDuration(360).setInterpolator(OvershootInterpolator(0.78f)).start()
  }

  override fun onResume() {
    super.onResume()
    // Handler callbacks can be delayed by Doze while the screen is off. Expire
    // against elapsed realtime when this activity becomes visible again.
    scheduleAutoDismiss()
  }

  override fun onSaveInstanceState(outState: Bundle) {
    outState.putLong(STATE_AUTO_DISMISS_AT, autoDismissAtElapsed)
    super.onSaveInstanceState(outState)
  }

  override fun onDestroy() {
    autoDismissHandler.removeCallbacks(autoDismiss)
    super.onDestroy()
  }

  private fun scheduleAutoDismiss() {
    autoDismissHandler.removeCallbacks(autoDismiss)
    if (SystemClock.elapsedRealtime() >= autoDismissAtElapsed) finish()
    else autoDismissHandler.postDelayed(autoDismiss, autoDismissAtElapsed - SystemClock.elapsedRealtime())
  }

  private fun currentWaterSummary(): Pair<Int, Int> {
    val owner = getSharedPreferences("skindecode_native_alarms", MODE_PRIVATE).getString("owner_id", "").orEmpty()
    if (owner.isEmpty()) return 0 to 8
    val today = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
    val summary = getSharedPreferences("skindecode_water_summary", MODE_PRIVATE)
    val key = "$owner|$today"
    val goal = summary.getInt("$key|goal", 8).coerceIn(1, 12)
    val glasses = summary.getInt("$key|glasses", 0).coerceAtLeast(0)
    return glasses to goal
  }

  private fun snooze() {
    WaterAlarmScheduler.scheduleSnooze(this, alarmId)
    finish()
  }

  private fun logWater() {
    NativeWaterLogStore.record(this)
    finish()
  }

  private fun actionButton(label: String, primary: Boolean, action: () -> Unit) = TextView(this).apply {
    text = label
    textSize = 12f
    gravity = Gravity.CENTER
    setTextColor(if (primary) Color.WHITE else forest)
    typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    background = rounded(if (primary) forest else Color.rgb(239, 245, 240), 24)
    setOnClickListener { action() }
  }

  private fun rounded(color: Int, radiusDp: Int) = GradientDrawable().apply { setColor(color); cornerRadius = dp(radiusDp).toFloat() }
  private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
