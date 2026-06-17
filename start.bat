@echo off
setlocal enabledelayedexpansion
chcp 65001 > nul
cd /d "%~dp0"

echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║   MENTOR — Автозапуск + ngrok туннель       ║
echo  ╚══════════════════════════════════════════════╝
echo.

:: ═══════════════════════════════════════
:: 1. PYTHON
:: ═══════════════════════════════════════
echo  [1/5] Проверка Python...
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo        Python не найден. Устанавливаю через winget...
    winget install Python.Python.3.11 -e --silent --accept-package-agreements --accept-source-agreements
    if !errorlevel! neq 0 (
        echo.
        echo  [ОШИБКА] Не удалось установить Python автоматически.
        echo  Скачай вручную: https://www.python.org/downloads
        echo  После установки запусти start.bat снова.
        pause & exit /b 1
    )
    echo        Python установлен. Перезапусти скрипт.
    pause & exit /b 0
)
for /f "tokens=*" %%v in ('python --version 2^>^&1') do echo        %%v -- OK

:: ═══════════════════════════════════════
:: 2. VENV + ЗАВИСИМОСТИ
:: ═══════════════════════════════════════
echo  [2/5] Проверка виртуального окружения...
if not exist "venv\Scripts\activate.bat" (
    echo        Создаю venv...
    python -m venv venv
)
call venv\Scripts\activate.bat

echo        Проверка зависимостей...
python -m pip install -q -r requirements.txt
echo        Зависимости -- OK

:: ═══════════════════════════════════════
:: 3. .ENV
:: ═══════════════════════════════════════
echo  [3/5] Проверка .env...
if not exist ".env" (
    echo        .env не найден -- создаю из шаблона...
    copy ".env.example" ".env" > nul
    echo.
    echo  Заполни .env перед запуском:
    echo  BOT_TOKEN, DATABASE_URL, JWT_SECRET
    echo.
    start notepad ".env"
    echo  Нажми любую клавишу после заполнения .env...
    pause > nul
)
echo        .env -- OK

:: ═══════════════════════════════════════
:: 4. NGROK
:: ═══════════════════════════════════════
echo  [4/5] Проверка ngrok...
where ngrok >nul 2>&1
if %errorlevel% neq 0 (
    echo        ngrok не найден. Устанавливаю через winget...
    winget install Ngrok.Ngrok -e --silent --accept-package-agreements --accept-source-agreements
    if !errorlevel! neq 0 (
        echo        winget не сработал -- скачиваю напрямую...
        powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip' -OutFile 'ngrok.zip'; Expand-Archive -Path 'ngrok.zip' -DestinationPath '%~dp0' -Force; Remove-Item 'ngrok.zip'"
        if not exist "ngrok.exe" (
            echo  [ОШИБКА] ngrok не удалось установить. Скачай вручную: https://ngrok.com/download
            pause & exit /b 1
        )
        set "PATH=%~dp0;%PATH%"
    )
)
echo        ngrok -- OK

:: ═══════════════════════════════════════
:: Конфиг туннеля (tunnel.config)
:: ═══════════════════════════════════════
if not exist "tunnel.config" (
    echo.
    echo  ╔══════════════════════════════════════════════╗
    echo  ║   Первый запуск -- настройка ngrok туннеля  ║
    echo  ╠══════════════════════════════════════════════╣
    echo  ║                                              ║
    echo  ║  1. Зарегистрируйся на ngrok.com            ║
    echo  ║  2. Authtoken: dashboard.ngrok.com/authtokens║
    echo  ║  3. Статичный домен:                        ║
    echo  ║     dashboard.ngrok.com/domains             ║
    echo  ║     (бесплатно: 1 домен на аккаунт)        ║
    echo  ╚══════════════════════════════════════════════╝
    echo.
    set /p "NGROK_TOKEN=  Вставь Authtoken ngrok: "
    set /p "NGROK_DOMAIN=  Вставь статичный домен (abc.ngrok-free.app): "
    (
        echo NGROK_AUTHTOKEN=!NGROK_TOKEN!
        echo NGROK_DOMAIN=!NGROK_DOMAIN!
    ) > tunnel.config
    echo.
    echo  Конфиг сохранён в tunnel.config
    echo  Чтобы изменить -- удали tunnel.config и запусти снова.
    echo.
)

:: Читаем tunnel.config
for /f "usebackq tokens=1,* delims==" %%a in ("tunnel.config") do (
    if "%%a"=="NGROK_AUTHTOKEN" set "NGROK_TOKEN=%%b"
    if "%%a"=="NGROK_DOMAIN"    set "NGROK_DOMAIN=%%b"
)

if "!NGROK_TOKEN!"=="" (
    echo  [ОШИБКА] NGROK_AUTHTOKEN не задан в tunnel.config. Удали файл и запусти снова.
    pause & exit /b 1
)
if "!NGROK_DOMAIN!"=="" (
    echo  [ОШИБКА] NGROK_DOMAIN не задан в tunnel.config. Удали файл и запусти снова.
    pause & exit /b 1
)

ngrok config add-authtoken !NGROK_TOKEN! > nul 2>&1

:: ═══════════════════════════════════════
:: 5. ЗАПУСК ВСЕХ КОМПОНЕНТОВ
:: ═══════════════════════════════════════
echo  [5/5] Запускаю компоненты...

start "MENTOR -- Backend" cmd /k "cd /d "%~dp0" && call venv\Scripts\activate.bat && uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload"
start "MENTOR -- Bot"     cmd /k "cd /d "%~dp0" && call venv\Scripts\activate.bat && python -m bot.main"

timeout /t 3 /nobreak > nul

echo.
echo  ╔════════════════════════════════════════════════════════╗
echo  ║                    ВСЁ ЗАПУЩЕНО                       ║
echo  ╠════════════════════════════════════════════════════════╣
echo  ║  Бэкенд:  http://localhost:8000                       ║
echo  ║  Туннель: https://!NGROK_DOMAIN!
echo  ╠════════════════════════════════════════════════════════╣
echo  ║  Скопируй в Render - Environment Variables:           ║
echo  ║  NEXT_PUBLIC_API_URL = https://!NGROK_DOMAIN!
echo  ╚════════════════════════════════════════════════════════╝
echo.
echo  Это окно -- ngrok туннель. Не закрывай его!
echo.

ngrok http --domain=!NGROK_DOMAIN! 8000
