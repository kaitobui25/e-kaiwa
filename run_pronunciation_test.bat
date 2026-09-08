@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo E-KAIWA - PRONUNCIATION TEST
echo ========================================
echo.

if not exist "api.txt" (
    echo [ERROR] api.txt not found.
    pause
    exit /b 2
)

if not exist "stt_samples\manifest.json" (
    echo [ERROR] stt_samples\manifest.json not found.
    pause
    exit /b 2
)

if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" test_pronunciation.py
    set EXITCODE=%ERRORLEVEL%
    echo.
    pause
    exit /b %EXITCODE%
)

where py >nul 2>nul
if %ERRORLEVEL%==0 (
    py -3 test_pronunciation.py
    set EXITCODE=%ERRORLEVEL%
    echo.
    pause
    exit /b %EXITCODE%
)

where python >nul 2>nul
if %ERRORLEVEL%==0 (
    python test_pronunciation.py
    set EXITCODE=%ERRORLEVEL%
    echo.
    pause
    exit /b %EXITCODE%
)

echo [ERROR] Python not found.
pause
exit /b 2
