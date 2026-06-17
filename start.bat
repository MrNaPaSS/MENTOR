@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo ================================================
echo   MENTOR - Avtozapusk + ngrok tunnel
echo ================================================
echo.

:: ===== 1. PYTHON =====
echo [1/5] Python...
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo   Python ne najden. Ustanavlivayu...
    winget install Python.Python.3.11 -e --silent --accept-package-agreements --accept-source-agreements
    if !errorlevel! neq 0 (
        echo   OSHIBKA: Skachaj Python vruchnuyu: https://www.python.org/downloads
        pause & exit /b 1
    )
    echo   Python ustanovlen. Perezapusti start.bat
    pause & exit /b 0
)
for /f "tokens=*" %%v in ('python --version 2^>^&1') do echo   %%v - OK

:: ===== 2. VENV + ZAVISIMOSTI =====
echo [2/5] Virtual environment...
if not exist "venv\Scripts\activate.bat" (
    echo   Sozdayu venv...
    python -m venv venv
)
call venv\Scripts\activate.bat
echo   Ustanavlivayu zavisimosti...
python -m pip install -q -r requirements.txt
echo   Zavisimosti - OK

:: ===== 3. .ENV =====
echo [3/5] .env...
if not exist ".env" (
    echo   .env ne najden - kopiruju iz .env.example
    copy ".env.example" ".env" > nul
    echo.
    echo   Otkroetsya Notepad - zapolni BOT_TOKEN, DATABASE_URL, JWT_SECRET
    echo   Posle sohraneniya zakroj Notepad i nazmi ljubuyu klavishu...
    echo.
    start /wait notepad ".env"
)
echo   .env - OK

:: ===== 4. NGROK =====
echo [4/5] ngrok...
where ngrok >nul 2>&1
if %errorlevel% neq 0 (
    echo   ngrok ne najden. Ustanavlivayu...
    winget install Ngrok.Ngrok -e --silent --accept-package-agreements --accept-source-agreements
    if !errorlevel! neq 0 (
        echo   Skachivaju ngrok naprjamuju...
        powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip' -OutFile 'ngrok.zip'; Expand-Archive -Path 'ngrok.zip' -DestinationPath '%~dp0' -Force; Remove-Item 'ngrok.zip'"
        if not exist "ngrok.exe" (
            echo   OSHIBKA: skachaj ngrok vruchnuyu: https://ngrok.com/download
            pause & exit /b 1
        )
        set "PATH=%~dp0;%PATH%"
    )
)
echo   ngrok - OK

:: ===== TUNNEL CONFIG =====
if not exist "tunnel.config" (
    echo.
    echo ================================================
    echo   Nastrojka ngrok tunnelya (pervyj zapusk)
    echo ================================================
    echo.
    echo   1. Zaregistrijsja na ngrok.com
    echo   2. Authtoken: dashboard.ngrok.com/authtokens
    echo   3. Statichnyi domen: dashboard.ngrok.com/domains
    echo      (besplatno: 1 domen na akkaunt)
    echo.
    set /p "NGROK_TOKEN=  Vstav' Authtoken: "
    set /p "NGROK_DOMAIN=  Vstav' statichnyi domen (abc.ngrok-free.app): "
    (
        echo NGROK_AUTHTOKEN=!NGROK_TOKEN!
        echo NGROK_DOMAIN=!NGROK_DOMAIN!
    ) > tunnel.config
    echo   Konfiguratsiya sohranena v tunnel.config
    echo.
)

for /f "usebackq tokens=1,* delims==" %%a in ("tunnel.config") do (
    if "%%a"=="NGROK_AUTHTOKEN" set "NGROK_TOKEN=%%b"
    if "%%a"=="NGROK_DOMAIN"    set "NGROK_DOMAIN=%%b"
)

if "!NGROK_TOKEN!"=="" (
    echo   OSHIBKA: NGROK_AUTHTOKEN pust v tunnel.config. Udali fajl i zapusti snova.
    pause & exit /b 1
)
if "!NGROK_DOMAIN!"=="" (
    echo   OSHIBKA: NGROK_DOMAIN pust v tunnel.config. Udali fajl i zapusti snova.
    pause & exit /b 1
)

ngrok config add-authtoken !NGROK_TOKEN! > nul 2>&1

:: ===== 5. ZAPUSK =====
echo [5/5] Zapusk komponentov...

start "MENTOR Backend" cmd /k "cd /d "%~dp0" && call venv\Scripts\activate.bat && uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload"
start "MENTOR Bot"     cmd /k "cd /d "%~dp0" && call venv\Scripts\activate.bat && python -m bot.main"

timeout /t 3 /nobreak > nul

echo.
echo ================================================
echo   VSE ZAPUSHENO
echo ================================================
echo   Backend:  http://localhost:8000
echo   Tunnel:   https://!NGROK_DOMAIN!
echo.
echo   Render - Environment Variables:
echo   NEXT_PUBLIC_API_URL = https://!NGROK_DOMAIN!
echo ================================================
echo.
echo   Eto okno - ngrok tunnel. Ne zakryvaj ego!
echo.

ngrok http --domain=!NGROK_DOMAIN! 8000
