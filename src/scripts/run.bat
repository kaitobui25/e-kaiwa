@echo off
setlocal EnableExtensions
set "ROOT=%~dp0..\.."
cd /d "%ROOT%"

if not exist "api.txt" (
  echo [ERROR] api.txt not found in repository root:
  echo %CD%
  exit /b 2
)

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
  start "E-KAIWA LIVE" cmd /k ".venv\Scripts\python.exe src\app.py"
) else (
  where py >nul 2>nul
  if not errorlevel 1 (
    start "E-KAIWA LIVE" cmd /k "py -3 src\app.py"
  ) else (
    start "E-KAIWA LIVE" cmd /k "python src\app.py"
  )
)

timeout /t 2 /nobreak >nul

rem Keep cloudflared running, suppress verbose logs, and print the public URL once.
"%CLOUDFLARED%" tunnel --url http://127.0.0.1:7860 2>&1 | powershell -NoProfile -Command "$shown=$false; $input | ForEach-Object { if (-not $shown -and $_ -match 'https://[a-z0-9-]+\.trycloudflare\.com') { $matches[0]; $shown=$true } }"

exit /b %ERRORLEVEL%
