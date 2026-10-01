package com.phoneclusterapp.modules

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
                c.requestMethod = "POST"; c.setRequestProperty("Content-Type", "application/json"); c.doOutput = true
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
        pool.shutdown(); pool.awaitTermination(5, TimeUnit.SECONDS)
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
                var cores = 0; var ram = 0L; var count = 0
                for (i in 0 until nodes.length()) {
                    val o = nodes.optJSONObject(i) ?: continue
                    val info = o.optJSONObject("info") ?: continue
                    count++; cores += info.optInt("cpu_cores"); ram += info.optLong("ram_available_mb")
                }
                return ModuleResponse(body = JSONObject().put("node_count", count)
                    .put("cluster_cpu_cores", cores).put("cluster_ram_available_mb", ram).put("nodes", nodes).toString())
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
                        val host = o.optString("host"); val port = o.optInt("port")
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
