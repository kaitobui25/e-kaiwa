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
  ".venv\Scripts\python.exe" "tests\test_live_access.py"
  set "EXITCODE=%ERRORLEVEL%"
) else (
  where py >nul 2>nul
  if not errorlevel 1 (
    py -3 "tests\test_live_access.py"
    set "EXITCODE=%ERRORLEVEL%"
  ) else (
    python "tests\test_live_access.py"
    set "EXITCODE=%ERRORLEVEL%"
  )
)

echo.
pause
exit /b %EXITCODE%
