@echo off
chcp 65001 >nul
echo ============================================
echo   虚拟患者训练系统
echo ============================================

set "VENV_PYTHON=%~dp0backend\.venv\Scripts\python.exe"
set UVICORN_WORKERS=4

echo [1/3] 安装前端依赖...
cd /d "%~dp0frontend"
call npm ci

echo.
echo [2/3] 构建前端...
call npm run build
if %errorlevel% neq 0 (
    echo [错误] 前端构建失败
    pause
    exit /b 1
)

echo.
echo [3/3] 启动后端 (%UVICORN_WORKERS% workers)...
cd /d "%~dp0backend"
"%VENV_PYTHON%" -m uvicorn main:app --host 0.0.0.0 --port 8000 --workers %UVICORN_WORKERS%

echo.
echo 后端已停止。
pause >nul
