/* ==========================================================
   API-Routen — hier kommen zukünftige Backend-Funktionen rein,
   z.B.:
     - /api/calendar  -> echte Google-Kalender-Anbindung
     - /api/sync      -> geräteübergreifender Datenabgleich
     - /api/weather   -> eigener Wetter-Proxy (API-Key serverseitig)
   Aktuell nur ein Health-Check, damit klar ist, dass das Backend läuft.
   ========================================================== */

const express = require("express");
const router = express.Router();

router.get("/health", (req, res) => {
  /* "https" sagt, ob der verschlüsselte Zugang steht. Ohne ihn gibt
     es auf dem iPad keinen Service Worker und damit keinen
     Offline-Betrieb — der Zustand soll deshalb nachschlagbar sein
     und nicht nur in der Startmeldung stehen. */
  res.json({
    ok: true,
    time: new Date().toISOString(),
    https: global.lifeosHttps || { an: false, grund: "nicht gestartet" }
  });
});

/* ---------- Bestand: derselbe Stand auf allen Geräten ----------
   Habits, Streaks, Termine und der Rest lagen bisher nur im
   Browser. Damit sah das iPad andere Zahlen als der Rechner. Jetzt
   liegen sie hier, und jedes Gerät holt sie sich beim Öffnen. */
router.get("/bestand", (req, res) => {
  res.json({ ok: true, eintraege: require("../lib/bestand").alles() });
});

router.put("/bestand", (req, res) => {
  try {
    const bestand = require("../lib/bestand");
    const { eintraege, geraet } = req.body || {};
    if (!eintraege || typeof eintraege !== "object") {
      return res.status(400).json({ ok: false, fehler: "eintraege fehlt" });
    }
    /* "geraet" sagt, von wem die Änderung kam — dorthin wird sie
       nicht zurückgeschickt. */
    res.json({ ok: true, ergebnis: bestand.setzenViele(eintraege, geraet) });
  } catch (fehler) {
    res.status(400).json({ ok: false, fehler: fehler.message });
  }
});

/* ==========================================================
   FRÜHERE FASSUNGEN
   Zwei Geräte schreiben denselben Wert immer als Ganzes. Ein
   Gerät mit veraltetem Stand kann damit überschreiben, was das
   andere gerade eingetragen hat. Der Server hebt deshalb die
   letzten Fassungen auf.

     GET  /api/bestand/frueher?schluessel=lifeos_termine
     POST /api/bestand/frueher   { schluessel, nummer }

   "nummer" ist der Platz in der Liste, 0 ist die zuletzt
   überschriebene Fassung. Das Zurückholen schreibt sie als neuen
   Stand — die Geräte bekommen sie damit sofort zugeschickt.
   ========================================================== */
router.get("/bestand/frueher", (req, res) => {
  const schluessel = String(req.query.schluessel || "");
  const bestand = require("../lib/bestand");
  if (!bestand.ERLAUBT.has(schluessel)) {
    return res.status(400).json({ ok: false, fehler: "unbekannter Schlüssel" });
  }
  const liste = bestand.fassungen(schluessel);
  res.json({
    ok: true,
    schluessel,
    fassungen: liste.map((f, i) => ({
      nummer: i,
      stand: f.stand,
      zeit: new Date(f.stand).toISOString(),
      umfang: Array.isArray(f.wert) ? f.wert.length : typeof f.wert,
      wert: f.wert
    }))
  });
});

router.post("/bestand/frueher", (req, res) => {
  try {
    const bestand = require("../lib/bestand");
    const { schluessel, nummer } = req.body || {};
    if (!bestand.ERLAUBT.has(String(schluessel))) {
      return res.status(400).json({ ok: false, fehler: "unbekannter Schlüssel" });
    }
    const liste = bestand.fassungen(String(schluessel));
    const f = liste[Number(nummer) || 0];
    if (!f) return res.status(404).json({ ok: false, fehler: "keine solche Fassung" });
    const ergebnis = bestand.setzen(String(schluessel), f.wert, Date.now(), "zurueckgeholt");
    res.json({ ok: true, ergebnis, zurueck: f.wert });
  } catch (fehler) {
    res.status(400).json({ ok: false, fehler: fehler.message });
  }
});

/* ==========================================================
   OFFENE LEITUNG
   Statt im Takt nachzufragen, hält jedes Gerät hier eine
   Verbindung offen. Ändert irgendwo etwas, schickt der Server
   es sofort hinterher — ohne dass die Seite neu lädt.

   Server-Sent Events: eine ganz gewöhnliche HTTP-Antwort, die
   nie endet. Der Browser bringt mit EventSource alles mit, was
   dafür nötig ist, auch das Wiederverbinden nach einem Abriss.
   ========================================================== */
