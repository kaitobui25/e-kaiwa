@echo off
setlocal
set "ROOT=%~dp0.."
cd /d "%ROOT%"

if not exist "api.txt" (
  echo [ERROR] api.txt not found in repository root:
  echo %CD%
  pause
  exit /b 2
)

if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" web_app.py
) else (
  where py >nul 2>nul
  if not errorlevel 1 (
    py -3 web_app.py
  ) else (
    python web_app.py
  )
)
