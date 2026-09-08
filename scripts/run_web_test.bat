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

where cloudflared >nul 2>nul
if errorlevel 1 (
  echo [ERROR] cloudflared is not installed or not in PATH.
  echo Install it once with:
  echo   winget install -e --id Cloudflare.cloudflared
  echo Then close and reopen this terminal and run this script again.
  pause
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

echo Starting E-KAIWA Gradio on http://127.0.0.1:7860 ...
start "E-KAIWA Gradio" cmd /k "%PYTHON_CMD% web_app.py --host 127.0.0.1 --port 7860"

echo Waiting for Gradio...
for /L %%I in (1,1,20) do (
  powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:7860 -TimeoutSec 1 ^| Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
  if not errorlevel 1 goto server_ready
  timeout /t 1 /nobreak >nul
)

echo [ERROR] Gradio did not become ready on port 7860.
echo Check the "E-KAIWA Gradio" window for the Python error.
pause
exit /b 4

:server_ready
echo.
echo Gradio is ready.
echo Starting Cloudflare Quick Tunnel...
echo Open the https://...trycloudflare.com URL below on your phone.
echo Press Ctrl+C here to stop the tunnel.
echo Close the "E-KAIWA Gradio" window when you are done testing.
echo.
cloudflared tunnel --url http://127.0.0.1:7860

set "EXITCODE=%ERRORLEVEL%"
echo.
echo Cloudflare tunnel stopped.
pause
exit /b %EXITCODE%
