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
                text = name + "\n:" + port + "\n(checking…)"
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
            log.append("\nyou> " + prompt)
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
                        name + " :" + port + "\n" + info.optString("device_model", "?") +
                            " · " + info.optInt("cpu_cores") + " cores\n" +
                            "ram " + info.optLong("ram_available_mb") + " MB free"
                    } else {
                        name + " :" + port + "\noffline (start daemon)"
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
                    log.append("\n" + name + "> " + resp)
                    if (done.incrementAndGet() == nodes.size) send.isEnabled = true
                }
            }.start()
        }
    }
}
