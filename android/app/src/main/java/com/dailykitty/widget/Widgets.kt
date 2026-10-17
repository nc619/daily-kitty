package com.dailykitty.widget

import android.app.Activity
import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

const val BASE_URL = "https://daily-kitty.onrender.com"

/** Who this phone is: her private key or his token, handed over by the Daily Kitty app. */
object Auth {
    private fun prefs(ctx: Context) = ctx.getSharedPreferences("auth", Context.MODE_PRIVATE)

    fun save(ctx: Context, key: String?, token: String?) {
        prefs(ctx).edit().putString("key", key).putString("token", token).apply()
    }

    fun isConnected(ctx: Context) = prefs(ctx).getString("key", null) != null || prefs(ctx).getString("token", null) != null

    fun apply(ctx: Context, conn: HttpURLConnection) {
        prefs(ctx).getString("key", null)?.let { conn.setRequestProperty("x-kitty-key", it) }
        prefs(ctx).getString("token", null)?.let { conn.setRequestProperty("x-sweetie-token", it) }
    }
}

/** Last refresh result, shown in the Kitty Widgets app to help when something looks stuck. */
object Status {
    private fun prefs(ctx: Context) = ctx.getSharedPreferences("status", Context.MODE_PRIVATE)
    fun ok(ctx: Context) = prefs(ctx).edit().putLong("okAt", System.currentTimeMillis()).remove("error").apply()
    fun error(ctx: Context, message: String) =
        prefs(ctx).edit().putString("error", message).putLong("errorAt", System.currentTimeMillis()).apply()
    fun lastOk(ctx: Context) = prefs(ctx).getLong("okAt", 0L)
    fun lastError(ctx: Context): String? = prefs(ctx).getString("error", null)
}

/** Last pictures shown, kept on disk so widgets redraw instantly. */
object Cache {
    fun file(ctx: Context, name: String) = File(ctx.filesDir, "$name.png")

    fun bitmap(ctx: Context, name: String): Bitmap? =
        file(ctx, name).takeIf { it.exists() }?.let { BitmapFactory.decodeFile(it.path) }

    fun caption(ctx: Context, name: String): String =
        ctx.getSharedPreferences("cache", Context.MODE_PRIVATE).getString("$name-caption", "") ?: ""

    fun url(ctx: Context, name: String): String? =
        ctx.getSharedPreferences("cache", Context.MODE_PRIVATE).getString("$name-url", null)

    fun save(ctx: Context, name: String, url: String, caption: String, bitmap: Bitmap) {
        val tmp = File(ctx.filesDir, "$name.tmp")
        tmp.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        tmp.renameTo(file(ctx, name))
        ctx.getSharedPreferences("cache", Context.MODE_PRIVATE).edit()
            .putString("$name-url", url).putString("$name-caption", caption).apply()
    }

    fun clear(ctx: Context, name: String) {
        file(ctx, name).delete()
        ctx.getSharedPreferences("cache", Context.MODE_PRIVATE).edit().remove("$name-url").remove("$name-caption").apply()
    }
}

object Net {
    fun get(ctx: Context, path: String): JSONObject {
        val conn = URL(BASE_URL + path).openConnection() as HttpURLConnection
        conn.connectTimeout = 60_000 // the free server may need to wake up
        conn.readTimeout = 90_000
        Auth.apply(ctx, conn)
        try {
            if (conn.responseCode == 403) throw RuntimeException("Not connected any more. Tap \"Connect the widgets\" in Daily Kitty again.")
            if (conn.responseCode != 200) throw RuntimeException("Server answered HTTP ${conn.responseCode}")
            return JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
        } finally {
            conn.disconnect()
        }
    }

    /** Downloads a picture, shrunk to at most [max] px so it fits in a widget. */
    fun bitmap(url: String, max: Int = 720): Bitmap? {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 60_000
        conn.readTimeout = 90_000
        conn.instanceFollowRedirects = true
        conn.setRequestProperty("User-Agent", "KittyWidgets/2.0")
        val bytes = try {
            if (conn.responseCode != 200) throw RuntimeException("Picture download failed (HTTP ${conn.responseCode})")
            conn.inputStream.use { it.readBytes() }
        } finally {
            conn.disconnect()
        }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= max && bounds.outHeight / (sample * 2) >= max) sample *= 2
        val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
            ?: return null
        val scale = minOf(1f, max.toFloat() / maxOf(decoded.width, decoded.height))
        return if (scale < 1f) {
            Bitmap.createScaledBitmap(decoded, (decoded.width * scale).toInt(), (decoded.height * scale).toInt(), true)
        } else decoded
    }
}

