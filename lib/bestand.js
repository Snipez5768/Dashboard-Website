/* ==========================================================
   LIFE OS // BESTAND
   Alles, was bisher nur im Browser lag — Habits, Streaks, Termine,
   Klausuren, Hausaufgaben, Projekte, Planung, Einstellungen —,
   liegt jetzt hier beim Server. Damit sieht das iPad denselben
   Stand wie der Rechner.

   Jeder Eintrag hat einen Schlüssel (genau der aus dem Browser,
   z.B. "lifeos_habits"), seinen Inhalt und den Zeitpunkt der
   letzten Änderung. Der Zeitpunkt entscheidet bei Streit: wer
   zuletzt geschrieben hat, gewinnt. Für ein Dashboard, das eine
   Person auf zwei Geräten benutzt, reicht das — Änderungen an
   derselben Sache zur selben Sekunde gibt es dort nicht.
   ========================================================== */

const fs = require("fs");
const path = require("path");

const ORDNER = path.join(__dirname, "..", "data");
const DATEI = path.join(ORDNER, "bestand.json");

/* Nur was das Dashboard wirklich führt. Ein fremder Schlüssel
   käme sonst ungeprüft in die Datei. */
const ERLAUBT = new Set([
  "lifeos_settings", "lifeos_quicklinks", "lifeos_termine", "lifeos_klausuren",
  "lifeos_kalorien", "lifeos_kalorien_verlauf", "lifeos_screentime",
  "lifeos_habits", "lifeos_streaks", "lifeos_projekte", "lifeos_planung",
  "lifeos_hausaufgaben", "lifeos_lernkarten", "lifeos_ziele", "lifeos_notizen",
  "lifeos_themen", "lifeos_klausurdauer", "lifeos_farbpaletten", "lifeos_licht_eigen",
  /* Damit ein Geraet offline das zuletzt bekannte Wetter zeigen kann,
     auch wenn es selbst nie geladen hat */
  "lifeos_weather_cache",
  "lifeos_st_range", "lifeos_st_seite", "lifeos_habit_ansicht",
  "lifeos_card_tab", "lifeos_wetter_ansicht", "lifeos_lern_reiter",
  "lifeos_streak_stufen"
]);

const GROESSE_MAX = 2 * 1024 * 1024;   // 2 MB je Eintrag reicht reichlich

let bestand = {};        // { schluessel: { wert, stand } }
let frueher = {};        // { schluessel: [ { wert, stand }, … ] }
let sichernTimer = null;

/* ----------------------------------------------------------
   FRÜHERE FASSUNGEN
   Geschrieben wird immer der ganze Wert: ein Gerät mit einer
   veralteten oder leeren Liste überschreibt damit im Zweifel,
   was ein anderes gerade eingetragen hat. Ganz verhindern lässt
   sich das bei zwei Geräten nicht — es muss aber umkehrbar sein.
   Deshalb liegen hier die letzten Fassungen jedes Schlüssels.

   Abrufbar über GET /api/bestand/frueher?schluessel=lifeos_termine
   ---------------------------------------------------------- */
const FRUEHER_MAX = 8;

/* ----------------------------------------------------------
   ZUHÖRER
   Bisher fragte jedes Gerät im Takt nach, ob sich etwas getan
   hat. Jetzt melden sich die Geräte einmal an und bekommen jede
   Änderung sofort zugeschickt. "quelle" ist das Gerät, von dem
   die Änderung kam — es bekommt sie nicht zurück, sonst
   überschriebe es sich selbst mit seinem eigenen Stand.
   ---------------------------------------------------------- */
const zuhoerer = new Set();

function anmelden(melden) {
  zuhoerer.add(melden);
  return () => zuhoerer.delete(melden);
}

function verteilen(nachricht) {
  zuhoerer.forEach(melden => {
    try { melden(nachricht); } catch (fehler) { zuhoerer.delete(melden); }
  });
}

