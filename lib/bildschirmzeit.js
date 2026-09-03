const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const TAKT = 15;          // Sekunden zwischen zwei Messungen
const LEERLAUF_AB = 90;   // ab so vielen Sekunden ohne Eingabe zählt nichts
const TAGE_BEHALTEN = 60;

/* Zum Testen umlenkbar, damit Probelaeufe die echten Daten nicht anfassen */
const DATEI = process.env.LIFEOS_DATEN
  || path.join(__dirname, "..", "data", "bildschirmzeit.json");
const SKRIPT = path.join(__dirname, "win-aktiv.ps1");

/* Je Tag:
     aktiv   { chrome: 1830 }          Sekunden je Programm
     inaktiv { chrome: 600 }           Zeit ohne Eingabe
     seiten  { chrome: { "Titel": { s: 900, d: "youtube.com" } } }
   Die Seiten haengen am Browser, in dem sie offen waren — sonst
   liessen sich zwei Browser nicht auseinanderhalten. */
let verlauf = {};

/* Das iPhone gibt seine Bildschirmzeit nicht heraus — Apple bietet
   dafür keine Schnittstelle. Sie wird darum vom Telefon aus
   hergeschickt und hier abgelegt, in Minuten:
   { "2026-08-26": { gesamt: 245, apps: { "TikTok": 90 } } } */
let handy = {};

/* Welche App auf dem Telefon gerade offen ist. Kurzbefehle melden
   das Öffnen; das Ende ergibt sich, sobald die nächste App aufgeht. */
let handyOffen = null;      // { app, seit }

/* Ohne Gegenmeldung wird eine Sitzung nach dieser Zeit gekappt —
   meist ist das Telefon dann nur gesperrt worden. */
const HANDY_MAX_SITZUNG = 120;   // Minuten
let laeuft = false;
let letzterFehler = null;
let letzteMessung = null;
let sichernTimer = null;
let taktgeber = null;       // Intervall der Messungen
let laeuftGerade = false;   // ein Aufruf ist noch unterwegs

/* ---------- Anzeigenamen ----------
   Prozessnamen sind kryptisch; die häufigsten bekommen einen
   lesbaren Namen. Alles andere behält seinen Prozessnamen. */
const NAMEN = {
  chrome: "Google Chrome",
  msedge: "Microsoft Edge",
  firefox: "Firefox",
  brave: "Brave",
  opera: "Opera",
  code: "VS Code",
  "code - insiders": "VS Code Insiders",
  devenv: "Visual Studio",
  explorer: "Explorer",
  windowsterminal: "Terminal",
  powershell: "PowerShell",
  pwsh: "PowerShell",
  cmd: "Eingabeaufforderung",
  discord: "Discord",
  "whatsapp.root": "WhatsApp",
  whatsapp: "WhatsApp",
  claude: "Claude",
  mspaint: "Paint",
  photos: "Fotos",
  letsview: "LetsView",
  spotify: "Spotify",
  steam: "Steam",
  winword: "Word",
  excel: "Excel",
  powerpnt: "PowerPoint",
  outlook: "Outlook",
  onenote: "OneNote",
  teams: "Teams",
  "ms-teams": "Teams",
  acrobat: "Acrobat",
  acrord32: "Acrobat Reader",
  notepad: "Editor",
  obsidian: "Obsidian",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  vlc: "VLC",
  photoshop: "Photoshop",
  illustrator: "Illustrator",
  figma: "Figma",
  blender: "Blender",
  unity: "Unity",
  javaw: "Minecraft",
  applicationframehost: "Windows-App",
  lockapp: "Gesperrt"
};

/* Fenster, die keine echte Nutzung sind. Beim Sperrbildschirm gilt
   das nur fuer die aktive Zeit — als inaktive Zeit ist er die
   ehrlichste Angabe, die es gibt. */
const IGNORIEREN = new Set([
  "", "idle", "lockapp", "searchhost", "shellexperiencehost",
  "startmenuexperiencehost", "textinputhost", "systemsettings",
  "applicationframehost", "pcaui", "dwm", "sihost"
]);

/* Launcher sind Wartezimmer, keine Beschaeftigung: die Zeit in Steam
   oder im Epic-Fenster zaehlt nicht als Bildschirmzeit. Das Spiel
   selbst laeuft als eigener Prozess und wird ganz normal gezaehlt. */
