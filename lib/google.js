/* ==========================================================
   LIFE OS // GOOGLE KALENDER
   Zwei Richtungen:

     Termine  Google → Dashboard.  Was im Google-Kalender steht,
              erscheint hier. Google ist dafür die Wahrheit; hier
              werden solche Termine nicht bearbeitet.

     Klausuren Dashboard → Google. Was du hier als Klausur
              einträgst, landet dort im Kalender. Für Klausuren ist
              das Dashboard die Wahrheit.

   Zwei Richtungen für dieselbe Sache wären eine Quelle ständiger
   Konflikte. Zwei Sachen, jede mit einer klaren Herkunft, sind
   verständlich und lassen sich reparieren.

   Der Abgleich läuft am Server, nicht im Browser: so bleibt er
   auch dann aktuell, wenn kein Gerät offen ist, und der Bestand
   verteilt ihn von selbst an iPad und Telefon.

   EINRICHTUNG (einmalig, siehe /api/google/status):
     data/google-zugang.json
     { "client_id": "…", "client_secret": "…" }
   ========================================================== */

const fs = require("fs");
const path = require("path");

const ORDNER = path.join(__dirname, "..", "data");
const ZUGANG = path.join(ORDNER, "google-zugang.json");
const TOKEN = path.join(ORDNER, "google-token.json");

const BEREICH = "https://www.googleapis.com/auth/calendar";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";

/* Wie weit der Blick reicht: ein Blick zurück fürs Nachtragen,
   ein halbes Jahr nach vorn für die Planung. */
const TAGE_ZURUECK = 14;
const TAGE_VORAUS = 180;

/* Termine aus Google tragen diese Kennung — daran erkennt der
   Abgleich seine eigenen Einträge wieder. */
const HERKUNFT = "google";

let letzterLauf = null;
let letzterFehler = null;

function lesen(datei) {
  try { return JSON.parse(fs.readFileSync(datei, "utf8")); }
  catch (fehler) { return null; }
}

function schreiben(datei, wert) {
  fs.mkdirSync(ORDNER, { recursive: true });
  fs.writeFileSync(datei, JSON.stringify(wert, null, 2), "utf8");
}

const zugang = () => lesen(ZUGANG);
const token = () => lesen(TOKEN);

const eingerichtet = () => {
  const z = zugang();
  return !!(z && z.client_id && z.client_secret);
};
const verbunden = () => {
  const t = token();
  return !!(t && t.refresh_token);
};

/* ---------- Anmeldung ---------- */

function anmeldeAdresse(rueckAdresse) {
  const z = zugang();
  if (!z) return null;
  const p = new URLSearchParams({
    client_id: z.client_id,
    redirect_uri: rueckAdresse,
    response_type: "code",
    scope: BEREICH,
    /* Ohne "offline" gäbe es kein Erneuerungs-Token — der Zugang
       wäre nach einer Stunde tot und müsste täglich neu bestätigt
       werden. */
    access_type: "offline",
    /* Erzwingt die Zustimmung auch beim zweiten Mal; nur dann
       schickt Google das Erneuerungs-Token erneut mit. */
    prompt: "consent"
  });
  return AUTH_URL + "?" + p.toString();
}

async function codeTauschen(code, rueckAdresse) {
  const z = zugang();
  if (!z) throw new Error("Kein Zugang hinterlegt");

  const antwort = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: z.client_id,
      client_secret: z.client_secret,
      redirect_uri: rueckAdresse,
      grant_type: "authorization_code"
    })
  });
  const daten = await antwort.json();
  if (!antwort.ok) throw new Error(daten.error_description || daten.error || "Anmeldung abgelehnt");

  schreiben(TOKEN, {
    access_token: daten.access_token,
    refresh_token: daten.refresh_token,
    laeuft_ab: Date.now() + (daten.expires_in || 3600) * 1000 - 60000,
    kalender: (token() || {}).kalender || "primary"
  });
  return true;
}

