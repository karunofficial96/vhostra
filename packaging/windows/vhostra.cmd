@echo off
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0Vhostra.exe" "%~dp0resources\app.asar\scripts\vhostra.mjs" %*
exit /b %ERRORLEVEL%
