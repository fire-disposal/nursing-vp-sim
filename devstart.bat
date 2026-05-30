@echo off
echo ============================================
echo   Nursing VP Sim - Dev Mode
echo ============================================
echo.
echo   Backend:  http://localhost:8000
echo   Frontend: http://localhost:3000
echo   API Docs: http://localhost:8000/docs
echo.

set "ROOT=%~dp0"
set "VENV_PYTHON=%ROOT%backend\.venv\Scripts\python.exe"

if not exist "%VENV_PYTHON%" (
    echo [ERROR] Virtual env not found at backend\.venv
    echo Run: cd backend ^&^& uv sync
    pause
    exit /b 1
)

echo [1/2] Starting backend (uvicorn --reload)...
start "Nursing-Backend" cmd /c "cd /d "%ROOT%backend" && "%VENV_PYTHON%" -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload"

echo [2/2] Starting frontend (vite dev)...
start "Nursing-Frontend" cmd /c "cd /d "%ROOT%frontend" && npm run dev"

echo.
echo Both servers started. Close their windows to stop.
echo.
pause