async function frischesToken() {
  const t = token();
  const z = zugang();
  if (!t || !z) throw new Error("Nicht verbunden");
  if (t.access_token && t.laeuft_ab && Date.now() < t.laeuft_ab) return t.access_token;
  if (!t.refresh_token) throw new Error("Kein Erneuerungs-Token — neu verbinden");

  const antwort = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: z.client_id,
      client_secret: z.client_secret,
      refresh_token: t.refresh_token,
      grant_type: "refresh_token"
    })
  });
  const daten = await antwort.json();
  if (!antwort.ok) throw new Error(daten.error_description || daten.error || "Erneuern abgelehnt");

  t.access_token = daten.access_token;
  t.laeuft_ab = Date.now() + (daten.expires_in || 3600) * 1000 - 60000;
  schreiben(TOKEN, t);
  return t.access_token;
}

async function ruf(pfad, optionen) {
  const zugriff = await frischesToken();
  const antwort = await fetch(API + pfad, {
    ...(optionen || {}),
    headers: {
      Authorization: "Bearer " + zugriff,
      "Content-Type": "application/json",
      ...((optionen || {}).headers || {})
    }
  });
  const text = await antwort.text();
  const daten = text ? JSON.parse(text) : {};
  if (!antwort.ok) {
    throw new Error((daten.error && daten.error.message) || ("HTTP " + antwort.status));
  }
  return daten;
}

/* Lesen und Schreiben sind getrennt: Termine dürfen aus mehreren
   Kalendern kommen — eigener und Familienkalender —, Klausuren gehen
   aber immer nur in einen. In einen fremden Kalender zu schreiben,
   nur weil man ihn sieht, wäre übergriffig.

   Ältere Token kennen nur ein einzelnes Feld `kalender`; das gilt
   dann für beides, damit nach einem Update nichts kaputt ist. */
const leseKalender = () => {
  const t = token() || {};
  const gewaehlt = (Array.isArray(t.lesen) && t.lesen.length)
    ? t.lesen : [t.kalender || "primary"];
  /* Wohin geschrieben wird, muss auch gelesen werden — sonst wäre
     eine Fahrstunde, die von hier in ihren Kalender wandert, dort
     zwar eingetragen, aber im Dashboard nicht mehr zu sehen. */
  const alle = new Set(gewaehlt);
  if (t.ziele) Object.values(t.ziele).forEach(id => { if (id) alle.add(id); });
  return [...alle];
};
const schreibKalender = () => {
  const t = token() || {};
  return t.schreiben || t.kalender || "primary";
};

/* ---------- Wohin was geschrieben wird ----------
   Nicht alles gehört in denselben Kalender: Klausuren und
   Hausaufgaben in „Schule", Fahrstunden in ihren eigenen, der Rest
   in den persönlichen. Fehlt eine Zuordnung, greift der allgemeine
   Schreibkalender — so läuft es auch ohne Einrichtung weiter. */
const ZIEL_ARTEN = ["klausur", "hausaufgabe", "fahrschule", "termin"];

const zieleLesen = () => {
  const t = token() || {};
  return (t.ziele && typeof t.ziele === "object") ? t.ziele : {};
};

const zielFuer = art => zieleLesen()[art] || schreibKalender();

function zieleSetzen(zuordnung) {
  const t = token();
  if (!t) return false;
  const neu = {};
  ZIEL_ARTEN.forEach(art => {
    const wert = (zuordnung || {})[art];
    if (wert) neu[art] = String(wert);
  });
  t.ziele = neu;
  schreiben(TOKEN, t);
  return true;
}

/* Alle Kalender, in die geschrieben wird — die müssen auch gelesen
   werden, sonst verschwindet der eigene Eintrag gleich wieder aus
   der Ansicht. */
function schreibZiele() {
  const raus = new Set([schreibKalender()]);
  Object.values(zieleLesen()).forEach(id => { if (id) raus.add(id); });
  return [...raus];
}

const kalenderId = (art) => encodeURIComponent(art ? zielFuer(art) : schreibKalender());

/* Nicht jeder Eintrag im Familienkalender ist ein Termin, an den
   erinnert werden muss: wiederkehrende Ortsmarken und Ferien füllen
   die Liste, ohne etwas zu sagen. Was hier steht, kommt gar nicht
   erst im Dashboard an — als Teil des Titels, Groß und Klein egal. */
