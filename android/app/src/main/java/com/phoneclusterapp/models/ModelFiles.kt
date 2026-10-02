package com.phoneclusterapp.models

import android.content.Context
import java.io.File
import java.io.IOException
import java.security.MessageDigest

class ModelFailure(val code: String, message: String) : IOException(message)

/** Metadata pinned to the upstream TinyLlama Q4_K_M file, not a phone model. */
object ModelFiles {
    const val NAME = "tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf"
    const val URL = "https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/$NAME"
    const val SIZE = 668788096L
    const val SHA256 = "9fecc3b3cd76bba89d504f29b616eedf7da85b96540e490ca5824d3f7d2776a0"
    private var verifiedStamp = ""
    fun file(context: Context) = File(context.getExternalFilesDir("models") ?: context.filesDir, NAME)
    fun verify(file: File) {
        if (!file.exists()) throw ModelFailure("MODEL_MISSING", "Install the test model on the main screen first.")
        if (file.length() != SIZE) throw ModelFailure("MODEL_FILE_INCOMPLETE", "Downloaded ${file.length()} of $SIZE bytes. Reinstall the test model.")
        val stamp = "${file.absolutePath}:${file.lastModified()}:${file.length()}"
        if (stamp == verifiedStamp) return
        ModelState.begin("verifying", "Checking the model's SHA-256 integrity before loading.")
        val digest = MessageDigest.getInstance("SHA-256")
        var done = 0L
        file.inputStream().use { input ->
            val buffer = ByteArray(256 * 1024)
            var count: Int
            while (input.read(buffer).also { count = it } >= 0) {
                digest.update(buffer, 0, count); done += count
                ModelState.update(done.toDouble() / SIZE, done, SIZE)
            }
        }
        val hash = digest.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
        if (hash != SHA256) throw ModelFailure("MODEL_CHECKSUM_FAILED", "The model is corrupted or is not the expected file. Reinstall it.")
        verifiedStamp = stamp
    }
}