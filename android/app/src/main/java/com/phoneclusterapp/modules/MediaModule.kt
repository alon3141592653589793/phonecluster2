package com.phoneclusterapp.modules

import android.media.MediaCodecList
import org.json.JSONArray
import org.json.JSONObject

/** Media probe: enumerate hardware/software codecs (encoders + decoders). */
class MediaModule : ComputeModule {
    override val id = "media_info"
    override fun handle(method: String, uri: String, body: String): ModuleResponse? {
        if (method != "GET" || uri != "/v1/media/info") return null
        val mcl = MediaCodecList(MediaCodecList.REGULAR_CODECS)
        val arr = JSONArray()
        var hwEnc = 0; var swEnc = 0; var hwDec = 0; var swDec = 0
        for (info in mcl.codecInfos) {
            val hw = !info.name.startsWith("OMX.") && !info.name.contains("c2.android") && !info.name.contains("c2.soft")
            if (info.isEncoder) { if (hw) hwEnc++ else swEnc++ } else { if (hw) hwDec++ else swDec++ }
            val types = JSONArray()
            for (t in info.supportedTypes) types.put(t)
            arr.put(JSONObject().apply {
                put("name", info.name); put("is_encoder", info.isEncoder); put("hardware", hw); put("types", types)
            })
        }
        return ModuleResponse(body = JSONObject().apply {
            put("module", "media_info"); put("codec_count", arr.length())
            put("hw_encoders", hwEnc); put("sw_encoders", swEnc); put("hw_decoders", hwDec); put("sw_decoders", swDec)
            put("codecs", arr)
        }.toString())
    }
}
