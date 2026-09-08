@echo off
call "%~dp0_run_test.bat" test_pronunciation.py
exit /b %ERRORLEVEL%
