package com.phoneclusterapp.modules

/**
 * A ComputeModule owns a set of HTTP routes. The daemon's HTTP server walks the
 * registered modules in order and lets the first module that returns a non-null
 * [ModuleResponse] handle the request. This keeps new execution engines
 * (LLM, MediaCodec, WASM, ...) out of core service logic.
 *
 * Modules must be stateless and thread-safe: the HTTP server may invoke
 * [handle] concurrently from multiple worker threads.
 */
interface ComputeModule {
    val id: String

    /**
     * @param method HTTP verb, e.g. "GET", "POST".
     * @param uri    Request path (no query string).
     * @param body   Raw request body (may be empty).
     * @return A [ModuleResponse] to answer, or null if this module does not own the route.
     */
    fun handle(method: String, uri: String, body: String): ModuleResponse?
}

/** A minimal, transport-agnostic response rendered by the HTTP server. */
data class ModuleResponse(
    val status: Int = 200,
    val mimeType: String = "application/json",
    val body: String = ""
)
