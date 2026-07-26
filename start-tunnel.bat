@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo ================================================
echo   NMNH - Cloudflare Tunnel (api.nmnh.trade)
echo ================================================
echo.

:: ===== 1. CLOUDFLARED =====
set "CF=cloudflared"
where cloudflared >nul 2>&1
if %errorlevel% neq 0 (
    if exist "%~dp0cloudflared.exe" (
        set "CF=%~dp0cloudflared.exe"
    ) else (
        echo   cloudflared ne najden. Skachivaju...
        powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile '%~dp0cloudflared.exe'"
        if not exist "%~dp0cloudflared.exe" (
            echo   OSHIBKA: skachaj vruchnuyu:
            echo   https://github.com/cloudflare/cloudflared/releases/latest
            pause & exit /b 1
        )
        set "CF=%~dp0cloudflared.exe"
    )
)
for /f "tokens=*" %%v in ('"!CF!" --version 2^>^&1') do echo   %%v

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
"!CF!" tunnel run nmnh-api
