package com.phoneclusterapp

import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import com.phoneclusterapp.models.ModelStatusPanel
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
 * In-app "fake PC": shows the 2 local nodes, discovers peer PhoneCluster nodes
 * on the LAN, and dispatches prompts either to both local nodes or to the whole
 * cluster. Lets one phone stand in for several phones + a PC.
 */
class ClusterConsoleActivity : AppCompatActivity() {

    private val nodes = ComputeDaemonService.PORTS.mapIndexed { i, port -> "Endpoint ${'A' + i}" to port }
    private lateinit var nodeViews: List<TextView>
    private lateinit var clusterView: TextView
    private lateinit var log: TextView
    private lateinit var input: EditText
    private lateinit var sendBoth: Button
    private lateinit var sendCluster: Button
    private lateinit var discoverBtn: Button
    private var consoleReady = false
    private val statusHandler = Handler(Looper.getMainLooper())
    private val statusTick = object : Runnable {
        override fun run() { refreshNodes(); statusHandler.postDelayed(this, 2000) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            buildConsole()
            consoleReady = true
        } catch (e: Exception) {
            android.util.Log.e("ClusterConsole", "CONSOLE_INIT_FAILED", e)
            val pad = (16 * resources.displayMetrics.density).toInt()
            setContentView(TextView(this).apply {
                text = "Cluster console could not open\n\nerror_code: CONSOLE_INIT_FAILED\nerror: " +
                    (e.message ?: e.javaClass.simpleName) + "\n\nReturn to the main screen and retry."
                setPadding(pad, pad, pad, pad)
                setTextIsSelectable(true)
            })
        }
    }

