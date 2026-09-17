@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

:: Perezapusk okon servera odnoj komandoj: staroe okno gasitsya, novoe
:: otkryvaetsya.
::
::   restart.bat api market   - sajt i rynochnye dannye
::   restart.bat all          - vse chetyre okna
::
:: Otlichie ot up.bat: tot tolko podnimaet i zanyatyj port propuskaet, a etot
:: snachala zakryvaet okno, kotoroe derzhit port.
::
:: Okno tunnelya (start.bat) ne trogaem: ono derzhit svyaz s saitom, i ego
:: perezapusk rvet vse, vklyuchaya otkrytye terminaly.

if "%~1"=="" goto USAGE
if /i "%~1"=="all" (
    call :ONE api
    call :ONE watcher
    call :ONE market
    goto DONE
)

:LOOP
if "%~1"=="" goto DONE
call :ONE %~1
shift
goto LOOP

:DONE
echo.
echo   Gotovo. Posmotri v novyh oknah, chto net oshibok.
echo.
goto :eof

:ONE
set "ROLE=%~1"
set "PORT="
set "NAME="
if /i "%ROLE%"=="api"     ( set "PORT=8000" & set "NAME=API" )
if /i "%ROLE%"=="watcher" ( set "PORT=8001" & set "NAME=Watcher" )
if /i "%ROLE%"=="market"  ( set "PORT=8002" & set "NAME=Market" )
if not defined NAME (
    echo   Ne znayu rol "%ROLE%" - propuskayu.
    goto :eof
)
if /i "%ROLE%"=="watcher" (
    echo   Vnimanie: soprovozhdenie ostanovitsya na neskolko sekund.
    echo   Zashchita pozicij stoit na birzhe i nikuda ne denetsya.
)
echo   Gashu staroe okno MENTOR !NAME! (port !PORT!)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\stop_port.ps1" -Port !PORT!
echo   Zapuskayu MENTOR !NAME!
start "MENTOR !NAME!" cmd /k ""%~dp0run.bat" !ROLE!"
goto :eof

:USAGE
echo.
echo   Perezapustit okna servera:
echo.
echo     restart.bat api market   - sajt i rynochnye dannye
echo     restart.bat api          - tolko sajt
echo     restart.bat all          - api, watcher i market
echo.
echo   Staroe okno zakryvaetsya samo. Okno tunnelya (start.bat) ne trogaetsya.
echo.
exit /b 1
