/* ==========================================================
   LIFE OS // WLED
   Die Lichterketten hängen als eigene kleine Server im Netz und
   sprechen JSON über HTTP. Der Browser könnte sie theoretisch
   direkt fragen — praktisch nicht: das Dashboard läuft am iPad
   über HTTPS, und eine verschlüsselte Seite darf keine
   unverschlüsselten Anfragen stellen. Safari blockiert das
   wortlos.

   Deshalb geht alles über diese Stelle: der Server fragt die
   Geräte, der Browser fragt den Server. Nebenbei löst das zwei
   weitere Dinge — die Geräteliste ist auf allen Geräten dieselbe,
   und ein Gerät, das gerade nicht antwortet, blockiert nicht die
   ganze Seite.
   ========================================================== */

const fs = require("fs");
const path = require("path");

const ORDNER = path.join(__dirname, "..", "data");
const DATEI = path.join(ORDNER, "wled.json");

/* Lichter antworten im Heimnetz in Millisekunden. Wartet man länger,
   hängt die ganze Liste an einem Gerät, das gerade stromlos ist. */
const FRIST = 2500;
const SUCH_FRIST = 900;

function lesen() {
  try { return JSON.parse(fs.readFileSync(DATEI, "utf8")); }
  catch (fehler) { return { geraete: [] }; }
}

function schreiben(daten) {
  fs.mkdirSync(ORDNER, { recursive: true });
  fs.writeFileSync(DATEI, JSON.stringify(daten, null, 2), "utf8");
}

const geraete = () => (lesen().geraete || []);

/* ---------- Ein Gerät fragen ---------- */

async function ruf(ip, pfad, optionen, frist) {
  const abbruch = new AbortController();
  const uhr = setTimeout(() => abbruch.abort(), frist || FRIST);
  try {
    const antwort = await fetch("http://" + ip + pfad, {
      ...(optionen || {}),
      signal: abbruch.signal,
      headers: { "Content-Type": "application/json", ...((optionen || {}).headers || {}) }
    });
    if (!antwort.ok) throw new Error("HTTP " + antwort.status);
    const text = await antwort.text();
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(uhr);
  }
}

/* ---------- Suchen ----------
   Reihum alle Adressen des eigenen Netzes durchprobieren. Das
   klingt grob, ist im Heimnetz aber der zuverlässigste Weg: mDNS
   bräuchte ein weiteres Paket, und die Geräte haben oft keine
   festen Namen. In Häppchen, damit nicht 254 Anfragen gleichzeitig
   losgehen. */
function eigenesNetz() {
  const os = require("os");
  const raus = [];
  Object.values(os.networkInterfaces()).forEach(liste =>
    (liste || []).forEach(a => {
      if (a.family !== "IPv4" || a.internal) return;
      raus.push(a.address.split(".").slice(0, 3).join(".") + ".");
    }));
  return [...new Set(raus)];
}

async function suchen() {
  const gefunden = [];
  for (const basis of eigenesNetz()) {
    const alle = [];
    for (let i = 1; i < 255; i++) alle.push(basis + i);

    const haeppchen = 24;
    for (let s = 0; s < alle.length; s += haeppchen) {
      const teil = alle.slice(s, s + haeppchen);
      const ergebnis = await Promise.all(teil.map(async ip => {
        try {
          const info = await ruf(ip, "/json/info", null, SUCH_FRIST);
          if (!info || info.brand !== "WLED") return null;
          return { ip, name: info.name || ip, lichter: (info.leds || {}).count || 0,
                   version: info.ver || "" };
        } catch (fehler) { return null; }
      }));
      ergebnis.filter(Boolean).forEach(g => gefunden.push(g));
    }
  }
  gefunden.sort((a, b) => a.name.localeCompare(b.name, "de"));
  return gefunden;
}

/* Gefundene übernehmen, ohne die Reihenfolge zu verlieren, die man
   sich eingerichtet hat: Bekanntes bleibt stehen, Neues kommt ans
   Ende, Verschwundenes bleibt (vielleicht ist es nur aus). */
function uebernehmen(gefunden) {
  const daten = lesen();
  const alt = daten.geraete || [];
  const nachIp = new Map(alt.map(g => [g.ip, g]));

  gefunden.forEach(g => {
    const da = nachIp.get(g.ip);
    if (da) { da.name = g.name; da.lichter = g.lichter; da.version = g.version; }
    else alt.push({ ip: g.ip, name: g.name, lichter: g.lichter, version: g.version });
  });

  daten.geraete = alt;
  schreiben(daten);
  return alt;
}

function hinzufuegen(ip, name) {
  const daten = lesen();
  daten.geraete = daten.geraete || [];
  if (daten.geraete.some(g => g.ip === ip)) return daten.geraete;
  daten.geraete.push({ ip, name: name || ip, lichter: 0, version: "" });
  schreiben(daten);
  return daten.geraete;
}

function entfernen(ip) {
  const daten = lesen();
  daten.geraete = (daten.geraete || []).filter(g => g.ip !== ip);
  schreiben(daten);
  return daten.geraete;
}

