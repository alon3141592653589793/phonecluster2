cmake_minimum_required(VERSION 3.22.1)
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
    ${log-lib}
)