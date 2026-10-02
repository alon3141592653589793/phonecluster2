package com.phoneclusterapp.modules

import android.content.Context
import android.app.ActivityManager
import com.phoneclusterapp.DeviceHardware
import com.phoneclusterapp.models.ModelFailure
import com.phoneclusterapp.models.ModelFiles
import com.phoneclusterapp.models.ModelState
import org.json.JSONObject
import kotlin.concurrent.withLock

/**
 * Real LLM engine: loads the GGUF stored by the "Install test model" button and
 * serves POST /v1/completions and /v1/chat/completions via the llama.cpp JNI bridge.
 */
class LlmModule(private val context: Context) : ComputeModule {

    companion object {
        private val libraryError = try {
            System.loadLibrary("LlamaServerBridge"); null
        } catch (e: LinkageError) { e.message ?: "Native inference is unavailable for this CPU architecture." }
    }

    override val id = "llm"

    fun loadAsync() {
        if (!ModelState.operationLock.tryLock()) return
        try {
            if (ModelState.loaded || ModelState.snapshot(context).optBoolean("busy")) return
            ModelState.begin("loading", "Preparing to validate and load the model.")
        } finally { ModelState.operationLock.unlock() }
        Thread {
            ModelState.operationLock.withLock {
                try { ensureLoaded() }
                catch (e: Exception) { recordFailure(e, "MODEL_LOAD_FAILED") }
                catch (e: LinkageError) { ModelState.fail("NATIVE_LIBRARY_UNAVAILABLE", e.message ?: "Native engine missing.") }
            }
        }.start()
    }

    private fun ensureLoaded() {
        if (ModelState.loaded) return
        ModelState.begin("engine_init", "Checking native engine compatibility.")
        if (libraryError != null) throw ModelFailure("NATIVE_LIBRARY_UNAVAILABLE", libraryError)
        val file = ModelFiles.file(context)
        ModelState.begin("verifying", "Checking the downloaded model file.")
        ModelFiles.verify(file)
        val memory = ActivityManager.MemoryInfo()
        (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(memory)
        val needed = file.length() + 128L * 1048576
        if (memory.lowMemory || memory.availMem < needed) throw ModelFailure("MODEL_RAM_LOW",
            "${memory.availMem / 1048576} MB RAM available; allow approximately ${needed / 1048576} MB for this model. Close other apps and retry.")
        ModelState.begin("loading", "Loading verified model tensors into memory. Both local nodes share this engine.")
        if (!nativeLoadModel(file.absolutePath)) throw ModelFailure("MODEL_LOAD_FAILED", "Native loader rejected the verified model. Check available RAM, then retry.")
        ModelState.loaded = true
        ModelState.begin("ready", "Model loaded into memory and ready for prompts.")
    }

    @Suppress("unused")
    private fun onLoadProgress(progress: Float) { ModelState.update(progress.toDouble()) }

    private fun recordFailure(e: Exception, fallback: String): ModuleResponse {
        val detail = e.message ?: e.javaClass.simpleName
        val nativeCode = detail.substringBefore(":")
        val code = (e as? ModelFailure)?.code ?: if (nativeCode.matches(Regex("[A-Z_]+"))) nativeCode else fallback
        ModelState.fail(code, detail)
        return ModuleResponse(status = 503, body = ModelState.snapshot(context).put("error", "model_operation_failed").toString())
    }

    override fun handle(method: String, uri: String, body: String): ModuleResponse? {
        if (uri == "/v1/model/status" && method == "GET") return ModuleResponse(body = ModelState.snapshot(context).toString())
        if (uri == "/v1/model/load" && method == "POST") {
            loadAsync()
            return ModuleResponse(status = 202, body = ModelState.snapshot(context).toString())
        }
        if (uri != "/v1/completions" && uri != "/v1/chat/completions") return null
        if (method != "POST") return ModuleResponse(status = 405, body = JSONObject().put("error_code", "METHOD_NOT_ALLOWED").put("error", "method_not_allowed").toString())
        return ModelState.operationLock.withLock {
            if (ModelState.snapshot(context).optString("stage") in listOf("connecting", "downloading")) {
                return@withLock ModuleResponse(status = 409, body = ModelState.snapshot(context).put("error_code", "MODEL_DOWNLOADING").put("error", "Wait for the download to finish.").toString())
            }
            try {
                val req = JSONObject(if (body.isBlank()) "{}" else body)
                val nPredict = req.optInt("n_predict", req.optInt("max_tokens", 128)).coerceIn(1, 1024)
                val prompt = buildPrompt(req)
                if (prompt.isBlank()) throw ModelFailure("PROMPT_EMPTY", "Enter a prompt before sending.")
                ensureLoaded()
                ModelState.begin("generating", "Generating a response. Local simulator nodes run sequentially on one shared engine.")
                val content = nativeComplete(prompt, nPredict, DeviceHardware.inferenceThreads())
                if (content.isBlank()) throw ModelFailure("INFERENCE_EMPTY", "The model generated no text. Try a different prompt.")
                ModelState.begin("ready", "Response completed. Model remains loaded.")
                ModuleResponse(body = JSONObject().put("model", "tinyllama-1.1b-chat-v1.0").put("content", content).put("n_predict", nPredict).toString())
            } catch (e: Exception) {
                recordFailure(e, if (ModelState.loaded) "INFERENCE_FAILED" else "MODEL_LOAD_FAILED")
            } catch (e: LinkageError) {
                ModelState.fail("NATIVE_LIBRARY_UNAVAILABLE", e.message ?: "Native engine missing.")
                ModuleResponse(status = 503, body = ModelState.snapshot(context).put("error", "native_engine_unavailable").toString())
            }
        }
    }

    private fun buildPrompt(req: JSONObject): String {
        val p = req.optString("prompt", "")
        if (p.isNotEmpty()) return "<|user|>\n$p</s>\n<|assistant|>\n"
        val msgs = req.optJSONArray("messages") ?: return p
        val sb = StringBuilder()
        for (i in 0 until msgs.length()) {
            val m = msgs.optJSONObject(i) ?: continue
            val role = m.optString("role", "user").takeIf { it in listOf("user", "assistant", "system") } ?: "user"
            sb.append("<|").append(role).append("|>\n")
              .append(m.optString("content", "")).append("</s>\n")
        }
        sb.append("<|assistant|>\n")
        return sb.toString()
    }

    private external fun nativeLoadModel(path: String): Boolean
    private external fun nativeIsLoaded(): Boolean
    private external fun nativeComplete(prompt: String, nPredict: Int, threads: Int): String
}