function umbenennen(ip, name) {
  const daten = lesen();
  const g = (daten.geraete || []).find(x => x.ip === ip);
  if (!g) return false;
  g.name = String(name || "").trim() || g.ip;
  schreiben(daten);
  return true;
}

/* ---------- Zustand ----------
   Geholt wird nur, was die Bedienung braucht: an/aus, Helligkeit,
   Effekt, Palette, die drei Farben des ersten Segments. Der Rest
   der WLED-Antwort ist umfangreich und hier ohne Nutzen. */
function knapp(voll, ip, name) {
  const s = voll.state || {};
  const seg = (s.seg || [])[0] || {};
  return {
    ip, name: (voll.info || {}).name || name || ip,
    da: true,
    an: !!s.on,
    helligkeit: s.bri || 0,
    effekt: seg.fx || 0,
    palette: seg.pal || 0,
    tempo: seg.sx == null ? 128 : seg.sx,
    staerke: seg.ix == null ? 128 : seg.ix,
    farben: (seg.col || []).slice(0, 3).map(c => Array.isArray(c) ? c.slice(0, 3) : [0, 0, 0]),
    lichter: ((voll.info || {}).leds || {}).count || 0
  };
}

async function zustand(ip, name) {
  try {
    const voll = await ruf(ip, "/json");
    return knapp(voll, ip, name);
  } catch (fehler) {
    /* Nicht erreichbar ist kein Fehler, sondern ein Zustand: das
       Licht hängt vielleicht an einer Steckdose, die aus ist. */
    return { ip, name: name || ip, da: false, grund: fehler.message,
             an: false, helligkeit: 0, effekt: 0, palette: 0, farben: [] };
  }
}

async function alleZustaende() {
  const liste = geraete();
  return Promise.all(liste.map(g => zustand(g.ip, g.name)));
}

/* Effekte und Paletten sind je Gerät gleich benannt, unterscheiden
   sich aber je nach Firmware in der Anzahl. Sie werden deshalb pro
   Gerät geholt — aber nur einmal und dann behalten, denn sie ändern
   sich nur bei einem Firmware-Wechsel. */
const listenSpeicher = new Map();

async function listen(ip) {
  if (listenSpeicher.has(ip)) return listenSpeicher.get(ip);
  const [effekte, paletten] = await Promise.all([
    ruf(ip, "/json/effects"),
    ruf(ip, "/json/palettes")
  ]);
  const raus = { effekte: effekte || [], paletten: paletten || [] };
  listenSpeicher.set(ip, raus);
  return raus;
}

/* ---------- Setzen ----------
   Es wird nur geschickt, was sich ändern soll — WLED übernimmt den
   Rest unverändert. Das hält die Übertragung klein und verhindert,
   dass eine Einstellung aus Versehen zurückgesetzt wird. */
async function setzen(ip, wunsch) {
  const zustandNeu = {};
  const seg = {};

  if (wunsch.an != null) zustandNeu.on = !!wunsch.an;
  if (wunsch.umschalten) zustandNeu.on = "t";           // WLED kennt "toggle"
  if (wunsch.helligkeit != null) zustandNeu.bri = klemm(wunsch.helligkeit, 0, 255);
  if (wunsch.effekt != null) seg.fx = Math.max(0, Number(wunsch.effekt) | 0);
  if (wunsch.palette != null) seg.pal = Math.max(0, Number(wunsch.palette) | 0);
  if (wunsch.tempo != null) seg.sx = klemm(wunsch.tempo, 0, 255);
  if (wunsch.staerke != null) seg.ix = klemm(wunsch.staerke, 0, 255);

  if (Array.isArray(wunsch.farben) && wunsch.farben.length) {
    seg.col = wunsch.farben.slice(0, 3).map(c =>
      Array.isArray(c) ? c.slice(0, 3).map(n => klemm(n, 0, 255)) : [0, 0, 0]);
  }

  /* Ein leeres Segment würde WLED als „alle Segmente löschen"
     verstehen — deshalb nur mitschicken, wenn etwas drinsteht. */
  if (Object.keys(seg).length) zustandNeu.seg = [{ id: 0, ...seg }];
  if (!Object.keys(zustandNeu).length) return null;

  const antwort = await ruf(ip, "/json/state", {
    method: "POST",
    body: JSON.stringify(zustandNeu)
  });
  return antwort;
}

const klemm = (n, min, max) => Math.min(max, Math.max(min, Math.round(Number(n) || 0)));

/* Alle auf einmal — für „alles aus" beim Verlassen des Hauses */
async function alleSetzen(wunsch) {
  const liste = geraete();
  const ergebnis = await Promise.all(liste.map(async g => {
    try { await setzen(g.ip, wunsch); return { ip: g.ip, ok: true }; }
    catch (fehler) { return { ip: g.ip, ok: false, grund: fehler.message }; }
  }));
  return ergebnis;
}

module.exports = {
  geraete, suchen, uebernehmen, hinzufuegen, entfernen, umbenennen,
  zustand, alleZustaende, listen, setzen, alleSetzen
};
