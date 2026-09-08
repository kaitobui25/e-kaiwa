@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo E-KAIWA - FULL LOOP TEST
echo ========================================
echo.

if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" test_full_loop.py
) else (
  where py >nul 2>nul
  if %errorlevel%==0 (
    py -3 test_full_loop.py
  ) else (
    python test_full_loop.py
  )
)

echo.
pause
