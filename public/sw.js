/* ==========================================================
   LIFE OS // SERVICE WORKER
   Ohne ihn ist die Website-App auf iPad und Telefon wertlos,
   sobald der Rechner aus ist: Safari holt jede Datei vom Server,
   und der antwortet dann nicht mehr.

   Hier liegt deshalb eine Kopie der App selbst — Seite, Stile,
   Skripte, Symbole. Ist der Server da, wird sie aufgefrischt; ist
   er weg, kommt die Kopie zum Zug. Die Daten selbst (Termine,
   Habits) stehen ohnehin im Browserspeicher, das Dashboard
   arbeitet also ganz normal weiter und schickt seine Änderungen
   nach, sobald der Server wieder antwortet.

   Bewusst NICHT zwischengespeichert wird alles unter /api/ — eine
   alte Antwort von dort wäre schlimmer als gar keine.
   ========================================================== */

/* Bei jeder Aenderung hochzaehlen: der Browser tauscht den Worker
   nur aus, wenn sich seine Datei unterscheidet, und ein neuer Name
   raeumt zugleich die alte Kopie weg. */
const LAGER = "lifeos-v13";

/* So lange wird auf den Server gewartet, bevor die Kopie einspringt */
const NETZ_FRIST = 2000;

/* Das Gerüst der App. Fehlt eine Datei beim Einrichten, soll das
   nicht alles scheitern lassen — deshalb einzeln geholt. */
const GERUEST = [
  "/",
  "/index.html",
  "/style.css",
  "/anmeldung.js",
  "/bestand.js",
  "/script.js",
  "/manifest.json",
  "/symbol-180.png",
  "/symbol-192.png",
  "/symbol-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const lager = await caches.open(LAGER);
    await Promise.all(GERUEST.map(pfad =>
      lager.add(new Request(pfad, { cache: "reload" })).catch(() => { /* eine fehlt, weiter */ })
    ));
    /* Sofort übernehmen statt auf das Schließen aller Tabs zu warten */
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const namen = await caches.keys();
    const alte = namen.filter(n => n !== LAGER);
    await Promise.all(alte.map(n => caches.delete(n)));
    await self.clients.claim();
    /* Gab es vorher schon ein Lager, ist das hier eine neue
       Fassung und nicht der erste Besuch — dann zeigt das offene
       Fenster noch die alte Seite und sollte nachladen. */
    if (alte.length) neueFassungMelden();
  })());
});

/* Sagt allen offenen Fenstern, dass eine neue Fassung bereitliegt.
   Was daraus wird, entscheidet die Seite selbst. */
async function neueFassungMelden() {
  const fenster = await self.clients.matchAll({ type: "window" });
  fenster.forEach(f => f.postMessage({ art: "neue-fassung" }));
}

/* Ist die Anfrage etwas, das wir aufheben wollen? */
function istGeruest(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/api/")) return false;
  if (url.pathname.includes("livereload")) return false;
  return true;
}

