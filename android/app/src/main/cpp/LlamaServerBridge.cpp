#include <jni.h>
#include <android/log.h>
#include <string>
#include <vector>
#include <mutex>
#include <algorithm>
#include "llama.h"

#define TAG "LlamaBridge"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO,  TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

static std::mutex g_mtx;
static llama_model * g_model = nullptr;
static std::string  g_model_path;
static bool g_backend_inited = false;
static std::mutex g_log_mtx;
static std::string g_last_error;

static void capture_log(enum ggml_log_level level, const char * text, void *) {
    __android_log_write(level >= GGML_LOG_LEVEL_ERROR ? ANDROID_LOG_ERROR : ANDROID_LOG_INFO, TAG, text);
    if (level >= GGML_LOG_LEVEL_ERROR) {
        std::lock_guard<std::mutex> lk(g_log_mtx);
        g_last_error = std::string(text).substr(0, 1200);
    }
}

static void fail(JNIEnv * env, const char * code, const std::string & detail) {
    jclass type = env->FindClass("java/lang/IllegalStateException");
    env->ThrowNew(type, (std::string(code) + ": " + detail).c_str());
    env->DeleteLocalRef(type);
}

struct LoadProgress { JNIEnv * env; jobject module; jmethodID callback; };
static bool load_progress(float progress, void * data) {
    auto * p = static_cast<LoadProgress *>(data);
    p->env->CallVoidMethod(p->module, p->callback, progress);
    return !p->env->ExceptionCheck();
}

static jstring utf8_string(JNIEnv * env, const std::string & text) {
    jbyteArray bytes = env->NewByteArray((jsize) text.size());
    env->SetByteArrayRegion(bytes, 0, (jsize) text.size(), reinterpret_cast<const jbyte *>(text.data()));
    jclass cls = env->FindClass("java/lang/String");
    jmethodID ctor = env->GetMethodID(cls, "<init>", "([BLjava/lang/String;)V");
    jstring charset = env->NewStringUTF("UTF-8");
    jstring result = static_cast<jstring>(env->NewObject(cls, ctor, bytes, charset));
    env->DeleteLocalRef(bytes); env->DeleteLocalRef(charset); env->DeleteLocalRef(cls);
    return result;
}

extern "C" {

JNIEXPORT jboolean JNICALL
Java_com_phoneclusterapp_modules_LlmModule_nativeLoadModel(JNIEnv * env, jobject module, jstring jpath) {
    std::lock_guard<std::mutex> lk(g_mtx);
    const char * cpath = env->GetStringUTFChars(jpath, nullptr);
    std::string spath(cpath);
    env->ReleaseStringUTFChars(jpath, cpath);

    if (g_model && g_model_path == spath) return JNI_TRUE;
    if (g_model) { llama_model_free(g_model); g_model = nullptr; }

    if (!g_backend_inited) { llama_log_set(capture_log, nullptr); llama_backend_init(); g_backend_inited = true; }
    { std::lock_guard<std::mutex> log_lock(g_log_mtx); g_last_error.clear(); }
    jclass cls = env->GetObjectClass(module);
    jmethodID callback = env->GetMethodID(cls, "onLoadProgress", "(F)V");
    env->DeleteLocalRef(cls);
    if (!callback) return JNI_FALSE;
    LoadProgress progress { env, module, callback };
    llama_model_params mp = llama_model_default_params();
    mp.n_gpu_layers = 0; // CPU only, on any supported Android CPU
    mp.use_mmap = true;
    mp.use_mlock = false;
    mp.progress_callback = load_progress;
    mp.progress_callback_user_data = &progress;
    g_model = llama_model_load_from_file(spath.c_str(), mp);
    if (env->ExceptionCheck()) return JNI_FALSE;
    if (!g_model) {
        std::lock_guard<std::mutex> log_lock(g_log_mtx);
        fail(env, "MODEL_LOAD_FAILED", g_last_error.empty() ? "Could not allocate or load the verified model. Close other apps to free RAM and retry." : g_last_error);
        return JNI_FALSE;
    }
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
Java_com_phoneclusterapp_modules_LlmModule_nativeComplete(JNIEnv * env, jobject, jstring jprompt, jint jnpredict, jint jthreads) {
    const char * cprompt = env->GetStringUTFChars(jprompt, nullptr);
    std::string prompt(cprompt);
    env->ReleaseStringUTFChars(jprompt, cprompt);
    int n_predict = (int) jnpredict;
    if (n_predict <= 0 || n_predict > 1024) n_predict = 128;

    std::lock_guard<std::mutex> lk(g_mtx);
    if (!g_model) { fail(env, "MODEL_MISSING", "Model is not loaded into memory."); return nullptr; }

    const llama_vocab * vocab = llama_model_get_vocab(g_model);

    const int n_prompt = -llama_tokenize(vocab, prompt.c_str(), (int) prompt.size(), nullptr, 0, true, true);
    if (n_prompt <= 0) { fail(env, "TOKENIZATION_FAILED", "The prompt could not be tokenized."); return nullptr; }
    if (n_prompt + n_predict > 2048) { fail(env, "PROMPT_TOO_LONG", "Use a shorter prompt or request fewer tokens; this model has a 2048-token context."); return nullptr; }
    std::vector<llama_token> tokens(n_prompt);
    if (llama_tokenize(vocab, prompt.c_str(), (int) prompt.size(), tokens.data(), (int) tokens.size(), true, true) < 0) {
        fail(env, "TOKENIZATION_FAILED", "Tokenizer rejected the prompt."); return nullptr;
    }

    llama_context_params cp = llama_context_default_params();
    cp.n_ctx     = (int) tokens.size() + n_predict + 16;
    cp.n_batch   = ((int) tokens.size() > 0 ? (int) tokens.size() : 512);
    cp.no_perf   = true;
    cp.n_threads = std::max(1, (int) jthreads);
    cp.n_threads_batch = cp.n_threads;
    llama_context * ctx = llama_init_from_model(g_model, cp);
    if (!ctx) { fail(env, "CONTEXT_INIT_FAILED", "Not enough available memory or an unsupported backend. Close other apps and retry."); return nullptr; }

    auto sp = llama_sampler_chain_default_params();
    sp.no_perf = true;
    llama_sampler * smpl = llama_sampler_chain_init(sp);
    llama_sampler_chain_add(smpl, llama_sampler_init_greedy());

    llama_batch batch = llama_batch_get_one(tokens.data(), (int) tokens.size());

    std::string output;
    bool decode_failed = false;
    // The next batch stores a pointer: this token must survive every loop iteration.
    llama_token next_token = 0;
    for (int i = 0; i < n_predict; ++i) {
        if (llama_decode(ctx, batch)) { decode_failed = true; break; }
        next_token = llama_sampler_sample(smpl, ctx, -1);
        if (llama_vocab_is_eog(vocab, next_token)) break;
        std::vector<char> piece(128);
        int n = llama_token_to_piece(vocab, next_token, piece.data(), (int) piece.size(), 0, true);
        if (n < 0) {
            piece.resize(-n);
            n = llama_token_to_piece(vocab, next_token, piece.data(), (int) piece.size(), 0, true);
        }
        if (n > 0) output.append(piece.data(), n);
        batch = llama_batch_get_one(&next_token, 1);
    }

    llama_sampler_free(smpl);
    llama_free(ctx);
    if (decode_failed) { fail(env, "DECODE_FAILED", "Inference failed while decoding tokens. Check available RAM and retry."); return nullptr; }
    LOGI("generated %zu bytes", output.size());
    return utf8_string(env, output);
}

} // extern "C"