@echo off
setlocal EnableExtensions
set "ROOT=%~dp0.."
cd /d "%ROOT%"

if not exist "api.txt" (
  echo [ERROR] api.txt not found in repository root:
  echo %CD%
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
  echo Install once with: winget install -e --id Cloudflare.cloudflared
  exit /b 3
)

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

start "E-KAIWA LIVE" cmd /k "%PYTHON_CMD% live_app.py"
timeout /t 2 /nobreak >nul

rem Keep cloudflared running, but suppress its verbose logs and print only the public URL once.
"%CLOUDFLARED%" tunnel --url http://127.0.0.1:7860 2>&1 | powershell -NoProfile -Command "$shown=$false; $input | ForEach-Object { if (-not $shown -and $_ -match 'https://[a-z0-9-]+\.trycloudflare\.com') { $matches[0]; $shown=$true } }"

exit /b %ERRORLEVEL%