const AUSBLENDEN_VORGABE = ["Steglitz", "Marienfelde", "Ferien"];

const ausblendListe = () => {
  const t = token() || {};
  return Array.isArray(t.ausblenden) ? t.ausblenden : AUSBLENDEN_VORGABE;
};

const wirdAusgeblendet = titel => {
  const t = String(titel || "").toLowerCase();
  return ausblendListe().some(m => m && t.includes(String(m).toLowerCase()));
};

/* Die Klausurdauern liegen im Browser. Der 15-Minuten-Takt am Server
   läuft aber auch ohne offenes Fenster — deshalb hebt er die zuletzt
   übermittelten auf. */
function dauernMerken(dauern) {
  const t = token();
  if (!t || !dauern || typeof dauern !== "object") return false;
  t.dauern = dauern;
  schreiben(TOKEN, t);
  return true;
}

const dauernLesen = () => (token() || {}).dauern || {};

function ausblendenSetzen(liste) {
  const t = token();
  if (!t) return false;
  t.ausblenden = (Array.isArray(liste) ? liste : [])
    .map(x => String(x || "").trim())
    .filter(Boolean);
  schreiben(TOKEN, t);
  return true;
}

/* ---------- Wann ist ein Termin ein Fahrschul-Termin? ----------
   Erkannt wird am Titel, weil man beim Eintragen ohnehin hinschreibt,
   worum es geht. Die Wortstämme decken die Beugungen mit ab:
   „Fahrstunde", „Fahrstunden", „2. Fahrstunde" — alles derselbe Fall.
   Die Liste steht auch im Browser (script.js), damit dort schon
   angezeigt werden kann, wohin ein Termin wandern wird. */
const FAHRSCHUL_WORTE = [
  "fahrschule", "fahrstunde", "fahrpruefung", "fahrprüfung",
  "theoriestunde", "theorieprüfung", "theoriepruefung",
  "führerschein", "fuehrerschein", "praktische prüfung",
  "sehtest", "erste hilfe kurs", "überlandfahrt", "ueberlandfahrt",
  "nachtfahrt", "autobahnfahrt"
];

function istFahrschule(titel) {
  const t = String(titel || "").toLowerCase();
  return FAHRSCHUL_WORTE.some(w => t.includes(w));
}

/* ---------- Google → Dashboard ---------- */

function alsDatum(d) { return d.toISOString(); }

/* Ein Google-Ereignis in einen Termin des Dashboards übersetzen.
   Ganztägige Ereignisse haben "date", terminierte "dateTime". */
function alsTermin(e, quelle) {
  const start = e.start || {};
  const iso = start.date || (start.dateTime || "").slice(0, 10);
  if (!iso) return null;
  const zeit = start.dateTime ? (start.dateTime.slice(11, 16)) : "";
  return {
    /* Die Kalender-Kennung gehört in die id: derselbe Termin kann in
       zwei Kalendern liegen und muss dann zweimal zählen dürfen. */
    id: "g" + (quelle ? kurzKennung(quelle) + "-" : "") + e.id,
    googleId: e.id,
    herkunft: HERKUNFT,
    kalender: quelle || "",
    title: e.summary || "Ohne Titel",
    date: iso,
    time: zeit,
    ort: e.location || ""
  };
}

/* Kalender-Adressen sind lang; für die id reicht der Anfang. */
const kurzKennung = id => String(id).replace(/[^a-z0-9]/gi, "").slice(0, 10);

