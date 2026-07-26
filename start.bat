@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

:: Imya tunnelya i publichnyj adres API (menjaetsja tut, esli nuzhno)
set "TUNNEL_NAME=nmnh-api"
set "API_DOMAIN=api.nmnh.trade"

echo.
echo ================================================
echo   MENTOR - Avtozapusk + Cloudflare Tunnel
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
:: ALLOWED_ORIGINS objazatelen: bez javnogo spiska ispolzuetsja "*",
:: a takoe sochetanie s credentials brauzer otvergaet po specifikacii CORS.
findstr /b /c:"ALLOWED_ORIGINS=" ".env" >nul 2>&1
if %errorlevel% neq 0 (
    echo   Dobavljaju ALLOWED_ORIGINS v .env...
    echo.>> ".env"
    echo ALLOWED_ORIGINS=https://www.nmnh.trade,https://nmnh.trade>> ".env"
)
echo   .env - OK

:: ===== 4. CLOUDFLARED =====
echo [4/5] Cloudflare Tunnel...
set "CF=cloudflared"
where cloudflared >nul 2>&1
if %errorlevel% neq 0 (
    :: Lokalnaja kopija rjadom so skriptom (esli uzhe skachivali ranshe)
    if exist "%~dp0cloudflared.exe" (
        set "CF=%~dp0cloudflared.exe"
    ) else (
        echo   cloudflared ne najden. Ustanavlivayu...
        :: winget est ne vezde (Windows Server) - snachala probujem ego,
        :: potom prjamuju zagruzku exe s oficialnyh relizov.
        where winget >nul 2>&1
        if !errorlevel! equ 0 (
            winget install --id Cloudflare.cloudflared -e --silent --accept-package-agreements --accept-source-agreements
        )
        where cloudflared >nul 2>&1
        if !errorlevel! neq 0 (
            echo   Skachivaju cloudflared.exe naprjamuju...
            powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile '%~dp0cloudflared.exe'"
            if not exist "%~dp0cloudflared.exe" (
                echo   OSHIBKA: skachaj vruchnuyu:
                echo   https://github.com/cloudflare/cloudflared/releases/latest
                pause & exit /b 1
            )
            set "CF=%~dp0cloudflared.exe"
        )
    )
)
for /f "tokens=*" %%v in ('"!CF!" --version 2^>^&1') do echo   %%v

set "CF_DIR=%USERPROFILE%\.cloudflared"
set "CF_CFG=%CF_DIR%\config.yml"

:: ===== TUNNEL CONFIG (pervyj zapusk) =====
if not exist "%CF_CFG%" (
    echo.
    echo ================================================
    echo   Nastrojka tunnelya (pervyj zapusk)
    echo ================================================
    echo.
    echo   Sejchas otkroetsja brauzer - vyberi domen nmnh.trade
    echo.
    pause
    "!CF!" tunnel login
    if !errorlevel! neq 0 (
        echo   OSHIBKA: ne udalos vojti v Cloudflare.
        pause & exit /b 1
    )

    echo   Sozdayu tunnel !TUNNEL_NAME!...
    "!CF!" tunnel create !TUNNEL_NAME! >nul 2>&1

    echo   Privjazyvaju DNS !API_DOMAIN!...
    "!CF!" tunnel route dns !TUNNEL_NAME! !API_DOMAIN!

    :: Tunnel ID beryom iz spiska tunnelej
    set "TUNNEL_ID="
    for /f "tokens=1" %%i in ('"!CF!" tunnel list ^| findstr /c:"!TUNNEL_NAME!"') do set "TUNNEL_ID=%%i"
    if "!TUNNEL_ID!"=="" (
        echo   OSHIBKA: ne udalos poluchit Tunnel ID.
        echo   Vypolni vruchnuyu: cloudflared tunnel create !TUNNEL_NAME!
        pause & exit /b 1
    )

    (
        echo tunnel: !TUNNEL_ID!
        echo credentials-file: !CF_DIR!\!TUNNEL_ID!.json
        echo metrics: 127.0.0.1:20241
        echo ingress:
        echo   - hostname: !API_DOMAIN!
        echo     service: http://localhost:8000
        echo   - service: http_status:404
    ) > "%CF_CFG%"
    echo   Konfiguratsiya sohranena: %CF_CFG%
    echo.
)
echo   Tunnel - OK

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
echo   Tunnel:   https://!API_DOMAIN!
echo.
echo   Render - Environment Variables:
echo   NEXT_PUBLIC_API_URL = https://!API_DOMAIN!
echo.
echo   Proverka: https://!API_DOMAIN!/api/health
echo ================================================
echo.
echo   Eto okno - Cloudflare Tunnel. Ne zakryvaj ego!
echo.

"!CF!" tunnel run !TUNNEL_NAME!
