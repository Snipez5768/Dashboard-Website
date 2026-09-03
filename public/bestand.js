/* ==========================================================
   LIFE OS // BESTAND IM NETZ
   Habits, Streaks, Termine und der Rest lagen bisher nur im
   Browser. Auf dem iPad war das ein anderer Browser — und damit
   ein anderer Stand. Dieses Stück holt den Bestand beim Öffnen
   vom Server, schreibt ihn in den lokalen Speicher und schickt
   jede spätere Änderung wieder hoch.

   Es läuft VOR dem eigentlichen Skript. Erst wenn der Stand da
   ist (oder feststeht, dass der Server nicht antwortet), wird
   script.js nachgeladen — sonst läse das Dashboard noch die
   alten Werte.
   ========================================================== */
(() => {
  const STAND_SCHLUESSEL = "lifeos_stand";      // wann wurde was zuletzt geändert
  const WARTEN_MAX = 2500;                      // länger nicht auf den Server warten

  /* Kennung dieses Fensters. Sie geht bei jedem Hochschicken mit, und
     der Server schickt die eigene Änderung nicht zurück — sonst
     überschriebe sich das Gerät mit seinem eigenen Stand. Für jedes
     Fenster eine neue, damit auch zwei Reiter desselben Browsers
     voneinander erfahren. */
  const GERAET = Math.random().toString(36).slice(2) + Date.now().toString(36);

  /* Zeitpunkte der letzten Änderung je Schlüssel */
  let stand = {};
  let ersterLauf = false;
  try {
    const roh = localStorage.getItem(STAND_SCHLUESSEL);
    ersterLauf = roh === null;
    stand = JSON.parse(roh || "{}") || {};
  } catch (e) { stand = {}; ersterLauf = true; }

  const standSichern = () => {
    try { localStorage.setItem(STAND_SCHLUESSEL, JSON.stringify(stand)); } catch (e) { /* voll */ }
  };

  /* ---------- Verbindung ----------
     Ist der Rechner aus, läuft das Dashboard auf iPad und Telefon
     ganz normal weiter — die Daten liegen im Browserspeicher. Nur
     abgeglichen wird nicht. Der Punkt oben in der Kopfzeile zeigt
     den Unterschied an, damit man nicht rätselt. */
  let verbunden = null;              // null = noch unbekannt

  function verbindungMelden(neu) {
    if (verbunden === neu) return;
    verbunden = neu;
    if (window.lifeosBestand) window.lifeosBestand.verbunden = neu;
    document.dispatchEvent(new CustomEvent("lifeos-verbindung", { detail: { verbunden: neu } }));
  }

  /* ---------- Anfragen mit Frist ----------
     Ist der Rechner aus, das WLAN aber an, antwortet niemand — die
     Anfrage scheitert dann nicht, sie bleibt einfach offen. Auf dem
     iPad hing sie so eine halbe Minute und länger. Solange lief kein
     Abgleich, keine Wiederholung, nichts; erst ein Neustart des
     Servers schickte ein Reset und löste die Blockade.

     Deshalb bekommt jede Anfrage hier eine Frist. Läuft sie ab, gilt
     der Rechner als weg — und der nächste Versuch kommt von selbst. */
  const FRIST = 4000;

  function mitFrist(pfad, optionen, frist) {
    const abbruch = typeof AbortController === "function" ? new AbortController() : null;
    const wecker = setTimeout(() => { try { abbruch && abbruch.abort(); } catch (e) {} }, frist || FRIST);
    const anfrage = Object.assign({}, optionen || {});
    if (abbruch) anfrage.signal = abbruch.signal;
    return fetch(pfad, anfrage).finally(() => clearTimeout(wecker));
  }

  /* ---------- Hochschicken ----------
     Gesammelt und mit kurzer Verzögerung: beim Tippen in einem Feld
     fallen sonst dutzende Anfragen an. */
  const offen = new Set();
  let schickTimer = null;
  let versuche = 0;                  // für den Abstand der Wiederholungen

  function spaeterNochmal() {
    /* 5 s, 10 s, 20 s … höchstens eine Minute. Kommt der Rechner
       zurück, meldet sich meist schon die offene Leitung vorher. */
    const wartezeit = Math.min(60000, 5000 * Math.pow(2, Math.min(versuche++, 4)));
    clearTimeout(schickTimer);
    schickTimer = setTimeout(hochschicken, wartezeit);
  }

  function hochschicken() {
    if (!offen.size) return;
    const schluessel = [...offen];
    const eintraege = {};
    schluessel.forEach(k => {
      let wert = null;
      try { wert = JSON.parse(localStorage.getItem(k)); } catch (e) { return; }
      eintraege[k] = { wert, stand: stand[k] || Date.now() };
    });
    if (!Object.keys(eintraege).length) { offen.clear(); return; }

    mitFrist("/api/bestand", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ geraet: GERAET, eintraege }),
      keepalive: true
    })
      .then(a => { if (!a.ok) throw new Error(a.status); return a; })
      .then(() => {
        /* Erst jetzt aus der Warteschlange nehmen — und nur, was sich
           seither nicht schon wieder geändert hat. Vorher wurde hier
           sofort geleert: war der Rechner aus, war die Änderung weg. */
        schluessel.forEach(k => {
          if (eintraege[k] && stand[k] === eintraege[k].stand) offen.delete(k);
        });
        versuche = 0;
        verbindungMelden(true);
      })
      .catch(() => {
        verbindungMelden(false);
        spaeterNochmal();
      });
  }

  window.lifeosBestand = {
    /* Sofort nachsehen, ob das andere Gerät etwas geändert hat */
    nachschauen: (erzwingen) => nachschauen(erzwingen),

    /* Ob der Server gerade erreichbar ist */
    verbunden: null,

    /* Ob der Bestand des Nutzers beim Start wirklich geholt wurde */
    standGeholt: false,

    /* Wie viele Änderungen noch darauf warten, hochzuwandern */
    offeneAenderungen: () => offen.size,

    /* Ruft das Dashboard bei jeder Änderung auf */
    gemerkt(schluessel) {
      stand[schluessel] = Date.now();
      standSichern();
      offen.add(schluessel);
      versuche = 0;
      clearTimeout(schickTimer);
      schickTimer = setTimeout(hochschicken, 600);
    }
  };

  /* Beim Schließen der Seite noch Offenes loswerden */
  window.addEventListener("pagehide", hochschicken);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") hochschicken();
  });

  /* ---------- Holen ---------- */
  /* Alle Dashboard-Schlüssel, die hier im Browser liegen */
  function lokaleSchluessel() {
    const raus = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("lifeos_") && k !== STAND_SCHLUESSEL) raus.push(k);
    }
    return raus;
  }

  /* Habits und Streaks führen einen Verlauf: pro Tag eine Liste
     abgehakter Einträge. Trifft beim ersten Abgleich der Bestand des
     Servers auf den eines Geräts, darf keiner der beiden Verläufe
     verloren gehen — deshalb werden sie zusammengelegt statt ersetzt.
     Ein Haken, den es auf einem der Geräte gibt, bleibt ein Haken. */
  const VERLAUF = new Set(["lifeos_habits", "lifeos_streaks"]);
  const GRENZE = { lifeos_habits: 6, lifeos_streaks: 99 };

  function verlaufVereinen(schluessel, meins, seins) {
    if (!meins || !seins || !Array.isArray(meins.list) || !Array.isArray(seins.list)) return null;

    /* Einträge nach id zusammenlegen, der Server gibt die Reihenfolge vor */
    const liste = seins.list.slice();
    meins.list.forEach(e => { if (!liste.some(x => x.id === e.id)) liste.push(e); });

    const done = {};
    [seins.done || {}, meins.done || {}].forEach(quelle => {
      Object.entries(quelle).forEach(([tag, ids]) => {
        const zusammen = new Set([...(done[tag] || []), ...(Array.isArray(ids) ? ids : [])]);
        done[tag] = [...zusammen];
      });
    });

    return { ...seins, list: liste.slice(0, GRENZE[schluessel] || 99), done };
  }

  /* Listen aus einzelnen Einträgen: Termine, Klausuren, Hausaufgaben,
     Projekte, Abläufe. Beim ersten Abgleich zwischen zwei Geräten gilt
     dasselbe wie beim Verlauf — was auf einem der beiden steht, bleibt
     stehen. Zusammengelegt wird über die Kennung; alles, was der
     Server noch nicht führt, kommt dazu.

     Nur beim ersten Mal: später entscheidet der Zeitpunkt, sonst käme
     ein gelöschter Termin vom anderen Gerät immer wieder zurück. */
  const LISTEN = new Set([
    "lifeos_termine", "lifeos_klausuren", "lifeos_hausaufgaben",
    "lifeos_projekte", "lifeos_planung", "lifeos_themen"
  ]);

  function listeVereinen(meins, seins) {
    if (!Array.isArray(meins) || !Array.isArray(seins)) return null;
    const raus = seins.slice();
    meins.forEach(e => {
      if (!e || typeof e !== "object") return;
      const schonDa = e.id != null && raus.some(x => x && x.id === e.id);
      if (!schonDa) raus.push(e);
    });
    return raus;
  }

  function anwenden(eintraege) {
    const nachOben = {};

    /* Beim allerersten Mal kennt dieses Gerät keine Zeitpunkte. Dann
       gilt: was der Server schon führt, ist die Wahrheit — dieses Gerät
       übernimmt es. Nur was dort noch fehlt, steuert es selbst bei.
       So legt das zuerst geöffnete Gerät den Bestand an, und jedes
       weitere fügt sich ein, statt ihn zu überschreiben. */
    if (ersterLauf) {
      const jetzt = Date.now();
      lokaleSchluessel().forEach(k => {
        if (!eintraege || !eintraege[k]) { stand[k] = jetzt; return; }

        /* Eigene Daten zusammenlegen, bevor der Server sie überschreibt */
        if (!VERLAUF.has(k) && !LISTEN.has(k)) return;
        let meins = null;
        try { meins = JSON.parse(localStorage.getItem(k)); } catch (e) { return; }
        const vereint = VERLAUF.has(k)
          ? verlaufVereinen(k, meins, eintraege[k].wert)
          : listeVereinen(meins, eintraege[k].wert);
        if (!vereint) return;
        try { localStorage.setItem(k, JSON.stringify(vereint)); } catch (e) { return; }
        /* Neuer als der Serverstand — die Schleife unten schickt das
           Zusammengelegte damit von selbst nach oben. */
        stand[k] = jetzt;
      });
      ersterLauf = false;
    }

    Object.entries(eintraege || {}).forEach(([schluessel, e]) => {
      const meins = stand[schluessel] || 0;
      const seins = e.stand || 0;
      if (seins > meins) {
        /* Der Server ist neuer — übernehmen */
        try { localStorage.setItem(schluessel, JSON.stringify(e.wert)); } catch (err) { return; }
        stand[schluessel] = seins;
      } else if (meins > seins && localStorage.getItem(schluessel) !== null) {
        /* Wir sind neuer — hochschicken */
        try { nachOben[schluessel] = { wert: JSON.parse(localStorage.getItem(schluessel)), stand: meins }; }
        catch (err) { /* kaputter Eintrag, dann eben nicht */ }
      }
    });

    /* Was der Server noch gar nicht kennt, kommt auch mit hoch */
    Object.keys(stand).forEach(schluessel => {
      if (eintraege && eintraege[schluessel]) return;
      const roh = localStorage.getItem(schluessel);
      if (roh === null) return;
      try { nachOben[schluessel] = { wert: JSON.parse(roh), stand: stand[schluessel] }; } catch (e) { /* egal */ }
    });

    standSichern();
    if (Object.keys(nachOben).length) {
      mitFrist("/api/bestand", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ geraet: GERAET, eintraege: nachOben }),
        keepalive: true
      }).catch(() => { /* später wieder */ });
    }
  }

  /* ---------- Eine Änderung übernehmen ----------
     Zuerst wird versucht, nur das betroffene Widget neu zu zeichnen.
     Das Dashboard stellt dafür lifeosUebernehmen bereit. Erst wenn
     das nicht geht — weil der Schlüssel dort nicht bekannt ist oder
     etwas schiefging —, wird die Seite geladen. */
  function einspielen(schluessel, wert, standNeu) {
    try { localStorage.setItem(schluessel, JSON.stringify(wert)); } catch (e) { return false; }
    stand[schluessel] = standNeu;
    standSichern();

    const uebernehmen = window.lifeosUebernehmen;
    if (typeof uebernehmen === "function" && uebernehmen(schluessel, wert)) return true;
    location.reload();
    return false;
  }

  /* ---------- Offene Leitung ----------
     Der Server hält eine Verbindung offen und schickt jede Änderung
     sofort her — ohne dass hier gefragt oder neu geladen wird. Reißt
     sie ab, verbindet EventSource von selbst wieder; das Nachfragen
     im Takt bleibt als Rückfallebene für den Fall, dass die Leitung
     gar nicht zustande kommt. */
  let leitung = null;
  let leitungLief = false;

  /* Wann kam zuletzt etwas über die Leitung? Der Server schickt alle
     20 s ein Lebenszeichen; bleibt es aus, ist die Leitung tot. */
  let letztesLebenszeichen = 0;
  const LEITUNG_STUMM_MAX = 55000;

  function leitungSchliessen() {
    if (!leitung) return;
    try { leitung.close(); } catch (e) { /* schon zu */ }
    leitung = null;
    leitungLief = false;
  }

  function leitungOeffnen() {
    if (typeof EventSource !== "function" || leitung) return;
    try {
      leitung = new EventSource("/api/bestand/strom?geraet=" + encodeURIComponent(GERAET));
    } catch (e) { return; }
    letztesLebenszeichen = Date.now();

    leitung.addEventListener("open", () => {
      leitungLief = true;
      letztesLebenszeichen = Date.now();
      verbindungMelden(true);
      /* Der Rechner ist zurück: liegen gebliebene Änderungen mitnehmen */
      if (offen.size) hochschicken();
    });

    leitung.addEventListener("puls", () => { letztesLebenszeichen = Date.now(); });

    leitung.addEventListener("stand", e => {
      letztesLebenszeichen = Date.now();
      let n = null;
      try { n = JSON.parse(e.data); } catch (err) { return; }
      if (!n || !n.schluessel) return;
      if ((n.stand || 0) <= (stand[n.schluessel] || 0)) return;   // kennen wir schon
      einspielen(n.schluessel, n.wert, n.stand);
    });

    /* EventSource verbindet nach einem Abriss selbst wieder. Beim
       Wiederkommen kann etwas verpasst worden sein — deshalb einmal
       nachfragen, sobald die Leitung wieder steht. */
    leitung.addEventListener("error", () => {
      verbindungMelden(false);
      if (leitungLief) { leitungLief = false; setTimeout(() => nachschauen(true), 1200); }
    });
  }

  /* ---------- Aufwachen ----------
     iOS friert eine App auf dem Startbildschirm ein, statt sie zu
     beenden. Beim Fortsetzen laufen Timer weiter, die Verbindung ist
     aber längst tot — EventSource merkt das nicht immer, weil das
     Betriebssystem den Abriss verschluckt hat. Die App sass dann
     stumm da und wurde erst wieder wach, wenn der Server neu startete
     und dabei alles zwang, sich neu zu verbinden.

     Deshalb hier: beim Zurückkommen die Leitung wegwerfen, frisch
     öffnen und einmal vollständig abgleichen. */
  function aufwachen() {
    if (document.visibilityState !== "visible") return;

    /* Nur eine Leitung erneuern, die auch verdächtig ist. Beim
       Fensterwechsel am Rechner feuert "focus" ständig — jedes Mal
       neu zu verbinden wäre Unfug und belastet den Server. Nach einer
       Pause von über einer halben Minute ohne Lebenszeichen ist sie
       dagegen mit hoher Wahrscheinlichkeit tot. */
    const stumm = Date.now() - letztesLebenszeichen > 30000;
    if (!leitung || !leitungLief || stumm) {
      leitungSchliessen();
      leitungOeffnen();
    }
    nachschauen(true);
    if (offen.size) hochschicken();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") aufwachen();
  });
  /* Wird die Seite aus dem Zwischenspeicher zurückgeholt (iOS holt
     eine App vom Startbildschirm so zurück), feuert nur pageshow. */
  window.addEventListener("pageshow", e => { if (e.persisted) aufwachen(); });
  window.addEventListener("focus", aufwachen);

  /* Wachhund: bleibt das Lebenszeichen aus, ist die Leitung tot —
     dann neu aufbauen, statt darauf zu warten, dass es jemand merkt. */
  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (!leitung) { leitungOeffnen(); return; }
    if (Date.now() - letztesLebenszeichen > LEITUNG_STUMM_MAX) {
      leitungSchliessen();
      leitungOeffnen();
      nachschauen(true);
    }
  }, 15000);

  /* ---------- Rückfallebene ----------
     Falls die Leitung nicht steht (alter Browser, Zwischenstelle im
     Weg), wird weiter im Takt nachgefragt. */
  const NACHSCHAUEN_ALLE = 20000;

  function nachschauen(erzwingen) {
    if (!erzwingen && document.visibilityState !== "visible") return;   // im Hintergrund nicht stoeren
    /* Liegt Eigenes bereit, geht das zuerst hoch. Früher wurde hier
       einfach abgebrochen — war der Rechner aus, merkte das Gerät
       dadurch nie, dass er wieder da ist. */
    if (offen.size) { hochschicken(); return; }
    const feld = document.activeElement;
    if (feld && (feld.tagName === "INPUT" || feld.tagName === "TEXTAREA" || feld.isContentEditable)) return;
    mitFrist("/api/bestand")
      .then(a => a.ok ? a.json() : Promise.reject(new Error(a.status)))
      .then(daten => {
        verbindungMelden(true);
        Object.entries(daten.eintraege || {}).forEach(([schluessel, e]) => {
          if ((e.stand || 0) > (stand[schluessel] || 0)) einspielen(schluessel, e.wert, e.stand);
        });
        if (offen.size) hochschicken();
      })
      .catch(() => { verbindungMelden(false); });
  }

  function starten() {
    /* Steht die Leitung nicht, wird häufig nachgefragt — der Rechner
       soll nicht lange unbemerkt zurück sein. Steht sie, genügt ein
       seltener Kontrollblick als Sicherheitsnetz.
       Das Aufwachen selbst hängt weiter oben an visibilitychange,
       pageshow und focus. */
    setInterval(() => {
      if (!leitungLief) nachschauen();
      else if (Math.random() < 0.2) nachschauen();     // etwa jede Minute
    }, NACHSCHAUEN_ALLE);

    const skript = document.createElement("script");
    skript.src = "script.js";
    /* Erst wenn das Dashboard steht, darf die Leitung auf: vorher
       gäbe es niemanden, der eine Änderung einzeichnen könnte, und
       jede Meldung endete in einem Neuladen. */
    skript.addEventListener("load", leitungOeffnen);
    skript.addEventListener("error", leitungOeffnen);
    document.body.appendChild(skript);
  }

  let losgelaufen = false;
  const einmalStarten = () => { if (!losgelaufen) { losgelaufen = true; starten(); } };

  /* Antwortet der Server nicht, läuft das Dashboard trotzdem an —
     dann eben mit dem, was lokal liegt. */
  const notbremse = setTimeout(einmalStarten, WARTEN_MAX);

  mitFrist("/api/bestand", null, 3000)
    .then(a => {
      /* 401 heisst: die Sitzung ist abgelaufen. Dann nicht stumm
         weiterlaufen, sondern zurueck zur Anmeldung. */
      if (a.status === 401) {
        if (window.lifeosSitzungWeg) window.lifeosSitzungWeg();
        return Promise.reject(new Error("nicht angemeldet"));
      }
      return a.ok ? a.json() : Promise.reject(new Error(a.status));
    })
    .then(daten => {
      verbindungMelden(true);
      anwenden(daten.eintraege);
      /* Das Dashboard darf jetzt davon ausgehen, den Stand des
         Nutzers wirklich zu kennen — wichtig für alles, was beim
         Fehlen eines Eintrags eine Vorgabe anlegen würde. */
      window.lifeosBestand.standGeholt = true;
    })
    .catch(() => {
      /* Rechner aus: das Dashboard läuft mit dem, was lokal liegt.
         Änderungen sammeln sich und gehen hoch, sobald er wieder da ist. */
      verbindungMelden(false);
    })
    .finally(() => { clearTimeout(notbremse); einmalStarten(); });

  /* Das Betriebssystem weiß oft früher Bescheid als jede Anfrage */
  window.addEventListener("offline", () => verbindungMelden(false));
  window.addEventListener("online", () => { nachschauen(true); if (offen.size) hochschicken(); });
})();
