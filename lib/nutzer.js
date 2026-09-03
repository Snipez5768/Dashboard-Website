/* ==========================================================
   LIFE OS // NUTZER UND ANMELDUNG
   Bis hierher gehörte das Dashboard dem, der die Adresse kannte.
   Im Heimnetz war das vertretbar, aber es hieß auch: jeder im WLAN
   sieht Noten, Termine und Bildschirmzeit.

   Deshalb hier ein Konto mit Namen und Passwort. Was es leistet und
   was nicht, gehört an dieselbe Stelle wie der Code:

     Es leistet — dass niemand ohne Passwort an die Daten kommt,
     auch nicht über die Schnittstellen. Passwörter liegen nur als
     Prüfsumme vor, nicht im Klartext; wer die Datei liest, hat sie
     damit noch nicht.

     Es leistet nicht — Schutz gegen jemanden, der schon auf diesem
     Rechner sitzt. Wer den Ordner öffnen kann, kann die Dateien
     lesen. Das ist ein Heimserver, kein Tresor.

   Passwörter werden mit scrypt geprüft: absichtlich langsam, damit
   Durchprobieren teuer wird. Jedes bekommt sein eigenes Salz, damit
   zwei gleiche Passwörter verschiedene Prüfsummen ergeben.
   ========================================================== */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ORDNER = path.join(__dirname, "..", "data");
const DATEI = path.join(ORDNER, "nutzer.json");

/* Kosten für scrypt. Höher heißt sicherer und langsamer; 16384 ist
   der übliche Ausgangspunkt und braucht auf diesem Rechner rund
   eine Zehntelsekunde — für eine Anmeldung nicht spürbar, für
   Millionen Versuche unbezahlbar. */
const SCRYPT_N = 16384;
const SCHLUESSEL_LAENGE = 64;

/* Wie lange eine Anmeldung gilt. Lang, weil das iPad sonst ständig
   nachfragt — und weil die Sitzung an ein Gerät gebunden ist, das
   ohnehin im Heimnetz steht. */
const SITZUNG_TAGE = 90;

function lesen() {
  try { return JSON.parse(fs.readFileSync(DATEI, "utf8")); }
  catch (fehler) { return { nutzer: [], geheimnis: null }; }
}

function schreiben(daten) {
  fs.mkdirSync(ORDNER, { recursive: true });
  /* Erst daneben schreiben, dann umbenennen: bricht der Vorgang ab,
     bleibt die alte Datei heil statt halb überschrieben. */
  const vorlaeufig = DATEI + ".neu";
  fs.writeFileSync(vorlaeufig, JSON.stringify(daten, null, 2), "utf8");
  fs.renameSync(vorlaeufig, DATEI);
}

/* Das Geheimnis unterschreibt die Sitzungsmarken. Es entsteht beim
   ersten Start und bleibt liegen — wird es neu erzeugt, sind alle
   Anmeldungen ungültig. */
function geheimnis() {
  const daten = lesen();
  if (daten.geheimnis) return daten.geheimnis;
  daten.geheimnis = crypto.randomBytes(32).toString("hex");
  schreiben(daten);
  return daten.geheimnis;
}

/* ---------- Passwörter ---------- */

function huelle(passwort, salz) {
  return new Promise((fertig, schiefgegangen) => {
    crypto.scrypt(String(passwort), salz, SCHLUESSEL_LAENGE, { N: SCRYPT_N }, (fehler, ergebnis) => {
      if (fehler) return schiefgegangen(fehler);
      fertig(ergebnis.toString("hex"));
    });
  });
}

async function passwortSetzen(passwort) {
  const salz = crypto.randomBytes(16).toString("hex");
  return { salz, pruefsumme: await huelle(passwort, salz), art: "scrypt" };
}

