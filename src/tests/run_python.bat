@echo off
setlocal EnableExtensions
set "ROOT=%~dp0..\.."
cd /d "%ROOT%"

if exist ".venv\Scripts\python.exe" (
  set "PY=.venv\Scripts\python.exe"
) else (
  where py >nul 2>nul
  if not errorlevel 1 (
    set "PY=py -3"
  ) else (
    set "PY=python"
  )
)

set "PYTHONPATH=%CD%\src"

echo ========================================
echo E-KAIWA PYTHON TESTS
echo ========================================
echo.
%PY% -m unittest discover -s src\tests\python -p "test_*.py" -v
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
  echo [PASS] Python tests passed.
) else (
  echo [FAIL] Python tests failed. Exit code: %RC%
)
exit /b %RC%
