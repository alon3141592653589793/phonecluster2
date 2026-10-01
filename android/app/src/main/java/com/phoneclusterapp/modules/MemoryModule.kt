package com.phoneclusterapp.modules

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