object Views {
    private fun open(ctx: Context, hash: String): PendingIntent {
        val intent = Intent(ctx, OpenActivity::class.java)
            .putExtra("hash", hash)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return PendingIntent.getActivity(ctx, hash.hashCode(), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun RemoteViews.clickable(pi: PendingIntent) {
        setOnClickPendingIntent(R.id.root, pi)
        setOnClickPendingIntent(R.id.image, pi)
        setOnClickPendingIntent(R.id.placeholder, pi)
        setOnClickPendingIntent(R.id.caption, pi)
    }

    /** A cheap soft blur: shrink the photo to a few pixels and let Android smooth it back up. */
    private fun blurred(src: Bitmap): Bitmap {
        val w = 16
        val h = maxOf(1, w * src.height / maxOf(1, src.width))
        val tiny = Bitmap.createScaledBitmap(src, w, h, true)
        return Bitmap.createScaledBitmap(tiny, w * 10, h * 10, true)
    }

    fun kitty(ctx: Context, compact: Boolean): RemoteViews = RemoteViews(ctx.packageName, R.layout.widget_kitty).apply {
        val bitmap = Cache.bitmap(ctx, "kitty")
        val caption = Cache.caption(ctx, "kitty")
        if (bitmap != null) {
            setImageViewBitmap(R.id.image, bitmap)
            setImageViewBitmap(R.id.bg, blurred(bitmap))
            setViewVisibility(R.id.placeholder, View.GONE)
        } else {
            setViewVisibility(R.id.placeholder, View.VISIBLE)
            setTextViewText(R.id.placeholder, if (Auth.isConnected(ctx)) "🐾 Kitty on the way…" else "🐾 Open Kitty Widgets to connect")
        }
        setTextViewText(R.id.caption, caption)
        setViewVisibility(R.id.caption, if (caption.isNotBlank() && !compact) View.VISIBLE else View.GONE)
        clickable(open(ctx, ""))
    }

    fun doodle(ctx: Context, compact: Boolean): RemoteViews = RemoteViews(ctx.packageName, R.layout.widget_doodle).apply {
        val bitmap = Cache.bitmap(ctx, "doodle")
        if (bitmap != null) {
            setImageViewBitmap(R.id.image, bitmap)
            setViewVisibility(R.id.placeholder, View.GONE)
            setViewVisibility(R.id.caption, if (compact) View.GONE else View.VISIBLE)
        } else {
            setViewVisibility(R.id.placeholder, View.VISIBLE)
            setViewVisibility(R.id.caption, View.GONE)
            setTextViewText(
                R.id.placeholder,
                if (Auth.isConnected(ctx)) "🎨 No drawing from your sweetie yet\nTap to draw one ✏️" else "🎨 Open Kitty Widgets to connect",
            )
        }
        clickable(open(ctx, "#draw"))
    }

    /** Tiny widgets (about one cell) hide the caption and the "Draw back" bubble. */
    fun isCompact(manager: AppWidgetManager, id: Int): Boolean {
        val options = manager.getAppWidgetOptions(id)
        val w = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 110)
        val h = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 110)
        return w in 1..99 || h in 1..99
    }

    fun update(ctx: Context, manager: AppWidgetManager, id: Int, isDoodle: Boolean) {
        val compact = isCompact(manager, id)
        manager.updateAppWidget(id, if (isDoodle) doodle(ctx, compact) else kitty(ctx, compact))
    }

    private val kittyProviders = listOf(KittyWidget::class.java, KittyWidgetSmall::class.java, KittyWidgetWide::class.java, KittyWidgetLarge::class.java)
    private val doodleProviders = listOf(DoodleWidget::class.java, DoodleWidgetMedium::class.java, DoodleWidgetLarge::class.java)

