@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

:: Otkryt okna servera po spisku - ne trogaya ostalnye.
::
::   up.bat api market     - dva okna
::   up.bat api            - odno
::   up.bat all            - vse chetyre (api, watcher, market, bot)
::
:: Okna zakryvaet chelovek: skript tolko podnimaet. Zanyatyj port znachit,
:: chto okno eshche rabotaet - takoe propuskaem, vtoroe takoe zhe ne nuzhno.
:: Okno tunnelya (start.bat) zhivet svoej zhiznyu i zdes ne uchastvuet.

if "%~1"=="" goto USAGE
if /i "%~1"=="all" (
    call :ONE api
    call :ONE watcher
    call :ONE market
    call :ONE bot
    goto DONE
)

:LOOP
if "%~1"=="" goto DONE
call :ONE %~1
shift
goto LOOP

:DONE
echo.
echo   Gotovo. Okna otkryvayutsya otdelno - posmotri, chto v nih net oshibok.
echo.
goto :eof

:ONE
set "ROLE=%~1"
set "PORT="
set "NAME="
if /i "%ROLE%"=="api"     ( set "PORT=8000" & set "NAME=API" )
if /i "%ROLE%"=="watcher" ( set "PORT=8001" & set "NAME=Watcher" )
if /i "%ROLE%"=="market"  ( set "PORT=8002" & set "NAME=Market" )
if /i "%ROLE%"=="bot"     ( set "NAME=Bot" )
if not defined NAME (
    echo   Ne znayu rol "%ROLE%" - propuskayu.
    goto :eof
)
if defined PORT (
    netstat -ano -p tcp | findstr /c:"127.0.0.1:!PORT!" | findstr /c:"LISTENING" >nul
    if not errorlevel 1 (
        echo   Port !PORT! zanyat: okno MENTOR !NAME! eshche rabotaet, propuskayu.
        goto :eof
    )
)
echo   Zapuskayu MENTOR !NAME!
start "MENTOR !NAME!" cmd /k ""%~dp0run.bat" !ROLE!"
goto :eof

:USAGE
echo.
echo   Otkryt okna servera:
echo.
echo     up.bat api market   - sajt i rynochnye dannye
echo     up.bat api          - tolko sajt
echo     up.bat watcher      - tolko soprovozhdenie
echo     up.bat all          - vse chetyre okna
echo.
echo   Snachala zakroj te okna, kotorye perezapuskaesh: zanyatyj port
echo   skript propustit i skazhet ob etom.
echo.
exit /b 1
