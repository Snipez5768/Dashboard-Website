# ==========================================================
#  LIFE OS // Browser oeffnen
#
#  Wird von dev-server.bat im Hintergrund gestartet. Die Aufgabe:
#  die Website zeigen, ohne bei jedem Serverstart einen weiteren
#  Reiter aufzumachen.
#
#  Der Weg dahin:
#    1. Warten, bis der Server seinen Port nach data\port.txt
#       geschrieben hat. Er kann ausgewichen sein.
#    2. Ihm einen Moment geben. Ein Reiter, der beim letzten Mal
#       offen geblieben ist, verbindet sich von selbst wieder —
#       seine offene Leitung zaehlt der Server mit.
#    3. Haengt schon ein Browser dran, wird nur dessen Fenster nach
#       vorn geholt. Haengt keiner dran, geht ein neuer Reiter auf.
#
#  Was Windows nicht kann: einen bestimmten Reiter innerhalb eines
#  Browserfensters auswaehlen. Liegt die Seite in dem Fenster vorne,
#  klappt das Nachvornholen; liegt sie hinter anderen Reitern,
#  bleibt es beim Fenster. Ein zweiter Reiter geht in keinem Fall
#  auf — genau das war das Aergernis.
# ==========================================================

$ordner   = Split-Path -Parent $MyInvocation.MyCommand.Path
$portDatei = Join-Path $ordner "data\port.txt"

# ---------- 1. Auf den Port warten ----------
$port = $null
for ($i = 0; $i -lt 75; $i++) {
  if (Test-Path $portDatei) {
    $roh = (Get-Content $portDatei -Raw).Trim()
    if ($roh -match '^\d+$') { $port = $roh; break }
  }
  Start-Sleep -Milliseconds 400
}
if (-not $port) { exit }

$adresse = "http://localhost:$port"

# ---------- 2. Dem offenen Reiter Zeit zum Wiederkommen geben ----------
# EventSource versucht es nach einem Abriss alle 3 Sekunden erneut.
# Zwei Runden davon reichen; laenger zu warten hiesse, bei jedem
# Start unnoetig vor einem leeren Bildschirm zu sitzen.
$klienten = 0
for ($i = 0; $i -lt 9; $i++) {
  Start-Sleep -Milliseconds 800
  try {
    $stand = Invoke-RestMethod -Uri "$adresse/api/health" -TimeoutSec 3
    if ($stand.klienten -gt 0) { $klienten = $stand.klienten; break }
  } catch { }
}

# ---------- 3. Zeigen ----------
if ($klienten -gt 0) {
  # Die Seite ist schon offen. Fenster nach vorn holen, wenn sie
  # darin gerade vorne liegt — der Fenstertitel verraet das.
  $fenster = Get-Process |
    Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle -match 'LIFE OS' } |
    Select-Object -First 1
  if ($fenster) {
    try {
      $schale = New-Object -ComObject WScript.Shell
      $null = $schale.AppActivate($fenster.Id)
    } catch { }
  }
  exit
}

Start-Process $adresse
