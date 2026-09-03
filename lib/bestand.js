/* ==========================================================
   LIFE OS // BESTAND
   Alles, was bisher nur im Browser lag — Habits, Streaks, Termine,
   Klausuren, Hausaufgaben, Projekte, Abläufe, Einstellungen —,
   liegt hier beim Server. Damit sieht das iPad denselben Stand wie
   der Rechner.

   Jeder Eintrag hat einen Schlüssel (genau der aus dem Browser,
   z.B. "lifeos_habits"), seinen Inhalt und den Zeitpunkt der
   letzten Änderung. Der Zeitpunkt entscheidet bei Streit: wer
   zuletzt geschrieben hat, gewinnt. Für ein Dashboard, das eine
   Person auf zwei Geräten benutzt, reicht das — Änderungen an
   derselben Sache zur selben Sekunde gibt es dort nicht.

   SEIT DER ANMELDUNG
   Jeder Nutzer hat seinen eigenen Bestand in einer eigenen Datei.
   Zwei Konten sehen nichts voneinander — auch nicht den
   Stundenplan. Dieses Modul ist deshalb keine einzelne Ablage mehr,
   sondern eine Werkstatt: `fuer(nutzerId)` gibt die Ablage dieses
   einen Nutzers zurück.

   Die alte gemeinsame Datei wird beim ersten Anlegen eines Kontos
   übernommen — sonst wären mit der Anmeldung alle bisherigen Daten
   scheinbar verschwunden.
   ========================================================== */

const fs = require("fs");
const path = require("path");

const ORDNER = path.join(__dirname, "..", "data");
const ALTE_DATEI = path.join(ORDNER, "bestand.json");

const dateiFuer = nutzerId => path.join(ORDNER, "bestand-" + nutzerId + ".json");

/* Nur was das Dashboard wirklich führt. Ein fremder Schlüssel
   käme sonst ungeprüft in die Datei. */
const ERLAUBT = new Set([
  "lifeos_settings", "lifeos_quicklinks", "lifeos_termine", "lifeos_klausuren",
  "lifeos_kalorien", "lifeos_kalorien_verlauf", "lifeos_screentime",
  "lifeos_habits", "lifeos_streaks", "lifeos_projekte", "lifeos_planung",
  "lifeos_hausaufgaben", "lifeos_lernkarten", "lifeos_ziele", "lifeos_notizen",
  "lifeos_themen", "lifeos_klausurdauer", "lifeos_farbpaletten", "lifeos_licht_eigen",
  /* Der Stundenplan gehört jetzt dem Nutzer: Fächer, Stunden, Räume */
  "lifeos_stundenplan", "lifeos_faecher",
  /* Ferienblöcke, wie sie im Google-Kalender stehen — daraus rechnet
     das Dashboard Schultage statt Kalendertage */
  "lifeos_ferien",
  /* Wann zuletzt ein Wochenrückblick geschrieben wurde, und der
     Lernplan der Karteikarten */
  "lifeos_rueckblick", "lifeos_karten_plan",
  /* Damit ein Geraet offline das zuletzt bekannte Wetter zeigen kann,
     auch wenn es selbst nie geladen hat */
  "lifeos_weather_cache",
  "lifeos_st_range", "lifeos_st_seite", "lifeos_habit_ansicht",
  "lifeos_card_tab", "lifeos_wetter_ansicht", "lifeos_lern_reiter",
  "lifeos_streak_stufen"
]);

const GROESSE_MAX = 2 * 1024 * 1024;   // 2 MB je Eintrag reicht reichlich
const FRUEHER_MAX = 8;

/* ==========================================================
   EINE ABLAGE
   ========================================================== */
