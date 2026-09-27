package com.phoneclusterapp

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import com.phoneclusterapp.modules.ComputeHttpServer
import com.phoneclusterapp.modules.InfoModule
import com.phoneclusterapp.modules.LlmStubModule

class ComputeDaemonService : Service() {

    companion object {
        private const val TAG = "ComputeDaemon"
        private const val CHANNEL_ID = "compute_node"
        private const val NOTIFICATION_ID = 42
        const val PORT = 8080

        // Lightweight, queryable from the UI without binding to the service.
        @Volatile
        var running: Boolean = false
            private set
    }

    private var wakeLock: PowerManager.WakeLock? = null
    private var server: ComputeHttpServer? = null
    private var startTimeMs = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
        startTimeMs = System.currentTimeMillis()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(
                NOTIFICATION_ID, notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        acquireWakeLock()
        startServer()
        running = true
        return START_STICKY
    }

    private fun startServer() {
        if (server != null) return
        try {
            val moduleIds = listOf("info_daemon", "llm_stub")
            val s = ComputeHttpServer(PORT).apply {
                register(InfoModule(this@ComputeDaemonService, startTimeMs, moduleIds))
                register(LlmStubModule())
                start(5000, false)
            }
            server = s
            Log.i(TAG, "HTTP server on 127.0.0.1:${PORT}  modules=${s.registeredModuleIds}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start HTTP server", e)
        }
    }

    private fun stopServer() {
        server?.let {
            try { it.stop() } catch (e: Exception) { Log.w(TAG, "server.stop()", e) }
        }
        server = null
    }

    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK, "PhoneClusterApp::ComputeNode"
        ).apply {
            setReferenceCounted(false)
            acquire()
        }
        Log.i(TAG, "CPU WakeLock acquired")
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            val channel = NotificationChannel(
                CHANNEL_ID, "Compute Node", NotificationManager.IMPORTANCE_LOW
            )
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("USB AI Compute Node")
            .setContentText("Daemon active — listening on :${PORT}")
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .build()
    }

    override fun onDestroy() {
        stopServer()
        running = false
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        Log.i(TAG, "Daemon stopped, WakeLock released")
        super.onDestroy()
    }
}
