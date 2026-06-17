@echo off
title NMNH Launcher

set ROOT=%~dp0

echo ============================================
echo   NMNH - zapusk vsekh servisov
echo ============================================
echo.

echo [1/3] Bot...
start "NMNH Bot" cmd /k "cd /d "%ROOT%" && call venv\Scripts\activate && python -m bot.main"

echo [2/3] Backend (port 8000)...
start "NMNH Backend" cmd /k "cd /d "%ROOT%" && call venv\Scripts\activate && uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload"

echo [3/3] Webapp (port 3001)...
start "NMNH Webapp" cmd /k "cd /d "%ROOT%webapp" && npm run dev -- --port 3001"

echo.
echo Bot     - Telegram
echo Backend - http://localhost:8000
echo Webapp  - http://localhost:3001
echo.
pause
