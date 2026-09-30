package com.phoneclusterapp

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
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
    private var wifiLock: WifiManager.WifiLock? = null
    private var server: ComputeHttpServer? = null
    private var startTimeMs = 0L
    private var nsdManager: NsdManager? = null
    private var nsdRegistration: NsdManager.RegistrationListener? = null

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
            Log.i(TAG, "HTTP server on 0.0.0.0:${PORT}  modules=${s.registeredModuleIds}")
            registerNsd()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start HTTP server", e)
        }
    }

    private fun stopServer() {
        unregisterNsd()
        server?.let {
            try { it.stop() } catch (e: Exception) { Log.w(TAG, "server.stop()", e) }
        }
        server = null
    }

    /**
     * Advertises the node over mDNS / DNS-SD as "_http._tcp." so a PC on the same
     * USB-tethering or Wi-Fi segment can discover it without typing an IP. A short
     * suffix derived from ANDROID_ID keeps service names unique when several phones
     * share the network.
     */
    private fun registerNsd() {
        if (nsdRegistration != null) return
        val nsd = getSystemService(Context.NSD_SERVICE) as NsdManager
        nsdManager = nsd
        val shortId = try {
            android.provider.Settings.Secure.getString(
                contentResolver, android.provider.Settings.Secure.ANDROID_ID
            )?.take(6) ?: ""
        } catch (e: Exception) { "" }
        val service = NsdServiceInfo().apply {
            serviceName = if (shortId.isNotEmpty()) "PhoneCluster-Node-${shortId}" else "PhoneCluster-Node"
            serviceType = "_http._tcp."
            port = PORT
        }
        val listener = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(info: NsdServiceInfo) {
                Log.i(TAG, "NSD registered: ${info.serviceName} :${info.port}")
            }
            override fun onRegistrationFailed(info: NsdServiceInfo, errorCode: Int) {
                Log.e(TAG, "NSD registration failed: $errorCode")
            }
            override fun onServiceUnregistered(info: NsdServiceInfo) {
                Log.i(TAG, "NSD unregistered")
            }
            override fun onUnregistrationFailed(info: NsdServiceInfo, errorCode: Int) {
                Log.w(TAG, "NSD unregistration failed: $errorCode")
            }
        }
        nsdRegistration = listener
        try {
            nsd.registerService(service, NsdManager.PROTOCOL_DNS_SD, listener)
        } catch (e: Exception) {
            Log.e(TAG, "registerService failed", e)
            nsdRegistration = null
            nsdManager = null
        }
    }

    private fun unregisterNsd() {
        nsdRegistration?.let { listener ->
            try { nsdManager?.unregisterService(listener) }
            catch (e: Exception) { Log.w(TAG, "unregisterService", e) }
        }
        nsdRegistration = null
        nsdManager = null
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

        // Keep the Wi-Fi radio out of power-save so the node stays reachable
        // with the screen off (a CPU WakeLock alone does not do this).
        if (wifiLock?.isHeld != true) {
            val wm = applicationContext.getSystemService(WIFI_SERVICE) as WifiManager
            @Suppress("DEPRECATION")
            wifiLock = wm.createWifiLock(
                WifiManager.WIFI_MODE_FULL_HIGH_PERF, "PhoneClusterApp::Wifi"
            ).apply {
                setReferenceCounted(false)
                acquire()
            }
            Log.i(TAG, "WifiLock acquired")
        }
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
        wifiLock?.let { if (it.isHeld) it.release() }
        wifiLock = null
        Log.i(TAG, "Daemon stopped, WakeLock + WifiLock released")
        super.onDestroy()
    }
}
