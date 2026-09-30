package com.phoneclusterapp

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.URL

class MainActivity : AppCompatActivity() {

    private lateinit var statusView: TextView
    private lateinit var portView: TextView
    private lateinit var toggleButton: Button
    private lateinit var notifButton: Button
    private lateinit var batteryButton: Button
    private lateinit var refreshButton: Button
    private lateinit var modelButton: Button
    private lateinit var modelStatus: TextView
    private lateinit var infoPreview: TextView
    private lateinit var networkView: TextView

    @Volatile
    private var modelDownloading = false

    companion object {
        private const val REQ_NOTIFICATIONS = 1001
        const val MODEL_URL =
            "https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf"
        const val MODEL_FILENAME = "tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = (24 * resources.displayMetrics.density).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
        }

        val title = TextView(this).apply {
            text = "USB AI Compute Node v0.2"
            textSize = 22f
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(0, 0, 0, pad)
        }

        statusView = TextView(this).apply {
            textSize = 16f
            setPadding(0, 0, 0, pad / 2)
        }
        portView = TextView(this).apply {
            textSize = 14f
            setPadding(0, 0, 0, pad / 2)
        }

        toggleButton = Button(this).apply { setOnClickListener { toggleDaemon() } }
        notifButton = Button(this).apply { setOnClickListener { requestNotificationPermission() } }
        batteryButton = Button(this).apply { setOnClickListener { requestBatteryExemption() } }
        refreshButton = Button(this).apply {
            text = "Refresh /v1/info"
            setOnClickListener { refreshInfo() }
        }

        val modelLabel = TextView(this).apply {
            text = "Test model"
            textSize = 13f
            setPadding(0, pad / 2, 0, 0)
        }
        modelButton = Button(this).apply { setOnClickListener { downloadModel() } }
        modelStatus = TextView(this).apply {
            textSize = 12f
            typeface = Typeface.MONOSPACE
            setPadding(0, pad / 4, 0, 0)
            text = "checking model..."
        }

        val infoLabel = TextView(this).apply {
            text = "/v1/info"
            textSize = 13f
            setPadding(0, pad / 2, 0, 0)
        }
        infoPreview = TextView(this).apply {
            textSize = 12f
            typeface = Typeface.MONOSPACE
            setPadding(0, pad / 4, 0, 0)
            text = "(daemon stopped)"
        }

        val networkLabel = TextView(this).apply {
            text = "Network endpoints"
            textSize = 13f
            setPadding(0, pad / 2, 0, 0)
        }
        networkView = TextView(this).apply {
            textSize = 12f
            typeface = Typeface.MONOSPACE
            setPadding(0, pad / 4, 0, 0)
            text = "(detecting…)"
        }

        listOf(
            title, statusView, portView, toggleButton,
            notifButton, batteryButton, refreshButton,
            modelLabel, modelButton, modelStatus,
            infoLabel, infoPreview, networkLabel, networkView
        ).forEach { root.addView(it) }

