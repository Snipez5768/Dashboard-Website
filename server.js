/* ==========================================================
   LIFE OS // DASHBOARD — server.js
   Kleiner Express-Server: liefert die Website aus public/ aus
   und stellt unter /api/... Platz für zukünftige Backend-Logik
   bereit (z.B. echte Kalender-Anbindung, geräteübergreifender
   Sync, Wetter-Proxy, ...).
   ========================================================== */

const express = require("express");
const path = require("path");
const net = require("net");

const app = express();

/* Die Wunschports. Ist einer belegt, rückt der Server eine Stelle
   weiter — deshalb "let": am Ende steht hier der Port, auf dem er
   wirklich hört. */
let PORT = Number(process.env.PORT) || 3000;
let PORT_HTTPS = Number(process.env.PORT_HTTPS) || 3443;
let LIVERELOAD_PORT = Number(process.env.LIVERELOAD_PORT) || 35729;

/* So viele Stellen weiter wird höchstens gesucht. Mehr als das
   heißt: da stimmt etwas anderes nicht. */
const PORT_SPANNE = 12;

const isDev = process.env.NODE_ENV !== "production";

let httpServer = null;
let httpsServer = null;
let lrServer = null;

/* Prüft, ob ein Port frei ist — ohne den Prozess zu beenden, falls nicht. */
function portIstFrei(port) {
  return new Promise(resolve => {
    const test = net.createServer();
    test.once("error", () => resolve(false));
    test.once("listening", () => test.close(() => resolve(true)));
    // ohne Host-Angabe, damit IPv4 UND IPv6 geprüft werden — genau so
    // bindet auch livereload, sonst meldet der Test faelschlich "frei"
    test.listen(port);
  });
}

/* Den ersten freien Port ab "wunsch" suchen. Nur für Dinge, die man
   nicht selbst zum Hören bringt — für die eigenen Server ist
   "hoeren" unten der bessere Weg, weil dort zwischen Prüfung und
   Belegung nichts dazwischenkommen kann. */
async function freierPort(wunsch, spanne) {
  for (let i = 0; i <= (spanne || PORT_SPANNE); i++) {
    if (await portIstFrei(wunsch + i)) return wunsch + i;
  }
  return null;
}

/* Einen Server zum Hören bringen und dabei ausweichen, wenn der Port
   belegt ist.

   Bewusst über den Fehler statt über eine Vorabprüfung: zwischen
   "ist frei" und "hört jetzt" liegt ein Moment, in dem sich jemand
   anderes den Port nehmen kann. Wer den Fehler abfängt, hat dieses
   Loch nicht. */
function hoeren(server, wunsch, spanne) {
  return new Promise((fertig, schiefgehen) => {
    let versuch = 0;

    const beiFehler = err => {
      if (err.code === "EADDRINUSE" && versuch < (spanne || PORT_SPANNE)) {
        versuch++;
        server.listen(wunsch + versuch);
        return;
      }
      aufraeumen();
      schiefgehen(err);
    };
    const beiErfolg = () => {
      aufraeumen();
      fertig(server.address().port);
    };
    function aufraeumen() {
      server.removeListener("error", beiFehler);
      server.removeListener("listening", beiErfolg);
    }

    server.on("error", beiFehler);
    server.on("listening", beiErfolg);
    server.listen(wunsch);
  });
}

/* Was ausgewichen ist, steht am Ende gesammelt im Terminal — eine
   Zeile mitten im Startgerede übersieht man. */
const ausgewichen = [];
function portMerken(name, wunsch, jetzt) {
  if (wunsch !== jetzt) ausgewichen.push({ name, wunsch, jetzt });
}

