package com.phoneclusterapp.modules

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject

/**
 * Exposes real-time node metrics at GET /v1/info so the PC bridge (or any client
 * over adb forward) can discover capabilities before dispatching work.
 */
class InfoModule(
    private val context: Context,
    private val startTimeMs: Long,
    private val moduleIds: List<String>
) : ComputeModule {

    override val id = "info_daemon"

    override fun handle(method: String, uri: String, body: String): ModuleResponse? {
        if (method != "GET" || uri != "/v1/info") return null

        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val mem = ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
        val totalMb = mem.totalMem / (1024L * 1024L)
        val availMb = mem.availMem / (1024L * 1024L)
        val abi = if (Build.SUPPORTED_ABIS.isNotEmpty()) Build.SUPPORTED_ABIS[0] else "unknown"
        val nodeId = Settings.Secure.getString(
            context.contentResolver, Settings.Secure.ANDROID_ID
        ) ?: "unknown"
        val uptimeMs = System.currentTimeMillis() - startTimeMs

        val json = JSONObject().apply {
            put("node_id", nodeId)
            put("device_model", Build.MODEL)
            put("manufacturer", Build.MANUFACTURER)
            put("cpu_cores", Runtime.getRuntime().availableProcessors())
            put("abi", abi)
            put("ram_total_mb", totalMb)
            put("ram_available_mb", availMb)
            put("modules", JSONArray(moduleIds))
            put("os_version", Build.VERSION.RELEASE)
            put("sdk_int", Build.VERSION.SDK_INT)
            put("daemon_uptime_ms", uptimeMs)
            put("port", 8080)
        }

        return ModuleResponse(body = json.toString(2))
    }
}
