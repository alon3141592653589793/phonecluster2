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
    val body: String = "",
    val bytes: ByteArray? = null
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
    path: "android/app/src/main/java/com/phoneclusterapp/modules/LlmModule.kt",
    lang: "kotlin",
    description: "Real LLM engine — llama.cpp JNI inference for /v1/completions",
    content: `package com.phoneclusterapp.modules

import android.content.Context
import org.json.JSONObject

/**
 * Real LLM engine: loads the GGUF stored by the "Install test model" button and
 * serves POST /v1/completions and /v1/chat/completions via the llama.cpp JNI bridge.
 */
class LlmModule(private val context: Context) : ComputeModule {

    companion object {
        init { System.loadLibrary("LlamaServerBridge") }
        private const val MODEL_FILENAME = "tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf"
    }

    override val id = "llm"

    private val lock = Any()

    private fun modelPath(): String =
        ((context.getExternalFilesDir("models") ?: context.filesDir))
            .resolve(MODEL_FILENAME).absolutePath

    private fun modelExists(): Boolean = java.io.File(modelPath()).exists()

    private fun ensureLoaded(): Boolean {
        if (nativeIsLoaded()) return true
        if (!modelExists()) return false
        return nativeLoadModel(modelPath())
    }

    override fun handle(method: String, uri: String, body: String): ModuleResponse? {
        if (uri != "/v1/completions" && uri != "/v1/chat/completions") return null
        if (method != "POST") {
            return ModuleResponse(status = 405, body = JSONObject().put("error", "method_not_allowed").toString())
        }
        synchronized(lock) {
            if (!ensureLoaded()) {
                return ModuleResponse(status = 503, body = JSONObject().apply {
                    put("error", "model_not_loaded")
                    put("detail", "Tap 'Install test model' in the app, then retry.")
                }.toString())
            }
            val req = try { JSONObject(if (body.isBlank()) "{}" else body) } catch (e: Exception) { JSONObject() }
            val nPredict = req.optInt("n_predict", req.optInt("max_tokens", 128))
            val prompt = buildPrompt(req)
            return try {
                val content = nativeComplete(prompt, nPredict)
                ModuleResponse(body = JSONObject().apply {
                    put("model", "tinyllama-1.1b-chat-v1.0")
                    put("content", content)
                    put("n_predict", nPredict)
                }.toString())
            } catch (e: Exception) {
                ModuleResponse(status = 500, body = JSONObject().apply {
                    put("error", "inference_failed")
                    put("detail", e.message ?: "")
                }.toString())
            }
        }
    }

    private fun buildPrompt(req: JSONObject): String {
        val p = req.optString("prompt", "")
        if (p.isNotEmpty()) return p
        val msgs = req.optJSONArray("messages") ?: return p
        val sb = StringBuilder()
        for (i in 0 until msgs.length()) {
            val m = msgs.optJSONObject(i) ?: continue
            sb.append(m.optString("role", "user"))
              .append(": ")
              .append(m.optString("content", ""))
              .append("\\n")
        }
        sb.append("assistant: ")
        return sb.toString()
    }

    private external fun nativeLoadModel(path: String): Boolean
    private external fun nativeIsLoaded(): Boolean
    private external fun nativeComplete(prompt: String, nPredict: Int): String
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
        // Always drain the request body. Leaving POST bytes unread corrupts the
        // next request on a keep-alive connection (random "offline" flaps).
        val body = if (method == "POST" || method == "PUT") {
            val files = HashMap<String, String>()
            try { session.parseBody(files) } catch (e: Exception) { }
            files["postData"] ?: ""
        } else ""
        for (module in modules) {
            val result = module.handle(method, uri, body)
            if (result != null) {
                val status = Response.Status.lookup(result.status) ?: Response.Status.OK
                val resp = if (result.bytes != null) {
                    newFixedLengthResponse(status, result.mimeType, java.io.ByteArrayInputStream(result.bytes), result.bytes.size.toLong())
                } else {
                    newFixedLengthResponse(status, result.mimeType, result.body)
                }
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
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import com.phoneclusterapp.modules.ComputeHttpServer
import com.phoneclusterapp.modules.InfoModule
import com.phoneclusterapp.modules.LlmModule
import com.phoneclusterapp.modules.CpuModule
import com.phoneclusterapp.modules.GpuModule
import com.phoneclusterapp.modules.MemoryModule

class ComputeDaemonService : Service() {

    companion object {
        private const val TAG = "ComputeDaemon"
        private const val CHANNEL_ID = "compute_node"
        private const val NOTIFICATION_ID = 42
        const val PORT = 8080
        // Cluster simulator: run two node instances on one phone so a single
        // device can stand in for two phones + a PC (no real PC needed).
        val PORTS = listOf(8080, 8081)

        // Lightweight, queryable from the UI without binding to the service.
        @Volatile
        var running: Boolean = false
            private set
    }

    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private val servers = mutableListOf<ComputeHttpServer>()
    private var startTimeMs = 0L
    private var nsdManager: NsdManager? = null
    private val nsdRegistrations = mutableListOf<NsdManager.RegistrationListener>()

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
        if (servers.isNotEmpty()) return
        val moduleIds = listOf("info_daemon", "llm", "cpu", "gpu", "memory")
        for (port in PORTS) {
            try {
                val s = ComputeHttpServer(port).apply {
                    register(InfoModule(this@ComputeDaemonService, startTimeMs, moduleIds))
                    register(LlmModule(this@ComputeDaemonService))
                    register(CpuModule())
                    register(GpuModule())
                    register(MemoryModule())
                    start(5000, false)
                }
                servers.add(s)
                Log.i(TAG, "HTTP server on 0.0.0.0:\${port}  modules=\${s.registeredModuleIds}")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to start HTTP server on \${port}", e)
            }
        }
        registerNsd()
    }

    private fun stopServer() {
        unregisterNsd()
        for (s in servers) {
            try { s.stop() } catch (e: Exception) { Log.w(TAG, "server.stop()", e) }
        }
        servers.clear()
    }

    /**
     * Advertises the node over mDNS / DNS-SD as "_http._tcp." so a PC on the same
     * USB-tethering or Wi-Fi segment can discover it without typing an IP. A short
     * suffix derived from ANDROID_ID keeps service names unique when several phones
     * share the network.
     */
    private fun registerNsd() {
        if (nsdRegistrations.isNotEmpty()) return
        val nsd = getSystemService(Context.NSD_SERVICE) as NsdManager
        nsdManager = nsd
        val shortId = try {
            android.provider.Settings.Secure.getString(
                contentResolver, android.provider.Settings.Secure.ANDROID_ID
            )?.take(6) ?: ""
        } catch (e: Exception) { "" }
        PORTS.forEachIndexed { i, p ->
            val suffix = if (shortId.isNotEmpty()) "\${shortId}-\${'A' + i}" else "\${'A' + i}"
            val service = NsdServiceInfo().apply {
                serviceName = "PhoneCluster-Node-\${suffix}"
                serviceType = "_http._tcp."
                port = p
            }
            val listener = object : NsdManager.RegistrationListener {
                override fun onServiceRegistered(info: NsdServiceInfo) {
                    Log.i(TAG, "NSD registered: \${info.serviceName} :\${info.port}")
                }
                override fun onRegistrationFailed(info: NsdServiceInfo, errorCode: Int) {
                    Log.e(TAG, "NSD registration failed: \$errorCode")
                }
                override fun onServiceUnregistered(info: NsdServiceInfo) {
                    Log.i(TAG, "NSD unregistered: \${info.serviceName}")
                }
                override fun onUnregistrationFailed(info: NsdServiceInfo, errorCode: Int) {
                    Log.w(TAG, "NSD unregistration failed: \$errorCode")
                }
            }
            nsdRegistrations.add(listener)
            try {
                nsd.registerService(service, NsdManager.PROTOCOL_DNS_SD, listener)
            } catch (e: Exception) {
                Log.e(TAG, "registerService failed on \${p}", e)
                nsdRegistrations.remove(listener)
            }
        }
    }

    private fun unregisterNsd() {
        nsdRegistrations.forEach { listener ->
            try { nsdManager?.unregisterService(listener) }
            catch (e: Exception) { Log.w(TAG, "unregisterService", e) }
        }
        nsdRegistrations.clear()
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
            .setContentText("Cluster simulator: 2 nodes on :\${PORTS.joinToString(" :")}")
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
    private lateinit var clusterButton: Button
    private lateinit var clusterMgrButton: Button
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
        clusterButton = Button(this).apply {
            text = "Open Cluster Console (fake PC)"
            setOnClickListener {
                startActivity(Intent(this@MainActivity, ClusterConsoleActivity::class.java))
            }
        }
        clusterMgrButton = Button(this).apply {
            text = "Open Cluster Manager (multi-phone)"
            setOnClickListener {
                startActivity(Intent(this@MainActivity, ClusterManagerActivity::class.java))
            }
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
            notifButton, batteryButton, refreshButton, clusterButton, clusterMgrButton,
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
  {
    path: "android/app/src/main/java/com/phoneclusterapp/ClusterConsoleActivity.kt",
    lang: "kotlin",
    description: "Fake-PC cluster console — dispatches prompts to 2 local nodes",
    content: `package com.phoneclusterapp

