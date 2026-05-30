@echo off
echo ============================================
echo   Nursing VP Sim - Production Start
echo ============================================

set "VENV_PYTHON=%~dp0backend\.venv\Scripts\python.exe"
set UVICORN_WORKERS=4

echo [1/3] Installing frontend deps...
cd /d "%~dp0frontend"
call npm ci

echo.
echo [2/3] Building frontend...
call npm run build
if %errorlevel% neq 0 (
    echo [ERROR] Frontend build failed
    pause
    exit /b 1
)

echo.
echo [3/3] Starting backend (%UVICORN_WORKERS% workers)...
cd /d "%~dp0backend"
"%VENV_PYTHON%" -m uvicorn main:app --host 0.0.0.0 --port 8000 --workers %UVICORN_WORKERS%

echo.
echo Backend stopped.
pause >nul