router.get("/bestand/strom", (req, res) => {
  const geraet = String(req.query.geraet || "");

  res.set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    /* Kein Zwischenspeicher darf hier etwas sammeln, sonst kommt
       nichts an, bevor die Verbindung endet. */
    "X-Accel-Buffering": "no"
  });
  res.flushHeaders && res.flushHeaders();
  res.write("retry: 3000\n\n");        // nach Abriss in 3 s wieder versuchen

  const abmelden = require("../lib/bestand").anmelden(nachricht => {
    if (nachricht.quelle && nachricht.quelle === geraet) return;   // eigene Änderung
    res.write("event: stand\n");
    res.write("data: " + JSON.stringify({
      schluessel: nachricht.schluessel,
      wert: nachricht.wert,
      stand: nachricht.stand
    }) + "\n\n");
  });

  /* Ein Lebenszeichen alle 20 s. Es ist bewusst ein benanntes
     Ereignis und kein Kommentar: nur so sieht das Gerät es auch.
     Bleibt es aus, weiß der Browser, dass die Leitung tot ist —
     bei einem Kommentar bliebe er ahnungslos, weil EventSource
     dafür kein Ereignis auslöst. Genau das passiert, wenn iOS die
     App einfriert und später fortsetzt: die Verbindung ist längst
     abgerissen, aber nichts meldet es. */
  const puls = setInterval(() => {
    res.write("event: puls\n");
    res.write("data: " + Date.now() + "\n\n");
  }, 20000);
  if (puls.unref) puls.unref();

  /* Eine eingeschlafene Verbindung soll den Server nicht ewig
     belegen — sonst sammeln sich tote Drähte an. */
  req.socket.setKeepAlive(true, 15000);

  req.on("close", () => { clearInterval(puls); abmelden(); });
});

/* ==========================================================
   GOOGLE KALENDER
   Termine kommen von Google, Klausuren gehen dorthin. Der
   Abgleich läuft am Server und schreibt direkt in den Bestand —
   so wirkt er auch, wenn gerade kein Gerät offen ist.

   Die Anmeldung muss über localhost laufen: Google lässt für
   eine Rückadresse nur https oder localhost zu, und ein selbst
   ausgestelltes Zertifikat kennt Google nicht.
   ========================================================== */
const RUECK_PFAD = "/api/google/zurueck";

function rueckAdresse(req) {
  /* Immer localhost, egal von wo aufgerufen — das ist die Adresse,
     die in der Google-Konsole hinterlegt wird. */
  const port = process.env.PORT || 3000;
  return "http://localhost:" + port + RUECK_PFAD;
}

router.get("/google/status", (req, res) => {
  const g = require("../lib/google");
  res.json({ ok: true, ...g.stand(), rueckAdresse: rueckAdresse(req) });
});

router.post("/google/zugang", (req, res) => {
  /* Schreibt data/google-zugang.json, damit die Datei nicht von Hand
     angelegt werden muss. Die Werte bleiben auf diesem Rechner und
     gehen an niemanden außer an Google beim Anmelden. */
  const k = req.body || {};
  try {
    require("../lib/google").zugangSetzen(k.client_id, k.client_secret);
    res.json({ ok: true });
  } catch (fehler) {
    res.status(400).json({ ok: false, fehler: fehler.message });
  }
});

router.get("/google/start", (req, res) => {
  const g = require("../lib/google");
  if (!g.eingerichtet()) {
    return res.status(400).type("text/plain; charset=utf-8").send(
      "Es fehlt die Datei data/google-zugang.json mit client_id und client_secret.");
  }
  const ziel = g.anmeldeAdresse(rueckAdresse(req));
  if (!ziel) return res.status(500).type("text/plain; charset=utf-8").send("Zugang unvollständig.");
  res.redirect(ziel);
});

