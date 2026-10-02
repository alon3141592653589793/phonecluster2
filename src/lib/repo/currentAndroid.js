import main from '/android/app/src/main/java/com/phoneclusterapp/MainActivity.kt?raw';
import consoleSource from '/android/app/src/main/java/com/phoneclusterapp/ClusterConsoleActivity.kt?raw';
import daemon from '/android/app/src/main/java/com/phoneclusterapp/ComputeDaemonService.kt?raw';
import hardware from '/android/app/src/main/java/com/phoneclusterapp/DeviceHardware.kt?raw';
import info from '/android/app/src/main/java/com/phoneclusterapp/modules/InfoModule.kt?raw';
import llm from '/android/app/src/main/java/com/phoneclusterapp/modules/LlmModule.kt?raw';
import orchestrator from '/android/app/src/main/java/com/phoneclusterapp/modules/ClusterOrchestratorModule.kt?raw';
import modelState from '/android/app/src/main/java/com/phoneclusterapp/models/ModelState.kt?raw';
import modelFiles from '/android/app/src/main/java/com/phoneclusterapp/models/ModelFiles.kt?raw';
import installer from '/android/app/src/main/java/com/phoneclusterapp/models/ModelInstaller.kt?raw';
import statusPanel from '/android/app/src/main/java/com/phoneclusterapp/models/ModelStatusPanel.kt?raw';
import native from '/android/app/src/main/cpp/LlamaServerBridge.cpp?raw';
import cmake from '/android/app/src/main/cpp/CMakeLists.txt?raw';
import manifest from '/android/app/src/main/AndroidManifest.xml?raw';
import build from '/android/app/build.gradle?raw';
import pipeline from '/.github/workflows/build-pipeline.yml?raw';

const javaRoot = 'android/app/src/main/java/com/phoneclusterapp/';
export const currentAndroidFiles = [
  ['MainActivity.kt', main, 'Device controls and live model status'],
  ['ClusterConsoleActivity.kt', consoleSource, 'Adaptive console with shared-hardware accounting'],
  ['ComputeDaemonService.kt', daemon, 'Foreground service and automatic model loading'],
  ['DeviceHardware.kt', hardware, 'Runtime CPU detection and physical-device identity'],
  ['modules/InfoModule.kt', info, 'Actual hardware, endpoint identity and model status'],
  ['modules/LlmModule.kt', llm, 'Shared inference engine with loading and failure diagnostics'],
  ['modules/ClusterOrchestratorModule.kt', orchestrator, 'Deduplicated hardware totals and complete node errors'],
  ['models/ModelState.kt', modelState, 'Live stages, progress, elapsed time and estimated remaining time'],
  ['models/ModelFiles.kt', modelFiles, 'Pinned model size and SHA-256 integrity validation'],
  ['models/ModelInstaller.kt', installer, 'Atomic verified download and automatic loading'],
  ['models/ModelStatusPanel.kt', statusPanel, 'Reusable model progress and retry controls'],
].map(([path, content, description]) => ({ path: javaRoot + path, content, description, lang: 'kotlin' })).concat([
  { path: 'android/app/src/main/cpp/LlamaServerBridge.cpp', content: native, lang: 'cpp', description: 'Portable JNI inference with real load progress and explicit errors' },
  { path: 'android/app/src/main/cpp/CMakeLists.txt', content: cmake, lang: 'cmake', description: 'Portable CPU inference build' },
  { path: 'android/app/src/main/AndroidManifest.xml', content: manifest, lang: 'xml', description: 'Daemon permissions and activity configuration' },
  { path: 'android/app/build.gradle', content: build, lang: 'groovy', description: 'Android 7+ build for ARM and x86 devices' },
  { path: '.github/workflows/build-pipeline.yml', content: pipeline, lang: 'yaml', description: 'Build and release the updated Android app' },
]);