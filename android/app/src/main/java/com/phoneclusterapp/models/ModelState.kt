package com.phoneclusterapp.models

import android.content.Context
import android.os.SystemClock
import org.json.JSONObject
import java.util.concurrent.locks.ReentrantLock

/** One engine and one status per physical phone, shared by both simulator ports. */
object ModelState {
    val operationLock = ReentrantLock()
    @Volatile var loaded = false
    private var phase = "idle"
    private var detail = ""
    private var errorCode = ""
    private var failedStage = ""
    private var progress = -1.0
    private var bytes = 0L
    private var total = 0L
    private var started = 0L

    @Synchronized fun begin(next: String, message: String) {
        phase = next; detail = message; errorCode = ""; failedStage = ""
        progress = -1.0; bytes = 0; total = 0
        started = SystemClock.elapsedRealtime()
    }
    @Synchronized fun update(fraction: Double, done: Long = 0, size: Long = 0) {
        progress = fraction.coerceIn(0.0, 1.0); bytes = done; total = size
    }
    @Synchronized fun fail(code: String, message: String) {
        failedStage = phase; phase = "error"; errorCode = code; detail = message
    }
    @Synchronized fun snapshot(context: Context): JSONObject {
        val file = ModelFiles.file(context)
        val installed = file.length() == ModelFiles.SIZE
        val effective = if (phase != "idle") phase else when {
            installed -> "installed"
            file.exists() -> "error"
            else -> "missing"
        }
        val active = effective in listOf("connecting", "downloading", "verifying", "loading", "generating")
        val elapsed = if (active && started > 0) (SystemClock.elapsedRealtime() - started) / 1000.0 else 0.0
        val eta = if (effective in listOf("downloading", "verifying", "loading") && progress > 0.02 && progress < 1.0 && elapsed > 2)
            (elapsed * (1 - progress) / progress).toLong() else -1L
        val message = if (phase != "idle") detail else when {
            installed -> "Downloaded, not loaded into memory. Tap Load model."
            file.exists() -> "Incomplete model: ${file.length()} of ${ModelFiles.SIZE} bytes. Reinstall it."
            else -> "No model installed. Tap Install test model."
        }
        return JSONObject().put("stage", effective).put("detail", message)
            .put("error_code", if (phase == "idle" && file.exists() && !installed) "MODEL_FILE_INCOMPLETE" else errorCode)
            .put("failed_stage", if (phase == "idle" && file.exists() && !installed) "file_validation" else failedStage)
            .put("loaded", loaded).put("installed", installed).put("busy", active)
            .put("progress_percent", if (progress < 0) -1 else (progress * 100).toInt())
            .put("elapsed_seconds", elapsed.toLong()).put("eta_seconds", eta)
            .put("bytes_received", bytes).put("bytes_total", total)
            .put("file_bytes", file.length()).put("expected_bytes", ModelFiles.SIZE)
            .put("shared_engine", true)
    }
}