async function start() {
  /* --- Live-Reload nur im Dev-Betrieb --------------------------------
     Früher hat ein belegter Live-Reload-Port den kompletten Server
     abstürzen lassen. Jetzt wird der Port vorher geprüft und der
     Server läuft notfalls einfach ohne Live-Reload weiter. */
  if (isDev) {
    /* Live-Reload bringt sich selbst zum Hören — hier hilft nur die
       Vorabsuche. Findet sie nichts, läuft der Server ohne. */
    const lrWunsch = LIVERELOAD_PORT;
    const lrFrei = await freierPort(lrWunsch, 6);
    if (lrFrei) {
      LIVERELOAD_PORT = lrFrei;
      portMerken("Live-Reload", lrWunsch, lrFrei);
      try {
        const livereload = require("livereload");
        const connectLivereload = require("connect-livereload");

        lrServer = livereload.createServer({
          exts: ["html", "css", "js"],
          port: LIVERELOAD_PORT
        });

        // Faengt spaete Fehler ab, statt den Prozess zu beenden. Wichtig:
        // livereload meldet Fehler auf dem Server-Objekt selbst, nicht auf
        // lrServer.server — dort registriert liefe der Handler ins Leere.
        lrServer.on("error", err => {
          console.warn(`  [Live-Reload] ${err.code || err.message} — läuft ohne Live-Reload weiter.`);
          lrServer = null;
        });

        lrServer.watch(path.join(__dirname, "public"));
        // kleine Verzögerung, damit der erste Reload nicht sofort beim Start feuert
        lrServer.server.once("connection", () => {
          setTimeout(() => lrServer.refresh("/"), 100);
        });

        /* Die Kennung im Browser muss denselben Port kennen —
           sonst horcht die Seite auf 35729, während der Server
           längst woanders sitzt. */
        app.use(connectLivereload({ port: LIVERELOAD_PORT }));
      } catch (err) {
        console.warn(`  [Live-Reload] konnte nicht starten (${err.message}) — läuft ohne weiter.`);
        lrServer = null;
      }
    } else {
      console.warn(
        `  [Live-Reload] Ab Port ${lrWunsch} ist nichts frei — die Seite lädt sich nicht\n` +
        `  automatisch neu. Meist läuft noch ein alter Server: dev-server.bat\n` +
        `  einmal neu starten räumt das auf.\n`
      );
    }
  }

  /* ==========================================================
     NUR AUS DEM EIGENEN NETZ
     Die Seite soll vom iPad im WLAN erreichbar sein, aber von
     nirgendwo sonst. Deshalb kommt hier eine Wache vor alles
     andere: sie laesst nur Adressen aus den privaten Bereichen
     durch, die ein Heimnetz vergibt.

       127.x / ::1        derselbe Rechner
       10.x               privat
       172.16.x-172.31.x  privat
       192.168.x          privat (der uebliche Fall)
       169.254.x / fe80:  Direktverbindung ohne Router
       fc00::/7           privat unter IPv6

     Alles andere bekommt eine kurze Absage. Das schuetzt auch dann
     noch, wenn im Router versehentlich eine Portfreigabe steht.
     ========================================================== */
  function ausHeimnetz(adresse) {
    let a = String(adresse || "");
    if (a.startsWith("::ffff:")) a = a.slice(7);     // IPv4 in IPv6-Schreibweise
    if (a === "::1" || a === "localhost") return true;
    if (/^127\./.test(a)) return true;
    if (/^10\./.test(a)) return true;
    if (/^192\.168\./.test(a)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(a)) return true;
    if (/^169\.254\./.test(a)) return true;         // ohne Router vergeben
    if (/^fe[89ab][0-9a-f]:/i.test(a)) return true;  // link-local IPv6
    if (/^f[cd][0-9a-f]{2}:/i.test(a)) return true;  // privat IPv6
    return false;
  }

  app.set("trust proxy", false);   // keine fremden Kopfzeilen glauben
  app.use((req, res, next) => {
    if (ausHeimnetz(req.socket.remoteAddress)) return next();
    console.warn("  Abgewiesen (nicht im Heimnetz):", req.socket.remoteAddress, req.url);
    res.status(403).type("text/plain; charset=utf-8")
       .send("Dieses Dashboard ist nur im eigenen Netz erreichbar.");
  });

  /* ==========================================================
     VOM WLAN AUS IMMER ÜBER HTTPS
     Ein Service Worker — und damit die App, die ohne Rechner
     startet — gibt es nur im "sicheren Kontext": HTTPS oder
     localhost. Wer die Seite am iPad über die Netzadresse ohne
     Verschlüsselung öffnet, bekommt von Safari keinen
     Zwischenspeicher; legt man sie so auf den Home-Bildschirm, ist
     nichts gespeichert und die App bleibt leer, sobald der Rechner
     aus ist. Sie läuft dann nur, solange man sie bei laufendem
     Server gestartet hat.

     Ein Hinweis allein reicht dagegen nicht — man kann ihn
     wegklicken und die Adresse trotzdem ablegen. Deshalb führt
     hier gar kein Weg mehr an HTTPS vorbei.

     Ausgenommen bleibt localhost: dort gilt HTTP ohnehin als
     sicher, und die Google-Anmeldung kommt genau dorthin zurück. */
  app.use((req, res, next) => {
    const verschluesselt = req.secure || (req.socket && req.socket.encrypted);
    if (verschluesselt || !global.lifeosHttps || !global.lifeosHttps.an) return next();

    const host = String(req.headers.host || "").split(":")[0];
    if (/^(localhost|127\.0\.0\.1|\[?::1\]?)$/.test(host)) return next();

    /* Das Wurzelzertifikat muss über HTTP erreichbar bleiben: es
       ist die Voraussetzung dafür, dass das iPad der sicheren
       Adresse überhaupt traut. Würde es dorthin umgeleitet, käme
       man nie hin — man bräuchte das Zertifikat, um das Zertifikat
       zu holen. Ein öffentlicher Schlüssel, kein Geheimnis. */
    if (req.path === "/life-os-wurzel.crt") return next();

    res.redirect(308, "https://" + host + ":" + global.lifeosHttps.port + req.originalUrl);
  });

  app.use(express.json());

  /* Bildschirmzeit dieses Rechners mitschreiben. Läuft nur unter
     Windows und nur, solange der Server läuft. */
  const bildschirmzeit = require("./lib/bildschirmzeit");
  bildschirmzeit.starten();

  /* Google-Kalender im Hintergrund abgleichen, sobald er eingerichtet ist */
  try { require("./lib/google").starten(); } catch (fehler) { console.warn("  [Google]", fehler.message); }

  // --- API-Routen (heute nur ein Health-Check, hier wächst später mehr rein) ---
  app.use("/api", require("./routes/api"));

  /* ==========================================================
     ZERTIFIKAT FÜRS iPAD
     Einmal aufrufen, Profil installieren, dann unter
     Einstellungen → Allgemein → Info → Zertifikatsvertrauens-
     einstellungen das Häkchen setzen. Danach kennt das iPad die
     Wurzel "Life OS Lokal" und https://<Adresse>:3443 gilt als
     sicher — erst damit gibt es Service Worker und Offline.
     ========================================================== */
  app.get("/life-os-wurzel.crt", (req, res) => {
    const fsx = require("fs");
    const zert = require("./lib/zertifikat");
    if (!fsx.existsSync(zert.WURZEL_CRT)) {
      return res.status(404).type("text/plain; charset=utf-8")
        .send("Es wurde noch kein Zertifikat erstellt.");
    }
    /* Dieser MIME-Typ bringt iOS dazu, das Profil anzubieten */
    res.type("application/x-x509-ca-cert");
    res.setHeader("Content-Disposition", 'attachment; filename="life-os-wurzel.crt"');
    res.send(fsx.readFileSync(zert.WURZEL_CRT));
  });

  // --- Statische Website ---
  // Im Dev-Betrieb ohne Zwischenspeicher ausliefern: sonst zeigt der
  // Browser nach einer Änderung weiter die alte CSS bzw. das alte Skript,
  // obwohl der Server längst die neue Fassung hat.
  app.use(express.static(path.join(__dirname, "public"), isDev ? {
    etag: false,
    lastModified: false,
    cacheControl: false,
    setHeaders(res) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
  } : {}));

  /* ==========================================================
     HTTPS NEBEN HTTP
     Am Rechner reicht http://localhost — localhost gilt dem
     Browser ohnehin als sicher. Das iPad kommt aber über die
     Netzadresse, und dort ist einfaches HTTP kein sicherer
     Kontext: Safari stellt weder navigator.serviceWorker noch
     caches bereit, die App kann also gar nicht offline laufen.
     Deshalb hier zusätzlich HTTPS mit selbst ausgestelltem
     Zertifikat.

     HTTP bleibt bestehen — zum Herunterladen des Zertifikats und
     als Rückfall, falls mit HTTPS etwas klemmt.
     ========================================================== */
  global.lifeosHttps = { an: false, grund: "wird eingerichtet" };
  const zertifikat = require("./lib/zertifikat").bereitstellen();
  if (!zertifikat) {
    global.lifeosHttps = { an: false, grund: "kein Zertifikat" };
  } else {
    try {
      httpsServer = require("https")
        .createServer({ key: zertifikat.key, cert: zertifikat.cert }, app);
      const httpsWunsch = PORT_HTTPS;
      try {
        PORT_HTTPS = await hoeren(httpsServer, httpsWunsch);
        portMerken("HTTPS", httpsWunsch, PORT_HTTPS);
        global.lifeosHttps = { an: true, port: PORT_HTTPS, adressen: zertifikat.adressen };
        /* Ab jetzt darf ein später Fehler den Zustand noch umwerfen,
           aber nicht mehr den Start. */
        httpsServer.on("error", err => {
          const grund = err.code || err.message;
          console.warn("  [HTTPS] Verbindung verloren:", grund);
          global.lifeosHttps = { an: false, grund: grund };
          httpsServer = null;
        });
      } catch (err) {
        const grund = err.code || err.message;
        console.warn("  [HTTPS] Ab Port " + httpsWunsch + " ist nichts frei:", grund);
        global.lifeosHttps = { an: false, grund: grund };
        httpsServer = null;
      }
    } catch (fehler) {
      console.warn("  [HTTPS] konnte nicht gestartet werden:", fehler.message);
      global.lifeosHttps = { an: false, grund: fehler.message };
      httpsServer = null;
    }
  }

  const httpWunsch = PORT;
  httpServer = require("http").createServer(app);
  try {
    PORT = await hoeren(httpServer, httpWunsch);
    portMerken("Dashboard", httpWunsch, PORT);
  } catch (err) {
    console.error(
      `\n  Ab Port ${httpWunsch} ist ${PORT_SPANNE + 1} Stellen weit nichts frei.\n` +
      `  Das ist ungewöhnlich — läuft eine Firewall oder ein Programm dazwischen?\n` +
      `  Mit einem anderen Startpunkt versuchen:  set PORT=4000 && npm run dev\n`
    );
    process.exit(1);
  }

  /* Andere Stellen müssen den echten Port kennen — vor allem die
     Rückadresse der Google-Anmeldung. */
  global.lifeosPort = PORT;

  /* Und das Startskript, damit es den Browser an der richtigen
     Adresse öffnet statt stur auf 3000. */
  try {
    const fsx = require("fs");
    fsx.mkdirSync(path.join(__dirname, "data"), { recursive: true });
    fsx.writeFileSync(path.join(__dirname, "data", "port.txt"), String(PORT), "utf8");
  } catch (fehler) { /* dann öffnet das Skript eben die Vorgabe */ }

  {
    console.log(`\n  LIFE OS Dashboard läuft auf  http://localhost:${PORT}`);
    console.log(`  Live-Reload: ${lrServer ? "aktiv" : "aus"}`);

    /* Ein gewechselter Port erklärt sich nicht von selbst: die alte
       Adresse im Lesezeichen führt dann ins Leere oder — schlimmer —
       auf das fremde Programm, das den Port belegt. */
    if (ausgewichen.length) {
      console.log("\n  Ausgewichen, weil belegt:");
      ausgewichen.forEach(a =>
        console.log(`      ${a.name}: ${a.wunsch} war belegt  ->  jetzt ${a.jetzt}`));
      if (PORT !== httpWunsch) {
        console.log("\n  Das Lesezeichen zeigt vermutlich noch auf den alten Port.");
        console.log("  Für die Google-Anmeldung muss die Rückadresse in der Konsole passen:");
        console.log(`      http://localhost:${PORT}/api/google/zurueck`);
      }
    }

    /* Fuers iPad und das Telefon: die Adresse im Heimnetz, nicht
       localhost. Nur private Adressen anzeigen — eine oeffentliche
       waere hier ohnehin gesperrt. */
    const netze = require("os").networkInterfaces();
    const imNetz = Object.values(netze).flat()
      .filter(n => n && n.family === "IPv4" && !n.internal)
      .filter(n => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(n.address));

    if (imNetz.length) {
      console.log("\n  Vom iPad oder Handy im selben WLAN:");
      if (httpsServer) {
        imNetz.forEach(n => console.log(`      https://${n.address}:${PORT_HTTPS}   <- diese benutzen`));
        console.log("\n  Warum https: nur dort gibt Safari der Seite einen Service");
        console.log("  Worker, und nur damit laeuft die App, wenn dieser Rechner aus ist.");
        console.log("\n  Einmalig auf dem iPad einrichten:");
        console.log(`    1. http://${imNetz[0].address}:${PORT}/life-os-wurzel.crt aufrufen`);
        console.log("    2. Profil laden, dann Einstellungen -> Profil geladen -> Installieren");
        console.log("    3. Einstellungen -> Allgemein -> Info -> Zertifikats-");
        console.log('       vertrauenseinstellungen -> "Life OS Lokal" einschalten');
        console.log("    4. Erst danach die https-Adresse oeffnen und zum Home-");
        console.log("       Bildschirm hinzufuegen.");
        console.log("\n  Ohne Offline-Betrieb geht weiterhin auch:");
      }
      imNetz.forEach(n => console.log(`      http://${n.address}:${PORT}`));
      console.log("\n  Von aussen ist die Seite gesperrt — nur das eigene Netz kommt durch.");
      console.log("  Meldet Windows beim ersten Mal die Firewall: fuer private");
      console.log("  Netzwerke zulassen, oeffentliche verweigern.");
    } else {
      console.log("\n  Keine Netzwerkadresse gefunden — haengt der Rechner am WLAN?");
    }

    console.log(`\n  (Beenden mit Strg+C)\n`);
  }

  /* Der Start ist durch — ab hier ist ein Fehler ein Fehler und kein
     belegter Port mehr. */
  httpServer.on("error", err => {
    console.error("  Serverfehler:", err);
    process.exit(1);
  });
}

