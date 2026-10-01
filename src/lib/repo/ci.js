export const ciFiles = [
  {
    path: ".github/workflows/build-pipeline.yml",
    lang: "yaml",
    description: "Cloud build → APK + PC bridge → release v0.1-testing",
    content: `name: Build Pipeline

on:
  push:
    branches: [ main, master ]
  workflow_dispatch:

permissions:
  contents: write

jobs:
  build:
    name: Build Android APK (arm64-v8a) + PC bridge
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v5

      - name: Set up Java 17
        uses: actions/setup-java@v5
        with:
          distribution: temurin
          java-version: '17'

      - name: Accept SDK licenses & install NDK 26.1 + CMake
        env:
          ANDROID_HOME: /usr/local/lib/android/sdk
        run: |
          export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/cmdline-tools/16.0/bin:$PATH"
          yes | sdkmanager --licenses > /dev/null || true
          sdkmanager --install "ndk;26.1.10909125" "cmake;3.22.1" "platforms;android-34" "build-tools;34.0.0"

      - name: Set up Gradle
        uses: gradle/actions/setup-gradle@v3
        with:
          gradle-version: '8.5'

      - name: Bootstrap Gradle wrapper jar if missing
        working-directory: android
        run: |
          if [ ! -f gradle/wrapper/gradle-wrapper.jar ]; then
            gradle wrapper --gradle-version 8.5
          fi

      - name: Make gradlew executable
        working-directory: android
        run: chmod +x gradlew

      - name: Ensure stable debug keystore (committed for consistent signing)
        run: |
          KS="$GITHUB_WORKSPACE/android/debug.keystore"
          if [ ! -f "$KS" ]; then
            keytool -genkeypair -keystore "$KS" -storepass android -alias androiddebugkey -keypass android \
              -keyalg RSA -keysize 2048 -validity 36500 -dname "CN=PhoneCluster Debug, O=PhoneCluster, C=US"
            echo "NEW_KEYSTORE=1" >> $GITHUB_ENV
            echo "Generated new debug keystore (will be committed back)"
          else
            echo "Using committed debug keystore"
          fi

      - name: "Fetch llama.cpp source (Milestone 1: native inference)"
        run: git clone --depth 1 --branch b11257 https://github.com/ggml-org/llama.cpp android/app/src/main/cpp/llama.cpp

      - name: Build debug APK
        working-directory: android
        run: ./gradlew assembleDebug --stacktrace

      - name: Commit debug keystore if newly generated
        if: env.NEW_KEYSTORE == '1'
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add android/debug.keystore
          git commit -m "chore: add stable debug keystore for consistent APK signing"
          git push

      - name: Package PC bridge (skip if files not committed yet)
        run: |
          if [ -f pc/connect_phone.bat ] && [ -f pc/index.html ]; then
            zip -j pc-bridge.zip pc/connect_phone.bat pc/index.html
            echo "PC_BRIDGE=pc-bridge.zip" >> $GITHUB_ENV
          else
            echo "pc/ files not present in this checkout — skipping bridge packaging."
          fi

      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: phonecluster-build
          path: |
            android/app/build/outputs/apk/debug/app-debug.apk
            pc-bridge.zip

      - name: Publish GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: v0.2-\${{ github.run_number }}
          name: PhoneClusterApp v0.2 (testing)
          prerelease: true
          make_latest: legacy
          body: |
            Automated build from commit \${{ github.sha }}.
            Prerelease flagged as "Latest" (make_latest: legacy) for Obtainium compatibility.
            - app-debug.apk : Android arm64-v8a (install via Obtainium)
            - pc-bridge.zip : connect_phone.bat + index.html (attached when pc/ is present)
          files: |
            android/app/build/outputs/apk/debug/app-debug.apk
            pc-bridge.zip
`,
  },
  {
    path: ".gitignore",
    lang: "text",
    description: "Ignore build outputs and local SDK config",
    content: `.gradle/
build/
.cxx/
local.properties
*.iml
.idea/
.DS_Store
android/app/src/main/cpp/llama.cpp/
`,
  },
];