const LAUNCHER = new Set([
  "steam", "steamwebhelper", "steamservice",
  "epicgameslauncher", "epicwebhelper",
  "battle.net", "agent", "blizzard battle.net",
  "eadesktop", "eabackgroundservice", "origin",
  "ubisoftconnect", "ubisoftgamelauncher", "upc",
  "riotclient", "riotclientservices", "riotclientux", "riot client",
  "galaxyclient", "gog galaxy", "xboxapp", "gamingservices",
  "itch", "playnite", "rockstargameslauncher", "launcher"
]);

/* Ein Browserfenster ohne offene Seite ist kein Surfen. Der
   Fenstertitel besteht dann nur aus dem Browsernamen oder dem
   leeren Tab. */
const LEERER_TAB = new Set([
  "brave", "google chrome", "chrome", "chromium", "mozilla firefox",
  "firefox", "microsoft edge", "edge", "opera", "opera gx", "vivaldi",
  "arc", "safari", "neuer tab", "new tab", "leerer tab", "startseite",
  "neuer inkognito-tab", "new incognito tab", "privates fenster"
]);

/* Browser schreiben den Seitentitel ins Fenster: "Titel - Brave".
   Damit laesst sich zeigen, welche Seite offen war. Der Zusatz am
   Ende faellt weg, sonst stuende der Browsername hinter jeder Zeile.
   Die Titel bleiben in der lokalen Datei und gehen nirgendwohin. */
const BROWSER = new Set(["chrome", "msedge", "firefox", "brave", "opera",
                         "operagx", "vivaldi", "arc", "safari", "chromium"]);

const BROWSER_ANHANG =
  /\s+[-–—]\s+(?:Brave|Google Chrome|Chromium|Microsoft\s*.?\s*Edge|Mozilla Firefox|Firefox|Opera(?:\s*GX)?|Vivaldi|Arc|Safari)\s*$/i;

/* Aus der Adressleiste wird nur der Host behalten: "youtube.com"
   statt der vollen Adresse mit Suchbegriffen darin. Tippt jemand
   gerade in die Leiste, steht dort kein Host — das faellt weg. */
function domainAus(adresse) {
  let a = String(adresse || "").trim();
  if (!a || /\s/.test(a)) return "";
  a = a.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");   // Schema weg
  a = a.split(/[\/?#]/)[0];                        // nur der Host
  a = a.replace(/^www\./i, "").toLowerCase();
  if (!a.includes(".") && !a.startsWith("localhost")) return "";
  return a.slice(0, 80);
}

function seitenTitel(roh) {
  let t = String(roh || "").trim();
  t = t.replace(BROWSER_ANHANG, "").trim();
  t = t.replace(/^\(\d+\)\s*/, "");        // "(3) " ungelesene Nachrichten
  t = t.replace(/^[\u2022\u25cf]\s*/, "");  // Punkt bei laufender Wiedergabe
  return t.slice(0, 120);
}

/* Spiele melden sich mit ihrem Dateinamen: aus
   "FortniteClient-Win64-Shipping" soll "Fortnite" werden. Erst die
   bekannten Namen, dann eine allgemeine Reinigung fuer alles, was
   hier noch nicht steht. */
const SPIELNAMEN = {
  "fortniteclient-win64-shipping": "Fortnite",
  "fortniteclient-win64-shipping_eac_eos": "Fortnite",
  "fortniteclient-win64-shipping_be": "Fortnite",
  "valorant-win64-shipping": "Valorant",
  "rocketleague": "Rocket League",
  "rocketleague_eac": "Rocket League",
  "league of legends": "League of Legends",
  "leagueoflegends": "League of Legends",
  "cs2": "Counter-Strike 2",
  "csgo": "CS:GO",
  "dota2": "Dota 2",
  "gta5": "GTA V",
  "gtav": "GTA V",
  "robloxplayerbeta": "Roblox",
  "minecraft": "Minecraft",
  "javaw": "Minecraft",
  "eldenring": "Elden Ring",
  "cyberpunk2077": "Cyberpunk 2077",
  "witcher3": "The Witcher 3",
  "palworld-win64-shipping": "Palworld",
  "overwatch": "Overwatch",
  "r5apex": "Apex Legends",
  "r5apex_dx12": "Apex Legends",
  "risk": "RISK"
};

/* Anhaengsel, die Spiele an ihren Dateinamen haengen */
const TECHNIK_ANHANG =
  /(-|_)?(win64|win32|x64|x86)?(-|_)?(shipping|eac|eac_eos|be|battleye|launcher|client|dx11|dx12|vulkan)+$/i;

function spielName(roh) {
  let n = String(roh || "").trim();
  /* Erst die Endungen abschneiden, dann Trenner zu Leerzeichen */
  let vorher;
  do { vorher = n; n = n.replace(TECHNIK_ANHANG, ""); } while (n !== vorher && n);
  n = n.replace(/\.(root|exe|tmp|bin|app)$/i, "");
  n = n.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!n) return roh;
  /* Ein einzelnes kleingeschriebenes Wort bekommt einen grossen
     Anfangsbuchstaben: aus "python" wird "Python". */
  if (/^[a-z][a-z0-9]*$/.test(n)) return n[0].toUpperCase() + n.slice(1);
  /* CamelCase auseinanderziehen: "RocketLeague" wird "Rocket League" */
  n = n.replace(/([a-z\d])([A-Z])/g, "$1 $2");
  return n;
}

const anzeigeName = roh => {
  const k = String(roh || "").toLowerCase();
  if (NAMEN[k]) return NAMEN[k];
  if (SPIELNAMEN[k]) return SPIELNAMEN[k];
  return spielName(roh);
};

const heuteKey = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0")
       + "-" + String(d.getDate()).padStart(2, "0");
};

