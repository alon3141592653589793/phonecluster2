package com.phoneclusterapp.modules

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
