@echo off
call "%~dp0_run_test.bat" test_llm.py
exit /b %ERRORLEVEL%