async function ereignisseHolen() {
  const von = new Date(); von.setDate(von.getDate() - TAGE_ZURUECK);
  const bis = new Date(); bis.setDate(bis.getDate() + TAGE_VORAUS);

  const p = new URLSearchParams({
    timeMin: alsDatum(von),
    timeMax: alsDatum(bis),
    singleEvents: "true",          // Serien in Einzeltermine auflösen
    orderBy: "startTime",
    maxResults: "250"
  });

  /* Nacheinander statt gleichzeitig: Google mag keine Salven, und
     bei zwei bis drei Kalendern fällt der Unterschied nicht auf. */
  const alle = [];
  const gescheitert = [];
  let ausgeblendet = 0;
  for (const id of leseKalender()) {
    try {
      const daten = await ruf("/calendars/" + encodeURIComponent(id) + "/events?" + p.toString());
      (daten.items || [])
        .filter(e => e.status !== "cancelled")
        .forEach(e => {
          /* Was von hier stammt, kommt nicht als Termin zurück: die
             Klausur steht schon im Dashboard, und ein zweites Mal
             als Termin daneben wäre dieselbe Sache doppelt. */
          if (vonHier(e)) return;
          const t = alsTermin(e, id);
          if (!t) return;
          if (wirdAusgeblendet(t.title)) { ausgeblendet++; return; }
          alle.push(t);
        });
    } catch (fehler) {
      /* Ein Kalender, auf den der Zugriff fehlt, darf nicht den
         ganzen Abgleich kippen — die anderen kommen trotzdem an. */
      gescheitert.push(id.split("@")[0] + ": " + fehler.message);
    }
  }
  alle.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  return { termine: alle, gescheitert, ausgeblendet };
}

/* ---------- Dashboard → Google ---------- */

/* Eine Klausur als ganztägiges Ereignis. Ganztägig, weil die Stunde
   im Stundenplan steht und nicht doppelt gepflegt werden soll. */
/* Zeitzone für terminierte Ereignisse. Ohne Angabe legt Google sie
   in die Zone des Kalenders, was bei Reisen abweicht — hier steht
   der Schulalltag, und der ist deutsch. */
const ZONE = "Europe/Berlin";

/* Fällt eine eigene Angabe weg, dauert eine Klausur so lange */
const DAUER_VORGABE = 135;

const zeitPlus = (uhr, minuten) => {
  const [h, m] = String(uhr || "").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const gesamt = h * 60 + m + (Number(minuten) || 0);
  const hh = Math.floor(gesamt / 60) % 24;
  return String(hh).padStart(2, "0") + ":" + String(gesamt % 60).padStart(2, "0");
};

/* Aus Datum und Uhrzeit ein Google-Zeitfeld — fehlt die Uhrzeit,
   bleibt es ein ganztägiger Eintrag. */
const alsZeitpunkt = (datum, uhr) =>
  uhr ? { dateTime: datum + "T" + uhr + ":00", timeZone: ZONE } : null;

/* Aus „08:00–09:35" wird „08:00" — für Einträge, die vor der
   Zeitrechnung angelegt wurden und nur dieses Feld tragen. */
function beginnAus(zeit) {
  const erste = String(zeit || "").split(/[–-]/)[0].trim();
  return /^\d{1,2}:\d{2}$/.test(erste) ? erste.padStart(5, "0") : null;
}

function alsEreignis(k, fachName, art, dauern) {
  const welche = art || "klausur";

  /* Von wann bis wann: Beginn aus der Stunde, Ende je nach Art —
     bei einer Klausur nach ihrer Dauer, bei einer Hausaufgabe ist
     der Stundenbeginn der Zeitpunkt, an dem sie vorliegen muss.

     Ältere Einträge kennen startZeit noch nicht; bei denen steht die
     Uhrzeit im Feld „time", und die Dauer kommt aus den Angaben, die
     der Browser mitschickt. */
  const beginn = k.startZeit || beginnAus(k.time);
  const dauer = k.dauer
    || (welche === "klausur" ? (dauern && dauern[k.fach]) || DAUER_VORGABE : null);
  const schluss = k.endeZeit
    || (beginn && welche === "hausaufgabe" ? zeitPlus(beginn, 15) : null)
    || (beginn && dauer ? zeitPlus(beginn, dauer) : null);

  const start = alsZeitpunkt(k.date, beginn);
  const ende = (beginn && schluss) ? alsZeitpunkt(k.date, schluss) : null;

  const zeitfelder = (start && ende)
    ? { start, end: ende }
    : (() => {
        const tagDanach = new Date(k.date + "T00:00:00");
        tagDanach.setDate(tagDanach.getDate() + 1);   // Google zählt exklusiv
        return { start: { date: k.date }, end: { date: tagDanach.toISOString().slice(0, 10) } };
      })();

  const wasIstEs = welche === "hausaufgabe" ? "Hausaufgabe"
                 : welche === "fahrschule" ? "Fahrschule"
                 : welche === "klausur" ? "Klausur" : "Termin";

  return {
    summary: k.title,
    description: [
      fachName ? "Fach: " + fachName : "",
      k.raum ? "Raum: " + k.raum : "",
      welche === "klausur" && dauer ? "Dauer: " + dauer + " Minuten" : "",
      welche === "hausaufgabe" ? "Fällig zum Stundenbeginn" : "",
      wasIstEs + " aus dem Life OS Dashboard"
    ].filter(Boolean).join("\n"),
    ...zeitfelder,
    source: { title: "Life OS", url: "http://localhost:3000/#/lernen" },
    /* Die Kennung wandert mit ins Ereignis. Nur so lässt sich später
       erkennen, welcher Eintrag im Kalender wozu gehört — und damit
       auch, welcher zu etwas gehört, das es nicht mehr gibt. Google
       zeigt diese Felder niemandem an. */
    extendedProperties: {
      private: { lifeosArt: welche, lifeosId: String(k.id || "") }
    }
  };
}

