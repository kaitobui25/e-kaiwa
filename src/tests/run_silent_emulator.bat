@echo off
setlocal EnableExtensions
set "ROOT=%~dp0..\.."
cd /d "%ROOT%"
set "PYTHONPATH=%CD%\src"

echo === Silent Coach: simulated WebSocket, PCM microphone, Coach and HTTP server ===
node --test src\tests\js\silent_coach.test.mjs src\tests\js\silent_view.test.mjs src\tests\js\silent_integration.test.mjs src\tests\js\silent_log.test.mjs
if errorlevel 1 exit /b 1
python -m unittest discover -s src\tests\python -p "test_silent_backend.py" -v
if errorlevel 1 exit /b 1
echo [PASS] Silent Coach emulator completed.
