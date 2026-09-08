@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo E-KAIWA PC PREFLIGHT

echo.
where py >nul 2>nul
if %errorlevel%==0 (
    set PY=py
) else (
    where python >nul 2>nul
    if %errorlevel% neq 0 (
        echo [FAIL] Khong tim thay Python.
        echo Cai Python 3.10+ va tick "Add Python to PATH".
        pause
        exit /b 1
    )
    set PY=python
)

if not exist ".venv\Scripts\python.exe" (
    echo Tao virtual environment...
    %PY% -m venv .venv
    if %errorlevel% neq 0 goto :error
)

echo Cai/cap nhat dependencies...
".venv\Scripts\python.exe" -m pip install -q --upgrade pip
".venv\Scripts\python.exe" -m pip install -q -r requirements.txt
if %errorlevel% neq 0 goto :error

echo.
".venv\Scripts\python.exe" preflight.py

echo.
pause
exit /b 0

:error
echo.
echo [FAIL] Setup bi loi. Xem thong bao phia tren.
pause
exit /b 1
