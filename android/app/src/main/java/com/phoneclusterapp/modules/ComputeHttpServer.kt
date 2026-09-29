package com.phoneclusterapp.modules

import fi.iki.elonen.NanoHTTPD
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Lightweight embedded HTTP server bound to 0.0.0.0:8080, so it is reachable on
 * every active interface (loopback, USB tethering via rndis0/usb0, and Wi-Fi).
 * The PC connects directly over USB Tethering (Ethernet-over-USB) or the LAN —
 * no "adb forward" is required. Each request is dispatched on NanoHTTPD's
 * own worker thread; modules are walked in registration order until one claims
 * the route. Registration uses a [CopyOnWriteArrayList] so modules can be added
 * safely while the server is serving traffic.
 *
 * CORS headers are added to every response and OPTIONS preflight is answered
 * inline, so a browser console opened from file:// (pc/index.html) may call the
 * node directly — without that, the browser blocks the cross-origin response.
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
        for (module in modules) {
            val result = module.handle(method, uri, "")
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
            """{"error":"no module handles ${method} ${uri}"}"""
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
