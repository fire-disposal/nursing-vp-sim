@echo off
chcp 65001 >nul
echo ============================================
echo   虚拟患者训练系统 (开发模式)
echo ============================================
echo.
echo   后端:  http://localhost:8000
echo   前端:  npm run dev --prefix frontend
echo.

set "VENV_PYTHON=%~dp0backend\.venv\Scripts\python.exe"

if not exist "%VENV_PYTHON%" (
    echo [错误] 未找到虚拟环境，请先在 backend\ 下创建 .venv
    pause
    exit /b 1
)

cd /d "%~dp0backend"
echo [启动] 后端开发服务器 (uvicorn --reload)...
"%VENV_PYTHON%" -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

echo.
echo 后端已停止。
pause >nul