    private fun buildConsole() {
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
            text = "${DeviceHardware.cpuCores()} physical cores on this phone. Local endpoints share its CPU, RAM and model; they are not extra phones. Start the daemon before sending."
            textSize = 12f
            setPadding(0, 0, 0, pad)
        })

        val narrow = resources.configuration.screenWidthDp < 600
        val nodesRow = LinearLayout(this).apply {
            orientation = if (narrow) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL
            setPadding(0, 0, 0, pad / 2)
        }
        nodeViews = nodes.map { entry ->
            val (name, port) = entry
            TextView(this).apply {
                textSize = 11f
                typeface = Typeface.MONOSPACE
                setPadding(pad / 2, pad / 2, pad / 2, pad / 2)
                text = name + "\n:" + port + "\n(checking…)"
            }.also { tv ->
                nodesRow.addView(tv, if (narrow) LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                    else LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            }
        }
        root.addView(nodesRow)
        root.addView(ModelStatusPanel(this))

        root.addView(TextView(this).apply {
            text = "Cluster (LAN discovery)"
            textSize = 13f
            setPadding(0, pad / 2, 0, pad / 4)
        })
        clusterView = TextView(this).apply {
            textSize = 11f
            typeface = Typeface.MONOSPACE
            setPadding(pad / 2, pad / 2, pad / 2, pad / 2)
            text = "(tap Discover)"
            setBackgroundColor(Color.parseColor("#111316"))
            setTextColor(Color.parseColor("#ccffcc"))
        }
        root.addView(clusterView, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ))
        discoverBtn = Button(this).apply {
            text = "Discover cluster nodes"
            setOnClickListener { discoverCluster() }
        }
        root.addView(discoverBtn)

        log = TextView(this).apply {
            textSize = 12f
            typeface = Typeface.MONOSPACE
            setPadding(pad / 2, pad / 2, pad / 2, pad / 2)
            text = "(send a prompt)"
            setBackgroundColor(Color.parseColor("#1a1a1a"))
            setTextColor(Color.parseColor("#e8e6e1"))
        }
        val scroll = ScrollView(this).apply {
            addView(log, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ))
        }
        root.addView(scroll, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, (resources.displayMetrics.heightPixels / 3).coerceAtLeast((160 * dp).toInt())
        ))

        input = EditText(this).apply { hint = "Prompt"; setSingleLine(true) }
        sendBoth = Button(this).apply { text = "Send to both" }
        sendCluster = Button(this).apply { text = "Send to cluster" }
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, pad, 0, 0)
        }
        bar.addView(input, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        val buttons = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        buttons.addView(sendBoth, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        buttons.addView(sendCluster, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        bar.addView(buttons)
        root.addView(bar)

        sendBoth.setOnClickListener {
            val p = input.text.toString().trim()
            if (p.isEmpty()) return@setOnClickListener
            input.setText("")
            log.append("\nyou> " + p)
            dispatchLocal(p)
        }
        sendCluster.setOnClickListener {
            val p = input.text.toString().trim()
            if (p.isEmpty()) return@setOnClickListener
            input.setText("")
            log.append("\nyou(cluster)> " + p)
            dispatchCluster(p)
        }

        setContentView(ScrollView(this).apply { isFillViewport = true; addView(root) })
    }

    override fun onResume() {
        super.onResume()
        if (consoleReady) statusHandler.post(statusTick)
    }

    override fun onPause() {
        statusHandler.removeCallbacks(statusTick)
        super.onPause()
    }

    private fun formatResponse(response: JSONObject): String {
        val code = response.optString("error_code")
        if (code.isNotEmpty() || response.has("error")) return "${code.ifEmpty { "REQUEST_FAILED" }}" +
            " [${response.optString("failed_stage").ifEmpty { response.optString("stage", "response") }}] ${response.optString("detail", response.optString("error"))}"
        return response.optString("content", "No response content.")
    }

    private fun refreshNodes() {
        nodes.forEachIndexed { i, entry ->
            val (name, port) = entry
            Thread {
                var failure = ""
                val info = try {
                    val c = URL("http://127.0.0.1:" + port + "/v1/info").openConnection() as HttpURLConnection
                    c.connectTimeout = 1200
                    c.readTimeout = 1200
                    try { JSONObject(c.inputStream.bufferedReader().use { it.readText() }) } finally { c.disconnect() }
                } catch (e: Exception) { failure = e.message ?: e.javaClass.simpleName; null }
                runOnUiThread {
                    nodeViews[i].text = if (info != null) {
                        name + " :" + port + "\n" + info.optString("device_model", "?") +
                            " · " + info.optInt("cpu_cores") + " physical cores (shared)\n" +
                            "RAM " + info.optLong("ram_available_mb") + " MB free (shared)\n" +
                            "Model: " + (info.optJSONObject("model_status")?.optString("stage") ?: "status unavailable")
                    } else {
                        name + " :" + port + "\nNODE_INFO_FAILED: " + failure + "\nStart the daemon if it is stopped."
                    }
                }
            }.start()
        }
    }

    private fun discoverCluster() {
        discoverBtn.isEnabled = false
        clusterView.text = "scanning LAN…"
        Thread {
            try {
                val c = URL("http://127.0.0.1:8080/v1/cluster/info").openConnection() as HttpURLConnection
                c.connectTimeout = 8000
                c.readTimeout = 8000
                val info = JSONObject(c.inputStream.bufferedReader().use { it.readText() })
                c.disconnect()
                val sb = StringBuilder()
                sb.append("Physical phones: ").append(info.optInt("physical_device_count"))
                  .append(" | endpoints: ").append(info.optInt("node_count"))
                  .append("\nPhysical cores: ").append(info.optInt("cluster_cpu_cores"))
                  .append(" | free RAM: ").append(info.optLong("cluster_ram_available_mb")).append(" MB\n")
                  .append("Hardware counted once per phone.\n")
                val ns = info.optJSONArray("nodes")
                if (ns != null) for (i in 0 until ns.length()) {
                    val n = ns.optJSONObject(i) ?: continue
                    val ni = n.optJSONObject("info") ?: JSONObject()
                    sb.append(if (n.optBoolean("self")) "self " else "peer ")
                      .append(n.optString("host")).append(":").append(n.optInt("port"))
                      .append("  ").append(ni.optString("device_model", "?"))
                      .append(if (n.optBoolean("shared_hardware")) " (shared phone, not extra cores)" else "")
                      .append("\n")
                }
                runOnUiThread { clusterView.text = sb.toString().trimEnd(); discoverBtn.isEnabled = true }
            } catch (e: Exception) {
                runOnUiThread { clusterView.text = "CLUSTER_DISCOVERY_FAILED: " + (e.message ?: e.javaClass.simpleName); discoverBtn.isEnabled = true }
            }
        }.start()
    }

    private fun dispatchLocal(prompt: String) {
        sendBoth.isEnabled = false; sendCluster.isEnabled = false
        val done = java.util.concurrent.atomic.AtomicInteger(0)
        nodes.forEachIndexed { _, entry ->
            val (name, port) = entry
            Thread {
                val resp = try {
                    val c = URL("http://127.0.0.1:" + port + "/v1/completions").openConnection() as HttpURLConnection
                    c.requestMethod = "POST"
                    c.setRequestProperty("Content-Type", "application/json")
                    c.connectTimeout = 30000
                    c.readTimeout = 300000
                    c.doOutput = true
                    c.outputStream.use {
                        it.write(JSONObject().put("prompt", prompt).put("n_predict", 128).toString().toByteArray())
                    }
                    val raw = try {
                        c.inputStream.bufferedReader().use { it.readText() }
                    } catch (_: Exception) {
                        val es = c.errorStream
                        if (es != null) es.bufferedReader().use { it.readText() } else "HTTP " + c.responseCode
                    }
                    c.disconnect()
                    try {
                        val j = JSONObject(raw)
                        formatResponse(j)
                    } catch (_: Exception) { raw }
                } catch (e: Exception) { "NODE_REQUEST_FAILED [connection] :$port: ${e.message ?: e.javaClass.simpleName}" }
                runOnUiThread {
                    log.append("\n" + name + "> " + resp)
                    if (done.incrementAndGet() == nodes.size) { sendBoth.isEnabled = true; sendCluster.isEnabled = true }
                }
            }.start()
        }
    }

    private fun dispatchCluster(prompt: String) {
        sendBoth.isEnabled = false; sendCluster.isEnabled = false
        log.append("\n(dispatching to whole cluster…)")
        Thread {
            try {
                val c = URL("http://127.0.0.1:8080/v1/cluster/completions").openConnection() as HttpURLConnection
                c.requestMethod = "POST"
                c.setRequestProperty("Content-Type", "application/json")
                c.connectTimeout = 60000
                c.readTimeout = 300000
                c.doOutput = true
                c.outputStream.use {
                    it.write(JSONObject().put("prompt", prompt).put("n_predict", 96).toString().toByteArray())
                }
                val raw = try {
                    c.inputStream.bufferedReader().use { it.readText() }
                } catch (_: Exception) {
                    val es = c.errorStream
                    if (es != null) es.bufferedReader().use { it.readText() } else "HTTP " + c.responseCode
                }
                c.disconnect()
                val j = try { JSONObject(raw) } catch (_: Exception) { JSONObject().put("error", raw) }
                val results = j.optJSONArray("results")
                val sb = StringBuilder()
                if (j.has("error") || j.optString("error_code").isNotEmpty()) sb.append("\n").append(formatResponse(j))
                if (results != null) for (i in 0 until results.length()) {
                    val r = results.optJSONObject(i) ?: continue
                    sb.append("\n").append(r.optString("host")).append(":").append(r.optInt("port"))
                      .append(if (r.optBoolean("self")) " (self)" else "").append("> ")
                      .append(formatResponse(r))
                }
                runOnUiThread {
                    log.append(sb.toString())
                    sendBoth.isEnabled = true; sendCluster.isEnabled = true
                }
            } catch (e: Exception) {
                runOnUiThread {
                    log.append("\nCLUSTER_REQUEST_FAILED [connection]: " + (e.message ?: e.javaClass.simpleName))
                    sendBoth.isEnabled = true; sendCluster.isEnabled = true
                }
            }
        }.start()
    }
}