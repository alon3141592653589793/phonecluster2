package com.phoneclusterapp.modules

import android.graphics.Bitmap
import android.graphics.Color
import java.io.ByteArrayOutputStream
import org.json.JSONObject

/**
 * Remote GPU/graphics: GET /v1/render rasterizes a 256×256 Mandelbrot fractal
 * and returns it as PNG. A first step toward exposing the device's rendering
 * hardware as a remote graphics endpoint (a GPU/NPU rasterizer can replace the
 * CPU loop later).
 */
class GpuModule : ComputeModule {

    override val id = "gpu"

    override fun handle(method: String, uri: String, body: String): ModuleResponse? {
        if (uri != "/v1/render") return null
        if (method != "GET") {
            return ModuleResponse(status = 405, body = JSONObject().put("error", "method_not_allowed").toString())
        }
        val w = 256
        val h = 256
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val maxIter = 128
        for (y in 0 until h) {
            for (x in 0 until w) {
                val cx = -0.5 + (x - w / 2) * 2.5 / w
                val cy = (y - h / 2) * 2.5 / h
                var zx = 0.0
                var zy = 0.0
                var iter = 0
                while (iter < maxIter && zx * zx + zy * zy < 4.0) {
                    val t = zx * zx - zy * zy + cx
                    zy = 2 * zx * zy + cy
                    zx = t
                    iter++
                }
                val color = if (iter == maxIter) Color.BLACK else Color.HSVToColor(floatArrayOf(iter * 360f / maxIter, 1f, 1f))
                bmp.setPixel(x, y, color)
            }
        }
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
        return ModuleResponse(mimeType = "image/png", bytes = out.toByteArray())
    }
}
