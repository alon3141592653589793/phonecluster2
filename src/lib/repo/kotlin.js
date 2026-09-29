export const kotlinFiles = [
  {
    path: "android/app/src/main/java/com/phoneclusterapp/modules/ComputeModule.kt",
    lang: "kotlin",
    description: "Pluggable engine contract — decoupled from the HTTP server",
    content: `package com.phoneclusterapp.modules

/**
 * A ComputeModule owns a set of HTTP routes. The daemon's HTTP server walks the
 * registered modules in order and lets the first module that returns a non-null
 * [ModuleResponse] handle the request. This keeps new execution engines
 * (LLM, MediaCodec, WASM, ...) out of core service logic.
 *
 * Modules must be stateless and thread-safe: the HTTP server may invoke
 * [handle] concurrently from multiple worker threads.
 */
interface ComputeModule {
    val id: String

    /**
     * @param method HTTP verb, e.g. "GET", "POST".
     * @param uri    Request path (no query string).
     * @param body   Raw request body (may be empty).
     * @return A [ModuleResponse] to answer, or null if this module does not own the route.
     */
    fun handle(method: String, uri: String, body: String): ModuleResponse?
}

/** A minimal, transport-agnostic response rendered by the HTTP server. */
data class ModuleResponse(
    val status: Int = 200,
    val mimeType: String = "application/json",
    val body: String = ""
)
`,
  },
  {
    path: "android/app/src/main/java/com/phoneclusterapp/modules/InfoModule.kt",
    lang: "kotlin",
    description: "Capability discovery — GET /v1/info with live node metrics",
    content: `package com.phoneclusterapp.modules

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
`,
  },
  {
    path: "android/app/src/main/java/com/phoneclusterapp/modules/LlmStubModule.kt",
    lang: "kotlin",
    description: "Placeholder LLM engine — demonstrates pluggable module registration",
    content: `package com.phoneclusterapp.modules

/**
 * Stub for the future llama.cpp runtime. Claiming the /v1/completions and
 * /v1/chat/completions routes now lets the routing architecture prove itself
 * end-to-end before the native engine is linked.
 */
class LlmStubModule : ComputeModule {

    override val id = "llm_stub"

    override fun handle(method: String, uri: String, body: String): ModuleResponse? {
        if (uri == "/v1/completions" || uri == "/v1/chat/completions") {
            return ModuleResponse(
                status = 501,
                body = """{"error":"llm_stub not implemented","detail":"llama.cpp runtime planned"}"""
            )
        }
        return null
    }
}
`,
  },
  {
    path: "android/app/src/main/java/com/phoneclusterapp/modules/ComputeHttpServer.kt",
    lang: "kotlin",
    description: "Embedded HTTP server (NanoHTTPD) with module routing on loopback",
    content: `package com.phoneclusterapp.modules

import fi.iki.elonen.NanoHTTPD
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Lightweight embedded HTTP server bound to 0.0.0.0:8080, so it is reachable on
 * every active interface (loopback, USB tethering via rndis0/usb0, and Wi-Fi).
 * The PC connects directly over USB Tethering (Ethernet-over-USB) or the LAN —
 * no "adb forward" is required. Each request is dispatched on NanoHTTPD's
 * own worker thread; modules are walked in registration order until one claims
 * the route. Registration uses a [CopyOnWriteArrayList] so modules can be added
 * safely while the server is serving traffic.
 */
class ComputeHttpServer(port: Int) : NanoHTTPD("0.0.0.0", port) {

    private val modules = CopyOnWriteArrayList<ComputeModule>()

    fun register(module: ComputeModule) {
        modules.add(module)
    }

    val registeredModuleIds: List<String> get() = modules.map { it.id }

    override fun serve(session: IHTTPSession): Response {
        val method = session.method.name
        val uri = session.uri
        // CORS preflight — browsers POST with Content-Type: application/json,
        // which triggers an OPTIONS check before the real request. Answer it
        // here so file:// consoles (pc/index.html) can reach the daemon.
        if (method == "OPTIONS") {
            val preflight = newFixedLengthResponse(Response.Status.OK, "application/json", "")
            addCorsHeaders(preflight)
            return preflight
        }
        for (module in modules) {
            val result = module.handle(method, uri, "")
            if (result != null) {
                val status = Response.Status.lookup(result.status) ?: Response.Status.OK
                val resp = newFixedLengthResponse(status, result.mimeType, result.body)
                addCorsHeaders(resp)
                return resp
            }
        }
        val notFound = newFixedLengthResponse(
            Response.Status.NOT_FOUND,
            "application/json",
            """{"error":"no module handles \${method} \${uri}"}"""
        )
        addCorsHeaders(notFound)
        return notFound
    }

    private fun addCorsHeaders(response: Response) {
        response.addHeader("Access-Control-Allow-Origin", "*")
        response.addHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        response.addHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")
    }
}
`,
  },
  {
    path: "android/app/src/main/java/com/phoneclusterapp/ComputeDaemonService.kt",
    lang: "kotlin",
    description: "Foreground daemon — WakeLock, notification, HTTP server lifecycle",
    content: `package com.phoneclusterapp

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
            Log.i(TAG, "HTTP server on 0.0.0.0:\${PORT}  modules=\${s.registeredModuleIds}")
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
            serviceName = if (shortId.isNotEmpty()) "PhoneCluster-Node-\${shortId}" else "PhoneCluster-Node"
            serviceType = "_http._tcp."
            port = PORT
        }
        val listener = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(info: NsdServiceInfo) {
                Log.i(TAG, "NSD registered: \${info.serviceName} :\${info.port}")
            }
            override fun onRegistrationFailed(info: NsdServiceInfo, errorCode: Int) {
                Log.e(TAG, "NSD registration failed: \$errorCode")
            }
            override fun onServiceUnregistered(info: NsdServiceInfo) {
                Log.i(TAG, "NSD unregistered")
            }
            override fun onUnregistrationFailed(info: NsdServiceInfo, errorCode: Int) {
                Log.w(TAG, "NSD unregistration failed: \$errorCode")
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
            .setContentText("Daemon active — listening on :\${PORT}")
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
`,
  },
  {
    path: "android/app/src/main/java/com/phoneclusterapp/MainActivity.kt",
    lang: "kotlin",
    description: "Diagnostics UI — daemon toggle, port, live /v1/info preview",
    content: `package com.phoneclusterapp

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
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
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
    private lateinit var infoPreview: TextView
    private lateinit var networkView: TextView

    companion object {
        private const val REQ_NOTIFICATIONS = 1001
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
            notifButton, batteryButton, refreshButton, infoLabel, infoPreview,
            networkLabel, networkView
        ).forEach { root.addView(it) }

        setContentView(ScrollView(this).apply { addView(root) })
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
        refreshInfo()
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
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:\$packageName"))
            )
        }
    }

    @SuppressLint("BatteryLife")
    private fun requestBatteryExemption() {
        if (!isIgnoringBatteryOptimizations()) {
            startActivity(
                Intent(
                    Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:\$packageName")
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
`,
  },
];