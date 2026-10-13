@echo off
rem One-command launcher for the Secure Local DocQA web app. Double-click, or run from a terminal.
rem Sets up the Python and frontend dependencies, then starts the dev host and the Open WebUI
rem frontend and opens the browser. It asks whether to run the Quick demo (no downloads) or a
rem real local model. Close this window or press Ctrl+C to stop everything.
rem
rem The llama.cpp runtime chat (the old behaviour of this file) still lives at
rem   app\document-qa\backend\secure_qa\answering\llama_cpp\start.cmd
setlocal
cd /d "%~dp0"

set "PYEXE="
where py >nul 2>nul && set "PYEXE=py -3"
if not defined PYEXE (where python >nul 2>nul && set "PYEXE=python")
if not defined PYEXE goto :nopython

%PYEXE% "%~dp0launch.py" %*
if errorlevel 1 goto :fail
exit /b 0

:nopython
echo.
echo Python was not found. Install Python 3.11+ from https://www.python.org/downloads/
echo and tick "Add python.exe to PATH" during setup, then run this file again.
pause
exit /b 1

:fail
echo.
echo The launcher stopped with an error - read the message above.
pause
exit /b 1
