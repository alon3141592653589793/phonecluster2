package com.phoneclusterapp

import android.content.Context
import android.provider.Settings
import java.io.File
import java.util.UUID

object DeviceHardware {
    fun availableThreads() = Runtime.getRuntime().availableProcessors().coerceAtLeast(1)
    fun inferenceThreads() = (availableThreads() - 1).coerceAtLeast(1)
    fun cpuCores(): Int = try {
        File("/sys/devices/system/cpu/present").readText().trim().split(",").sumOf { range ->
            val bounds = range.split("-").map { it.toInt() }
            if (bounds.size == 2) bounds[1] - bounds[0] + 1 else 1
        }.coerceAtLeast(1)
    } catch (_: Exception) { availableThreads() }
    @Synchronized fun deviceId(context: Context): String {
        val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
        if (!androidId.isNullOrBlank() && androidId != "unknown") return androidId
        val prefs = context.getSharedPreferences("hardware", Context.MODE_PRIVATE)
        return prefs.getString("device_id", null) ?: UUID.randomUUID().toString().also {
            prefs.edit().putString("device_id", it).commit()
        }
    }
}