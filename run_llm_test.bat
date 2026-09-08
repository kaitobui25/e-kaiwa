@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo E-KAIWA - GEMINI LLM TEST
echo ========================================
echo.

if not exist "api.txt" (
    echo [ERROR] api.txt not found in:
    echo %CD%
    echo.
    echo Put one Gemini API key per line in api.txt
    echo api.txt is already ignored by Git.
    echo.
    pause
    exit /b 2
)

if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" test_llm.py
    set EXITCODE=%ERRORLEVEL%
    echo.
    pause
    exit /b %EXITCODE%
)

where py >nul 2>nul
if %ERRORLEVEL%==0 (
    py -3 test_llm.py
    set EXITCODE=%ERRORLEVEL%
    echo.
    pause
    exit /b %EXITCODE%
)

where python >nul 2>nul
if %ERRORLEVEL%==0 (
    python test_llm.py
    set EXITCODE=%ERRORLEVEL%
    echo.
    pause
    exit /b %EXITCODE%
)

echo [ERROR] Python not found.
echo Run run.bat first or install Python 3.10+.
echo.
pause
exit /b 2
