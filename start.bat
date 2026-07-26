@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "TUNNEL_NAME=nmnh-api"
set "API_DOMAIN=api.nmnh.trade"
set "CF_DIR=%USERPROFILE%\.cloudflared"
set "LOCAL_CFG=%~dp0cloudflared-config.yml"

echo.
echo ================================================
echo   MENTOR - Avtozapusk (backend + bot + tunnel)
echo ================================================
echo.

:: ============ 1. PYTHON ============
echo [1/5] Python...
where python >nul 2>&1
if errorlevel 1 goto NO_PYTHON
for /f "tokens=*" %%v in ('python --version 2^>^&1') do echo   %%v - OK
goto VENV

:NO_PYTHON
echo   OSHIBKA: Python ne najden. Ustanovi: https://www.python.org/downloads
pause & exit /b 1

:: ============ 2. VENV ============
:VENV
echo [2/5] Virtual environment...
if not exist "venv\Scripts\activate.bat" python -m venv venv
call venv\Scripts\activate.bat
python -m pip install -q -r requirements.txt
echo   Zavisimosti - OK

:: ============ 3. .ENV ============
echo [3/5] .env...
if not exist ".env" copy ".env.example" ".env" >nul
findstr /b /c:"ALLOWED_ORIGINS=" ".env" >nul 2>&1
if errorlevel 1 (
    echo.>> ".env"
    echo ALLOWED_ORIGINS=https://www.nmnh.trade,https://nmnh.trade>> ".env"
)
echo   .env - OK

:: ============ 4. CLOUDFLARED ============
echo [4/5] Cloudflare Tunnel...

:: 4.1 Gde binarnik
set "CF="
if exist "%~dp0cloudflared.exe" set "CF=%~dp0cloudflared.exe"
if not defined CF (
    where cloudflared >nul 2>&1
    if not errorlevel 1 set "CF=cloudflared"
)
if not defined CF call :DOWNLOAD_CF
if not defined CF goto CF_FAIL
for /f "tokens=*" %%v in ('"!CF!" --version 2^>^&1') do echo   %%v

:: 4.2 Gde config: lokalnyj -^> polzovatelskij -^> sozdaem
set "CFG="
if exist "%LOCAL_CFG%"        set "CFG=%LOCAL_CFG%"
if not defined CFG if exist "%CF_DIR%\config.yml" set "CFG=%CF_DIR%\config.yml"
if not defined CFG call :MAKE_CFG
if not defined CFG goto CFG_FAIL
echo   Config: !CFG!

:: ============ 5. ZAPUSK ============
echo [5/5] Zapusk komponentov...

start "MENTOR Backend" cmd /k "cd /d "%~dp0" && call venv\Scripts\activate.bat && uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload"
start "MENTOR Bot"     cmd /k "cd /d "%~dp0" && call venv\Scripts\activate.bat && python -m bot.main"

timeout /t 3 /nobreak >nul

echo.
echo ================================================
echo   VSE ZAPUSHENO
echo ================================================
echo   Backend:  http://localhost:8000
echo   API:      https://!API_DOMAIN!
echo   Proverka: https://!API_DOMAIN!/api/health
echo.
echo   Render - Environment Variables:
echo   NEXT_PUBLIC_API_URL = https://!API_DOMAIN!
echo ================================================
echo.
echo   Eto okno - tunnel. Ne zakryvaj ego!
echo.

"!CF!" tunnel --config "!CFG!" run !TUNNEL_NAME!
goto :eof

:: ============ PODPROGRAMMY ============

:DOWNLOAD_CF
echo   cloudflared ne najden - skachivaju...
powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile '%~dp0cloudflared.exe'" >nul 2>&1
if exist "%~dp0cloudflared.exe" set "CF=%~dp0cloudflared.exe"
goto :eof

:MAKE_CFG
echo   Config ne najden - sobirayu...
:: Tunnel ID iz spiska tunnelej
set "TID="
for /f "tokens=1" %%i in ('"!CF!" tunnel list 2^>nul ^| findstr /c:"!TUNNEL_NAME!"') do set "TID=%%i"
:: Net tunnelya - probuem sozdat (rabotaet, esli est cert.pem)
if not defined TID (
    "!CF!" tunnel create !TUNNEL_NAME! >nul 2>&1
    for /f "tokens=1" %%i in ('"!CF!" tunnel list 2^>nul ^| findstr /c:"!TUNNEL_NAME!"') do set "TID=%%i"
)
if not defined TID goto :eof
:: Fajl s uchetnymi dannymi tunnelya
set "CRED=%CF_DIR%\!TID!.json"
if not exist "!CRED!" goto :eof
:: Pishem config rjadom so skriptom - ne zavisim ot puti profilja
(
    echo tunnel: !TID!
    echo credentials-file: !CRED!
    echo ingress:
    echo   - hostname: !API_DOMAIN!
    echo     service: http://127.0.0.1:8000
    echo   - service: http_status:404
) > "%LOCAL_CFG%"
"!CF!" tunnel route dns !TUNNEL_NAME! !API_DOMAIN! >nul 2>&1
set "CFG=%LOCAL_CFG%"
goto :eof

:CF_FAIL
echo.
echo   OSHIBKA: ne udalos poluchit cloudflared.exe
echo   Skachaj vruchnuyu v papku proekta:
echo   https://github.com/cloudflare/cloudflared/releases/latest
echo.
pause & exit /b 1

:CFG_FAIL
echo.
echo   OSHIBKA: tunnel ne nastroen. Vypolni ODIN raz:
echo.
echo     cloudflared.exe tunnel login
echo     cloudflared.exe tunnel create !TUNNEL_NAME!
echo.
echo   Zatem zapusti start.bat snova - konfig soberetsja sam.
echo.
pause & exit /b 1
