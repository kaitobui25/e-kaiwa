@echo off
setlocal
set "ROOT=%~dp0.."
cd /d "%ROOT%"

if not exist "api.txt" (
  echo [ERROR] api.txt not found in repository root:
  echo %CD%
  echo Put one Gemini API key per line in api.txt.
  pause
  exit /b 2
)

if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" "web_app.py" --share
  set "EXITCODE=%ERRORLEVEL%"
) else (
  where py >nul 2>nul
  if %ERRORLEVEL%==0 (
    py -3 "web_app.py" --share
    set "EXITCODE=%ERRORLEVEL%"
  ) else (
    python "web_app.py" --share
    set "EXITCODE=%ERRORLEVEL%"
  )
)

echo.
pause
exit /b %EXITCODE%
