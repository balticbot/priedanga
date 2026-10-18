package com.balticbot.priedanga.tiltas

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log

/** One engine per process, shared by the foreground service and the JS module. */
object TiltasRuntime {
  @Volatile private var instance: MeshEngine? = null

  fun engine(context: Context): MeshEngine =
    instance ?: synchronized(this) { instance ?: MeshEngine(context.applicationContext).also { instance = it } }
}

/**
 * Keeps Tiltas relaying with the screen off or the app in the background,
 * with a persistent notification (SPEC §6: Android is a full relay node).
 */
class TiltasService : Service() {
  companion object {
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    private const val CHANNEL = "tiltas"
    private const val NOTIFICATION_ID = 7201
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Tiltas"
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: ""
    try {
      val notification = buildNotification(title, text)
      when {
        Build.VERSION.SDK_INT >= 29 -> startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        else -> startForeground(NOTIFICATION_ID, notification)
      }
    } catch (e: Exception) {
      // e.g. Bluetooth permissions revoked while the service was scheduled for restart
      Log.w("Tiltas", "cannot start foreground service", e)
      stopSelf()
      return START_NOT_STICKY
    }
    TiltasRuntime.engine(this).start()
    return START_STICKY
  }

  override fun onDestroy() {
    TiltasRuntime.engine(this).stop()
    super.onDestroy()
  }

  private fun buildNotification(title: String, text: String): Notification {
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val tap = launch?.let { PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT) }
    val builder = if (Build.VERSION.SDK_INT >= 26) {
      val nm = getSystemService(NotificationManager::class.java)
      nm.createNotificationChannel(NotificationChannel(CHANNEL, "Tiltas", NotificationManager.IMPORTANCE_LOW))
      Notification.Builder(this, CHANNEL)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    return builder
      .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
      .setContentTitle(title)
      .setContentText(text)
      .setOngoing(true)
      .apply { if (tap != null) setContentIntent(tap) }
      .build()
  }
}
