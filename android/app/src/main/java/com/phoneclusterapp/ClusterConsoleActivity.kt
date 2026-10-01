package com.phoneclusterapp

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
 * In-app "fake PC": shows the 2 local nodes, discovers peer PhoneCluster nodes
 * on the LAN, and dispatches prompts either to both local nodes or to the whole
 * cluster. Lets one phone stand in for several phones + a PC.
 */
class ClusterConsoleActivity : AppCompatActivity() {

    private val nodes = listOf("Node A" to 8080, "Node B" to 8081)
    private lateinit var nodeViews: List<TextView>
    private lateinit var clusterView: TextView
    private lateinit var log: TextView
    private lateinit var input: EditText
    private lateinit var sendBoth: Button
    private lateinit var sendCluster: Button
    private lateinit var discoverBtn: Button

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
            text = "Start the daemon first — 2 local nodes + LAN cluster orchestrator."
            textSize = 12f
            setPadding(0, 0, 0, pad)
        })

        val nodesRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
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
                nodesRow.addView(tv, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            }
        }
        root.addView(nodesRow)

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
            setTextColor(Color.parseColor("#cfc"))
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
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f
        ))

        input = EditText(this).apply { hint = "Prompt"; setSingleLine(true) }
        sendBoth = Button(this).apply { text = "Send to both" }
        sendCluster = Button(this).apply { text = "Send to cluster" }
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, pad, 0, 0)
        }
        bar.addView(input, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        val btnCol = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        btnCol.addView(sendBoth)
        btnCol.addView(sendCluster)
        bar.addView(btnCol)
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
                        name + " :" + port + "\n" + info.optString("device_model", "?") +
                            " · " + info.optInt("cpu_cores") + " cores\n" +
                            "ram " + info.optLong("ram_available_mb") + " MB"
                    } else {
                        name + " :" + port + "\noffline"
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
                sb.append("Nodes: ").append(info.optInt("node_count"))
                  .append("  cores: ").append(info.optInt("cluster_cpu_cores"))
                  .append("  ram: ").append(info.optLong("cluster_ram_available_mb")).append(" MB\n")
                val ns = info.optJSONArray("nodes")
                if (ns != null) for (i in 0 until ns.length()) {
                    val n = ns.optJSONObject(i) ?: continue
                    val ni = n.optJSONObject("info") ?: JSONObject()
                    sb.append(if (n.optBoolean("self")) "self " else "peer ")
                      .append(n.optString("host")).append(":").append(n.optInt("port"))
                      .append("  ").append(ni.optString("device_model", "?")).append("\n")
                }
                runOnUiThread { clusterView.text = sb.toString().trimEnd(); discoverBtn.isEnabled = true }
            } catch (e: Exception) {
                runOnUiThread { clusterView.text = "error: " + e.message; discoverBtn.isEnabled = true }
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
                    c.readTimeout = 60000
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
                        j.optString("content", j.optString("error", raw))
                    } catch (_: Exception) { raw }
                } catch (e: Exception) { "error: " + e.message }
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
                c.readTimeout = 60000
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
                if (results != null) for (i in 0 until results.length()) {
                    val r = results.optJSONObject(i) ?: continue
                    sb.append("\n").append(r.optString("host")).append(":").append(r.optInt("port"))
                      .append(if (r.optBoolean("self")) " (self)" else "").append("> ")
                      .append(r.optString("content", "?"))
                }
                runOnUiThread {
                    log.append(sb.toString())
                    sendBoth.isEnabled = true; sendCluster.isEnabled = true
                }
            } catch (e: Exception) {
                runOnUiThread {
                    log.append("\ncluster error: " + e.message)
                    sendBoth.isEnabled = true; sendCluster.isEnabled = true
                }
            }
        }.start()
    }
}