/* Ist dieses Ereignis von hier angelegt worden? Die Kennung ist der
   sichere Weg; `source` fängt zusätzlich die Einträge ab, die vor
   der Kennung geschrieben wurden. */
function vonHier(e) {
  const p = (e.extendedProperties || {}).private || {};
  if (p.lifeosArt === "klausur") return true;
  return !!(e.source && e.source.title === "Life OS");
}

const klausurKennung = e => (((e.extendedProperties || {}).private) || {}).lifeosId || "";

/* Schreibt einen Eintrag in den Kalender, der zu seiner Art gehört.

   Ein Wechsel des Zielkalenders ist der heikle Fall: Google kann ein
   Ereignis nicht einfach umhängen, und ein PUT in den neuen Kalender
   ginge ins Leere, während im alten eine Leiche bliebe. Deshalb wird
   der alte Eintrag entfernt und ein neuer angelegt. */
async function eintragSchreiben(k, fachName, art, dauern) {
  const welche = art || "klausur";
  const ziel = kalenderId(welche);
  const koerper = JSON.stringify(alsEreignis(k, fachName, welche, dauern));

  if (k.googleId) {
    const alterOrt = k.googleKalender ? encodeURIComponent(k.googleKalender) : ziel;
    if (alterOrt === ziel) {
      try {
        await ruf("/calendars/" + ziel + "/events/" + encodeURIComponent(k.googleId),
                  { method: "PUT", body: koerper });
        return { id: k.googleId, kalender: zielFuer(welche) };
      } catch (fehler) {
        /* Im Kalender gelöscht: dann eben neu anlegen */
        if (!/404|not found|deleted/i.test(fehler.message)) throw fehler;
      }
    } else {
      /* Der Zielkalender hat sich geändert — drüben aufräumen */
      try {
        await ruf("/calendars/" + alterOrt + "/events/" + encodeURIComponent(k.googleId),
                  { method: "DELETE" });
      } catch (fehler) { /* war schon weg, auch gut */ }
    }
  }

  const neu = await ruf("/calendars/" + ziel + "/events", { method: "POST", body: koerper });
  return { id: neu.id, kalender: zielFuer(welche) };
}

/* Der alte Name bleibt für die Klausuren erhalten */
const klausurSchreiben = (k, fachName) => eintragSchreiben(k, fachName, "klausur");

/* ---------- Was hier gelöscht wurde, muss dort verschwinden ----------
   Eine Klausur, die aus dem Dashboard fliegt, hinterlässt sonst einen
   Eintrag im Kalender, den niemand mehr pflegt. Gesucht wird nur im
   Schreibkalender und nur nach Einträgen, die nachweislich von hier
   stammen — ein geteilter Kalender wird dabei nie angefasst. */
async function ereignisseIn(kalender) {
  const von = new Date(); von.setDate(von.getDate() - TAGE_ZURUECK);
  const bis = new Date(); bis.setDate(bis.getDate() + TAGE_VORAUS);

  const p = new URLSearchParams({
    timeMin: alsDatum(von),
    timeMax: alsDatum(bis),
    singleEvents: "true",
    maxResults: "250"
  });
  const daten = await ruf("/calendars/" + encodeURIComponent(kalender) + "/events?" + p.toString());
  return daten.items || [];
}