function laden() {
  try {
    const roh = JSON.parse(fs.readFileSync(DATEI, "utf8"));
    if (!roh || typeof roh !== "object") return;
    /* Ältere Dateien enthalten nur den Bestand, neuere zusätzlich die
       früheren Fassungen. Beides muss sich lesen lassen. */
    if (roh.bestand && typeof roh.bestand === "object") {
      bestand = roh.bestand;
      frueher = (roh.frueher && typeof roh.frueher === "object") ? roh.frueher : {};
    } else {
      bestand = roh;
    }
  } catch (fehler) {
    if (fehler.code !== "ENOENT") console.warn("  [Bestand] konnte nicht gelesen werden:", fehler.message);
  }
}

function sichern() {
  try {
    fs.mkdirSync(ORDNER, { recursive: true });
    fs.writeFileSync(DATEI, JSON.stringify({ bestand, frueher }), "utf8");
  } catch (fehler) {
    console.warn("  [Bestand] konnte nicht gespeichert werden:", fehler.message);
  }
}

/* Die bisherige Fassung wegheben, bevor sie überschrieben wird */
function wegheben(schluessel, eintrag) {
  if (!eintrag) return;
  const liste = frueher[schluessel] || (frueher[schluessel] = []);
  /* Nichts doppelt aufheben — Geräte schicken denselben Wert oft
     mehrfach, etwa nach jedem Neustart des Servers. */
  const letzte = liste[0];
  if (letzte && JSON.stringify(letzte.wert) === JSON.stringify(eintrag.wert)) return;
  liste.unshift({ wert: eintrag.wert, stand: eintrag.stand || 0 });
  if (liste.length > FRUEHER_MAX) liste.length = FRUEHER_MAX;
}

/* Frühere Fassungen eines Schlüssels — zum Nachsehen und Zurückholen */
function fassungen(schluessel) {
  return (frueher[schluessel] || []).map(e => ({ wert: e.wert, stand: e.stand }));
}

/* Nicht bei jedem Tastendruck auf die Platte schreiben */
function sichernBald() {
  clearTimeout(sichernTimer);
  sichernTimer = setTimeout(sichern, 400);
  if (sichernTimer.unref) sichernTimer.unref();
}

/* Alles auf einmal — das Gerät holt sich beim Öffnen den Stand */
function alles() {
  const raus = {};
  Object.entries(bestand).forEach(([schluessel, eintrag]) => {
    raus[schluessel] = { wert: eintrag.wert, stand: eintrag.stand || 0 };
  });
  return raus;
}

/* Einen Eintrag setzen. "stand" ist der Zeitpunkt des Geräts; ein
   älterer Schreibversuch überschreibt keinen neueren Stand. */
function setzen(schluessel, wert, stand, quelle) {
  if (!ERLAUBT.has(schluessel)) return { ok: false, grund: "unbekannter Schlüssel" };
  const jetzt = Number(stand) || Date.now();
  const da = bestand[schluessel];
  if (da && da.stand > jetzt) return { ok: true, veraltet: true, stand: da.stand };

  const text = JSON.stringify(wert);
  if (text && text.length > GROESSE_MAX) return { ok: false, grund: "zu groß" };

  wegheben(schluessel, da);
  bestand[schluessel] = { wert, stand: jetzt };
  sichernBald();
  verteilen({ schluessel, wert, stand: jetzt, quelle: quelle || null });
  return { ok: true, stand: jetzt };
}

/* Mehrere auf einmal, so schickt es das Gerät beim ersten Abgleich */
function setzenViele(eintraege, quelle) {
  const ergebnis = {};
  Object.entries(eintraege || {}).forEach(([schluessel, e]) => {
    ergebnis[schluessel] = setzen(schluessel, e && e.wert, e && e.stand, quelle);
  });
  return ergebnis;
}

laden();

module.exports = { alles, setzen, setzenViele, anmelden, fassungen, ERLAUBT };






