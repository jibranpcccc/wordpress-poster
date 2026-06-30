@echo off
title WordPress Smart Poster Launcher
color 0A

echo ============================================================
echo   WordPress Smart Poster Launcher
echo ============================================================
echo.

:: 1. Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found on your system!
    echo Please install Node.js (version 18 or newer) from:
    echo https://nodejs.org/
    echo.
    echo Press any key to exit...
    pause >nul
    exit /b 1
)

:: 2. Check and install dependencies if node_modules is missing
if not exist "node_modules\" (
    echo [INFO] First time run: Installing dependencies...
    echo This may take a minute. Please wait...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Dependency installation failed!
        pause
        exit /b 1
    )
    echo [INFO] Dependencies installed successfully.
)

:: 3. Kill any process on port 3001
echo [INFO] Cleaning up port 3001...
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr ":3001 "') do (
    taskkill /PID %%p /F >nul 2>&1
)

:: 4. Start Next.js server on port 3001 in a minimized window
echo [INFO] Starting dev server on port 3001...
start "WP Smart Poster Server" /min cmd /c "npx next dev -p 3001"

:: 5. Bounded wait for server startup, then launch browser
echo [INFO] Waiting for server to initialize...
timeout /t 5 /nobreak >nul

start "" "http://localhost:3001"

echo.
echo ============================================================
echo   WordPress Smart Poster is RUNNING!
echo.
echo   Local Address : http://localhost:3001
echo.
echo   To stop the server:
echo   1. Press Ctrl+C in the minimized background window, or
echo   2. Close this console window and the minimized window.
echo ============================================================
echo.
pause