/* ---------- Ablage ---------- */
function laden() {
  try {
    const roh = JSON.parse(fs.readFileSync(DATEI, "utf8"));
    if (!roh || typeof roh.verlauf !== "object") return;

    /* Aeltere Dateien haben die Programme flach je Tag stehen, ohne
       Trennung nach aktiv und inaktiv. Die zaehlen als aktive Zeit. */
    Object.entries(roh.verlauf).forEach(([tag, wert]) => {
      if (wert && (wert.aktiv || wert.inaktiv)) {
        /* Frueher lagen die Seiten flach in einem Topf, ohne Browser
           davor. Solche Eintraege lassen sich nicht zuordnen und
           fallen darum weg. */
        const seiten = {};
        Object.entries(wert.seiten || {}).forEach(([schluessel, inhalt]) => {
          if (inhalt && typeof inhalt === "object") seiten[schluessel] = inhalt;
        });
        verlauf[tag] = { aktiv: wert.aktiv || {}, inaktiv: wert.inaktiv || {}, seiten,
                         stunden: wert.stunden || {} };
      } else {
        verlauf[tag] = { aktiv: wert || {}, inaktiv: {}, seiten: {} };
      }
    });

    if (roh.handy && typeof roh.handy === "object") handy = roh.handy;
  } catch (e) {
    verlauf = {};   // erste Ausführung oder beschädigt — beides unkritisch
  }
}

function sichern() {
  clearTimeout(sichernTimer);
  sichernTimer = null;
  try {
    fs.mkdirSync(path.dirname(DATEI), { recursive: true });
    fs.writeFileSync(DATEI, JSON.stringify({ verlauf, handy }, null, 1));
  } catch (e) {
    letzterFehler = "Konnte nicht speichern: " + e.message;
  }
}

/* Nicht bei jeder Messung schreiben — einmal pro Minute reicht */
function sichernBald() {
  if (sichernTimer) return;
  sichernTimer = setTimeout(sichern, 60000);
  if (sichernTimer.unref) sichernTimer.unref();
}

function aufraeumen() {
  const grenze = new Date();
  grenze.setDate(grenze.getDate() - TAGE_BEHALTEN);
  const grenzKey = grenze.getFullYear() + "-" + String(grenze.getMonth() + 1).padStart(2, "0")
                 + "-" + String(grenze.getDate()).padStart(2, "0");
  Object.keys(verlauf).forEach(k => { if (k < grenzKey) delete verlauf[k]; });
  Object.keys(handy).forEach(k => { if (k < grenzKey) delete handy[k]; });
}

/* ---------- Vom Telefon geschickte Zeit ----------
   Nimmt Minuten für einen Tag entgegen, wahlweise mit Aufschlüsselung
   nach Apps. Ein erneuter Aufruf für denselben Tag ersetzt den Wert,
   damit mehrfaches Senden nichts doppelt zählt. */
