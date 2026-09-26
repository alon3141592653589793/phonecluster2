export const kotlinFiles = [
  {
    path: "android/app/src/main/java/com/phoneclusterapp/MainActivity.kt",
    lang: "kotlin",
    description: "Control UI — permissions, daemon start, native status",
    content: `package com.phoneclusterapp

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {

    private lateinit var statusView: TextView
    private lateinit var notifButton: Button
    private lateinit var batteryButton: Button

    external fun getEngineStatus(): String

    companion object {
        private const val REQ_NOTIFICATIONS = 1001

        init {
            System.loadLibrary("LlamaServerBridge")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = (24 * resources.displayMetrics.density).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
        }

        val title = TextView(this).apply {
            text = "USB AI Compute Node v0.1"
            textSize = 22f
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(0, 0, 0, pad)
        }

        notifButton = Button(this).apply {
            setOnClickListener { requestNotificationPermission() }
        }

        batteryButton = Button(this).apply {
            setOnClickListener { requestBatteryExemption() }
        }

        val startButton = Button(this).apply {
            text = "Start Daemon Service"
            setOnClickListener { startDaemon() }
        }

        statusView = TextView(this).apply {
            textSize = 14f
            setPadding(0, pad, 0, 0)
            text = getEngineStatus()
        }

        listOf(title, notifButton, batteryButton, startButton, statusView).forEach { root.addView(it) }
        setContentView(root)
    }

    override fun onResume() {
        super.onResume()
        refreshPermissionLabels()
    }

    private fun hasNotificationPermission(): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED

    private fun isIgnoringBatteryOptimizations(): Boolean {
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        return pm.isIgnoringBatteryOptimizations(packageName)
    }

    private fun refreshPermissionLabels() {
        notifButton.text =
            if (hasNotificationPermission()) "Notifications: GRANTED" else "Grant Notifications"
        batteryButton.text =
            if (isIgnoringBatteryOptimizations()) "Battery Optimization: DISABLED" else "Disable Battery Optimization"
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && !hasNotificationPermission()) {
            ActivityCompat.requestPermissions(
                this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIFICATIONS
            )
        } else {
            startActivity(
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))
            )
        }
    }

    @SuppressLint("BatteryLife")
    private fun requestBatteryExemption() {
        if (!isIgnoringBatteryOptimizations()) {
            startActivity(
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))
            )
        } else {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
    }

    private fun startDaemon() {
        ContextCompat.startForegroundService(this, Intent(this, ComputeDaemonService::class.java))
        statusView.text = getEngineStatus() + "\\nDaemon: STARTING"
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        refreshPermissionLabels()
    }
}
`,
  },
  {
    path: "android/app/src/main/java/com/phoneclusterapp/ComputeDaemonService.kt",
    lang: "kotlin",
    description: "Foreground daemon holding a partial CPU WakeLock",
    content: `package com.phoneclusterapp

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

class ComputeDaemonService : Service() {

    companion object {
        private const val TAG = "ComputeDaemon"
        private const val CHANNEL_ID = "compute_node"
        private const val NOTIFICATION_ID = 42
    }

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        acquireWakeLock()
        // TODO: boot llama.cpp server on 127.0.0.1:8080 through LlamaServerBridge
        return START_STICKY
    }

    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "PhoneClusterApp::ComputeNode").apply {
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
            .setContentText("Daemon active - listening on :8080")
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .build()
    }

    override fun onDestroy() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        Log.i(TAG, "Daemon stopped, WakeLock released")
        super.onDestroy()
    }
}
`,
  },
];