import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

/**
 * In-app "fake PC": simulates a PC orchestrator talking to two compute nodes
 * running on this same phone (ports 8080 and 8081). Discover nodes, dispatch a
 * prompt to both, compare responses — with no PC attached.
 * Requires the daemon to be running (it starts both node instances).
 */
class ClusterConsoleActivity : AppCompatActivity() {

    private val nodes = listOf("Node A" to 8080, "Node B" to 8081)
    private lateinit var nodeViews: List<TextView>
    private lateinit var log: TextView
    private lateinit var input: EditText
    private lateinit var send: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val dp = resources.displayMetrics.density
        val pad = (16 * dp).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
        }

        root.addView(TextView(this).apply {
            text = "Cluster Console (fake PC)"
            textSize = 20f
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(0, 0, 0, pad)
        })
        root.addView(TextView(this).apply {
            text = "Start the daemon on the main screen first — it runs 2 nodes on this phone."
            textSize = 12f
            setPadding(0, 0, 0, pad)
        })

        val nodesRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 0, 0, pad)
        }
        nodeViews = nodes.map { entry ->
            val (name, port) = entry
            TextView(this).apply {
                textSize = 11f
                typeface = Typeface.MONOSPACE
                setPadding(pad / 2, pad / 2, pad / 2, pad / 2)
                text = name + "\\n:" + port + "\\n(checking…)"
            }.also { tv ->
                nodesRow.addView(tv, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            }
        }
        root.addView(nodesRow)

        log = TextView(this).apply {
            textSize = 12f
            typeface = Typeface.MONOSPACE
            setPadding(pad / 2, pad / 2, pad / 2, pad / 2)
            text = "(send a prompt to dispatch to both nodes)"
            setBackgroundColor(Color.parseColor("#1a1a1a"))
            setTextColor(Color.parseColor("#e8e6e1"))
        }
        val scroll = ScrollView(this).apply {
            addView(log, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ))
        }
        root.addView(scroll, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f
        ))

        input = EditText(this).apply { hint = "Prompt"; setSingleLine(true) }
        send = Button(this).apply { text = "Send to both" }
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, pad, 0, 0)
        }
        bar.addView(input, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        bar.addView(send)
        root.addView(bar)

        send.setOnClickListener {
            val prompt = input.text.toString().trim()
            if (prompt.isEmpty()) return@setOnClickListener
            input.setText("")
            log.append("\\nyou> " + prompt)
            dispatch(prompt)
        }

        setContentView(root)
    }

    override fun onResume() {
        super.onResume()
        refreshNodes()
    }

    private fun refreshNodes() {
        nodes.forEachIndexed { i, entry ->
            val (name, port) = entry
            Thread {
                val info = try {
                    val c = URL("http://127.0.0.1:" + port + "/v1/info").openConnection() as HttpURLConnection
                    c.connectTimeout = 1200
                    c.readTimeout = 1200
                    try { JSONObject(c.inputStream.bufferedReader().use { it.readText() }) } finally { c.disconnect() }
                } catch (e: Exception) { null }
                runOnUiThread {
                    nodeViews[i].text = if (info != null) {
                        name + " :" + port + "\\n" + info.optString("device_model", "?") +
                            " · " + info.optInt("cpu_cores") + " cores\\n" +
                            "ram " + info.optLong("ram_available_mb") + " MB free"
                    } else {
                        name + " :" + port + "\\noffline (start daemon)"
                    }
                }
            }.start()
        }
    }

    private fun dispatch(prompt: String) {
        send.isEnabled = false
        val done = java.util.concurrent.atomic.AtomicInteger(0)
        nodes.forEachIndexed { _, entry ->
            val (name, port) = entry
            Thread {
                val resp = try {
                    val c = URL("http://127.0.0.1:" + port + "/v1/completions").openConnection() as HttpURLConnection
                    c.requestMethod = "POST"
                    c.setRequestProperty("Content-Type", "application/json")
                    c.connectTimeout = 30000
                    c.readTimeout = 60000
                    c.doOutput = true
                    c.outputStream.use {
                        it.write(JSONObject().put("prompt", prompt).put("n_predict", 128).toString().toByteArray())
                    }
                    val raw = c.inputStream.bufferedReader().use { it.readText() }
                    c.disconnect()
                    val j = JSONObject(raw)
                    j.optString("content", j.optString("error", raw))
                } catch (e: Exception) { "error: " + e.message }
                runOnUiThread {
                    log.append("\\n" + name + "> " + resp)
                    if (done.incrementAndGet() == nodes.size) send.isEnabled = true
                }
            }.start()
        }
    }
}
`,
  },
  {
    path: "android/app/src/main/java/com/phoneclusterapp/modules/CpuModule.kt",
    lang: "kotlin",
    description: "Remote CPU — POST /v1/compute matrix-multiply GFLOPS benchmark",
    content: `package com.phoneclusterapp.modules