function handySetzen(datum, minuten, apps) {
  const tag = /^\d{4}-\d{2}-\d{2}$/.test(String(datum || "")) ? datum : heuteKey();
  const zahl = Number(minuten);
  if (!Number.isFinite(zahl) || zahl < 0) throw new Error("minuten muss eine Zahl ab 0 sein");

  const liste = {};
  if (apps && typeof apps === "object") {
    Object.entries(apps).forEach(([name, wert]) => {
      const m = Number(wert);
      if (String(name).trim() && Number.isFinite(m) && m > 0) liste[String(name).trim()] = Math.round(m);
    });
  }

  handy[tag] = { gesamt: Math.round(zahl), apps: liste, manuell: true,
                 empfangen: new Date().toISOString() };
  sichern();
  return { tag, gesamt: handy[tag].gesamt, apps: liste };
}

/* ---------- Einzelne App-Ereignisse vom Telefon ----------
   Ein Kurzbefehl meldet "diese App wurde geöffnet". Die vorherige
   Sitzung endet damit von selbst — auf dem Telefon ist immer nur
   eine App im Vordergrund. Ein ausdrückliches Ende geht auch. */
function sitzungSchliessen(bis) {
  if (!handyOffen) return null;
  const dauer = Math.round((bis - handyOffen.seit) / 60000);
  const app = handyOffen.app;
  const tag = handyOffen.tag;
  handyOffen = null;
  if (dauer < 1) return null;

  const minuten = Math.min(dauer, HANDY_MAX_SITZUNG);
  if (!handy[tag]) handy[tag] = { gesamt: 0, apps: {}, manuell: false, empfangen: null };
  const e = handy[tag];
  e.apps[app] = (e.apps[app] || 0) + minuten;
  e.empfangen = new Date().toISOString();
  /* Wurde für den Tag eine Gesamtzeit von Hand geschickt, bleibt die
     stehen — sie kommt aus der Bildschirmzeit selbst und ist genauer. */
  if (!e.manuell) e.gesamt = Object.values(e.apps).reduce((s, m) => s + m, 0);
  return { app, minuten, gekappt: dauer > HANDY_MAX_SITZUNG };
}

function handyEreignis(app, art) {
  const name = String(app || "").trim();
  if (!name) throw new Error("app fehlt");
  const jetzt = Date.now();

  const beendet = sitzungSchliessen(jetzt);

  if (art === "ende") { sichern(); return { offen: null, beendet }; }

  handyOffen = { app: name, seit: jetzt, tag: heuteKey() };
  sichern();
  return { offen: name, beendet };
}

/* ---------- Messung verarbeiten ---------- */
function messung(zeile) {
  const teile = String(zeile).split("|");
  if (teile.length < 3) return;

  const prozess = teile[0].trim();
  const leerlauf = Number(teile[teile.length - 1].trim());
  if (!Number.isFinite(leerlauf)) return;

  /* Vier Felder seit der Messfuehler auch die Adresse meldet; drei
     Felder kommen noch von einer aelteren Fassung. */
  const titel = (teile[1] || "").trim();
  const adresse = teile.length >= 4 ? (teile[2] || "").trim() : "";

  letzteMessung = { prozess, titel, adresse, leerlauf, zeit: Date.now() };

  /* Ohne Eingabe seit LEERLAUF_AB Sekunden: die Zeit wird gezaehlt,
     aber getrennt — sie ist keine Bildschirmzeit. */
  const abwesend = leerlauf >= LEERLAUF_AB;
  const schluessel = prozess || (abwesend ? "Unbekannt" : "");
  if (!schluessel) return;
  const klein = schluessel.toLowerCase();
  if (!abwesend && IGNORIEREN.has(klein)) return;
  /* Launcher zaehlen gar nicht — weder aktiv noch inaktiv */
  if (LAUNCHER.has(klein)) return;

  /* Ein Browser ohne offene Seite zaehlt ebenfalls nicht: dann steht
     im Fenstertitel nur sein eigener Name oder der leere Tab. */
  if (!abwesend && BROWSER.has(klein)) {
    const offen = seitenTitel(titel);
    if (!offen || LEERER_TAB.has(offen.toLowerCase())) return;
  }

  const tag = heuteKey();
  if (!verlauf[tag]) verlauf[tag] = { aktiv: {}, inaktiv: {}, seiten: {}, stunden: {} };
  if (!verlauf[tag].seiten) verlauf[tag].seiten = {};
  if (!verlauf[tag].stunden) verlauf[tag].stunden = {};
  const topf = abwesend ? verlauf[tag].inaktiv : verlauf[tag].aktiv;
  topf[schluessel] = (topf[schluessel] || 0) + TAKT;

  /* Zusaetzlich je Stunde festhalten, welches Programm lief. Die
     Tagessumme allein sagt nicht, WANN die Zeit anfiel — und genau
     das ist interessant: wann bist du produktiv, wann rutscht es ab.
     Nur aktive Zeit, und nur was ueber eine Minute kommt; sonst
     stuende hier fuer jeden Fensterwechsel ein Eintrag. */
  if (!abwesend) {
    const stunde = String(new Date().getHours());
    const eimer = verlauf[tag].stunden[stunde] || (verlauf[tag].stunden[stunde] = {});
    eimer[schluessel] = (eimer[schluessel] || 0) + TAKT;
  }

  /* Bei einem Browser zusaetzlich festhalten, welche Seite offen war.
     Nur waehrend echter Nutzung — sonst zaehlt eine vergessene Seite
     ueber Nacht mit. */
  if (!abwesend && BROWSER.has(schluessel.toLowerCase())) {
    const seite = seitenTitel(letzteMessung.titel);
    if (seite) {
      const topfB = verlauf[tag].seiten[schluessel] || (verlauf[tag].seiten[schluessel] = {});
      const eintrag = topfB[seite] || (topfB[seite] = { s: 0, d: "" });
      eintrag.s += TAKT;
      /* Die Adresse gehoert zum Titel; ist sie mal nicht lesbar,
         bleibt die zuletzt bekannte stehen. */
      const wo = domainAus(letzteMessung.adresse);
      if (wo) eintrag.d = wo;
    }
  }

  sichernBald();
}

