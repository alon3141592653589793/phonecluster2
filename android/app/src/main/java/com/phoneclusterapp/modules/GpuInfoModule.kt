package com.phoneclusterapp.modules

import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.GLES20
import org.json.JSONObject

/** GPU probe: EGL/GLES renderer + a clear-rate benchmark. */
class GpuInfoModule : ComputeModule {
    override val id = "gpu_info"
    override fun handle(method: String, uri: String, body: String): ModuleResponse? {
        if (method != "GET" || uri != "/v1/gpu/info") return null
        var display = EGL14.EGL_NO_DISPLAY
        var context = EGL14.EGL_NO_CONTEXT
        var surface = EGL14.EGL_NO_SURFACE
        try {
            display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
            if (display == EGL14.EGL_NO_DISPLAY) throw RuntimeException("no_display")
            val ver = IntArray(2)
            if (!EGL14.eglInitialize(display, ver, 0, ver, 1)) throw RuntimeException("egl_init")
            val cfgAttr = intArrayOf(
                EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_ALPHA_SIZE, 8,
                EGL14.EGL_SURFACE_TYPE, EGL14.EGL_PBUFFER_BIT,
                EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT, EGL14.EGL_NONE
            )
            val configs = arrayOfNulls<EGLConfig>(1)
            val num = IntArray(1)
            if (!EGL14.eglChooseConfig(display, cfgAttr, 0, configs, 0, 1, num, 0) || num[0] == 0)
                throw RuntimeException("no_config")
            val surfAttr = intArrayOf(EGL14.EGL_WIDTH, 64, EGL14.EGL_HEIGHT, 64, EGL14.EGL_NONE)
            surface = EGL14.eglCreatePbufferSurface(display, configs[0], surfAttr, 0)
            if (surface == EGL14.EGL_NO_SURFACE) throw RuntimeException("no_surface")
            val ctxAttr = intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE)
            context = EGL14.eglCreateContext(display, configs[0], EGL14.EGL_NO_CONTEXT, ctxAttr, 0)
            if (context == EGL14.EGL_NO_CONTEXT) throw RuntimeException("no_context")
            EGL14.eglMakeCurrent(display, surface, surface, context)
            val renderer = GLES20.glGetString(GLES20.GL_RENDERER) ?: "unknown"
            val vendor = GLES20.glGetString(GLES20.GL_VENDOR) ?: "unknown"
            val version = GLES20.glGetString(GLES20.GL_VERSION) ?: "unknown"
            val exts = GLES20.glGetString(GLES20.GL_EXTENSIONS) ?: ""
            val iters = 2000
            val s = System.nanoTime()
            for (i in 0 until iters) {
                GLES20.glClearColor((i and 255) / 255f, 0.2f, 0.3f, 1f)
                GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
            }
            GLES20.glFinish()
            val ms = (System.nanoTime() - s) / 1e6
            val cps = if (ms > 0) iters / (ms / 1000.0) else 0.0
            return ModuleResponse(body = JSONObject().apply {
                put("module", "gpu_info"); put("renderer", renderer); put("vendor", vendor)
                put("gles_version", version)
                put("extensions_count", exts.split(" ").filter { it.isNotBlank() }.size)
                put("clear_bench_iters", iters); put("clear_bench_ms", ms); put("clears_per_sec", cps)
            }.toString())
        } catch (e: Exception) {
            return ModuleResponse(status = 200, body = JSONObject().apply {
                put("module", "gpu_info"); put("error", "gpu_unavailable"); put("detail", e.message ?: "")
            }.toString())
        } finally {
            try { if (display != EGL14.EGL_NO_DISPLAY) EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT) } catch (_: Exception) {}
            try { if (context != EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(display, context) } catch (_: Exception) {}
            try { if (surface != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(display, surface) } catch (_: Exception) {}
        }
    }
}