async function passwortStimmt(passwort, konto) {
  if (!konto || !konto.salz || !konto.pruefsumme) return false;
  const geprueft = await huelle(passwort, konto.salz);
  /* Zeitgleicher Vergleich: ein einfaches === verrät über die
     Laufzeit, wie viele Zeichen gestimmt haben. */
  const a = Buffer.from(geprueft, "hex");
  const b = Buffer.from(konto.pruefsumme, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------- Konten ---------- */

const alleNutzer = () => (lesen().nutzer || []);
const gibtNutzer = () => alleNutzer().length > 0;

const nutzerNach = kennung =>
  alleNutzer().find(n => n.id === kennung
    || String(n.name).toLowerCase() === String(kennung).toLowerCase()) || null;

/* Aus „Luca B." wird „luca-b" — daraus entsteht der Dateiname des
   Bestands, deshalb streng auf Unverfängliches begrenzt. */
function alsKennung(name) {
  const roh = String(name || "").toLowerCase()
    .replace(/[äöüß]/g, z => ({ "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss" }[z]))
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return roh || ("nutzer-" + crypto.randomBytes(3).toString("hex"));
}

async function anlegen(name, passwort) {
  const sauber = String(name || "").trim();
  if (sauber.length < 2) throw new Error("Der Name braucht mindestens zwei Zeichen");
  if (String(passwort || "").length < 6) throw new Error("Das Passwort braucht mindestens sechs Zeichen");
  if (nutzerNach(sauber)) throw new Error("Diesen Namen gibt es schon");

  const daten = lesen();
  daten.nutzer = daten.nutzer || [];

  let id = alsKennung(sauber);
  while (daten.nutzer.some(n => n.id === id)) id += "-" + crypto.randomBytes(2).toString("hex");

  const konto = {
    id, name: sauber,
    ...(await passwortSetzen(passwort)),
    angelegt: new Date().toISOString(),
    /* Der erste im Haus darf später weitere anlegen */
    verwalter: daten.nutzer.length === 0
  };
  daten.nutzer.push(konto);
  schreiben(daten);
  return { id: konto.id, name: konto.name, verwalter: konto.verwalter };
}

async function pruefen(name, passwort) {
  const konto = nutzerNach(name);
  if (!konto) {
    /* Auch bei unbekanntem Namen rechnen, sonst verrät die
       Antwortzeit, welche Namen es gibt. */
    await huelle(passwort, "leerlauf");
    return null;
  }
  if (!(await passwortStimmt(passwort, konto))) return null;
  return { id: konto.id, name: konto.name, verwalter: !!konto.verwalter };
}

async function passwortAendern(id, altes, neues) {
  const daten = lesen();
  const konto = (daten.nutzer || []).find(n => n.id === id);
  if (!konto) throw new Error("Kein solches Konto");
  if (!(await passwortStimmt(altes, konto))) throw new Error("Das alte Passwort stimmt nicht");
  if (String(neues || "").length < 6) throw new Error("Das neue Passwort braucht mindestens sechs Zeichen");
  Object.assign(konto, await passwortSetzen(neues));
  schreiben(daten);
  return true;
}

function entfernen(id) {
  const daten = lesen();
  const vorher = (daten.nutzer || []).length;
  daten.nutzer = (daten.nutzer || []).filter(n => n.id !== id);
  schreiben(daten);
  return daten.nutzer.length < vorher;
}

/* ---------- Sitzungen ----------
   Die Marke trägt Kennung und Ablauf im Klartext und dahinter eine
   Unterschrift. Sie lässt sich lesen, aber nicht fälschen: ohne das
   Geheimnis passt die Unterschrift nicht. Damit braucht der Server
   keine Liste offener Sitzungen zu führen. */

function unterschreiben(inhalt) {
  return crypto.createHmac("sha256", geheimnis()).update(inhalt).digest("base64url");
}

function markeBauen(nutzerId) {
  const ablauf = Date.now() + SITZUNG_TAGE * 86400000;
  const inhalt = Buffer.from(JSON.stringify({ id: nutzerId, ablauf })).toString("base64url");
  return inhalt + "." + unterschreiben(inhalt);
}

function markeLesen(marke) {
  if (!marke || typeof marke !== "string") return null;
  const [inhalt, unterschrift] = marke.split(".");
  if (!inhalt || !unterschrift) return null;

  const soll = unterschreiben(inhalt);
  const a = Buffer.from(unterschrift);
  const b = Buffer.from(soll);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let daten;
  try { daten = JSON.parse(Buffer.from(inhalt, "base64url").toString("utf8")); }
  catch (fehler) { return null; }

  if (!daten.ablauf || Date.now() > daten.ablauf) return null;
  /* Konto zwischenzeitlich gelöscht? Dann gilt die Marke nicht mehr. */
  const konto = nutzerNach(daten.id);
  if (!konto) return null;
  return { id: konto.id, name: konto.name, verwalter: !!konto.verwalter };
}

module.exports = {
  gibtNutzer, alleNutzer, anlegen, pruefen, passwortAendern, entfernen,
  markeBauen, markeLesen, alsKennung,
  SITZUNG_TAGE
};
