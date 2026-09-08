@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo E-KAIWA - STT TEST
echo ========================================
echo.

if not exist "api.txt" (
    echo [ERROR] api.txt not found in %CD%
    echo Put one Gemini API key per line in api.txt
    echo.
    pause
    exit /b 2
)

if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" test_stt.py
) else (
    where py >nul 2>nul
    if %ERRORLEVEL%==0 (
        py -3 test_stt.py
    ) else (
        python test_stt.py
    )
)

set EXITCODE=%ERRORLEVEL%
echo.
pause
exit /b %EXITCODE%