/* --- Sauberes Herunterfahren ---------------------------------------
   Ohne das blieben unter Windows regelmäßig verwaiste Prozesse zurück,
   die Port 3000 und 35729 weiter belegt haben — der nächste Start ist
   dann sofort abgestürzt. */
let faehrtHerunter = false;
function herunterfahren(signal) {
  if (faehrtHerunter) return;
  faehrtHerunter = true;

  const fertig = () => process.exit(0);
  const timeout = setTimeout(fertig, 1500); // nie länger als 1,5 s hängen

  try { require("./lib/bildschirmzeit").stoppen(); } catch (e) { /* egal beim Beenden */ }
  try { if (lrServer) lrServer.close(); } catch (e) { /* egal beim Beenden */ }
  try {
    if (httpsServer) {
      httpsServer.close();
      if (typeof httpsServer.closeAllConnections === "function") httpsServer.closeAllConnections();
    }
  } catch (e) { /* egal beim Beenden */ }

  if (httpServer) {
    httpServer.close(() => { clearTimeout(timeout); fertig(); });
    // bestehende Verbindungen nicht auf ihr Timeout warten lassen
    if (typeof httpServer.closeAllConnections === "function") httpServer.closeAllConnections();
  } else {
    clearTimeout(timeout);
    fertig();
  }
}

