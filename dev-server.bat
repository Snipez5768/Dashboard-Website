@echo off
setlocal
cd /d "%~dp0"
title LIFE OS Dashboard - Dev-Server

echo ============================================
echo   LIFE OS Dashboard - Dev-Server
echo ============================================

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [FEHLER] Node.js wurde nicht gefunden.
  echo Bitte installiere Node.js von https://nodejs.org und starte diese Datei erneut.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo.
  echo Erststart: installiere Abhaengigkeiten ^(einmalig, kann etwas dauern^) ...
  call npm install
  if errorlevel 1 (
    echo.
    echo [FEHLER] npm install ist fehlgeschlagen. Siehe Meldungen oben.
    pause
    exit /b 1
  )
)

REM --- Alte Server aufraeumen -------------------------------------------
REM Unter Windows ueberleben abgebrochene Server gerne mal und halten die
REM Ports weiter besetzt. Das laesst den naechsten Start sofort abstuerzen.
REM Ueber PowerShell statt netstat, weil die Ausgabe sonst sprachabhaengig ist.
echo.
echo Pruefe auf alte Server-Prozesse ...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ids = Get-NetTCPConnection -LocalPort 3000,35729 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique;" ^
  "if ($ids) { $ids | ForEach-Object { try { Stop-Process -Id $_ -Force -ErrorAction Stop; Write-Host ('  alten Server beendet (PID ' + $_ + ')') } catch {} } } else { Write-Host '  nichts zu tun' }"

echo.
echo Starte Server auf http://localhost:3000 ...
start "" http://localhost:3000

call npm run dev

REM --- Ab hier nur noch, wenn der Server beendet wurde -------------------
echo.
echo ============================================
echo   Server wurde beendet.
echo ============================================
echo Fenster bleibt offen, damit Fehlermeldungen lesbar sind.
echo.
pause
