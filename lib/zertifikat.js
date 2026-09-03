/* ==========================================================
   LIFE OS // ZERTIFIKAT
   Service Worker — und damit der Offline-Betrieb der Website-App —
   gibt es nur in einem "sicheren Kontext". Das ist HTTPS oder
   localhost. Am Rechner reicht deshalb http://localhost, auf dem
   iPad aber nicht: dort läuft die Seite über die Netzadresse
   (http://192.168.x.x), und Safari stellt weder navigator.
   serviceWorker noch caches bereit. Offline ist dort schlicht
   unmöglich, egal wie die App gebaut ist.

   Also HTTPS. Ein Zertifikat von außen gibt es für eine private
   Adresse nicht, deshalb wird hier eins selbst ausgestellt:

     Wurzel  — "Life OS Lokal", einmal auf dem iPad installieren
     Server  — für die aktuellen Netzadressen, von der Wurzel
               unterschrieben

   Zwei Stück, weil iOS eine selbst unterschriebene Wurzel als
   Vertrauensanker akzeptiert, ein einzelnes Blatt aber nicht
   zuverlässig. Ändert der Router die Adresse, wird das
   Serverzertifikat automatisch neu ausgestellt — die Wurzel
   bleibt, sie muss also nur einmal aufs Gerät.
   ========================================================== */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const ORDNER = path.join(__dirname, "..", "data", "zertifikate");
const WURZEL_KEY = path.join(ORDNER, "wurzel-schluessel.pem");
const WURZEL_CRT = path.join(ORDNER, "wurzel.pem");
const SERVER_KEY = path.join(ORDNER, "server-schluessel.pem");
const SERVER_CRT = path.join(ORDNER, "server.pem");
const MERKE      = path.join(ORDNER, "adressen.json");

/* iOS nimmt seit Version 13 keine Serverzertifikate mehr an, die
   länger als 825 Tage gelten. */
const TAGE_SERVER = 800;
const TAGE_WURZEL = 3650;

function netzAdressen() {
  const raus = ["127.0.0.1"];
  Object.values(os.networkInterfaces()).flat()
    .filter(n => n && n.family === "IPv4" && !n.internal)
    .filter(n => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(n.address))
    .forEach(n => { if (!raus.includes(n.address)) raus.push(n.address); });
  return raus;
}

/* Wo openssl stecken kann. Der Suchpfad eines per Doppelklick
   gestarteten Servers ist oft kürzer als der einer Eingabe-
   aufforderung — deshalb werden die üblichen Orte mitgeprüft. */
const OPENSSL_ORTE = [
  "openssl",
  "C:/Program Files/Git/mingw64/bin/openssl.exe",
  "C:/Program Files/Git/usr/bin/openssl.exe",
  "C:/Program Files (x86)/Git/mingw64/bin/openssl.exe",
  "C:/Program Files/OpenSSL-Win64/bin/openssl.exe"
];
let opensslPfad = null;

function openssl(args, eingabe) {
  return execFileSync(opensslPfad || "openssl", args, {
    input: eingabe,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });
}

