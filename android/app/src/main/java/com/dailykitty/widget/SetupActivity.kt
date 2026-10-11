package com.dailykitty.widget

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Tiny setup screen. The Daily Kitty app opens it with dailykitty://setup?k=… (her) or ?t=… (him),
 * which connects the widgets to the right person. Opened from the launcher, it explains what to do.
 */
class SetupActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handle(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
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

    private fun render() {
        val connected = Auth.isConnected(this)
        val dp = resources.displayMetrics.density
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding((28 * dp).toInt(), (28 * dp).toInt(), (28 * dp).toInt(), (28 * dp).toInt())
            setBackgroundColor(Color.parseColor("#FFF6F9"))
        }
        fun text(s: String, size: Float, bold: Boolean = false, color: String = "#4B3A47") = TextView(this).apply {
            text = s
            textSize = size
            gravity = Gravity.CENTER
            setTextColor(Color.parseColor(color))
            if (bold) typeface = Typeface.DEFAULT_BOLD
            setPadding(0, (8 * dp).toInt(), 0, (8 * dp).toInt())
        }
        root.addView(text("🐾", 54f))
        root.addView(text("Kitty Widgets", 26f, true, "#EC5F93"))
        if (connected) {
            root.addView(text("You're connected 💕", 18f, true))
            root.addView(text(
                "Now long-press an empty spot on your home screen → Widgets → Kitty Widgets, " +
                    "and add \"Daily Kitty\" and \"Sweetie's drawing\".\n\nThey refresh by themselves every 15 minutes.",
                15f,
            ))
        } else {
            root.addView(text(
                "Open the Daily Kitty app and tap \"Connect the widgets\" to link them to you 💌",
                16f,
            ))
        }
        root.addView(Button(this).apply {
            text = if (connected) "Done" else "Open Daily Kitty"
            setTextColor(Color.WHITE)
            isAllCaps = false
            background = GradientDrawable().apply {
                cornerRadius = 40 * dp
                setColor(Color.parseColor("#EC5F93"))
            }
            setOnClickListener {
                if (connected) finish()
                else startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(BASE_URL)))
            }
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (52 * dp).toInt()).apply {
            topMargin = (24 * dp).toInt()
        })
        setContentView(root)
    }
}
