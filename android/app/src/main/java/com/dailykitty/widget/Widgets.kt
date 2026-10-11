package com.dailykitty.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
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
            if (conn.responseCode != 200) throw RuntimeException("HTTP ${conn.responseCode}")
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
        conn.setRequestProperty("User-Agent", "KittyWidgets/1.0")
        val bytes = try {
            if (conn.responseCode != 200) return null
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
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("$BASE_URL/$hash")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return PendingIntent.getActivity(ctx, hash.hashCode(), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    fun kitty(ctx: Context): RemoteViews = RemoteViews(ctx.packageName, R.layout.widget_kitty).apply {
        val bitmap = Cache.bitmap(ctx, "kitty")
        val caption = Cache.caption(ctx, "kitty")
        if (bitmap != null) {
            setImageViewBitmap(R.id.image, bitmap)
            setViewVisibility(R.id.placeholder, View.GONE)
        } else {
            setTextViewText(R.id.placeholder, if (Auth.isConnected(ctx)) "🐾 Kitty on the way…" else "🐾 Open Kitty Widgets to connect")
        }
        setTextViewText(R.id.caption, caption)
        setViewVisibility(R.id.caption, if (caption.isNotBlank()) View.VISIBLE else View.GONE)
        setOnClickPendingIntent(R.id.root, open(ctx, ""))
    }

    fun doodle(ctx: Context): RemoteViews = RemoteViews(ctx.packageName, R.layout.widget_doodle).apply {
        val bitmap = Cache.bitmap(ctx, "doodle")
        if (bitmap != null) {
            setImageViewBitmap(R.id.image, bitmap)
            setViewVisibility(R.id.placeholder, View.GONE)
        } else {
            setTextViewText(R.id.placeholder, if (Auth.isConnected(ctx)) "🎨 No drawing yet" else "🎨 Open Kitty Widgets to connect")
        }
        setOnClickPendingIntent(R.id.root, open(ctx, "#draw"))
    }

    fun redrawAll(ctx: Context) {
        val manager = AppWidgetManager.getInstance(ctx)
        manager.getAppWidgetIds(ComponentName(ctx, KittyWidget::class.java)).forEach { manager.updateAppWidget(it, kitty(ctx)) }
        manager.getAppWidgetIds(ComponentName(ctx, DoodleWidget::class.java)).forEach { manager.updateAppWidget(it, doodle(ctx)) }
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
            Result.success()
        } catch (e: Exception) {
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
        val bitmap = Net.bitmap(url) ?: return
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
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("refresh", ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }
}

class KittyWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { manager.updateAppWidget(it, Views.kitty(ctx)) }
        RefreshWorker.schedule(ctx)
        RefreshWorker.runNow(ctx)
    }
}

class DoodleWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { manager.updateAppWidget(it, Views.doodle(ctx)) }
        RefreshWorker.schedule(ctx)
        RefreshWorker.runNow(ctx)
    }
}
