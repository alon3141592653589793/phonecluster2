package com.phoneclusterapp.models

import android.content.Context
import android.os.StatFs
import com.phoneclusterapp.modules.LlmModule
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

object ModelInstaller {
    fun install(context: Context) {
        val app = context.applicationContext
        if (!ModelState.operationLock.tryLock()) return
        try {
            if (ModelState.loaded || ModelState.snapshot(app).optBoolean("busy")) return
            ModelState.begin("connecting", "Connecting to the model download. This is not memory loading yet.")
        } finally { ModelState.operationLock.unlock() }
        Thread {
            ModelState.operationLock.lock()
            var connection: HttpURLConnection? = null
            val target = ModelFiles.file(app)
            val partial = File(target.parentFile, target.name + ".part")
            try {
                target.parentFile?.mkdirs()
                if (StatFs(target.parentFile!!.absolutePath).availableBytes < ModelFiles.SIZE + 16 * 1024 * 1024)
                    throw ModelFailure("MODEL_STORAGE_LOW", "Not enough free storage. Free at least ${ModelFiles.SIZE / 1048576 + 16} MB and retry.")
                connection = URL(ModelFiles.URL).openConnection() as HttpURLConnection
                connection.connectTimeout = 20000; connection.readTimeout = 60000
                connection.instanceFollowRedirects = true
                connection.setRequestProperty("Accept-Encoding", "identity")
                connection.setRequestProperty("User-Agent", "PhoneClusterApp")
                val status = connection.responseCode
                if (status !in 200..299) throw ModelFailure("MODEL_DOWNLOAD_HTTP_$status", "Model server returned HTTP $status. Check the connection and retry.")
                ModelState.begin("downloading", "Downloading the model to storage. Keep the app open until it finishes.")
                var done = 0L
                connection.inputStream.use { input ->
                    FileOutputStream(partial).use { output ->
                        val buffer = ByteArray(64 * 1024)
                        var count: Int
                        while (input.read(buffer).also { count = it } >= 0) {
                            output.write(buffer, 0, count); done += count
                            ModelState.update(done.toDouble() / ModelFiles.SIZE, done, ModelFiles.SIZE)
                        }
                        output.fd.sync()
                    }
                }
                ModelFiles.verify(partial)
                if (!partial.renameTo(target)) throw ModelFailure("MODEL_INSTALL_FAILED", "Could not move the verified model into place. Check storage and retry.")
                ModelState.begin("installed", "Download verified. Starting memory loading next.")
            } catch (e: Exception) {
                partial.delete()
                ModelState.fail((e as? ModelFailure)?.code ?: "MODEL_DOWNLOAD_FAILED", e.message ?: e.javaClass.simpleName)
            } finally {
                connection?.disconnect()
                ModelState.operationLock.unlock()
            }
            if (ModelState.snapshot(app).optString("stage") == "installed") LlmModule(app).loadAsync()
        }.start()
    }
}