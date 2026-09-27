#include <jni.h>
#include <string>
#include <android/log.h>

#define LOG_TAG "LlamaServerBridge"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)

#if defined(__aarch64__)
static const char *kAbi = "arm64-v8a";
#else
static const char *kAbi = "unknown";
#endif

extern "C"
JNIEXPORT jstring JNICALL
Java_com_phoneclusterapp_MainActivity_getEngineStatus(JNIEnv *env, jobject /* this */) {
    std::string status = "Native engine: READY (stub) | ABI: ";
    status += kAbi;
    status += " | llama.cpp: not linked";
    LOGI("getEngineStatus() -> %s", status.c_str());
    return env->NewStringUTF(status.c_str());
}