["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"].forEach(sig => {
  process.on(sig, () => herunterfahren(sig));
});
// nodemon meldet einen Neustart per SIGUSR2 an
process.once("SIGUSR2", () => {
  herunterfahren("SIGUSR2");
  setTimeout(() => process.kill(process.pid, "SIGUSR2"), 100);
});
// Ein unerwarteter Fehler soll nicht stumm einen belegten Port hinterlassen
process.on("uncaughtException", err => {
  console.error("  Unerwarteter Fehler:", err);
  herunterfahren("uncaughtException");
});

/* --- Nicht verwaisen ------------------------------------------------
   Unter Windows läuft ein Kindprozess munter weiter, wenn sein Elternteil
   (nodemon bzw. das geschlossene Terminal) verschwindet — ohne dass ein
   Signal ankommt. Genau so blieben Server zurück, die Port 3000 und 35729
   blockiert haben. Darum: regelmäßig prüfen, ob das Elternteil noch lebt. */
if (isDev && process.ppid) {
  const elternPid = process.ppid;
  const wache = setInterval(() => {
    try {
      process.kill(elternPid, 0);   // wirft, wenn es den Prozess nicht mehr gibt
    } catch (e) {
      console.log("\n  Übergeordneter Prozess ist weg — Server beendet sich mit.\n");
      herunterfahren("elternteil-weg");
    }
  }, 2000);
  wache.unref();                     // hält den Prozess nicht künstlich am Leben
}

start();







