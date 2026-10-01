package com.phoneclusterapp

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
            text = "Nodes: 0\nCores: 0\nRAM: 0 MB"
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
            nodes.values.joinToString("\n\n") { n ->
                val i = n.info
                val mods = i?.optJSONArray("modules")?.let { arr -> (0 until arr.length()).joinToString(",") { idx -> arr.optString(idx) } } ?: "?"
                n.name + "  " + n.host + ":" + n.port + "\n" +
                    (i?.optString("device_model") ?: "?") + " · " + (i?.optInt("cpu_cores") ?: 0) + " cores · " +
                    (i?.optLong("ram_available_mb") ?: 0L) + " MB free\nmodules: " + mods
            }
        }
    }

    private fun updateSummary() {
        val totalCores = nodes.values.sumOf { it.info?.optInt("cpu_cores") ?: 0 }
        val totalRam = nodes.values.sumOf { it.info?.optLong("ram_available_mb") ?: 0L }
        summary.text = "Nodes: " + nodes.size + "\nCores: " + totalCores + "\nRAM: " + totalRam + " MB free"
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