/* ---------- Start und Stopp ----------
   Je Takt ein kurzer PowerShell-Aufruf statt eines dauerhaft
   laufenden Kindprozesses. Ein solches Kind haengt unter Windows am
   Server und blockiert dessen Neustart — Aenderungen kamen dann nie
   an. Ein Aufruf kostet rund eine halbe Sekunde, alle 15 Sekunden
   ist das vertretbar.
   ---------------------------------------------------------------- */
function messenEinmal() {
  if (laeuftGerade) return;          // voriger Aufruf noch unterwegs
  laeuftGerade = true;

  execFile("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", SKRIPT, "0"
  ], { windowsHide: true, timeout: 10000, maxBuffer: 1 << 16 }, (fehler, aus, err) => {
    laeuftGerade = false;
    if (fehler && !aus) {
      letzterFehler = (err && String(err).trim().split(/\r?\n/)[0]) || fehler.message;
      return;
    }
    const zeile = String(aus || "").trim().split(/\r?\n/).pop();
    if (zeile) { letzterFehler = null; messung(zeile); }
  });
}

function starten() {
  /* Das Gesammelte immer einlesen, auch wenn gleich nicht weiter
     gemessen wird — sonst zeigt die Seite nichts mehr, nur weil die
     Messung gerade nicht laufen kann. */
  if (!Object.keys(verlauf).length) {
    laden();
    aufraeumen();
  }

  if (process.env.LIFEOS_OHNE_MESSUNG) {
    letzterFehler = "Messung abgeschaltet (LIFEOS_OHNE_MESSUNG).";
    return;
  }
  if (process.platform !== "win32") {
    letzterFehler = "Die Messung gibt es bisher nur für Windows.";
    return;
  }
  if (taktgeber) return;

  laeuft = true;
  letzterFehler = null;
  messenEinmal();                      // nicht erst nach dem ersten Takt
  taktgeber = setInterval(messenEinmal, TAKT * 1000);
  if (taktgeber.unref) taktgeber.unref();
}

function stoppen() {
  clearInterval(taktgeber);
  taktgeber = null;
  laeuft = false;
  sichern();
}

/* ---------- Auskunft für die API ---------- */
function alsListe(topf) {
  /* Domains und Seitentitel behalten ihren Namen; nur Prozessnamen
     bekommen eine lesbare Fassung. */
  return Object.entries(topf || {})
    .filter(([roh]) => !LAUNCHER.has(roh.toLowerCase()))
    .map(([roh, sek]) => ({ name: anzeigeName(roh), prozess: roh, minuten: Math.round(sek / 60) }))
    .filter(a => a.minuten > 0)
    .sort((a, b) => b.minuten - a.minuten);
}