function openSslDa() {
  if (opensslPfad) return true;
  for (const ort of OPENSSL_ORTE) {
    try {
      execFileSync(ort, ["version"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      opensslPfad = ort;
      return true;
    } catch (fehler) { /* nächster Ort */ }
  }
  return false;
}

function wurzelAnlegen() {
  if (fs.existsSync(WURZEL_KEY) && fs.existsSync(WURZEL_CRT)) return;
  openssl([
    "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes",
    "-days", String(TAGE_WURZEL),
    "-keyout", WURZEL_KEY, "-out", WURZEL_CRT,
    "-subj", "/CN=Life OS Lokal/O=Life OS",
    "-addext", "basicConstraints=critical,CA:true,pathlen:0",
    "-addext", "keyUsage=critical,keyCertSign,cRLSign"
  ]);
}

function serverAnlegen(adressen) {
  const san = adressen.map(a => "IP:" + a).concat(["DNS:localhost"]).join(",");
  const anfrage = path.join(ORDNER, "anfrage.csr");
  const zusatz = path.join(ORDNER, "zusatz.cnf");

  fs.writeFileSync(zusatz,
    "subjectAltName=" + san + "\n" +
    "extendedKeyUsage=serverAuth\n" +
    "basicConstraints=critical,CA:false\n" +
    "keyUsage=critical,digitalSignature,keyEncipherment\n", "utf8");

  openssl([
    "req", "-new", "-newkey", "rsa:2048", "-nodes",
    "-keyout", SERVER_KEY, "-out", anfrage,
    "-subj", "/CN=" + (adressen[1] || adressen[0]) + "/O=Life OS"
  ]);

  openssl([
    "x509", "-req", "-in", anfrage,
    "-CA", WURZEL_CRT, "-CAkey", WURZEL_KEY, "-CAcreateserial",
    "-out", SERVER_CRT, "-days", String(TAGE_SERVER), "-sha256",
    "-extfile", zusatz
  ]);

  try { fs.unlinkSync(anfrage); fs.unlinkSync(zusatz); } catch (e) { /* egal */ }
  fs.writeFileSync(MERKE, JSON.stringify(adressen), "utf8");
}

/* Passt das vorhandene Serverzertifikat noch zu den Adressen, die
   der Rechner gerade hat? */
function passtNoch(adressen) {
  if (!fs.existsSync(SERVER_KEY) || !fs.existsSync(SERVER_CRT)) return false;
  try {
    const alt = JSON.parse(fs.readFileSync(MERKE, "utf8"));
    if (!Array.isArray(alt)) return false;
    return adressen.every(a => alt.includes(a)) && alt.every(a => adressen.includes(a));
  } catch (fehler) { return false; }
}

/* Liefert { key, cert, wurzelPfad, adressen } oder null, wenn kein
   Zertifikat gebaut werden kann. Der Server läuft dann eben nur
   über HTTP weiter — ohne Offline-Betrieb, aber ohne Absturz. */
function bereitstellen() {
  const adressen = netzAdressen();

  /* Liegt schon ein passendes Zertifikat da, wird openssl gar nicht
     gebraucht. Das ist der Normalfall — vorher stand die Prüfung auf
     openssl davor, und wenn das Programm im Suchpfad des Servers
     fehlte, blieb HTTPS aus, obwohl alles Nötige längst auf der
     Platte lag. */
  try {
    if (passtNoch(adressen) && fs.existsSync(WURZEL_CRT)) {
      return {
        key: fs.readFileSync(SERVER_KEY),
        cert: fs.readFileSync(SERVER_CRT),
        wurzelPfad: WURZEL_CRT,
        adressen: adressen.filter(a => a !== "127.0.0.1")
      };
    }
  } catch (fehler) {
    console.warn("  [HTTPS] vorhandenes Zertifikat unlesbar:", fehler.message);
  }

  /* Sonst muss eins ausgestellt werden — dafür braucht es openssl. */
  try {
    if (!openSslDa()) {
      console.warn("  [HTTPS] openssl nicht gefunden — die Seite läuft nur über HTTP.");
      console.warn("  [HTTPS] Ohne HTTPS gibt es auf dem iPad keinen Offline-Betrieb.");
      return null;
    }
    fs.mkdirSync(ORDNER, { recursive: true });
    wurzelAnlegen();
    serverAnlegen(adressen);
    console.log("  [HTTPS] Zertifikat für " + adressen.join(", ") + " ausgestellt.");
    return {
      key: fs.readFileSync(SERVER_KEY),
      cert: fs.readFileSync(SERVER_CRT),
      wurzelPfad: WURZEL_CRT,
      adressen: adressen.filter(a => a !== "127.0.0.1")
    };
  } catch (fehler) {
    console.warn("  [HTTPS] Zertifikat konnte nicht erstellt werden:", fehler.message);
    return null;
  }
}

module.exports = { bereitstellen, WURZEL_CRT };
