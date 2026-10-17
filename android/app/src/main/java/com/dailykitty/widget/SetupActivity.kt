package com.dailykitty.widget

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.text.format.DateUtils
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * Tiny setup screen. The Daily Kitty app opens it with dailykitty://setup?k=… (her) or ?t=… (him),
 * which connects the widgets to the right person. It also shows when the widgets last refreshed,
 * and asks Android to let the app run in the background (otherwise Samsung puts it to sleep).
 */
class SetupActivity : Activity() {

    private val handler = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handle(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    override fun onResume() {
        super.onResume()
        render()
    }

    private fun handle(intent: Intent?) {
        val data: Uri? = intent?.data
        if (data != null && data.scheme == "dailykitty") {
            val key = data.getQueryParameter("k")
            val token = data.getQueryParameter("t")
            if (key != null || token != null) {
                Auth.save(this, key, token)
                RefreshWorker.schedule(this)
                RefreshWorker.runNow(this)
                Views.redrawAll(this)
            }
        }
        render()
    }

    private fun ignoringBattery(): Boolean =
        getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(packageName) == true

    @SuppressLint("BatteryLife")
    private fun askBattery() {
        try {
            startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
        } catch (_: Exception) {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
        }
    }

    private fun render() {
        val connected = Auth.isConnected(this)
        val dp = resources.displayMetrics.density
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding((28 * dp).toInt(), (40 * dp).toInt(), (28 * dp).toInt(), (28 * dp).toInt())
            setBackgroundColor(Color.parseColor("#FFF6F9"))
        }
        fun text(s: String, size: Float, bold: Boolean = false, color: String = "#4B3A47") = TextView(this).apply {
            text = s
            textSize = size
            gravity = Gravity.CENTER
            setTextColor(Color.parseColor(color))
            if (bold) typeface = Typeface.DEFAULT_BOLD
            setPadding(0, (6 * dp).toInt(), 0, (6 * dp).toInt())
        }
        fun button(label: String, filled: Boolean, onClick: () -> Unit) = Button(this).apply {
            text = label
            isAllCaps = false
            setTextColor(if (filled) Color.WHITE else Color.parseColor("#EC5F93"))
            background = GradientDrawable().apply {
                cornerRadius = 40 * dp
                if (filled) setColor(Color.parseColor("#EC5F93")) else {
                    setColor(Color.WHITE)
                    setStroke((2 * dp).toInt(), Color.parseColor("#EC5F93"))
                }
            }
            setOnClickListener { onClick() }
        }
        val params = { LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (52 * dp).toInt()).apply { topMargin = (12 * dp).toInt() } }

        root.addView(text("🐾", 54f))
        root.addView(text("Kitty Widgets", 26f, true, "#EC5F93"))
        if (!connected) {
            root.addView(text("Open the Daily Kitty app and tap \"Connect the widgets\" to link them to you 💌", 16f))
            root.addView(button("Open Daily Kitty", true) { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(BASE_URL))) }, params())
        } else {
            root.addView(text("You're connected 💕", 18f, true))
            val ok = Status.lastOk(this)
            val error = Status.lastError(this)
            root.addView(text(
                when {
                    error != null -> "⚠️ Last refresh failed: $error"
                    ok > 0 -> "✅ Widgets updated ${DateUtils.getRelativeTimeSpanString(ok)}"
                    else -> "⏳ First update on its way…"
                },
                14f,
                color = if (error != null) "#C62F5B" else "#4B3A47",
            ))
            root.addView(button("🔄 Refresh now", false) {
                RefreshWorker.runNow(this)
                handler.postDelayed({ render() }, 6000)
            }, params())

            if (!ignoringBattery()) {
                root.addView(text(
                    "\nSo the widgets keep updating every day, let Kitty Widgets run in the background:",
                    15f, true,
                ))
                root.addView(button("Allow background updates", true) { askBattery() }, params())
            } else {
                root.addView(text("\n✅ Allowed to update in the background", 14f))
            }
            root.addView(text(
                "\nOn Samsung, also check: Settings → Battery → Background usage limits → " +
                    "Never sleeping apps → add Kitty Widgets.\n\n" +
                    "To add the widgets: long-press an empty spot on your home screen → Widgets → Kitty Widgets. " +
                    "They refresh right after the daily kitty arrives, every 15 minutes, and whenever you tap them.",
                13f, color = "#8E7686",
            ))
        }
        setContentView(ScrollView(this).apply { addView(root) })
    }
}