function stand() {
  const tage = {};
  Object.keys(verlauf).sort().forEach(tag => {
    const apps = alsListe(verlauf[tag].aktiv);
    const inaktivApps = alsListe(verlauf[tag].inaktiv);
    /* Je Browser eine eigene Rangliste seiner Seiten */
    const seiten = {};
    Object.entries(verlauf[tag].seiten || {}).forEach(([browser, titel]) => {
      const liste = Object.entries(titel)
        .map(([name, e]) => ({ name, domain: e.d || "", minuten: Math.round((e.s || 0) / 60) }))
        .filter(x => x.minuten > 0)
        .sort((a, b) => b.minuten - a.minuten);
      if (liste.length) seiten[anzeigeName(browser)] = liste;
    });
    /* Frueher gemessene Browserminuten ohne erfasste Seite fallen
       nachtraeglich weg — dieselbe Regel wie beim Messen. */
    apps.forEach(a => {
      const liste = seiten[a.name];
      if (!liste) return;
      const ausSeiten = liste.reduce((sum, x) => sum + x.minuten, 0);
      if (ausSeiten < a.minuten) a.minuten = ausSeiten;
    });

    const gesamt = apps.reduce((s, a) => s + a.minuten, 0);
    const inaktivGesamt = inaktivApps.reduce((s, a) => s + a.minuten, 0);
    /* Ein Tag zaehlt auch dann, wenn nur inaktive Zeit anfiel */
    if (gesamt > 0 || inaktivGesamt > 0) {
      /* Je Stunde eine kleine Liste der Programme — daraus baut die
         Analyse den Tagesverlauf und beantwortet, wann welche Art
         von Zeit anfiel. Sekunden werden erst hier zu Minuten. */
      const stunden = {};
      Object.entries(verlauf[tag].stunden || {}).forEach(([stunde, eimer]) => {
        const liste = Object.entries(eimer)
          .map(([name, sek]) => ({ name: anzeigeName(name), minuten: Math.round(sek / 60) }))
          .filter(x => x.minuten > 0)
          .sort((a, b) => b.minuten - a.minuten);
        if (liste.length) stunden[stunde] = liste;
      });

      tage[tag] = { gesamt, apps, inaktivGesamt, inaktivApps, seiten, stunden };
    }
  });

  /* Die Telefonzeit kommt getrennt — sie wird nicht gemessen,
     sondern vom Telefon geschickt. */
  const handyTage = {};
  /* Die laufende Sitzung zaehlt schon mit, sonst springt die Zahl
     erst beim naechsten App-Wechsel. */
  const laufend = handyOffen
    ? { tag: handyOffen.tag, app: handyOffen.app,
        minuten: Math.min(HANDY_MAX_SITZUNG, Math.round((Date.now() - handyOffen.seit) / 60000)) }
    : null;

  Object.keys(handy).sort().forEach(tag => {
    const e = handy[tag];
    if (!e || (!e.gesamt && !(laufend && laufend.tag === tag))) return;
    const apps = { ...(e.apps || {}) };
    let gesamt = e.gesamt;
    if (laufend && laufend.tag === tag && laufend.minuten > 0) {
      apps[laufend.app] = (apps[laufend.app] || 0) + laufend.minuten;
      if (!e.manuell) gesamt = Object.values(apps).reduce((s, m) => s + m, 0);
    }
    handyTage[tag] = {
      gesamt,
      manuell: !!e.manuell,
      empfangen: e.empfangen || null,
      apps: Object.entries(apps)
        .map(([name, minuten]) => ({ name, minuten }))
        .sort((a, b) => b.minuten - a.minuten)
    };
  });

  if (laufend && !handyTage[laufend.tag]) {
    handyTage[laufend.tag] = { gesamt: laufend.minuten, manuell: false, empfangen: null,
                               apps: [{ name: laufend.app, minuten: laufend.minuten }] };
  }

  return {
    aktiv: laeuft,
    takt: TAKT,
    leerlaufAb: LEERLAUF_AB,
    plattform: process.platform,
    fehler: letzterFehler,
    zuletzt: letzteMessung
      ? { prozess: letzteMessung.prozess, leerlauf: letzteMessung.leerlauf,
          titel: seitenTitel(letzteMessung.titel),
          adresse: domainAus(letzteMessung.adresse),
          vorSekunden: Math.round((Date.now() - letzteMessung.zeit) / 1000) }
      : null,
    tage,
    handy: handyTage,
    handyOffen: handyOffen ? { app: handyOffen.app, seitMinuten: laufend ? laufend.minuten : 0 } : null
  };
}

module.exports = { starten, stoppen, stand, handySetzen, handyEreignis };


