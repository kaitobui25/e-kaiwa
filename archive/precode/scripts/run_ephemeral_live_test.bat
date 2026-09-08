@echo off
setlocal
set "ROOT=%~dp0.."
cd /d "%ROOT%"

if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" "tests\test_ephemeral_live.py"
) else (
  py -3 "tests\test_ephemeral_live.py"
)

echo.
pause
