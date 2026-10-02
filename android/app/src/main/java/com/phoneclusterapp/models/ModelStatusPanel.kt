package com.phoneclusterapp.models

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import com.phoneclusterapp.modules.LlmModule

class ModelStatusPanel(context: Context) : LinearLayout(context) {
    private val text = TextView(context).apply { textSize = 12f; setTextIsSelectable(true) }
    private val progress = ProgressBar(context, null, android.R.attr.progressBarStyleHorizontal)
    private val action = Button(context)
    private val repair = Button(context).apply {
        this.text = "Reinstall test model"
        setOnClickListener { ModelInstaller.install(context) }
    }
    private val handler = Handler(Looper.getMainLooper())
    private val tick = object : Runnable {
        override fun run() { render(); handler.postDelayed(this, 500) }
    }
    init {
        orientation = VERTICAL
        addView(text); addView(progress); addView(action); addView(repair)
        action.setOnClickListener {
            if (ModelState.snapshot(context).optBoolean("installed")) LlmModule(context.applicationContext).loadAsync()
            else ModelInstaller.install(context)
        }
    }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); handler.post(tick) }
    override fun onDetachedFromWindow() { handler.removeCallbacks(tick); super.onDetachedFromWindow() }
    private fun render() {
        val s = ModelState.snapshot(context)
        val busy = s.optBoolean("busy")
        val percent = s.optInt("progress_percent", -1)
        val eta = s.optLong("eta_seconds", -1)
        text.text = "Model: ${s.optString("stage")}\n${s.optString("detail")}" +
            (if (s.optString("error_code").isNotEmpty()) "\nError: ${s.optString("error_code")} at ${s.optString("failed_stage")}" else "") +
            (if (busy) "\nElapsed: ${s.optLong("elapsed_seconds")}s" else "") +
            (if (percent >= 0 && busy) " | $percent%" else "") +
            (if (busy) if (eta >= 0) " | Approx. ${eta}s left in this stage" else " | Time remaining unknown" else "") +
            (if (s.optLong("bytes_total") > 0 && busy) "\n${s.optLong("bytes_received") / 1048576} / ${s.optLong("bytes_total") / 1048576} MB" else "")
        progress.visibility = if (busy) VISIBLE else GONE
        progress.isIndeterminate = percent < 0; progress.progress = percent.coerceAtLeast(0)
        action.text = if (s.optBoolean("loaded")) "Model loaded" else if (s.optBoolean("installed")) "Load / retry model" else "Install test model"
        action.isEnabled = !busy && !s.optBoolean("loaded")
        repair.visibility = if (s.optString("stage") == "error" && !s.optBoolean("loaded")) VISIBLE else GONE
        repair.isEnabled = !busy
    }
}