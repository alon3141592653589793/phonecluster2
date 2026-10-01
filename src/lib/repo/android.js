export const androidFiles = [
  {
    path: "android/build.gradle",
    lang: "groovy",
    description: "Root build — repositories + Android Gradle Plugin 8.x",
    content: `// Top-level build file for PhoneClusterApp
buildscript {
    ext.kotlin_version = '1.9.22'
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath 'com.android.tools.build:gradle:8.2.2'
        classpath "org.jetbrains.kotlin:kotlin-gradle-plugin:$kotlin_version"
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

tasks.register('clean', Delete) {
    delete rootProject.layout.buildDirectory
}
`,
  },
  {
    path: "android/settings.gradle",
    lang: "groovy",
    description: "Project name + module includes",
    content: `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

rootProject.name = 'PhoneClusterApp'
include ':app'
`,
  },
  {
    path: "android/gradle.properties",
    lang: "properties",
    description: "Gradle JVM + AndroidX flags (required for AndroidX deps)",
    content: `org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
android.useAndroidX=true
android.nonTransitiveRClass=true
kotlin.code.style=official
`,
  },
  {
    path: "android/app/build.gradle",
    lang: "groovy",
    description: "App module — SDK 24/34, NDK 26.1, arm64-v8a, CMake",
    content: `plugins {
    id 'com.android.application'
    id 'org.jetbrains.kotlin.android'
}

android {
    namespace 'com.phoneclusterapp'
    compileSdk 34
    ndkVersion "26.1.10909125"

    defaultConfig {
        applicationId "com.phoneclusterapp"
        minSdk 24
        targetSdk 34
        versionCode 2
        versionName "0.2"

        ndk {
            abiFilters 'arm64-v8a'
        }

        externalNativeBuild {
            cmake {
                cppFlags "-std=c++17"
                arguments "-DANDROID_STL=c++_shared"
            }
        }
    }

    signingConfigs {
        debug {
            storeFile file("${rootProject.projectDir}/debug.keystore")
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }

    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt')
        }
    }

    externalNativeBuild {
        cmake {
            path "src/main/cpp/CMakeLists.txt"
            version "3.22.1"
        }
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = '17'
    }
}

dependencies {
    implementation 'androidx.core:core-ktx:1.12.0'
    implementation 'androidx.appcompat:appcompat:1.6.1'
    implementation 'com.google.android.material:material:1.11.0'
    implementation 'androidx.lifecycle:lifecycle-runtime-ktx:2.7.0'
    // Embedded HTTP server for the compute daemon (loopback only)
    implementation 'org.nanohttpd:nanohttpd:2.3.1'
}
`,
  },
  {
    path: "android/app/src/main/AndroidManifest.xml",
    lang: "xml",
    description: "Permissions + activity + specialUse foreground service",
    content: `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />

    <application
        android:label="PhoneClusterApp"
        android:icon="@android:drawable/sym_def_app_icon"
        android:theme="@style/Theme.AppCompat.Light.DarkActionBar"
        android:usesCleartextTraffic="true">

        <activity
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <activity
            android:name=".ClusterConsoleActivity"
            android:exported="false" />

        <service
            android:name=".ComputeDaemonService"
            android:exported="false"
            android:foregroundServiceType="specialUse">
            <property
                android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
                android:value="Local on-device AI inference server exposed over USB (adb forward)" />
        </service>
    </application>
</manifest>
`,
  },
];