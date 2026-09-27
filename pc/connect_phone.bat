@echo off
title PhoneClusterApp - USB Bridge
echo ============================================
echo   PhoneClusterApp :: USB AI Compute Node
echo ============================================

where adb >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] adb not found in PATH. Install Android Platform Tools.
    pause
    exit /b 1
)

echo [1/3] Waiting for device...
adb wait-for-device

echo [2/3] Forwarding PC tcp:8080 -^> phone tcp:8080
adb forward tcp:8080 tcp:8080
if %errorlevel% neq 0 (
    echo [ERROR] Port forward failed.
    pause
    exit /b 1
)

echo [3/3] Opening chat UI...
start "" "%~dp0index.html"

echo.
echo Bridge active. Forwarding persists until the phone is unplugged
echo or you run: adb forward --remove tcp:8080
pause