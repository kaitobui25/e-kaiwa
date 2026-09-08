@echo off
setlocal EnableExtensions
set "ROOT=%~dp0..\.."
cd /d "%ROOT%"

if exist ".venv\Scripts\python.exe" (
  set "PY=.venv\Scripts\python.exe"
) else (
  where py >nul 2>nul
  if not errorlevel 1 (
    set "PY=py -3"
  ) else (
    set "PY=python"
  )
)

set "PYTHONPATH=%CD%\src"

%PY% src\tests\system\check_system.py
set "RC=%ERRORLEVEL%"
exit /b %RC%
