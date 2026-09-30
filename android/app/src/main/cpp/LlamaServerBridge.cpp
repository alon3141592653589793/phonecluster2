#include <jni.h>
#include <android/log.h>
#include <string>
#include <vector>
#include <mutex>
#include "llama.h"

#define TAG "LlamaBridge"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO,  TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

static std::mutex g_mtx;
static llama_model * g_model = nullptr;
static std::string  g_model_path;
static bool g_backend_inited = false;

extern "C" {

JNIEXPORT jboolean JNICALL
Java_com_phoneclusterapp_modules_LlmModule_nativeLoadModel(JNIEnv * env, jobject, jstring jpath) {
    std::lock_guard<std::mutex> lk(g_mtx);
    const char * cpath = env->GetStringUTFChars(jpath, nullptr);
    std::string spath(cpath);
    env->ReleaseStringUTFChars(jpath, cpath);

    if (g_model && g_model_path == spath) return JNI_TRUE;
    if (g_model) { llama_model_free(g_model); g_model = nullptr; }

    if (!g_backend_inited) { llama_backend_init(); g_backend_inited = true; }

    llama_model_params mp = llama_model_default_params();
    mp.n_gpu_layers = 0; // CPU only on Android
    g_model = llama_model_load_from_file(spath.c_str(), mp);
    if (!g_model) { LOGE("failed to load model: %s", spath.c_str()); return JNI_FALSE; }
    g_model_path = spath;
    LOGI("model loaded: %s", spath.c_str());
    return JNI_TRUE;
}

JNIEXPORT jboolean JNICALL
Java_com_phoneclusterapp_modules_LlmModule_nativeIsLoaded(JNIEnv *, jobject) {
    std::lock_guard<std::mutex> lk(g_mtx);
    return g_model ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT jstring JNICALL
Java_com_phoneclusterapp_modules_LlmModule_nativeComplete(JNIEnv * env, jobject, jstring jprompt, jint jnpredict) {
    const char * cprompt = env->GetStringUTFChars(jprompt, nullptr);
    std::string prompt(cprompt);
    env->ReleaseStringUTFChars(jprompt, cprompt);
    int n_predict = (int) jnpredict;
    if (n_predict <= 0 || n_predict > 1024) n_predict = 128;

    std::lock_guard<std::mutex> lk(g_mtx);
    if (!g_model) return env->NewStringUTF("");

    const llama_vocab * vocab = llama_model_get_vocab(g_model);

    const int n_prompt = -llama_tokenize(vocab, prompt.c_str(), (int) prompt.size(), nullptr, 0, true, true);
    if (n_prompt <= 0) return env->NewStringUTF("");
    std::vector<llama_token> tokens(n_prompt);
    if (llama_tokenize(vocab, prompt.c_str(), (int) prompt.size(), tokens.data(), (int) tokens.size(), true, true) < 0) {
        return env->NewStringUTF("");
    }

    llama_context_params cp = llama_context_default_params();
    cp.n_ctx     = (int) tokens.size() + n_predict + 16;
    cp.n_batch   = ((int) tokens.size() > 0 ? (int) tokens.size() : 512);
    cp.no_perf   = true;
    llama_context * ctx = llama_init_from_model(g_model, cp);
    if (!ctx) { LOGE("failed to create context"); return env->NewStringUTF(""); }

    auto sp = llama_sampler_chain_default_params();
    sp.no_perf = true;
    llama_sampler * smpl = llama_sampler_chain_init(sp);
    llama_sampler_chain_add(smpl, llama_sampler_init_greedy());

    llama_batch batch = llama_batch_get_one(tokens.data(), (int) tokens.size());

    std::string output;
    for (int i = 0; i < n_predict; ) {
        if (llama_decode(ctx, batch)) { LOGE("decode failed"); break; }
        llama_token id = llama_sampler_sample(smpl, ctx, -1);
        if (llama_vocab_is_eog(vocab, id)) break;
        char buf[128];
        int n = llama_token_to_piece(vocab, id, buf, sizeof(buf), 0, true);
        if (n > 0) output.append(buf, n);
        batch = llama_batch_get_one(&id, 1);
        i++;
    }

    llama_sampler_free(smpl);
    llama_free(ctx);
    LOGI("generated %zu bytes", output.size());
    return env->NewStringUTF(output.c_str());
}

} // extern "C"
