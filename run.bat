@echo off
setlocal
cd /d "%~dp0"

:: Zapusk odnogo okna servera - chtoby ne perezapuskat vse srazu.
::
:: start.bat podnimaet vse okna srazu, i posle git pull eto znachilo by
:: oborvat i stakan, i soprovozhdenie, i sajt. Zdes odno okno:
::
::   run.bat api       - sajt i ruchki terminala (port 8000)
::   run.bat watcher   - soprovozhdenie sdelok (port 8001)
::   run.bat market    - rynochnye dannye: potoki birzh i stakan (port 8002)
::   run.bat bot       - telegram-bot
::
:: Poryadok: Ctrl+C v nuzhnom okne, zatem run.bat s ego rolyu v tom zhe okne.
:: Tunnel (okno start.bat) i ostalnye okna prodolzhayut rabotat.

set "ROLE=%~1"
if "%ROLE%"=="" goto USAGE

if /i "%ROLE%"=="api"     set "PORT=8000"
if /i "%ROLE%"=="watcher" set "PORT=8001"
if /i "%ROLE%"=="market"  set "PORT=8002"

if /i "%ROLE%"=="bot" (
    echo [bot] Telegram-bot
    call venv\Scripts\activate.bat
    python -m bot.main
    goto :eof
)

if not defined PORT goto USAGE

echo [%ROLE%] http://127.0.0.1:%PORT%
call venv\Scripts\activate.bat
set "NMNH_ROLE=%ROLE%"
uvicorn backend.main:app --host 127.0.0.1 --port %PORT%
goto :eof

:USAGE
echo.
echo   Zapusk odnogo okna servera:
echo.
echo     run.bat api       - sajt i ruchki terminala (8000)
echo     run.bat watcher   - soprovozhdenie sdelok (8001)
echo     run.bat market    - rynochnye dannye i stakan (8002)
echo     run.bat bot       - telegram-bot
echo.
echo   Snachala Ctrl+C v tom okne, kotoroe perezapuskaesh.
echo   Okno tunnelya (start.bat) zakryvat ne nado - ono derzhit svyaz s saitom.
echo.
exit /b 1
