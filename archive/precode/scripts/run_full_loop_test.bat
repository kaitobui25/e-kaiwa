@echo off
call "%~dp0_run_test.bat" test_full_loop.py
exit /b %ERRORLEVEL%