/* Der alte Name — jetzt der allgemeine Schreibkalender */
const ereignisseImSchreibkalender = () => ereignisseIn(schreibKalender());

/* Aufgeräumt wird in jedem Kalender, in den geschrieben wird: hat man
   das Ziel einer Art umgestellt, liegen Leichen auch im vorherigen. */
async function verwaisteAufraeumen(lebendig, alteIds) {
  let geloescht = 0;
  const namen = [];

  for (const kalender of schreibZiele()) {
    let liste;
    try { liste = await ereignisseIn(kalender); }
    catch (fehler) { continue; }               // kein Zugriff: den nächsten

    for (const e of liste) {
      if (e.status === "cancelled") continue;
      if (!vonHier(e)) continue;               // fremder Eintrag, Finger weg

      const kennung = klausurKennung(e);
      /* Mit Kennung: gibt es den Eintrag im Dashboard noch? Ohne
         Kennung (älterer Eintrag): hängt noch etwas an dieser
         Ereignis-Nummer? */
      const nochDa = kennung ? lebendig.has(kennung) : alteIds.has(e.id);

      /* Auch ein lebendiger Eintrag gehört weg, wenn er im falschen
         Kalender liegt: hat man das Ziel einer Art umgestellt, bleibt
         sonst am alten Ort eine Kopie stehen und die Klausur steht
         zweimal im Kalender. */
      const art = (((e.extendedProperties || {}).private) || {}).lifeosArt;
      const amFalschenOrt = nochDa && art && zielFuer(art) !== kalender;

      if (nochDa && !amFalschenOrt) continue;

      try {
        await ruf("/calendars/" + encodeURIComponent(kalender) + "/events/"
                  + encodeURIComponent(e.id), { method: "DELETE" });
        geloescht++;
        if (namen.length < 4) namen.push(e.summary || "Ohne Titel");
      } catch (fehler) {
        if (!/404|410|not found|deleted/i.test(fehler.message)) throw fehler;
      }
    }
  }
  return { geloescht, namen };
}

/* Löscht ein von hier angelegtes Ereignis wieder aus dem Kalender.
   Ist es dort schon weg, gilt das als erledigt. */
async function ereignisLoeschen(googleId) {
  if (!googleId) return false;
  try {
    await ruf("/calendars/" + kalenderId() + "/events/" + encodeURIComponent(googleId),
              { method: "DELETE" });
    return true;
  } catch (fehler) {
    if (/404|410|not found|deleted/i.test(fehler.message)) return true;
    throw fehler;
  }
}

/* ---------- Der Abgleich ---------- */

/* Der Bestand ist die gemeinsame Ablage aller Geräte — der Abgleich
   schreibt direkt dorthin, damit er auch ohne offenen Browser wirkt. */
function bestand() { return require("./bestand"); }

function holenAusBestand(schluessel, vorgabe) {
  const alles = bestand().alles();
  const e = alles[schluessel];
  return e && e.wert !== undefined && e.wert !== null ? e.wert : vorgabe;
}

/* Der Abgleich merkt sich selbst, wie er ausgegangen ist. Vorher tat
   das nur der 15-Minuten-Takt — ein von Hand oder direkt nach dem
   Verbinden gescheiterter Lauf blieb deshalb unsichtbar, und im
   Kasten stand weiter nur „Verbunden“, obwohl nichts ankam. */
async function abgleichen(fachNamen, dauern) {
  try {
    const ergebnis = await abgleichLauf(fachNamen, dauern);
    /* Ein Lauf kann im Ganzen gelingen und trotzdem an einer
       einzelnen Klausur hängen — das bleibt dann stehen. */
    letzterFehler = ergebnis.stolperte || null;
    letzterLauf = Date.now();
    return ergebnis;
  } catch (fehler) {
    letzterFehler = fehler.message;
    throw fehler;
  }
}