        setContentView(ScrollView(this).apply { addView(root) })
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
        refreshInfo()
        refreshModelState()
    }

    private fun refreshStatus() {
        val running = ComputeDaemonService.running
        statusView.text = if (running) "Daemon: RUNNING" else "Daemon: STOPPED"
        portView.text = "Port: 8080  (0.0.0.0 — all interfaces)"
        toggleButton.text = if (running) "Stop Daemon" else "Start Daemon"
        refreshPermissionLabels()
        refreshNetwork()
    }

    /**
     * Enumerates active non-loopback IPv4 addresses (USB tethering via rndis0/usb0,
     * Wi-Fi via wlan0, etc.) so the user knows exactly which URL to query from the
     * PC over USB Tethering / the LAN.
     */
    private fun localIpAddresses(): List<String> {
        val ips = mutableListOf<String>()
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces() ?: return ips
            for (intf in interfaces) {
                if (!intf.isUp || intf.isLoopback) continue
                for (addr in intf.inetAddresses) {
                    if (addr.isLoopbackAddress) continue
                    if (addr is Inet4Address) addr.hostAddress?.let { ips.add(it) }
                }
            }
        } catch (e: Exception) {
            // ignore — surfaced as an empty list
        }
        return ips
    }

    private fun refreshNetwork() {
        val ips = localIpAddresses()
        networkView.text = if (ips.isEmpty()) {
            "No LAN/USB IP detected\nFallback: adb forward tcp:8080 tcp:8080"
        } else {
            buildString {
                for (ip in ips) append("http://").append(ip).append(":8080/v1/info\n")
            }.trimEnd()
        }
    }

    private fun toggleDaemon() {
        if (ComputeDaemonService.running) {
            stopService(Intent(this, ComputeDaemonService::class.java))
        } else {
            ContextCompat.startForegroundService(
                this, Intent(this, ComputeDaemonService::class.java)
            )
        }
        toggleButton.postDelayed({ refreshStatus(); refreshInfo() }, 400)
    }

    private fun modelFile(): File {
        val dir = getExternalFilesDir("models") ?: filesDir
        return File(dir, MODEL_FILENAME)
    }

    private fun refreshModelState() {
        val f = modelFile()
        modelStatus.text = if (f.exists()) {
            "Model ready: " + "%.1f".format(f.length() / 1048576.0) + " MB"
        } else {
            "No model installed"
        }
        modelButton.text = if (f.exists()) "Reinstall test model" else "Install test model"
        modelButton.isEnabled = !modelDownloading
    }

    private fun downloadModel() {
        if (modelDownloading) return
        modelDownloading = true
        modelButton.isEnabled = false
        modelStatus.text = "Downloading test model..."
        Thread {
            try {
                val conn = URL(MODEL_URL).openConnection() as HttpURLConnection
                conn.connectTimeout = 20000
                conn.readTimeout = 60000
                conn.instanceFollowRedirects = true
                val total = conn.contentLengthLong
                val f = modelFile()
                f.parentFile?.mkdirs()
                var lastPct = -1
                conn.inputStream.use { input ->
                    FileOutputStream(f).use { out ->
                        val buf = ByteArray(64 * 1024)
                        var read: Int
                        var done = 0L
                        while (input.read(buf).also { read = it } != -1) {
                            out.write(buf, 0, read)
                            done += read
                            if (total > 0) {
                                val pct = (done * 100 / total).toInt()
                                if (pct != lastPct && pct % 5 == 0) {
                                    lastPct = pct
                                    runOnUiThread {
                                        modelStatus.text = "Downloading… " + pct + "% (" + (done / 1048576) + " MB)"
                                    }
                                }
                            }
                        }
                    }
                }
                runOnUiThread {
                    modelDownloading = false
                    refreshModelState()
                    Toast.makeText(this, "Model installed", Toast.LENGTH_SHORT).show()
                }
            } catch (e: Exception) {
                runOnUiThread {
                    modelDownloading = false
                    modelStatus.text = "Download failed: " + e.message
                    modelButton.isEnabled = true
                }
            }
        }.start()
    }

    private fun refreshInfo() {
        if (!ComputeDaemonService.running) {
            infoPreview.text = "(daemon stopped)"
            return
        }
        Thread {
            try {
                val conn = URL("http://127.0.0.1:8080/v1/info").openConnection() as HttpURLConnection
                conn.connectTimeout = 1500
                conn.readTimeout = 1500
                try {
                    val text = conn.inputStream.bufferedReader().use { it.readText() }
                    runOnUiThread { infoPreview.text = text }
                } finally {
                    conn.disconnect()
                }
            } catch (e: Exception) {
                runOnUiThread { infoPreview.text = "error: " + e.message }
            }
        }.start()
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
            if (isIgnoringBatteryOptimizations())
                "Battery Optimization: DISABLED"
            else
                "Disable Battery Optimization"
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
                Intent(
                    Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:$packageName")
                )
            )
        } else {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
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
