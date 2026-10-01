import clusterConsoleFile from "@/lib/repo/clusterConsole";

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
            return ModuleResponse(status = 405, body = JSONObject().put("error_code", "METHOD_NOT_ALLOWED").put("error", "method_not_allowed").toString())
        }
        synchronized(lock) {
            if (!ensureLoaded()) {
                return ModuleResponse(status = 503, body = JSONObject().apply {
                    put("error_code", "MODEL_NOT_LOADED")
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
                    put("error_code", "INFERENCE_FAILED")
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
import org.json.JSONObject
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
                val resp = newFixedLengthResponse(status, result.mimeType, result.body)
                addCorsHeaders(resp)
                return resp
            }
        }
        val notFound = newFixedLengthResponse(
            Response.Status.NOT_FOUND,
            "application/json",
            JSONObject().put("error_code", "NOT_FOUND").put("error", "no module handles " + method + " " + uri).toString()
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
import com.phoneclusterapp.modules.ClusterOrchestratorModule
import com.phoneclusterapp.modules.ComputeHttpServer
import com.phoneclusterapp.modules.CpuBenchModule
import com.phoneclusterapp.modules.GpuInfoModule
import com.phoneclusterapp.modules.InfoModule
import com.phoneclusterapp.modules.LlmModule
import com.phoneclusterapp.modules.MediaModule

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
        val moduleIds = listOf("info_daemon", "llm", "cpu_bench", "gpu_info", "media_info", "cluster")
        for (port in PORTS) {
            try {
                val s = ComputeHttpServer(port).apply {
                    register(InfoModule(this@ComputeDaemonService, startTimeMs, moduleIds))
                    register(LlmModule(this@ComputeDaemonService))
                    register(CpuBenchModule())
                    register(GpuInfoModule())
                    register(MediaModule())
                    register(ClusterOrchestratorModule(this@ComputeDaemonService))
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
            notifButton, batteryButton, refreshButton, clusterButton,
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
  clusterConsoleFile,
  {
    path: "android/app/src/main/java/com/phoneclusterapp/modules/CpuBenchModule.kt",
    lang: "kotlin",
    description: "CPU benchmark — parallel matmul GFLOPS",
    content: `package com.phoneclusterapp.modules

import org.json.JSONObject

/** CPU compute benchmark: parallel matrix-multiply to measure GFLOPS. */
class CpuBenchModule : ComputeModule {
    override val id = "cpu_bench"
    override fun handle(method: String, uri: String, body: String): ModuleResponse? {
        if (method != "GET" || uri != "/v1/cpu/bench") return null
        val n = 160
        val cores = Runtime.getRuntime().availableProcessors().coerceAtLeast(1)
        val a = FloatArray(n * n) { (it % 7) - 3f }
        val b = FloatArray(n * n) { (it % 5) - 2f }
        val c = FloatArray(n * n)
        val perThread = (n + cores - 1) / cores
        val start = System.nanoTime()
        val threads = (0 until cores).map { t ->
            Thread {
                val r0 = t * perThread
                val r1 = minOf(r0 + perThread, n)
                for (i in r0 until r1) for (j in 0 until n) {
                    var s = 0f
                    for (k in 0 until n) s += a[i * n + k] * b[k * n + j]
                    c[i * n + j] = s
                }
            }.also { it.start() }
        }
        threads.forEach { it.join() }
        val ms = (System.nanoTime() - start) / 1e6
        val flops = 2.0 * n * n * n
        val gflops = if (ms > 0) flops / (ms / 1000.0) / 1e9 else 0.0
        var sum = 0.0
        for (v in c) sum += v
        return ModuleResponse(body = JSONObject().apply {
            put("module", "cpu_bench")
            put("matrix_size", n)
            put("cores_used", cores)
            put("time_ms", ms)
            put("gflops", gflops)
            put("checksum", sum.toLong())
        }.toString())
    }
}
`,
  },
  {
    path: "android/app/src/main/java/com/phoneclusterapp/modules/GpuInfoModule.kt",
    lang: "kotlin",
    description: "GPU probe — EGL/GLES renderer + clear benchmark",
    content: `package com.phoneclusterapp.modules

import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.GLES20
import org.json.JSONObject

/** GPU probe: EGL/GLES renderer + a clear-rate benchmark. */
class GpuInfoModule : ComputeModule {
    override val id = "gpu_info"
    override fun handle(method: String, uri: String, body: String): ModuleResponse? {
        if (method != "GET" || uri != "/v1/gpu/info") return null
        var display = EGL14.EGL_NO_DISPLAY
        var context = EGL14.EGL_NO_CONTEXT
        var surface = EGL14.EGL_NO_SURFACE
        try {
            display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
            if (display == EGL14.EGL_NO_DISPLAY) throw RuntimeException("no_display")
            val ver = IntArray(2)
            if (!EGL14.eglInitialize(display, ver, 0, ver, 1)) throw RuntimeException("egl_init")
            val cfgAttr = intArrayOf(
                EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_ALPHA_SIZE, 8,
                EGL14.EGL_SURFACE_TYPE, EGL14.EGL_PBUFFER_BIT,
                EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT, EGL14.EGL_NONE
            )
            val configs = arrayOfNulls<EGLConfig>(1)
            val num = IntArray(1)
            if (!EGL14.eglChooseConfig(display, cfgAttr, 0, configs, 0, 1, num, 0) || num[0] == 0)
                throw RuntimeException("no_config")
            val surfAttr = intArrayOf(EGL14.EGL_WIDTH, 64, EGL14.EGL_HEIGHT, 64, EGL14.EGL_NONE)
            surface = EGL14.eglCreatePbufferSurface(display, configs[0], surfAttr, 0)
            if (surface == EGL14.EGL_NO_SURFACE) throw RuntimeException("no_surface")
            val ctxAttr = intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE)
            context = EGL14.eglCreateContext(display, configs[0], EGL14.EGL_NO_CONTEXT, ctxAttr, 0)
            if (context == EGL14.EGL_NO_CONTEXT) throw RuntimeException("no_context")
            EGL14.eglMakeCurrent(display, surface, surface, context)
            val renderer = GLES20.glGetString(GLES20.GL_RENDERER) ?: "unknown"
            val vendor = GLES20.glGetString(GLES20.GL_VENDOR) ?: "unknown"
            val version = GLES20.glGetString(GLES20.GL_VERSION) ?: "unknown"
            val exts = GLES20.glGetString(GLES20.GL_EXTENSIONS) ?: ""
            val iters = 2000
            val s = System.nanoTime()
            for (i in 0 until iters) {
                GLES20.glClearColor((i and 255) / 255f, 0.2f, 0.3f, 1f)
                GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
            }
            GLES20.glFinish()
            val ms = (System.nanoTime() - s) / 1e6
            val cps = if (ms > 0) iters / (ms / 1000.0) else 0.0
            return ModuleResponse(body = JSONObject().apply {
                put("module", "gpu_info")
                put("renderer", renderer)
                put("vendor", vendor)
                put("gles_version", version)
                put("extensions_count", exts.split(" ").filter { it.isNotBlank() }.size)
                put("clear_bench_iters", iters)
                put("clear_bench_ms", ms)
                put("clears_per_sec", cps)
            }.toString())
        } catch (e: Exception) {
            return ModuleResponse(status = 200, body = JSONObject().apply {
                put("module", "gpu_info")
                put("error_code", "GPU_UNAVAILABLE")
                put("error", "gpu_unavailable")
                put("detail", e.message ?: "")
            }.toString())
        } finally {
            try { if (display != EGL14.EGL_NO_DISPLAY) EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT) } catch (_: Exception) {}
            try { if (context != EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(display, context) } catch (_: Exception) {}
            try { if (surface != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(display, surface) } catch (_: Exception) {}
        }
    }
}
`,
  },
  {
    path: "android/app/src/main/java/com/phoneclusterapp/modules/MediaModule.kt",
    lang: "kotlin",
    description: "Media probe — hardware codec enumeration",
    content: `package com.phoneclusterapp.modules

import android.media.MediaCodecList
import org.json.JSONArray
import org.json.JSONObject

/** Media probe: enumerate hardware/software codecs (encoders + decoders). */
class MediaModule : ComputeModule {
    override val id = "media_info"
    override fun handle(method: String, uri: String, body: String): ModuleResponse? {
        if (method != "GET" || uri != "/v1/media/info") return null
        val mcl = MediaCodecList(MediaCodecList.REGULAR_CODECS)
        val arr = JSONArray()
        var hwEnc = 0; var swEnc = 0; var hwDec = 0; var swDec = 0
        for (info in mcl.codecInfos) {
            val hw = !info.name.startsWith("OMX.") && !info.name.contains("c2.android") && !info.name.contains("c2.soft")
            if (info.isEncoder) { if (hw) hwEnc++ else swEnc++ } else { if (hw) hwDec++ else swDec++ }
            val types = JSONArray()
            for (t in info.supportedTypes) types.put(t)
            arr.put(JSONObject().apply {
                put("name", info.name)
                put("is_encoder", info.isEncoder)
                put("hardware", hw)
                put("types", types)
            })
        }
        return ModuleResponse(body = JSONObject().apply {
            put("module", "media_info")
            put("codec_count", arr.length())
            put("hw_encoders", hwEnc)
            put("sw_encoders", swEnc)
            put("hw_decoders", hwDec)
            put("sw_decoders", swDec)
            put("codecs", arr)
        }.toString())
    }
}
`,
  },
  {
    path: "android/app/src/main/java/com/phoneclusterapp/modules/ClusterOrchestratorModule.kt",
    lang: "kotlin",
    description: "Cluster orchestrator — LAN peer discovery + fan-out dispatch",
    content: `package com.phoneclusterapp.modules

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.URL
import java.util.Collections
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Cluster orchestrator: discovers peer PhoneCluster nodes on the LAN (subnet
 * scan of :8080), aggregates their /v1/info, and fans a completion request out
 * to every node. This is what turns several phones into one compute pool.
 */
class ClusterOrchestratorModule(private val context: Context) : ComputeModule {
    override val id = "cluster"
    private val selfPorts = listOf(8080, 8081)

    private fun ownIps(): List<String> {
        val out = mutableListOf<String>()
        try {
            Collections.list(NetworkInterface.getNetworkInterfaces()).forEach { i ->
                if (!i.isUp || i.isLoopback) return@forEach
                Collections.list(i.inetAddresses).forEach { a ->
                    if (a is Inet4Address && !a.isLoopbackAddress) a.hostAddress?.let { out.add(it) }
                }
            }
        } catch (_: Exception) {}
        return out
    }

    private fun lanBase(): String? {
        try {
            Collections.list(NetworkInterface.getNetworkInterfaces()).forEach { i ->
                if (!i.isUp || i.isLoopback) return@forEach
                Collections.list(i.inetAddresses).forEach { a ->
                    if (a is Inet4Address && !a.isLoopbackAddress) {
                        val ip = a.hostAddress ?: return@forEach
                        val parts = ip.split(".")
                        if (parts.size == 4) return parts.subList(0, 3).joinToString(".")
                    }
                }
            }
        } catch (_: Exception) {}
        return null
    }

    private fun fetchJson(host: String, port: Int, path: String, timeoutMs: Int, postBody: String? = null): JSONObject? {
        return try {
            val c = URL("http://$host:$port$path").openConnection() as HttpURLConnection
            c.connectTimeout = timeoutMs
            c.readTimeout = if (postBody != null) 60000 else timeoutMs
            if (postBody != null) {
                c.requestMethod = "POST"
                c.setRequestProperty("Content-Type", "application/json")
                c.doOutput = true
                c.outputStream.use { it.write(postBody.toByteArray()) }
            }
            val raw = try {
                c.inputStream.bufferedReader().use { it.readText() }
            } catch (_: Exception) {
                val es = c.errorStream
                if (es != null) {
                    es.bufferedReader().use { it.readText() }
                } else {
                    c.disconnect()
                    return null
                }
            }
            try { JSONObject(raw) } catch (_: Exception) { null } finally { c.disconnect() }
        } catch (_: Exception) { null }
    }

    private fun discoverPeers(timeoutMs: Int): List<Triple<String, Int, JSONObject?>> {
        val base = lanBase() ?: return emptyList()
        val own = ownIps()
        val peers = mutableListOf<Triple<String, Int, JSONObject?>>()
        val pool = Executors.newFixedThreadPool(48)
        val futs = (1..254).map { last ->
            pool.submit {
                val host = "$base.$last"
                if (host in own) return@submit
                val info = fetchJson(host, 8080, "/v1/info", timeoutMs)
                if (info != null) synchronized(peers) { peers.add(Triple(host, 8080, info)) }
            }
        }
        futs.forEach { it.get() }
        pool.shutdown()
        pool.awaitTermination(5, TimeUnit.SECONDS)
        return peers
    }

    private fun allNodes(scanTimeoutMs: Int): JSONArray {
        val arr = JSONArray()
        for (port in selfPorts) {
            val info = fetchJson("127.0.0.1", port, "/v1/info", 800)
            arr.put(JSONObject().put("host", "127.0.0.1").put("port", port).put("self", true).put("info", info ?: JSONObject()))
        }
        for ((host, port, info) in discoverPeers(scanTimeoutMs)) {
            arr.put(JSONObject().put("host", host).put("port", port).put("self", false).put("info", info ?: JSONObject()))
        }
        return arr
    }

    override fun handle(method: String, uri: String, body: String): ModuleResponse? {
        when (uri) {
            "/v1/cluster/nodes" -> {
                if (method != "GET") return ModuleResponse(status = 405, body = JSONObject().put("error_code", "METHOD_NOT_ALLOWED").put("error", "method_not_allowed").toString())
                return ModuleResponse(body = JSONObject().put("nodes", allNodes(350)).toString())
            }
            "/v1/cluster/info" -> {
                if (method != "GET") return ModuleResponse(status = 405, body = JSONObject().put("error_code", "METHOD_NOT_ALLOWED").put("error", "method_not_allowed").toString())
                val nodes = allNodes(350)
                var cores = 0
                var ram = 0L
                var count = 0
                for (i in 0 until nodes.length()) {
                    val o = nodes.optJSONObject(i) ?: continue
                    val info = o.optJSONObject("info") ?: continue
                    count++
                    cores += info.optInt("cpu_cores")
                    ram += info.optLong("ram_available_mb")
                }
                return ModuleResponse(body = JSONObject()
                    .put("node_count", count)
                    .put("cluster_cpu_cores", cores)
                    .put("cluster_ram_available_mb", ram)
                    .put("nodes", nodes).toString())
            }
            "/v1/cluster/completions" -> {
                if (method != "POST") return ModuleResponse(status = 405, body = JSONObject().put("error_code", "METHOD_NOT_ALLOWED").put("error", "method_not_allowed").toString())
                val req = try { JSONObject(if (body.isBlank()) "{}" else body) } catch (_: Exception) { JSONObject() }
                val prompt = req.optString("prompt", "")
                val nPredict = req.optInt("n_predict", req.optInt("max_tokens", 96))
                val nodes = allNodes(350)
                val results = JSONArray()
                val pool = Executors.newFixedThreadPool(16)
                val futs = (0 until nodes.length()).map { i ->
                    pool.submit {
                        val o = nodes.optJSONObject(i) ?: return@submit
                        val host = o.optString("host")
                        val port = o.optInt("port")
                        val resp = fetchJson(host, port, "/v1/completions", 60000,
                            JSONObject().put("prompt", prompt).put("n_predict", nPredict).toString())
                        val content = resp?.optString("content", resp.optString("error", "no_response")) ?: "no_response"
                        synchronized(results) {
                            results.put(JSONObject().put("host", host).put("port", port)
                                .put("self", o.optBoolean("self")).put("content", content))
                        }
                    }
                }
                futs.forEach { it.get() }
                pool.shutdown()
                return ModuleResponse(body = JSONObject().put("prompt", prompt)
                    .put("node_count", nodes.length()).put("results", results).toString())
            }
        }
        return null
    }
}
`,
  },
];