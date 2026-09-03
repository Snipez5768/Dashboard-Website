# ==========================================================
#  LIFE OS // Bildschirmzeit-Messfuehler (Windows)
#  Meldet im Takt, welches Programm im Vordergrund liegt, wie lange
#  keine Eingabe mehr kam und - bei einem Browser - welche Adresse
#  in der Adressleiste steht. Eine Zeile je Messung:
#      prozessname|fenstertitel|adresse|leerlaufsekunden
#  Laeuft dauerhaft, damit die Windows-Aufrufe nur einmal
#  uebersetzt werden muessen.
# ==========================================================

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class LifeOsWin {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [StructLayout(LayoutKind.Sequential)]
    public struct LASTINPUTINFO {
        public uint cbSize;
        public uint dwTime;
    }

    [DllImport("user32.dll")]
    public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

    public static IntPtr FensterVorn() {
        return GetForegroundWindow();
    }

    public static int ProcessIdImVordergrund() {
        IntPtr h = GetForegroundWindow();
        if (h == IntPtr.Zero) return 0;
        int pid;
        GetWindowThreadProcessId(h, out pid);
        return pid;
    }

    public static string TitelImVordergrund() {
        IntPtr h = GetForegroundWindow();
        if (h == IntPtr.Zero) return "";
        StringBuilder sb = new StringBuilder(512);
        GetWindowText(h, sb, sb.Capacity);
        return sb.ToString();
    }

    // Sekunden seit der letzten Maus- oder Tastatureingabe
    public static int LeerlaufSekunden() {
        LASTINPUTINFO l = new LASTINPUTINFO();
        l.cbSize = (uint)Marshal.SizeOf(l);
        if (!GetLastInputInfo(ref l)) return 0;
        // Die Differenz laeuft bewusst ueber - beide Werte sind
        // dieselbe Tickzahl, der Ueberlauf hebt sich damit auf.
        unchecked {
            int diff = Environment.TickCount - (int)l.dwTime;
            return diff < 0 ? 0 : diff / 1000;
        }
    }
}
'@

# Die Adressleiste liegt in der Bedienungshilfen-Schnittstelle.
# Faellt das Laden aus, laeuft die Messung ohne Adresse weiter.
$uiaDa = $true
try {
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
} catch {
    $uiaDa = $false
}

$browser = @("chrome", "msedge", "firefox", "brave", "opera", "operagx",
             "vivaldi", "arc", "chromium")

function Adresse-Lesen($handle) {
    if (-not $uiaDa -or $handle -eq [IntPtr]::Zero) { return "" }
    try {
        $el = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
        if (-not $el) { return "" }
        $cond = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Edit)
        $feld = $el.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
        if (-not $feld) { return "" }
        return $feld.GetCurrentPattern(
            [System.Windows.Automation.ValuePattern]::Pattern).Current.Value
    } catch {
        return ""
    }
}

# Der Takt kommt als erstes Argument. 0 bedeutet: eine einzige
# Messung ausgeben und beenden. Genau so ruft der Server auf - ein
# dauerhaft laufender Prozess haengt sonst am Server und blockiert
# dessen Neustart.
$takt = 0
if ($args.Count -ge 1) {
    $wert = 0
    if ([int]::TryParse($args[0], [ref]$wert) -and $wert -ge 0) { $takt = $wert }
}

while ($true) {
    $name = ""
    $titel = ""
    $adresse = ""
    try {
        $handle = [LifeOsWin]::FensterVorn()
        $prozessId = [LifeOsWin]::ProcessIdImVordergrund()
        if ($prozessId -gt 0) {
            $p = Get-Process -Id $prozessId -ErrorAction SilentlyContinue
            if ($p) { $name = $p.ProcessName }
        }
        $titel = [LifeOsWin]::TitelImVordergrund()

        # Nur bei Browsern nachschauen - bei anderen Fenstern waere die
        # Suche durch den Baum verschwendete Zeit.
        if ($browser -contains $name.ToLower()) {
            $adresse = Adresse-Lesen $handle
        }
    } catch {
        $name = ""
    }

    $leerlauf = 0
    try { $leerlauf = [LifeOsWin]::LeerlaufSekunden() } catch { $leerlauf = 0 }

    # Senkrechte Striche wuerden das Format zerlegen
    $titel = $titel -replace '\|', '/'
    $adresse = $adresse -replace '\|', '/'

    Write-Output ("{0}|{1}|{2}|{3}" -f $name, $titel, $adresse, $leerlauf)

    if ($takt -le 0) { break }
    Start-Sleep -Seconds $takt
}