async function abgleichLauf(fachNamen, dauern) {
  if (!eingerichtet()) throw new Error("Nicht eingerichtet");
  if (!verbunden()) throw new Error("Nicht verbunden");

  /* --- 1. Klausuren → Google ---
     Erst schreiben, dann lesen. Andersherum liest der Lauf den Stand
     von vor seiner eigenen Änderung: eine verschobene Klausur stünde
     im Dashboard bis zum nächsten Lauf noch auf dem alten Datum. */
  const grenze = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const kommtNoch = e => e.date && e.date >= grenze;

  let geschrieben = 0;
  let stolperte = null;

  /* Drei Listen, ein Verfahren: jede Art kennt ihren Speicher, ihren
     Zielkalender und die Bedingung, unter der sie hinaus soll. */
  const klausuren = holenAusBestand("lifeos_klausuren", []) || [];
  const hausaufgaben = holenAusBestand("lifeos_hausaufgaben", []) || [];
  const eigeneTermine = holenAusBestand("lifeos_termine", []) || [];

  const gruppen = [
    { art: "klausur", schluessel: "lifeos_klausuren", liste: klausuren,
      raus: kommtNoch },
    /* Erledigte Hausaufgaben haben im Kalender nichts mehr verloren —
       sie fliegen beim Aufräumen von selbst wieder hinaus. */
    { art: "hausaufgabe", schluessel: "lifeos_hausaufgaben", liste: hausaufgaben,
      raus: h => kommtNoch(h) && !h.erledigt },
    /* Von Google geholte Termine gehen nicht zurück; nur was hier
       entstanden ist und nach Fahrschule aussieht. */
    { art: "fahrschule", schluessel: "lifeos_termine", liste: eigeneTermine,
      raus: t => kommtNoch(t) && t.herkunft !== HERKUNFT && istFahrschule(t.title) }
  ];

  for (const g of gruppen) {
    let veraendert = false;
    for (const e of g.liste) {
      if (!g.raus(e)) continue;
      try {
        const wo = await eintragSchreiben(e, fachNamen && fachNamen[e.fach], g.art, dauern);
        if (wo.id !== e.googleId || wo.kalender !== e.googleKalender) {
          e.googleId = wo.id;
          e.googleKalender = wo.kalender;
          veraendert = true;
        }
        geschrieben++;
      } catch (fehler) {
        stolperte = "„" + e.title + "“: " + fehler.message;
      }
    }
    if (veraendert) bestand().setzen(g.schluessel, g.liste, Date.now(), "google");
  }

  /* --- 1b. Gelöschtes auch dort löschen ---
     Erst nach dem Schreiben: so tragen die eben angelegten Einträge
     ihre Kennung schon, und das Aufräumen greift sie nicht auf. */
  let geloescht = 0, geloeschteNamen = [];
  try {
    const lebendig = new Set();
    gruppen.forEach(g => g.liste.forEach(e => { if (g.raus(e)) lebendig.add(String(e.id)); }));
    const alteIds = new Set();
    gruppen.forEach(g => g.liste.forEach(e => { if (e.googleId) alteIds.add(e.googleId); }));

    const weg = await verwaisteAufraeumen(lebendig, alteIds);
    geloescht = weg.geloescht;
    geloeschteNamen = weg.namen;
  } catch (fehler) {
    stolperte = "Aufräumen: " + fehler.message;
  }

  /* --- 2. Google → Termine --- */
  const geholt = await ereignisseHolen();
  const ausGoogle = geholt.termine;
  const termine = holenAusBestand("lifeos_termine", []) || [];

  /* Eigene Termine bleiben unangetastet; die aus Google werden
     ersetzt. Löscht du dort etwas, verschwindet es auch hier. */
  const eigene = termine.filter(t => t.herkunft !== HERKUNFT);
  const zusammen = eigene.concat(ausGoogle);

  const vorher = JSON.stringify(termine);
  const nachher = JSON.stringify(zusammen);
  if (vorher !== nachher) {
    bestand().setzen("lifeos_termine", zusammen, Date.now(), "google");
  }

  if (geholt.gescheitert.length) {
    stolperte = "Kalender nicht lesbar — " + geholt.gescheitert.join(" · ");
  }

  return { geholt: ausGoogle.length, geschrieben, stolperte,
           ausgeblendet: geholt.ausgeblendet,
           geloescht, geloeschteNamen };
}

