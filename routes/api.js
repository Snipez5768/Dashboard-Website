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

/* ==========================================================
   ANMELDUNG
   Ohne gültige Sitzung geht nichts an Daten heraus. Die Prüfung
   steht bewusst hier vor allen Routen und nicht nur vor der
   Oberfläche: eine Sperre, die man mit dem Aufruf einer Adresse
   umgeht, ist keine.

   Frei bleiben nur die Wege, die man braucht, um überhaupt
   hineinzukommen — der Zustand der Anmeldung, das Anmelden selbst
   und die einmalige Einrichtung des ersten Kontos.
   ========================================================== */
const nutzer = () => require("../lib/nutzer");

const MARKE = "lifeos_sitzung";

/* Das Häkchen "secure" nur bei verschlüsselter Verbindung: über
   http://localhost würde der Browser das Plätzchen sonst verwerfen
   und niemand käme mehr herein. */
function markeSetzen(req, res, marke) {
  const verschluesselt = req.secure || (req.socket && req.socket.encrypted);
  res.cookie(MARKE, marke, {
    httpOnly: true,                 // kein Zugriff aus JavaScript
    sameSite: "Lax",                // nicht von fremden Seiten mitschicken
    secure: !!verschluesselt,
    maxAge: nutzer().SITZUNG_TAGE * 86400000,
    path: "/"
  });
}

/* Plätzchen lesen, ohne ein Paket dafür einzubinden */
function markeLesen(req) {
  const roh = req.headers.cookie || "";
  const treffer = roh.split(";").map(t => t.trim())
    .find(t => t.startsWith(MARKE + "="));
  return treffer ? decodeURIComponent(treffer.slice(MARKE.length + 1)) : null;
}

/* Hängt den angemeldeten Nutzer an die Anfrage — oder nichts */
router.use((req, res, next) => {
  req.nutzer = nutzer().markeLesen(markeLesen(req));
  next();
});

/* Diese Wege bleiben offen. Die ersten vier braucht man, um
   überhaupt hereinzukommen.

   Die drei Meldewege des Telefons sind ein bewusster Kompromiss:
   sie kommen aus der Kurzbefehle-App, die kein Plätzchen mitschickt
   und sich nicht anmelden kann. Sie tragen nur Zahlen ein — Minuten
   und App-Namen — und geben nichts heraus. Gelesen wird die
   Bildschirmzeit weiter nur mit Anmeldung. */
const OHNE_ANMELDUNG = new Set([
  "/health", "/anmeldung/stand", "/anmeldung/an", "/anmeldung/einrichten",
  "/bildschirmzeit/handy", "/bildschirmzeit/handy/ereignis", "/bildschirmzeit/text"
]);

router.use((req, res, next) => {
  if (OHNE_ANMELDUNG.has(req.path)) return next();
  if (req.nutzer) return next();
  res.status(401).json({ ok: false, fehler: "Nicht angemeldet", anmeldung: true });
});

/* Der Bestand des angemeldeten Nutzers — jeder sieht nur seinen */
const meinBestand = req => require("../lib/bestand").fuer(req.nutzer.id);

router.get("/anmeldung/stand", (req, res) => {
  res.json({
    ok: true,
    eingerichtet: nutzer().gibtNutzer(),
    angemeldet: !!req.nutzer,
    nutzer: req.nutzer || null
  });
});

/* Das allererste Konto. Danach ist dieser Weg zu — sonst könnte
   sich jeder im Netz selbst eines anlegen. */
router.post("/anmeldung/einrichten", async (req, res) => {
  try {
    if (nutzer().gibtNutzer()) {
      return res.status(403).json({ ok: false, fehler: "Es gibt schon ein Konto" });
    }
    const { name, passwort } = req.body || {};
    const konto = await nutzer().anlegen(name, passwort);
    markeSetzen(req, res, nutzer().markeBauen(konto.id));
    /* Die Ablage jetzt anlegen und dabei die bisherigen Daten aus
       der gemeinsamen Datei übernehmen — nur hier, nur einmal. */
    require("../lib/bestand").fuer(konto.id, true);
    res.json({ ok: true, nutzer: konto });
  } catch (fehler) {
    res.status(400).json({ ok: false, fehler: fehler.message });
  }
});

router.post("/anmeldung/an", async (req, res) => {
  try {
    const { name, passwort } = req.body || {};
    const konto = await nutzer().pruefen(name, passwort);
    if (!konto) {
      /* Keine Auskunft darüber, was falsch war — Name oder Passwort */
      return res.status(401).json({ ok: false, fehler: "Name oder Passwort stimmt nicht" });
    }
    markeSetzen(req, res, nutzer().markeBauen(konto.id));
    require("../lib/bestand").fuer(konto.id);
    res.json({ ok: true, nutzer: konto });
  } catch (fehler) {
    res.status(400).json({ ok: false, fehler: fehler.message });
  }
});