function ablageBauen(nutzerId, uebernehmen) {
  const DATEI = dateiFuer(nutzerId);

  let bestand = {};        // { schluessel: { wert, stand } }
  let frueher = {};        // { schluessel: [ { wert, stand }, … ] }
  let sichernTimer = null;

  /* ----------------------------------------------------------
     ZUHÖRER
     Die Geräte melden sich einmal an und bekommen jede Änderung
     sofort zugeschickt. "quelle" ist das Gerät, von dem die
     Änderung kam — es bekommt sie nicht zurück, sonst überschriebe
     es sich selbst mit seinem eigenen Stand.

     Je Nutzer eine eigene Runde: eine Änderung darf nur an dessen
     Geräte gehen.
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
    let quelle = DATEI;
    /* Die alte gemeinsame Datei wird nur für das allererste Konto
       übernommen, und nur wenn der Aufrufer das ausdrücklich sagt.

       Ohne diese Bedingung bekäme sie jeder neu angelegte Nutzer:
       ein zweites Konto im Haus stünde dann vor den Terminen,
       Noten und Notizen des ersten. */
    if (uebernehmen && !fs.existsSync(DATEI) && fs.existsSync(ALTE_DATEI)) quelle = ALTE_DATEI;

    try {
      const roh = JSON.parse(fs.readFileSync(quelle, "utf8"));
      if (!roh || typeof roh !== "object") return;
      if (roh.bestand && typeof roh.bestand === "object") {
        bestand = roh.bestand;
        frueher = (roh.frueher && typeof roh.frueher === "object") ? roh.frueher : {};
      } else {
        bestand = roh;
      }
      if (quelle === ALTE_DATEI) {
        console.log("  [Bestand] bisherige Daten für „" + nutzerId + "“ übernommen ("
                    + Object.keys(bestand).length + " Einträge)");
        sichern();
      }
    } catch (fehler) {
      if (fehler.code !== "ENOENT") {
        console.warn("  [Bestand] " + nutzerId + " nicht lesbar:", fehler.message);
      }
    }
  }

  function sichern() {
    try {
      fs.mkdirSync(ORDNER, { recursive: true });
      /* Erst daneben, dann umbenennen — ein Abbruch mitten im
         Schreiben ließe sonst eine halbe Datei zurück. */
      const vorlaeufig = DATEI + ".neu";
      fs.writeFileSync(vorlaeufig, JSON.stringify({ bestand, frueher }), "utf8");
      fs.renameSync(vorlaeufig, DATEI);
    } catch (fehler) {
      console.warn("  [Bestand] " + nutzerId + " nicht speicherbar:", fehler.message);
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

  function setzenViele(eintraege, quelle) {
    const ergebnis = {};
    Object.entries(eintraege || {}).forEach(([schluessel, e]) => {
      ergebnis[schluessel] = setzen(schluessel, e && e.wert, e && e.stand, quelle);
    });
    return ergebnis;
  }

  laden();
  return { nutzerId, alles, setzen, setzenViele, anmelden, fassungen, ERLAUBT };
}

/* ==========================================================
   DIE WERKSTATT
   Jede Ablage wird einmal gebaut und dann behalten — sie hält
   ihren Stand im Speicher und ihre Zuhörer.
   ========================================================== */
const ablagen = new Map();

/* `uebernehmen` nur beim Anlegen des allerersten Kontos: dann — und
   nur dann — wandern die Daten aus der bisherigen gemeinsamen Datei
   in die Ablage dieses Nutzers. */
function fuer(nutzerId, uebernehmen) {
  const id = String(nutzerId || "").trim();
  if (!id || !/^[a-z0-9][a-z0-9._-]*$/i.test(id)) {
    throw new Error("Ungültige Nutzerkennung für den Bestand");
  }
  if (!ablagen.has(id)) ablagen.set(id, ablageBauen(id, uebernehmen));
  return ablagen.get(id);
}

/* Eine Ablage aus dem Speicher werfen — nach dem Löschen eines
   Kontos, damit nichts von ihm hängen bleibt. */
function vergessen(nutzerId) {
  ablagen.delete(String(nutzerId || ""));
}

module.exports = { fuer, vergessen, ERLAUBT };
