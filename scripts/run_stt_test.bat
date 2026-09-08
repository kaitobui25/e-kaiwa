@echo off
call "%~dp0_run_test.bat" test_stt.py
exit /b %ERRORLEVEL%