import org.json.JSONObject

/**
 * Remote CPU: POST /v1/compute runs an N×N double-precision matrix multiply and
 * reports sustained GFLOPS, so a PC or another phone can treat this device as a
 * remote CPU and benchmark it.
 */
class CpuModule : ComputeModule {

    override val id = "cpu"

    override fun handle(method: String, uri: String, body: String): ModuleResponse? {
        if (uri != "/v1/compute") return null
        if (method != "POST") {
            return ModuleResponse(status = 405, body = JSONObject().put("error", "method_not_allowed").toString())
        }
        val req = try { JSONObject(if (body.isBlank()) "{}" else body) } catch (e: Exception) { JSONObject() }
        val n = req.optInt("size", 256).coerceIn(16, 1024)
        val a = Array(n) { DoubleArray(n) { Math.random() } }
        val b = Array(n) { DoubleArray(n) { Math.random() } }
        val c = Array(n) { DoubleArray(n) }
        val t0 = System.nanoTime()
        for (i in 0 until n) {
            for (j in 0 until n) {
                var s = 0.0
                for (k in 0 until n) s += a[i][k] * b[k][j]
                c[i][j] = s
            }
        }
        val ms = (System.nanoTime() - t0) / 1000000.0
        val flops = 2L * n * n * n
        val gflops = flops / ms / 1000000.0
        return ModuleResponse(body = JSONObject().apply {
            put("module", id)
            put("size", n)
            put("ms", Math.round(ms * 1000.0) / 1000.0)
            put("gflops", Math.round(gflops * 1000.0) / 1000.0)
            put("cores", Runtime.getRuntime().availableProcessors())
        }.toString())
    }
}
`,
  },
  {
    path: "android/app/src/main/java/com/phoneclusterapp/modules/GpuModule.kt",
    lang: "kotlin",
    description: "Remote GPU/graphics — GET /v1/render returns a Mandelbrot PNG",
    content: `package com.phoneclusterapp.modules

