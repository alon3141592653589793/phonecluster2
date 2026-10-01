package com.phoneclusterapp.modules

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
            put("module", "cpu_bench"); put("matrix_size", n); put("cores_used", cores)
            put("time_ms", ms); put("gflops", gflops); put("checksum", sum.toLong())
        }.toString())
    }
}
