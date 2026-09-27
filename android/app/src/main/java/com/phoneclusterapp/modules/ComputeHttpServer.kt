package com.phoneclusterapp.modules

import fi.iki.elonen.NanoHTTPD
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Lightweight embedded HTTP server bound to 127.0.0.1:8080. Reachable from the PC
 * via "adb forward tcp:8080 tcp:8080". Each request is dispatched on NanoHTTPD's
 * own worker thread; modules are walked in registration order until one claims
 * the route. Registration uses a [CopyOnWriteArrayList] so modules can be added
 * safely while the server is serving traffic.
 */
class ComputeHttpServer(port: Int) : NanoHTTPD("127.0.0.1", port) {

    private val modules = CopyOnWriteArrayList<ComputeModule>()

    fun register(module: ComputeModule) {
        modules.add(module)
    }

    val registeredModuleIds: List<String> get() = modules.map { it.id }

    override fun serve(session: IHTTPSession): Response {
        val method = session.method.name
        val uri = session.uri
        for (module in modules) {
            val result = module.handle(method, uri, "")
            if (result != null) {
                val status = Response.Status.lookup(result.status) ?: Response.Status.OK
                return newFixedLengthResponse(status, result.mimeType, result.body)
            }
        }
        return newFixedLengthResponse(
            Response.Status.NOT_FOUND,
            "application/json",
            """{"error":"no module handles ${method} ${uri}"}"""
        )
    }
}