import android.graphics.Bitmap
import android.graphics.Color
import java.io.ByteArrayOutputStream
import org.json.JSONObject

/**
 * Remote GPU/graphics: GET /v1/render rasterizes a 256×256 Mandelbrot fractal
 * and returns it as PNG. A first step toward exposing the device's rendering
 * hardware as a remote graphics endpoint (a GPU/NPU rasterizer can replace the
 * CPU loop later).
 */
class GpuModule : ComputeModule {

    override val id = "gpu"

    override fun handle(method: String, uri: String, body: String): ModuleResponse? {
        if (uri != "/v1/render") return null
        if (method != "GET") {
            return ModuleResponse(status = 405, body = JSONObject().put("error", "method_not_allowed").toString())
        }
        val w = 256
        val h = 256
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val maxIter = 128
        for (y in 0 until h) {
            for (x in 0 until w) {
                val cx = -0.5 + (x - w / 2) * 2.5 / w
                val cy = (y - h / 2) * 2.5 / h
                var zx = 0.0
                var zy = 0.0
                var iter = 0
                while (iter < maxIter && zx * zx + zy * zy < 4.0) {
                    val t = zx * zx - zy * zy + cx
                    zy = 2 * zx * zy + cy
                    zx = t
                    iter++
                }
                val color = if (iter == maxIter) Color.BLACK else Color.HSVToColor(floatArrayOf(iter * 360f / maxIter, 1f, 1f))
                bmp.setPixel(x, y, color)
            }
        }
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
        return ModuleResponse(mimeType = "image/png", bytes = out.toByteArray())
    }
}
`,
  },
  {
    path: "android/app/src/main/java/com/phoneclusterapp/modules/MemoryModule.kt",
    lang: "kotlin",
    description: "Remote RAM — /v1/memory/<key> key/value store using phone RAM",
    content: `package com.phoneclusterapp.modules