/* ---------- Zustand ---------- */

function stand() {
  const t = token();
  return {
    eingerichtet: eingerichtet(),
    verbunden: verbunden(),
    kalender: (t || {}).kalender || "primary",
    lesen: t ? leseKalender() : [],
    schreiben: t ? schreibKalender() : "",
    ziele: zieleLesen(),
    zielArten: ZIEL_ARTEN,
    ausblenden: ausblendListe(),
    letzterLauf,
    letzterFehler
  };
}

function kalenderSetzen(wahl) {
  const t = token();
  if (!t) return false;
  const w = wahl || {};

  /* Ein einzelner String bleibt erlaubt — dann ist es der Kalender,
     in den geschrieben wird, und er wird auch gelesen. */
  if (typeof wahl === "string") {
    t.lesen = [wahl]; t.schreiben = wahl; t.kalender = wahl;
    schreiben(TOKEN, t);
    return true;
  }

  if (Array.isArray(w.lesen)) {
    t.lesen = w.lesen.filter(Boolean);
  }
  if (w.schreiben) t.schreiben = w.schreiben;

  /* Wohin geschrieben wird, muss auch gelesen werden — sonst
     verschwindet die eigene Klausur gleich wieder aus der Ansicht. */
  if (!t.lesen || !t.lesen.length) t.lesen = [schreibKalender()];
  if (t.schreiben && !t.lesen.includes(t.schreiben)) t.lesen.push(t.schreiben);

  t.kalender = t.schreiben || t.kalender || "primary";   // für ältere Stände
  schreiben(TOKEN, t);
  return true;
}

async function kalenderListe() {
  /* reader reicht zum Lesen — der Familienkalender ist oft nur
     geteilt, nicht beschreibbar. Was sich beschreiben lässt, sagt
     `schreibbar`; nur das darf als Ziel gewählt werden. */
  const daten = await ruf("/users/me/calendarList?minAccessRole=reader");
  return (daten.items || []).map(k => ({
    schreibbar: k.accessRole === "owner" || k.accessRole === "writer",
    id: k.id, name: k.summary, haupt: !!k.primary
  }));
}

function zugangSetzen(id, geheim) {
  /* Die Zugangsdaten kommen aus dem Formular in den Einstellungen.
     Sie bleiben auf diesem Rechner — hier wird nur die Datei
     geschrieben, die sonst von Hand angelegt werden müsste. */
  const kennung = String(id || "").trim();
  const schluessel = String(geheim || "").trim();
  if (!kennung || !schluessel) throw new Error("Client-ID und Secret dürfen nicht leer sein");
  if (!/\.apps\.googleusercontent\.com$/.test(kennung)) {
    throw new Error("Die Client-ID endet normalerweise auf .apps.googleusercontent.com — das sieht nach der falschen Zeile aus");
  }
  schreiben(ZUGANG, { client_id: kennung, client_secret: schluessel });
  letzterFehler = null;
  return true;
}

function trennen() {
  try { fs.unlinkSync(TOKEN); } catch (fehler) { /* war schon weg */ }
  letzterLauf = null;
  letzterFehler = null;
  return true;
}

/* ---------- Von selbst, alle 15 Minuten ---------- */
let takt = null;
function starten() {
  if (takt) return;
  const lauf = () => {
    if (!eingerichtet() || !verbunden()) return;
    abgleichen(null, dauernLesen()).catch(fehler => { letzterFehler = fehler.message; });
  };
  takt = setInterval(lauf, 15 * 60 * 1000);
  if (takt.unref) takt.unref();
  setTimeout(lauf, 8000);          // einmal kurz nach dem Start
}

module.exports = {
  eingerichtet, verbunden, stand, starten, zugangSetzen,
  anmeldeAdresse, codeTauschen, abgleichen, ereignisLoeschen,
  kalenderListe, kalenderSetzen, trennen, ausblendenSetzen,
  zieleSetzen, istFahrschule, FAHRSCHUL_WORTE, ZIEL_ARTEN,
  dauernMerken, dauernLesen,
  ereignisseImSchreibkalender, ereignisseIn,
  ZUGANG
};
