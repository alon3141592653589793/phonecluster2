package com.phoneclusterapp.modules

/**
 * Stub for the future llama.cpp runtime. Claiming the /v1/completions and
 * /v1/chat/completions routes now lets the routing architecture prove itself
 * end-to-end before the native engine is linked.
 */
class LlmStubModule : ComputeModule {

    override val id = "llm_stub"

    override fun handle(method: String, uri: String, body: String): ModuleResponse? {
        if (uri == "/v1/completions" || uri == "/v1/chat/completions") {
            return ModuleResponse(
                status = 501,
                body = """{"error":"llm_stub not implemented","detail":"llama.cpp runtime planned"}"""
            )
        }
        return null
    }
}