router.get(RUECK_PFAD.replace("/api", ""), async (req, res) => {
  const g = require("../lib/google");
  const seite = (titel, text) =>
    `<!doctype html><meta charset="utf-8"><title>${titel}</title>` +
    `<body style="font-family:system-ui;background:#070a12;color:#e7ebf3;padding:48px;line-height:1.6">` +
    `<h1 style="font-size:20px">${titel}</h1><p>${text}</p>` +
    `<p><a style="color:#5b8cff" href="/">Zurück zum Dashboard</a></p></body>`;

  if (req.query.error) {
    return res.status(400).type("html").send(seite("Abgebrochen",
      "Google hat die Anmeldung abgelehnt: " + String(req.query.error)));
  }
  try {
    await g.codeTauschen(String(req.query.code || ""), rueckAdresse(req));
    /* Gleich einmal abgleichen, damit sofort etwas zu sehen ist — und
       zwar abwarten. Vorher lief das nebenher und ein Fehler blieb
       unsichtbar: die Seite meldete "Verbunden", während in Wahrheit
       kein einziger Termin ankam. */
    let ergebnis = null, schiefging = null;
    try { ergebnis = await g.abgleichen(); }
    catch (fehler) { schiefging = fehler.message; }

    if (schiefging) {
      return res.type("html").send(seite("Verbunden, aber der Abgleich hakt",
        "Die Anmeldung hat geklappt. Google lehnt den Zugriff aber noch ab:<br><br>" +
        `<code style="display:block;padding:12px;border-radius:8px;background:#111827;font-size:13px">${
          schiefging.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</code><br>` +
        "Meist fehlt die Freigabe der Calendar API im Google-Projekt. " +
        "Sobald das erledigt ist, genügt in den Einstellungen ein Klick auf „Jetzt abgleichen“."));
    }
    res.type("html").send(seite("Verbunden",
      `Der Google-Kalender ist angebunden — ${ergebnis.geholt} Termine geholt, ` +
      `${ergebnis.geschrieben} Klausuren geschrieben. Von jetzt an alle 15 Minuten von selbst.`));
  } catch (fehler) {
    res.status(400).type("html").send(seite("Hat nicht geklappt", fehler.message));
  }
});

router.post("/google/abgleich", async (req, res) => {
  try {
    /* Fachnamen und Klausurdauern kennt nur der Browser — sie wandern
       mit und werden für den eigenen Takt aufgehoben. */
    const g = require("../lib/google");
    const k = req.body || {};
    if (k.dauern) g.dauernMerken(k.dauern);
    const ergebnis = await g.abgleichen(k.faecher, k.dauern || g.dauernLesen());
    res.json({ ok: true, ...ergebnis });
  } catch (fehler) {
    res.status(400).json({ ok: false, fehler: fehler.message });
  }
});

router.get("/google/kalender", async (req, res) => {
  try {
    res.json({ ok: true, kalender: await require("../lib/google").kalenderListe() });
  } catch (fehler) {
    res.status(400).json({ ok: false, fehler: fehler.message });
  }
});

router.post("/google/kalender", (req, res) => {
  /* { lesen: [id…], schreiben: id } — aus mehreren Kalendern lesen,
     in genau einen schreiben. Ein einzelnes `id` bleibt erlaubt. */
  const k = req.body || {};
  const ok = require("../lib/google").kalenderSetzen(
    k.id ? String(k.id) : { lesen: k.lesen, schreiben: k.schreiben });
  res.json({ ok });
});

/* ==========================================================
   WLED — LICHT
   Der Browser darf die Lichter nicht direkt fragen: das Dashboard
   läuft über HTTPS, die Geräte sprechen HTTP, und der Browser
   blockiert die Mischung. Hier ist die Brücke.
   ========================================================== */
const wled = () => require("../lib/wled");

router.get("/wled/geraete", async (req, res) => {
  try { res.json({ ok: true, geraete: await wled().alleZustaende() }); }
  catch (fehler) { res.status(500).json({ ok: false, fehler: fehler.message }); }
});

router.post("/wled/suchen", async (req, res) => {
  try {
    const gefunden = await wled().suchen();
    wled().uebernehmen(gefunden);
    res.json({ ok: true, gefunden: gefunden.length,
               geraete: await wled().alleZustaende() });
  } catch (fehler) { res.status(500).json({ ok: false, fehler: fehler.message }); }
});

router.get("/wled/listen", async (req, res) => {
  try { res.json({ ok: true, ...(await wled().listen(String(req.query.ip || ""))) }); }
  catch (fehler) { res.status(400).json({ ok: false, fehler: fehler.message }); }
});

router.post("/wled/setzen", async (req, res) => {
  const k = req.body || {};
  try {
    if (k.alle) { res.json({ ok: true, ergebnis: await wled().alleSetzen(k) }); return; }
    await wled().setzen(String(k.ip || ""), k);
    /* Den frischen Zustand gleich zurück — dann muss der Browser
       nicht nachfragen und die Anzeige stimmt sofort. */
    res.json({ ok: true, zustand: await wled().zustand(String(k.ip || "")) });
  } catch (fehler) { res.status(400).json({ ok: false, fehler: fehler.message }); }
});

