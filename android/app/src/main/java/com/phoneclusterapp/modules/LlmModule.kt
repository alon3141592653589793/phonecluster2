package com.phoneclusterapp.modules

import android.content.Context
import org.json.JSONObject

/**
 * Real LLM engine: loads the GGUF stored by the "Install test model" button and
 * serves POST /v1/completions and /v1/chat/completions via the llama.cpp JNI bridge.
 */
class LlmModule(private val context: Context) : ComputeModule {

    companion object {
        init { System.loadLibrary("LlamaServerBridge") }
        private const val MODEL_FILENAME = "tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf"
    }

    override val id = "llm"

    private val lock = Any()

    private fun modelPath(): String =
        ((context.getExternalFilesDir("models") ?: context.filesDir))
            .resolve(MODEL_FILENAME).absolutePath

    private fun modelExists(): Boolean = java.io.File(modelPath()).exists()

    private fun ensureLoaded(): Boolean {
        if (nativeIsLoaded()) return true
        if (!modelExists()) return false
        return nativeLoadModel(modelPath())
    }

    override fun handle(method: String, uri: String, body: String): ModuleResponse? {
        if (uri != "/v1/completions" && uri != "/v1/chat/completions") return null
        if (method != "POST") {
            return ModuleResponse(status = 405, body = JSONObject().put("error_code", "METHOD_NOT_ALLOWED").put("error", "method_not_allowed").toString())
        }
        synchronized(lock) {
            if (!ensureLoaded()) {
                return ModuleResponse(status = 503, body = JSONObject().apply {
                    put("error_code", "MODEL_NOT_LOADED")
                    put("error", "model_not_loaded")
                    put("detail", "Tap 'Install test model' in the app, then retry.")
                }.toString())
            }
            val req = try { JSONObject(if (body.isBlank()) "{}" else body) } catch (e: Exception) { JSONObject() }
            val nPredict = req.optInt("n_predict", req.optInt("max_tokens", 128))
            val prompt = buildPrompt(req)
            return try {
                val content = nativeComplete(prompt, nPredict)
                ModuleResponse(body = JSONObject().apply {
                    put("model", "tinyllama-1.1b-chat-v1.0")
                    put("content", content)
                    put("n_predict", nPredict)
                }.toString())
            } catch (e: Exception) {
                ModuleResponse(status = 500, body = JSONObject().apply {
                    put("error_code", "INFERENCE_FAILED")
                    put("error", "inference_failed")
                    put("detail", e.message ?: "")
                }.toString())
            }
        }
    }

    private fun buildPrompt(req: JSONObject): String {
        val p = req.optString("prompt", "")
        if (p.isNotEmpty()) return p
        val msgs = req.optJSONArray("messages") ?: return p
        val sb = StringBuilder()
        for (i in 0 until msgs.length()) {
            val m = msgs.optJSONObject(i) ?: continue
            sb.append(m.optString("role", "user"))
              .append(": ")
              .append(m.optString("content", ""))
              .append("\n")
        }
        sb.append("assistant: ")
        return sb.toString()
    }

    private external fun nativeLoadModel(path: String): Boolean
    private external fun nativeIsLoaded(): Boolean
    private external fun nativeComplete(prompt: String, nPredict: Int): String
}