import org.json.JSONArray
import org.json.JSONObject
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap

/**
 * Remote RAM: a tiny in-memory key/value store. POST a body to
 * /v1/memory/<key> to stash bytes on this device, GET them back, DELETE to free.
 * Lets a PC use spare phone RAM as overflow storage. Values live in process
 * memory and are lost when the daemon stops.
 */
class MemoryModule : ComputeModule {

    override val id = "memory"
    private val store = ConcurrentHashMap<String, ByteArray>()

    override fun handle(method: String, uri: String, body: String): ModuleResponse? {
        if (!uri.startsWith("/v1/memory")) return null
        val key = uri.removePrefix("/v1/memory").removePrefix("/")
        if (method == "GET" && key.isEmpty()) {
            val total = store.values.sumOf { it.size.toLong() }
            return ModuleResponse(body = JSONObject().apply {
                put("module", id)
                put("keys", JSONArray(Collections.list(store.keys)))
                put("count", store.size)
                put("bytes", total)
            }.toString())
        }
        if (key.isEmpty()) {
            return ModuleResponse(status = 400, body = JSONObject().put("error", "missing_key").toString())
        }
        return when (method) {
            "POST", "PUT" -> {
                val bytes = body.toByteArray()
                store[key] = bytes
                ModuleResponse(body = JSONObject().apply {
                    put("module", id); put("key", key); put("bytes", bytes.size)
                }.toString())
            }
            "GET" -> {
                val v = store[key]
                if (v == null) ModuleResponse(status = 404, body = JSONObject().put("error", "not_found").toString())
                else ModuleResponse(mimeType = "application/octet-stream", bytes = v)
            }
            "DELETE" -> {
                store.remove(key)
                ModuleResponse(body = JSONObject().apply {
                    put("module", id); put("key", key); put("deleted", true)
                }.toString())
            }
            else -> ModuleResponse(status = 405, body = JSONObject().put("error", "method_not_allowed").toString())
        }
    }
}
`,
  },
  {
    path: "android/app/src/main/java/com/phoneclusterapp/ClusterManagerActivity.kt",
    lang: "kotlin",
    description: "Multi-phone cluster manager — mDNS discovery + distributed benchmark",
    content: `package com.phoneclusterapp

