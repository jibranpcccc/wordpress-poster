@echo off
title WordPress Smart Poster Launcher and Control Panel
color 0B

:menu
cls
echo ============================================================
echo   WordPress Smart Poster Launcher and Control Panel
echo ============================================================
echo.
echo   [1] Start Server (Port 3001) and Open Browser
echo   [2] Stop Server (Kill Port 3001 ONLY)
echo   [3] Restart Server
echo   [4] Exit
echo.
echo ============================================================
echo.
set /p choice="Enter your choice (1-4): "

if "%choice%"=="1" goto start_server
if "%choice%"=="2" goto stop_server
if "%choice%"=="3" goto restart_server
if "%choice%"=="4" exit /b 0
goto menu

:start_server
cls
echo ============================================================
echo   Starting WordPress Smart Poster...
echo ============================================================
echo.

:: 1. Check Node.js
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found on your system!
    echo Please install Node.js version 18 or newer from nodejs.org
    echo.
    pause
    goto menu
)

:: 2. Check and install dependencies
if not exist node_modules (
    echo [INFO] First time run: Installing dependencies...
    echo This may take a minute. Please wait...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Dependency installation failed!
        pause
        goto menu
    )
)

:: 3. Clean up port 3001 first
echo [INFO] Ensuring port 3001 is clean...
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr /i "listening" ^| findstr ":3001"') do (
    taskkill /PID %%p /F >nul 2>&1
)
taskkill /FI "WINDOWTITLE eq WP Smart Poster Server*" /F >nul 2>&1

:: 4. Start Next.js server in minimized background window
echo [INFO] Starting dev server on port 3001...
start "WP Smart Poster Server" /min cmd /c "npx next dev -p 3001"

echo [INFO] Waiting for server to initialize...
timeout /t 5 /nobreak >nul

echo [INFO] Opening http://localhost:3001 in browser...
start "" "http://localhost:3001"

echo.
echo ============================================================
echo   WordPress Smart Poster is RUNNING!
echo.
echo   Local Address : http://localhost:3001
echo ============================================================
echo.
echo   Press any key to STOP the server and return to menu...
echo.
pause >nul

goto stop_server

:stop_server
cls
echo ============================================================
echo   Stopping WordPress Smart Poster...
echo ============================================================
echo.
echo [INFO] Stopping process holding port 3001...

for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr /i "listening" ^| findstr ":3001"') do (
    taskkill /PID %%p /F >nul 2>&1
)
taskkill /FI "WINDOWTITLE eq WP Smart Poster Server*" /F >nul 2>&1

echo [SUCCESS] Server stopped successfully.
echo.
timeout /t 2 /nobreak >nul
goto menu

:restart_server
cls
echo ============================================================
echo   Restarting WordPress Smart Poster...
echo ============================================================
echo.
echo [INFO] Stopping current server...

for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr /i "listening" ^| findstr ":3001"') do (
    taskkill /PID %%p /F >nul 2>&1
)
taskkill /FI "WINDOWTITLE eq WP Smart Poster Server*" /F >nul 2>&1

echo [INFO] Waiting for port cleanup...
timeout /t 2 /nobreak >nul
goto start_server