router.post("/wled/geraet", (req, res) => {
  const k = req.body || {};
  const w = wled();
  if (k.weg) return res.json({ ok: true, geraete: w.entfernen(String(k.ip || "")) });
  if (k.name != null && !k.neu) return res.json({ ok: w.umbenennen(String(k.ip || ""), k.name) });
  res.json({ ok: true, geraete: w.hinzufuegen(String(k.ip || ""), k.name) });
});

router.post("/google/ziele", (req, res) => {
  /* { klausur: id, hausaufgabe: id, fahrschule: id, termin: id } —
     welche Art in welchen Kalender geschrieben wird. */
  const ok = require("../lib/google").zieleSetzen((req.body || {}).ziele || req.body);
  res.json({ ok });
});

router.post("/google/ausblenden", (req, res) => {
  /* { liste: ["Steglitz", "Ferien"] } — Titel, die gar nicht erst
     ins Dashboard sollen. Teil des Titels genügt. */
  const ok = require("../lib/google").ausblendenSetzen((req.body || {}).liste);
  res.json({ ok });
});

router.post("/google/trennen", (req, res) => {
  res.json({ ok: require("../lib/google").trennen() });
});

/* ==========================================================
   NUTZUNG DES DASHBOARDS
   Welche Seite wie lange offen war, was getan wurde, zu welcher
   Stunde und von welchem Gerät. Nur Zähler je Tag — daraus baut
   die Analyse-Seite ihre Muster.
   ========================================================== */
router.post("/nutzung", (req, res) => {
  try {
    res.json(require("../lib/nutzung").melden(req.body || {}));
  } catch (fehler) {
    res.status(400).json({ ok: false, fehler: fehler.message });
  }
});

router.get("/nutzung", (req, res) => {
  const von = typeof req.query.von === "string" ? req.query.von : null;
  res.json({ ok: true, tage: require("../lib/nutzung").verlauf(von) });
});

/* Bildschirmzeit dieses Rechners — gemessen, solange der Server läuft */
router.get("/bildschirmzeit", (req, res) => {
  res.json(require("../lib/bildschirmzeit").stand());
});

/* Zeit vom Telefon. Apple gibt die Bildschirmzeit nicht heraus, also
   schickt sie das Telefon selbst her — per Kurzbefehl:
     POST /api/bildschirmzeit/handy
     { "minuten": 245, "datum": "2026-08-26", "apps": { "TikTok": 90 } }
   "datum" und "apps" sind freiwillig. */
/* Einzelne App-Ereignisse vom Telefon:
     POST /api/bildschirmzeit/handy/ereignis
     { "app": "TikTok", "art": "start" }      art: "start" (Vorgabe) oder "ende"
   Das Ende der vorigen App ergibt sich von selbst, sobald die
   naechste geoeffnet wird. */
router.post("/bildschirmzeit/handy/ereignis", (req, res) => {
  try {
    const { app, art } = req.body || {};
    const ergebnis = require("../lib/bildschirmzeit").handyEreignis(app, art);
    res.json({ ok: true, ...ergebnis });
  } catch (fehler) {
    res.status(400).json({ ok: false, fehler: fehler.message });
  }
});

/* Bildschirmzeit aus einem Screenshot. Die Kurzbefehle-App liest den
   Text aus dem Bild, das Auswerten passiert hier — so bleibt die
   Einrichtung auf dem iPhone kurz und der Parser laesst sich
   verbessern, ohne den Kurzbefehl anzufassen.
     POST /api/bildschirmzeit/text
     { "text": "Bildschirmzeit
Heute
5 Std. 32 Min. ..." } */
router.post("/bildschirmzeit/text", (req, res) => {
  try {
    const gelesen = require("../lib/zeittext").ausText((req.body || {}).text);
    if (gelesen.gesamt === null) {
      return res.status(422).json({ ok: false, fehler: gelesen.grund, gelesen });
    }
    const zeit = require("../lib/bildschirmzeit");
    const gesetzt = zeit.handySetzen((req.body || {}).datum, gelesen.gesamt, gelesen.apps);
    res.json({ ok: true, ...gesetzt, quelle: gelesen.quelle });
  } catch (fehler) {
    res.status(400).json({ ok: false, fehler: fehler.message });
  }
});

router.post("/bildschirmzeit/handy", (req, res) => {
  try {
    const { minuten, datum, apps } = req.body || {};
    const ergebnis = require("../lib/bildschirmzeit").handySetzen(datum, minuten, apps);
    res.json({ ok: true, ...ergebnis });
  } catch (fehler) {
    res.status(400).json({ ok: false, fehler: fehler.message });
  }
});

module.exports = router;