import android.content.Context
import android.graphics.Typeface
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

/**
 * Cluster manager: discovers other PhoneCluster nodes on the LAN via mDNS
 * (_http._tcp.), pulls /v1/info from each, and shows aggregate cluster capacity
 * (node count, total cores, total RAM). "Run cluster benchmark" dispatches a
 * CPU workload to every node and sums sustained GFLOPS — a real multi-phone
 * cluster compute demo, no PC required.
 */
class ClusterManagerActivity : AppCompatActivity() {

    private lateinit var summary: TextView
    private lateinit var nodeList: TextView
    private lateinit var benchResult: TextView
    private lateinit var scanButton: Button
    private lateinit var benchButton: Button

    private var nsd: NsdManager? = null
    private var discovery: NsdManager.DiscoveryListener? = null
    private val nodes = mutableMapOf<String, NodeInfo>()

    private data class NodeInfo(val name: String, val host: String, val port: Int, val info: JSONObject?)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val dp = resources.displayMetrics.density
        val pad = (16 * dp).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
        }

        root.addView(TextView(this).apply {
            text = "Cluster Manager"
            textSize = 20f
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(0, 0, 0, pad)
        })
        root.addView(TextView(this).apply {
            text = "Discovers other phones on the LAN via mDNS and aggregates them into one cluster."
            textSize = 12f
            setPadding(0, 0, 0, pad)
        })

        summary = TextView(this).apply {
            textSize = 13f
            typeface = Typeface.MONOSPACE
            setPadding(0, 0, 0, pad / 2)
            text = "Nodes: 0\\nCores: 0\\nRAM: 0 MB"
        }
        root.addView(summary)

        scanButton = Button(this).apply { text = "Scan LAN for nodes"; setOnClickListener { startScan() } }
        root.addView(scanButton)

        root.addView(TextView(this).apply { text = "Discovered nodes"; textSize = 13f; setPadding(0, pad / 2, 0, 0) })
        nodeList = TextView(this).apply {
            textSize = 11f
            typeface = Typeface.MONOSPACE
            setPadding(0, pad / 4, 0, pad)
            text = "(not scanned)"
        }
        root.addView(nodeList)

        benchButton = Button(this).apply { text = "Run cluster CPU benchmark"; setOnClickListener { runBenchmark() } }
        root.addView(benchButton)
        benchResult = TextView(this).apply {
            textSize = 12f
            typeface = Typeface.MONOSPACE
            setPadding(0, pad / 4, 0, 0)
            text = "(not run)"
        }
        root.addView(benchResult)

        setContentView(ScrollView(this).apply { addView(root) })
    }

    override fun onDestroy() {
        super.onDestroy()
        stopScan()
    }

    private fun startScan() {
        stopScan()
        nodes.clear()
        nodeList.text = "scanning…"
        updateSummary()
        nsd = getSystemService(Context.NSD_SERVICE) as NsdManager
        discovery = object : NsdManager.DiscoveryListener {
            override fun onStartDiscoveryFailed(serviceType: String?, errorCode: Int) { nodeList.text = "discovery failed: " + errorCode }
            override fun onStopDiscoveryFailed(serviceType: String?, errorCode: Int) {}
            override fun onDiscoveryStarted(serviceType: String?) {}
            override fun onDiscoveryStopped(serviceType: String?) {}
            override fun onServiceFound(info: NsdServiceInfo) {
                if (info.serviceName?.startsWith("PhoneCluster-Node") != true) return
                resolve(info)
            }
            override fun onServiceLost(info: NsdServiceInfo) {
                nodes.remove(info.serviceName)
                runOnUiThread { renderNodes() }
            }
        }
        try {
            nsd!!.discoverServices("_http._tcp.", NsdManager.PROTOCOL_DNS_SD, discovery!!)
        } catch (e: Exception) {
            nodeList.text = "error: " + e.message
        }
    }

    private fun stopScan() {
        try { discovery?.let { nsd?.stopServiceDiscovery(it) } } catch (e: Exception) {}
        discovery = null
    }

    private fun resolve(info: NsdServiceInfo) {
        val listener = object : NsdManager.ResolveListener {
            override fun onServiceResolved(svc: NsdServiceInfo) {
                val host = svc.host?.hostAddress ?: return
                fetchInfo(svc.serviceName ?: "node", host, svc.port)
            }
            override fun onResolveFailed(p0: NsdServiceInfo?, p1: Int) {}
        }
        try { nsd?.resolveService(info, listener) } catch (e: Exception) {}
    }

    private fun fetchInfo(name: String, host: String, port: Int) {
        Thread {
            val info = try {
                val c = URL("http://" + host + ":" + port + "/v1/info").openConnection() as HttpURLConnection
                c.connectTimeout = 1500
                c.readTimeout = 1500
                try { JSONObject(c.inputStream.bufferedReader().use { it.readText() }) } finally { c.disconnect() }
            } catch (e: Exception) { null }
            nodes[name] = NodeInfo(name, host, port, info)
            runOnUiThread { renderNodes(); updateSummary() }
        }.start()
    }

    private fun renderNodes() {
        nodeList.text = if (nodes.isEmpty()) {
            "(none found — start the daemon on other phones on the same Wi-Fi)"
        } else {
            nodes.values.joinToString("\\n\\n") { n ->
                val i = n.info
                val mods = i?.optJSONArray("modules")?.let { arr -> (0 until arr.length()).joinToString(",") { idx -> arr.optString(idx) } } ?: "?"
                n.name + "  " + n.host + ":" + n.port + "\\n" +
                    (i?.optString("device_model") ?: "?") + " · " + (i?.optInt("cpu_cores") ?: 0) + " cores · " +
                    (i?.optLong("ram_available_mb") ?: 0L) + " MB free\\nmodules: " + mods
            }
        }
    }

    private fun updateSummary() {
        val totalCores = nodes.values.sumOf { it.info?.optInt("cpu_cores") ?: 0 }
        val totalRam = nodes.values.sumOf { it.info?.optLong("ram_available_mb") ?: 0L }
        summary.text = "Nodes: " + nodes.size + "\\nCores: " + totalCores + "\\nRAM: " + totalRam + " MB free"
    }

    private fun runBenchmark() {
        if (nodes.isEmpty()) { benchResult.text = "scan first (no nodes)"; return }
        benchButton.isEnabled = false
        benchResult.text = "dispatching to " + nodes.size + " nodes…"
        val total = java.util.concurrent.atomic.AtomicDouble(0.0)
        val done = java.util.concurrent.atomic.AtomicInteger(0)
        for (n in nodes.values) {
            Thread {
                val gf = try {
                    val c = URL("http://" + n.host + ":" + n.port + "/v1/compute").openConnection() as HttpURLConnection
                    c.requestMethod = "POST"
                    c.setRequestProperty("Content-Type", "application/json")
                    c.connectTimeout = 60000
                    c.readTimeout = 60000
                    c.doOutput = true
                    c.outputStream.use { it.write(JSONObject().put("size", 256).toString().toByteArray()) }
                    val j = JSONObject(c.inputStream.bufferedReader().use { it.readText() })
                    c.disconnect()
                    j.optDouble("gflops", 0.0)
                } catch (e: Exception) { 0.0 }
                total.addAndGet(gf)
                if (done.incrementAndGet() == nodes.size) {
                    runOnUiThread {
                        benchResult.text = "Cluster total: " + "%.3f".format(total.get()) + " GFLOPS across " + nodes.size + " nodes"
                        benchButton.isEnabled = true
                    }
                }
            }.start()
        }
    }
}
`,
  },
];