    fun redrawAll(ctx: Context) {
        val manager = AppWidgetManager.getInstance(ctx)
        kittyProviders.forEach { cls -> manager.getAppWidgetIds(ComponentName(ctx, cls)).forEach { update(ctx, manager, it, false) } }
        doodleProviders.forEach { cls -> manager.getAppWidgetIds(ComponentName(ctx, cls)).forEach { update(ctx, manager, it, true) } }
    }
}

class RefreshWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result {
        val ctx = applicationContext
        if (!Auth.isConnected(ctx)) return Result.success()
        return try {
            val data = Net.get(ctx, "/api/widget")
            update(ctx, "kitty", data.optJSONObject("kitty"))
            update(ctx, "doodle", data.optJSONObject("doodle"))
            Views.redrawAll(ctx)
            data.optLong("nextDaily").takeIf { it > 0 }?.let { DailyAlarm.set(ctx, it) }
            Status.ok(ctx)
            Result.success()
        } catch (e: Exception) {
            Status.error(ctx, e.message ?: e.javaClass.simpleName)
            if (runAttemptCount < 3) Result.retry() else Result.failure()
        }
    }

    private fun update(ctx: Context, name: String, item: JSONObject?) {
        if (item == null) {
            Cache.clear(ctx, name)
            return
        }
        val url = item.optString("url")
        val caption = item.optString("caption")
        if (url.isBlank()) return
        if (url == Cache.url(ctx, name) && Cache.file(ctx, name).exists()) {
            if (caption != Cache.caption(ctx, name)) Cache.bitmap(ctx, name)?.let { Cache.save(ctx, name, url, caption, it) }
            return
        }
        val bitmap = Net.bitmap(url) ?: throw RuntimeException("Could not read the $name picture")
        Cache.save(ctx, name, url, caption, bitmap)
    }

    companion object {
        private val network = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        fun runNow(ctx: Context) {
            val request = OneTimeWorkRequestBuilder<RefreshWorker>().setConstraints(network).build()
            WorkManager.getInstance(ctx).enqueueUniqueWork("refresh-now", ExistingWorkPolicy.REPLACE, request)
        }

        /** Every 15 minutes (the shortest Android allows). */
        fun schedule(ctx: Context) {
            val request = PeriodicWorkRequestBuilder<RefreshWorker>(15, TimeUnit.MINUTES).setConstraints(network).build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("refresh", ExistingPeriodicWorkPolicy.UPDATE, request)
        }
    }
}

/** Wakes the app a few minutes after the daily kitty is delivered, even in deep sleep. */
object DailyAlarm {
    fun set(ctx: Context, atMillis: Long) {
        val alarms = ctx.getSystemService(AlarmManager::class.java) ?: return
        val pi = PendingIntent.getBroadcast(
            ctx, 1, Intent(ctx, AlarmReceiver::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, pi)
    }
}

class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        RefreshWorker.runNow(ctx)
        DailyAlarm.set(ctx, System.currentTimeMillis() + 24 * 60 * 60 * 1000L) // refined after the refresh
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (!Auth.isConnected(ctx)) return
        RefreshWorker.schedule(ctx)
        RefreshWorker.runNow(ctx)
    }
}

/** Invisible: refreshes the widgets, then opens Daily Kitty (on the drawing page for the drawing widget). */
class OpenActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        RefreshWorker.runNow(this)
        val hash = intent.getStringExtra("hash").orEmpty()
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("$BASE_URL/$hash")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Exception) {
        }
        finish()
    }
}

/** Same widget, several default sizes in the widget picker (each can still be resized). */
open class KittyWidget : AppWidgetProvider() {
    open val isDoodle = false

    override fun onUpdate(ctx: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { Views.update(ctx, manager, it, isDoodle) }
        RefreshWorker.schedule(ctx)
        RefreshWorker.runNow(ctx)
    }

    override fun onAppWidgetOptionsChanged(ctx: Context, manager: AppWidgetManager, id: Int, newOptions: Bundle) {
        Views.update(ctx, manager, id, isDoodle) // resized: show or hide the caption
    }
}

class KittyWidgetSmall : KittyWidget()
class KittyWidgetWide : KittyWidget()
class KittyWidgetLarge : KittyWidget()

open class DoodleWidget : KittyWidget() {
    override val isDoodle = true
}

class DoodleWidgetMedium : DoodleWidget()
class DoodleWidgetLarge : DoodleWidget()
