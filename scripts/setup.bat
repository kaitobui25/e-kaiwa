@echo off
setlocal
set "ROOT=%~dp0.."
cd /d "%ROOT%"

echo ========================================
echo E-KAIWA PC PREFLIGHT
echo ========================================
echo.

where py >nul 2>nul
if %ERRORLEVEL%==0 (
  set "PY=py"
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

echo Installing/updating dependencies...
".venv\Scripts\python.exe" -m pip install -q --upgrade pip
".venv\Scripts\python.exe" -m pip install -q -r requirements.txt
if %ERRORLEVEL% neq 0 goto :error

echo.
".venv\Scripts\python.exe" tools\preflight.py

echo.
pause
exit /b 0

:error
echo.
echo [FAIL] Setup failed. Check the messages above.
pause
exit /b 1