router.post("/anmeldung/aus", (req, res) => {
  res.clearCookie(MARKE, { path: "/" });
  res.json({ ok: true });
});

router.post("/anmeldung/passwort", async (req, res) => {
  try {
    const { alt, neu } = req.body || {};
    await nutzer().passwortAendern(req.nutzer.id, alt, neu);
    res.json({ ok: true });
  } catch (fehler) {
    res.status(400).json({ ok: false, fehler: fehler.message });
  }
});

/* Weitere Konten legt nur an, wer das erste angelegt hat */
router.get("/anmeldung/nutzer", (req, res) => {
  if (!req.nutzer.verwalter) return res.status(403).json({ ok: false, fehler: "Nicht erlaubt" });
  res.json({ ok: true, nutzer: nutzer().alleNutzer()
    .map(n => ({ id: n.id, name: n.name, verwalter: !!n.verwalter, angelegt: n.angelegt })) });
});

router.post("/anmeldung/nutzer", async (req, res) => {
  try {
    if (!req.nutzer.verwalter) return res.status(403).json({ ok: false, fehler: "Nicht erlaubt" });
    const { name, passwort } = req.body || {};
    res.json({ ok: true, nutzer: await nutzer().anlegen(name, passwort) });
  } catch (fehler) {
    res.status(400).json({ ok: false, fehler: fehler.message });
  }
});

router.delete("/anmeldung/nutzer/:id", (req, res) => {
  if (!req.nutzer.verwalter) return res.status(403).json({ ok: false, fehler: "Nicht erlaubt" });
  if (req.params.id === req.nutzer.id) {
    return res.status(400).json({ ok: false, fehler: "Das eigene Konto lässt sich hier nicht löschen" });
  }
  const weg = nutzer().entfernen(req.params.id);
  require("../lib/bestand").vergessen(req.params.id);
  res.json({ ok: weg });
});

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
  res.json({ ok: true, eintraege: meinBestand(req).alles() });
});

router.put("/bestand", (req, res) => {
  try {
    const bestand = meinBestand(req);
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
  const bestand = meinBestand(req);
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
    const bestand = meinBestand(req);
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

  const abmelden = meinBestand(req).anmelden(nachricht => {
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
     die in der Google-Konsole hinterlegt wird.

     Der Port kommt vom Server selbst: war 3000 belegt, hört er
     woanders, und dann muss auch Google dorthin zurückschicken.
     Steht in der Konsole noch die alte Adresse, sagt Google das
     deutlich — besser als eine Anmeldung, die still ins Leere
     läuft. */
  const port = global.lifeosPort || process.env.PORT || 3000;
  return "http://localhost:" + port + RUECK_PFAD;
}

/* ----------------------------------------------------------
   Der Google-Kalender gehört einem Konto, nicht dem Haus. Wer ihn
   verbunden hat, darf ihn lesen und beschreiben; alle anderen nicht
   — sonst stünden Lucas Termine im Dashboard des Zweitkontos.

   Ist noch nichts verbunden, darf das erste Konto verbinden. Zwei
   getrennte Google-Zugänge kann diese Ablage noch nicht führen;
   dann bräuchte es eine Datei je Nutzer.
   ---------------------------------------------------------- */
router.use((req, res, next) => {
  if (!req.path.startsWith("/google")) return next();
  const g = require("../lib/google");
  const eigner = g.kalenderNutzer ? g.kalenderNutzer() : null;
  if (eigner ? eigner === req.nutzer.id : !!req.nutzer.verwalter) return next();
  res.status(403).json({ ok: false, fehler: "Der Kalender gehört einem anderen Konto" });
});

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
    /* Festhalten, wem der Kalender gehört — ein zweites Konto im Haus
       soll darüber weder lesen noch schreiben. */
    g.kalenderNutzerSetzen(req.nutzer.id);
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
  /* Wie bei der Bildschirmzeit: die Zähler stammen von den Geräten
     des ersten Kontos. */
  if (!req.nutzer.verwalter) return res.json({ ok: true, tage: {} });
  const von = typeof req.query.von === "string" ? req.query.von : null;
  res.json({ ok: true, tage: require("../lib/nutzung").verlauf(von) });
});

/* Bildschirmzeit dieses Rechners — gemessen, solange der Server läuft.

   Gemessen wird dieser eine Rechner und dieses eine Telefon; beide
   gehören dem, der das Dashboard aufgesetzt hat. Ein zweites Konto
   bekommt deshalb nichts davon zu sehen — sonst stünde dort fremde
   Zeit als die eigene. */
router.get("/bildschirmzeit", (req, res) => {
  if (!req.nutzer.verwalter) {
    return res.json({ aktiv: false, takt: 0, plattform: process.platform, fehler: null,
                      zuletzt: null, tage: {}, handy: {}, handyOffen: null, fremd: true });
  }
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

