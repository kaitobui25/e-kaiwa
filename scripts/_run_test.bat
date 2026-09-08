@echo off
setlocal
set "ROOT=%~dp0.."
cd /d "%ROOT%"

if "%~1"=="" (
  echo [ERROR] Missing Python test filename.
  exit /b 2
)

if not exist "api.txt" (
  echo [ERROR] api.txt not found in repository root:
  echo %CD%
  echo Put one Gemini API key per line in api.txt.
  pause
  exit /b 2
)

copy /Y "api.txt" "tests\api.txt" >nul

if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" "tests\%~1"
  set "EXITCODE=%ERRORLEVEL%"
) else (
  where py >nul 2>nul
  if %ERRORLEVEL%==0 (
    py -3 "tests\%~1"
    set "EXITCODE=%ERRORLEVEL%"
  ) else (
    python "tests\%~1"
    set "EXITCODE=%ERRORLEVEL%"
  )
)

del /Q "tests\api.txt" >nul 2>nul

echo.
pause
exit /b %EXITCODE%
