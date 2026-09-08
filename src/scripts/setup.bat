@echo off
setlocal EnableExtensions
set "ROOT=%~dp0..\.."
cd /d "%ROOT%"

echo ========================================
echo E-KAIWA SETUP
echo ========================================
echo.

where py >nul 2>nul
if %ERRORLEVEL%==0 (
  set "PY=py -3"
) else (
  where python >nul 2>nul
  if %ERRORLEVEL% neq 0 (
    echo [FAIL] Python not found. Install Python 3.10+ and add it to PATH.
    pause
    exit /b 1
  )
  set "PY=python"
)

if not exist ".venv\Scripts\python.exe" (
  echo Creating virtual environment...
  %PY% -m venv .venv
  if %ERRORLEVEL% neq 0 goto :error
)

echo Installing/updating runtime dependencies...
".venv\Scripts\python.exe" -m pip install -q --upgrade pip
".venv\Scripts\python.exe" -m pip install -q -r src\requirements.txt
if %ERRORLEVEL% neq 0 goto :error

if not exist "api.txt" (
  echo.
  echo [WARN] api.txt not found in repository root.
  echo Create it before running the app. Put one Gemini API key per non-empty line.
)

where cloudflared.exe >nul 2>nul
if %ERRORLEVEL% neq 0 (
  echo.
  echo [WARN] cloudflared.exe is not currently on PATH.
  echo Install once with: winget install -e --id Cloudflare.cloudflared
)

echo.
echo [OK] Setup complete.
echo Run: src\scripts\run.bat
pause
exit /b 0

:error
echo.
echo [FAIL] Setup failed. Check the messages above.
pause
exit /b 1
