@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo ================================================
echo   NMNH - Cloudflare Tunnel (api.nmnh.trade)
echo ================================================
echo.

:: ===== 1. CLOUDFLARED =====
where cloudflared >nul 2>&1
if %errorlevel% neq 0 (
    echo   cloudflared ne najden. Ustanavlivayu...
    winget install --id Cloudflare.cloudflared -e --silent --accept-package-agreements --accept-source-agreements
    if !errorlevel! neq 0 (
        echo   OSHIBKA: ustanovi vruchnuyu:
        echo   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
        pause & exit /b 1
    )
    echo   Ustanovlen. Perezapusti start-tunnel.bat
    pause & exit /b 0
)
for /f "tokens=*" %%v in ('cloudflared --version 2^>^&1') do echo   %%v

:: ===== 2. KONFIG =====
set "CFG=%USERPROFILE%\.cloudflared\config.yml"
if not exist "%CFG%" (
    echo.
    echo   Net fajla %CFG%
    echo.
    echo   Pervyj zapusk - vypolni po poryadku:
    echo     cloudflared tunnel login
    echo     cloudflared tunnel create nmnh-api
    echo     cloudflared tunnel route dns nmnh-api api.nmnh.trade
    echo.
    echo   Zatem skopiruj deploy\cloudflared\config.example.yml v
    echo   %CFG% i podstav' svoj TUNNEL-ID.
    echo.
    echo   Podrobno: docs\deploy\cloudflare-tunnel.md
    pause & exit /b 1
)

:: ===== 3. ZAPUSK =====
echo.
echo   Tunnel: api.nmnh.trade -^> http://localhost:8000
echo   Ostanovka: Ctrl+C
echo.
cloudflared tunnel run nmnh-api