self.addEventListener("fetch", e => {
  const anfrage = e.request;
  if (anfrage.method !== "GET") return;

  const url = new URL(anfrage.url);

  /* Schriften von Google: einmal geholt, danach aus dem Lager. Sie
     ändern sich nicht, und offline sähe die App sonst anders aus. */
  if (url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com") {
    e.respondWith((async () => {
      const lager = await caches.open(LAGER);
      const da = await lager.match(anfrage);
      if (da) return da;
      try {
        const antwort = await fetch(anfrage);
        lager.put(anfrage, antwort.clone());
        return antwort;
      } catch (fehler) {
        return new Response("", { status: 504, statusText: "offline" });
      }
    })());
    return;
  }

  if (!istGeruest(url)) return;      // /api/ und Fremdes laufen direkt

  /* Der Start der App ist ein Sonderfall und bekommt die Kopie
     sofort — ohne auch nur kurz auf den Server zu warten.

     Beim Öffnen vom Home-Bildschirm gibt iOS der App nur wenige
     Augenblicke, bis etwas da sein muss. Ist der Rechner aus,
     antwortet niemand: die Anfrage scheitert nicht, sie bleibt
     offen. Wartet der Worker dann erst seine Frist ab, hat iOS
     längst aufgegeben und zeigt eine leere Seite — genau der Fall,
     in dem die App sich nicht mehr starten ließ, obwohl die Kopie
     bereitlag und im Flugmodus alles weiterlief.

     Der Server wird trotzdem gefragt, nur eben nebenher: die
     Auffrischung landet im Lager und liegt beim nächsten Start
     bereit. Ein Neuladen in der App holt sie sofort. */
  /* Nur die App selbst nimmt den Weg ueber die Kopie. Fuer jede
     andere Seite im Ordner waere der Rueckfall auf index.html
     schlicht die falsche Seite. */
  const istApp = url.pathname === "/" || url.pathname === "/index.html";

  if (anfrage.mode === "navigate" && istApp) {
    /* Beides synchron anmelden: waitUntil nimmt später nichts mehr
       an, und ohne es darf der Worker mitten im Auffrischen enden. */
    /* Womit die Seite gleich beantwortet wird. Der Vergleich braucht
       genau das und nicht den Stand im Lager: dorthin schreibt das
       Auffrischen ja selbst, und kaeme es zuerst, meldete der Worker
       eine neue Fassung, die die Seite schon bekommen hat. */
    let serviertSagen;
    const serviert = new Promise(fertig => { serviertSagen = fertig; });

    const auffrischen = fetch(anfrage)
      .then(async antwort => {
        if (!antwort || !antwort.ok) return antwort;
        /* Der Text wird einmal gelesen und zweimal abgelegt —
           ein Koerper laesst sich nur einmal auslesen. */
        const neu = await antwort.clone().text();
        const lager = await caches.open(LAGER);
        const kopf = { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } };
        await lager.put("/index.html", new Response(neu, kopf));
        await lager.put("/", new Response(neu, kopf));
        /* Nur wenn die Seite wirklich etwas anderes bekommen hat.
           Beim allerersten Mal lag nichts da — dann ist das, was
           gerade laedt, ohnehin die neue Fassung. */
        const alt = await serviert;
        if (alt !== null && alt !== neu) neueFassungMelden();
        return antwort;
      })
      .catch(() => null);
    e.waitUntil(auffrischen);

    e.respondWith((async () => {
      const lager = await caches.open(LAGER);

      /* Die Startadresse kann eine Kennung tragen (/?start=1) — die
         Kopie liegt unter dem nackten Pfad. Beides versuchen. */
      const kopie = await lager.match(anfrage)
                 || await lager.match("/index.html")
                 || await lager.match("/");

      if (kopie) {
        /* Laesst sich die Kopie nicht lesen, wird eben nicht
           gemeldet — lieber die alte Seite als ein Warten, das
           niemand mehr aufloest. */
        try { serviertSagen(await kopie.clone().text()); }
        catch (fehler) { serviertSagen(null); }
        return kopie;
      }

      /* Noch nichts gespeichert: dann bleibt nur der Server, und auf
         den lohnt das Warten — eine Frist bringt hier nichts, weil
         es nichts gibt, worauf man ausweichen könnte. Genau das
         passierte nach einem geleerten Zwischenspeicher: der Server
         lief, brauchte aber einen Moment, und die Frist lieferte die
         Notfallseite, obwohl die echte längst unterwegs war. */
      /* Erst sagen, dann warten: das Auffrischen wartet seinerseits
         auf diese Antwort — andersherum warteten beide aufeinander. */
      serviertSagen(null);
      const antwort = await auffrischen;
      return antwort || new Response(
        "<!doctype html><meta charset=utf-8><title>Life OS</title>" +
        "<body style='font-family:system-ui;background:#070a12;color:#e7ebf3;padding:48px;line-height:1.6'>" +
        "<h1 style='font-size:20px'>Noch nichts gespeichert</h1>" +
        "<p>Diese App war noch nie mit laufendem Rechner geöffnet — es gibt also " +
        "keine Kopie, die jetzt einspringen könnte.</p>" +
        "<p>Einmal bei laufendem Server öffnen, danach startet sie auch ohne ihn.</p></body>",
        { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
    })());
    return;
  }

  /* Erst der Server, dann das Lager — aber nur kurz warten.

     Ist der Rechner aus und das WLAN an, antwortet niemand: die
     Anfrage scheitert dann nicht, sie bleibt offen, bis das
     Betriebssystem sie irgendwann aufgibt. Auf dem iPad dauert das
     eine halbe Minute und länger, und so lange stand die App leer da,
     obwohl die Kopie längst bereitlag.

     Deshalb: zwei Sekunden auf den Server warten, sonst die Kopie
     nehmen. Die Antwort vom Server frischt das Lager im Hintergrund
     trotzdem auf — beim nächsten Öffnen ist sie da. */
  e.respondWith((async () => {
    const lager = await caches.open(LAGER);

    const ausDemNetz = fetch(anfrage).then(antwort => {
      if (antwort && antwort.ok) lager.put(anfrage, antwort.clone());
      return antwort;
    });

    const da = await lager.match(anfrage);

    if (da) {
      /* Kopie vorhanden: kurz auf den Server warten, sonst sofort
         liefern. Das Auffrischen läuft weiter. */
      const frist = new Promise(fertig => setTimeout(() => fertig(null), NETZ_FRIST));
      const zuerst = await Promise.race([ausDemNetz.catch(() => null), frist]);
      ausDemNetz.catch(() => { /* im Hintergrund gescheitert, egal */ });
      return zuerst || da;
    }

    /* Nichts im Lager: dann bleibt nur der Server. Navigationen
       kommen hier nicht mehr an — die sind oben schon erledigt. */
    try {
      return await ausDemNetz;
    } catch (fehler) {
      return new Response("Offline — der Rechner ist aus.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
  })());
});
