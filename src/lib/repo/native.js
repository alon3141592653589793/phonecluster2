export const nativeFiles = [
  {
    path: "android/app/src/main/cpp/CMakeLists.txt",
    lang: "cmake",
    description: "Builds libLlamaServerBridge.so, linked to logcat",
    content: `cmake_minimum_required(VERSION 3.22.1)
project("LlamaServerBridge" LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Planned: add_subdirectory(llama.cpp) with -DGGML_VULKAN=ON -DGGML_OPENMP=ON
#          producing libllama.so and linking it below.

add_library(LlamaServerBridge SHARED
    LlamaServerBridge.cpp
)

find_library(log-lib log)

target_link_libraries(LlamaServerBridge
    \${log-lib}
)
`,
  },
  {
    path: "android/app/src/main/cpp/LlamaServerBridge.cpp",
    lang: "cpp",
    description: "JNI entrypoint — getEngineStatus() stub",
    content: `#include <jni.h>
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
`,
  },
];