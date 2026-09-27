package com.phoneclusterapp

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
        statusView.text = getEngineStatus() + "\nDaemon: STARTING"
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