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
REM Neben den Vorgabeports auch den, auf den der letzte Lauf
REM ausgewichen ist — er steht in data\port.txt.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ports = @(3000,35729);" ^
  "if (Test-Path 'data\port.txt') { $x = (Get-Content 'data\port.txt' -Raw).Trim(); if ($x -match '^^\d+$') { $ports += [int]$x } }" ^
  "$ids = Get-NetTCPConnection -LocalPort $ports -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique;" ^
  "if ($ids) { $ids | ForEach-Object { try { Stop-Process -Id $_ -Force -ErrorAction Stop; Write-Host ('  alten Server beendet (PID ' + $_ + ')') } catch {} } } else { Write-Host '  nichts zu tun' }"

echo.
echo Starte Server ...

REM --- Browser an der richtigen Adresse oeffnen -------------------------
REM Ist 3000 belegt, weicht der Server auf 3001 aus. Ein fest
REM verdrahtetes http://localhost:3000 zeigte dann auf das fremde
REM Programm, das den Port haelt. Der Server schreibt seinen Port
REM nach data\port.txt, sobald er hoert — darauf wird hier gewartet.
if exist "data\port.txt" del "data\port.txt" >nul 2>nul
start "" /min powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "for ($i = 0; $i -lt 75; $i++) {" ^
  "  if (Test-Path 'data\port.txt') {" ^
  "    $port = (Get-Content 'data\port.txt' -Raw).Trim();" ^
  "    if ($port -match '^^\d+$') { Start-Process ('http://localhost:' + $port); break }" ^
  "  }" ^
  "  Start-Sleep -Milliseconds 400" ^
  "}"

call npm run dev

REM --- Ab hier nur noch, wenn der Server beendet wurde -------------------
echo.
echo ============================================
echo   Server wurde beendet.
echo ============================================
echo Fenster bleibt offen, damit Fehlermeldungen lesbar sind.
echo.
pause
