/* ==========================================================
   LIFE OS // NUTZUNG
   Bisher wusste das Dashboard alles über den Tag — nur nicht
   über sich selbst. Hier wird deshalb mitgeschrieben, wie es
   benutzt wird: welche Seite wie lange offen war, was getan
   wurde und zu welcher Stunde.

   Bewusst nur Zähler, keine Ereignisliste. Ein Tag ist ein
   Eintrag mit ein paar Summen — das bleibt auch nach Monaten
   klein, lässt sich in einem Blick auswerten und enthält nichts,
   was über "wann und wie oft" hinausgeht.

     seiten    { dashboard: { auf: 12, dauer: 3600 } }   dauer in Sekunden
     aktionen  { habit: 8, termin: 2, suche: 5 }
     stunden   { "14": 23 }                              Ereignisse je Stunde
     geraete   { pc: 40, tablet: 6 }

   Aufgehoben werden 400 Tage. Das reicht für den Vergleich
   "dieser Monat gegen denselben Monat im Vorjahr" und deckelt
   die Datei zugleich.
   ========================================================== */

const fs = require("fs");
const path = require("path");

const ORDNER = path.join(__dirname, "..", "data");
const DATEI = path.join(ORDNER, "nutzung.json");

const TAGE_MAX = 400;
/* Ein Seitenaufruf, der länger als vier Stunden zählt, ist kein
   Aufruf mehr — da lag das Gerät nur offen herum. */
const DAUER_MAX = 4 * 3600;

/* Nur bekannte Namen. Ein Tippfehler im Browser soll die Auswertung
   nicht mit Phantom-Einträgen zumüllen. */
const SEITEN = new Set([
  "dashboard", "kalender", "habits", "kalorien", "bildschirmzeit",
  "lernen", "planung", "projekte", "analyse"
]);

const AKTIONEN = new Set([
  "habit", "streak", "termin", "klausur", "hausaufgabe", "hausaufgabe_fertig",
  "kalorien", "suche", "slash", "lernkarte", "projekt", "planung", "einstellungen",
  "notiz"
]);

const GERAETE = new Set(["pc", "tablet", "handy"]);

let tage = {};
let sichernTimer = null;

function laden() {
  try {
    const roh = JSON.parse(fs.readFileSync(DATEI, "utf8"));
    if (roh && typeof roh === "object") tage = roh;
  } catch (fehler) {
    if (fehler.code !== "ENOENT") console.warn("  [Nutzung] nicht lesbar:", fehler.message);
  }
}

function sichern() {
  try {
    fs.mkdirSync(ORDNER, { recursive: true });
    fs.writeFileSync(DATEI, JSON.stringify(tage), "utf8");
  } catch (fehler) {
    console.warn("  [Nutzung] nicht speicherbar:", fehler.message);
  }
}

function sichernBald() {
  clearTimeout(sichernTimer);
  sichernTimer = setTimeout(sichern, 1500);
  if (sichernTimer.unref) sichernTimer.unref();
}

/* Ortsdatum des Servers — die Geräte stehen im selben Zimmer, ein
   gemeinsamer Tagesbegriff reicht also. */
function heute() {
  const d = new Date();
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

function tagHolen(datum) {
  if (!tage[datum]) tage[datum] = { seiten: {}, aktionen: {}, stunden: {}, geraete: {} };
  const t = tage[datum];
  t.seiten = t.seiten || {};
  t.aktionen = t.aktionen || {};
  t.stunden = t.stunden || {};
  t.geraete = t.geraete || {};
  return t;
}

function aufraeumen() {
  const schluessel = Object.keys(tage).sort();
  if (schluessel.length <= TAGE_MAX) return;
  schluessel.slice(0, schluessel.length - TAGE_MAX).forEach(k => delete tage[k]);
}

/* Nimmt ein Bündel Ereignisse entgegen:
     { geraet: "pc", stunde: 14,
       seiten:   [{ name: "dashboard", dauer: 120 }],
       aktionen: ["habit", "habit", "suche"] }              */
function melden(bericht) {
  if (!bericht || typeof bericht !== "object") return { ok: false, grund: "leer" };

  const datum = heute();
  const t = tagHolen(datum);
  let gezaehlt = 0;

  const geraet = GERAETE.has(bericht.geraet) ? bericht.geraet : "pc";
  const stunde = Number.isInteger(bericht.stunde) && bericht.stunde >= 0 && bericht.stunde < 24
    ? String(bericht.stunde) : String(new Date().getHours());

  (Array.isArray(bericht.seiten) ? bericht.seiten : []).forEach(s => {
    if (!s || !SEITEN.has(s.name)) return;
    const dauer = Math.max(0, Math.min(DAUER_MAX, Math.round(Number(s.dauer) || 0)));
    const e = t.seiten[s.name] || (t.seiten[s.name] = { auf: 0, dauer: 0 });
    e.auf += 1;
    e.dauer += dauer;
    gezaehlt++;
  });

  (Array.isArray(bericht.aktionen) ? bericht.aktionen : []).forEach(a => {
    if (!AKTIONEN.has(a)) return;
    t.aktionen[a] = (t.aktionen[a] || 0) + 1;
    gezaehlt++;
  });

  if (gezaehlt) {
    t.stunden[stunde] = (t.stunden[stunde] || 0) + gezaehlt;
    t.geraete[geraet] = (t.geraete[geraet] || 0) + gezaehlt;
    aufraeumen();
    sichernBald();
  }
  return { ok: true, gezaehlt };
}

/* Alles zum Auswerten. "vonTag" begrenzt auf einen Zeitraum. */
function verlauf(vonTag) {
  if (!vonTag) return tage;
  const raus = {};
  Object.keys(tage).forEach(k => { if (k >= vonTag) raus[k] = tage[k]; });
  return raus;
}

laden();

module.exports = { melden, verlauf, SEITEN, AKTIONEN };

