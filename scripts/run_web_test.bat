@echo off
setlocal EnableExtensions
set "ROOT=%~dp0.."
cd /d "%ROOT%"

if not exist "api.txt" (
  echo [ERROR] api.txt not found in repository root:
  echo %CD%
  echo Put one Gemini API key per line in api.txt.
  pause
  exit /b 2
)

rem Find cloudflared even when WinGet installed it but this CMD does not have the updated PATH.
set "CLOUDFLARED="
for /f "delims=" %%I in ('where cloudflared.exe 2^>nul') do if not defined CLOUDFLARED set "CLOUDFLARED=%%I"

if not defined CLOUDFLARED if exist "%LOCALAPPDATA%\Microsoft\WinGet\Links\cloudflared.exe" (
  set "CLOUDFLARED=%LOCALAPPDATA%\Microsoft\WinGet\Links\cloudflared.exe"
)

if not defined CLOUDFLARED if exist "%ProgramFiles%\cloudflared\cloudflared.exe" (
  set "CLOUDFLARED=%ProgramFiles%\cloudflared\cloudflared.exe"
)

if not defined CLOUDFLARED if defined ProgramFiles(x86) if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" (
  set "CLOUDFLARED=%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
)

if not defined CLOUDFLARED (
  for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "$root=Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'; if(Test-Path $root){$p=Get-ChildItem -Path $root -Filter cloudflared.exe -File -Recurse -ErrorAction SilentlyContinue ^| Select-Object -First 1; if($p){$p.FullName}}"`) do if not defined CLOUDFLARED set "CLOUDFLARED=%%I"
)

if not defined CLOUDFLARED (
  echo [ERROR] cloudflared.exe was not found.
  echo.
  echo If it is not installed, install once with:
  echo   winget install -e --id Cloudflare.cloudflared
  echo.
  pause
  exit /b 3
)

echo Cloudflare: %CLOUDFLARED%

if exist ".venv\Scripts\python.exe" (
  set "PYTHON_CMD=.venv\Scripts\python.exe"
) else (
  where py >nul 2>nul
  if not errorlevel 1 (
    set "PYTHON_CMD=py -3"
  ) else (
    set "PYTHON_CMD=python"
  )
)

echo Starting E-KAIWA LIVE on http://127.0.0.1:7860 ...
start "E-KAIWA LIVE" cmd /k "%PYTHON_CMD% live_app.py"

timeout /t 2 /nobreak >nul

echo.
echo Starting Cloudflare Quick Tunnel...
echo Open the https://...trycloudflare.com URL below on your phone.
echo Realtime audio goes directly between the phone and Gemini Live.
echo This PC only serves the page, creates ephemeral tokens, and runs coach feedback.
echo Press Ctrl+C here to stop the tunnel.
echo Close the "E-KAIWA LIVE" window when you are done testing.
echo.
"%CLOUDFLARED%" tunnel --url http://127.0.0.1:7860

set "EXITCODE=%ERRORLEVEL%"
echo.
echo Cloudflare tunnel stopped.
pause
exit /b %EXITCODE%
