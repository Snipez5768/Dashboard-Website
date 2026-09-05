/* ==========================================================
   LIFE OS // DASHBOARD — script.js
   Die Oberfläche läuft im Browser, die Daten gehören einem Konto:
   sie liegen lokal in localStorage und beim Server unter dem
   angemeldeten Nutzer. anmeldung.js startet dieses Skript erst,
   wenn jemand angemeldet ist.
   ========================================================== */

(() => {
  "use strict";

  /* ---------- Storage Helper ---------- */
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) { return fallback; }
    },
    set(key, value) {
      localStorage.setItem(key, JSON.stringify(value));
      /* Dieselbe Aenderung wandert zum Server, damit das iPad sie
         auch sieht. Faellt der Server aus, bleibt es beim lokalen
         Stand — das Dashboard laeuft weiter. */
      if (window.lifeosBestand) window.lifeosBestand.gemerkt(key);
    }
  };

  const $ = id => document.getElementById(id);

  /* ==========================================================
     AUFBAU — wann die Widgets einlaufen dürfen
     Nur beim Laden der Seite und beim Wechsel über die Sidebar.
     Ein Klick im Widget (Streak abhaken, Habit setzen) zeichnet
     zwar neu, die Animation bleibt dabei aber aus — sonst rutscht
     bei jedem Klick die ganze Liste noch einmal herein.
     Der Schalter sitzt am body, damit jedes Widget ihn über seine
     eigene Regel abfragen kann: "body.aufbau .streak-row { … }".
     ========================================================== */
  const AUFBAU_DAUER = 1100;      // so lange dürfen die Animationen laufen
  let aufbauTimer = null;
  function aufbauAnstossen() {
    document.body.classList.add("aufbau");
    clearTimeout(aufbauTimer);
    aufbauTimer = setTimeout(() => document.body.classList.remove("aufbau"), AUFBAU_DAUER);
  }
  aufbauAnstossen();

  const todayStr = () => dateKey(new Date());
  function dateKey(d) {
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
  }

  /* ---------- Default Settings ---------- */
  const DEFAULT_SETTINGS = {
    name: "Luca",
    city: "Berlin",
    lat: 52.52,
    lon: 13.405,
    calGoal: 0,
    /* Profilbild als eingebettete Datenadresse, auf 256 Kanten
       gestutzt — so reist es mit den Einstellungen zum iPad. */
    bild: ""
  };
  let settings = { ...DEFAULT_SETTINGS, ...store.get("lifeos_settings", DEFAULT_SETTINGS) };

  const DEFAULT_LINKS = [
    { label: "Gmail",   url: "https://mail.google.com/",                icon: "gmail"   },
    { label: "Spotify", url: "https://open.spotify.com/",               icon: "spotify" },
    { label: "YouTube", url: "https://www.youtube.com/",                icon: "youtube" },
    { label: "TikTok",  url: "https://www.tiktok.com/",                 icon: "tiktok"  },
    { label: "Bolle",   url: "https://bolle.carl-zeiss-oberschule.de/", icon: "school"  }
  ];
  let quickLinks = store.get("lifeos_quicklinks", null) || DEFAULT_LINKS;

  let termine = store.get("lifeos_termine", []);
  let klausuren = store.get("lifeos_klausuren", []);

  /* ---------- Klausur oder Test? ----------
     Beides liegt in derselben Liste. Ein Test trägt "pruefung:
     test", eine Klausur trägt nichts — so bleiben alle bisherigen
     Einträge das, was sie waren.

     Die drei stehen hier oben, weil schon der erste Aufbau des
     Dashboards nach dem Wort fragt. */
  const istTest = k => !!k && k.pruefung === "test";
  const pruefungWort = k => istTest(k) ? "Test" : "Klausur";

  /* Ein Test dauert eine Schulstunde. Klausuren haben ihre eigene
     Dauer je Fach; für Tests wäre eine zweite Tabelle mehr
     Verwaltung als Nutzen. */
  const TEST_DAUER = 45;
  let lernkarten = store.get("lifeos_lernkarten", {});   // { klausurId: [ {id, frage, antwort} ] }
  /* Eigene Lernthemen — alles, was weder Klausur noch Hausaufgabe
     ist: eine Sprache, ein Führerschein, ein Kapitel nebenher. Sie
     tragen Karten wie eine Klausur, aber kein Fach und kein
     Stundenplan; ein Datum ist freiwillig. */
  let themen = store.get("lifeos_themen", []);           // [ {id, title, date, notiz} ]

  /* ---------- Lernplan der Karteikarten ----------
     Wann eine Karte wieder dran ist. Steht hier oben, weil schon der
     erste Aufbau des Dashboards wissen will, wie viele heute fällig
     sind. Die Regeln dazu stehen weiter unten bei den Karten. */
  const ABSTAENDE = [1, 2, 4, 8, 16, 32];   // Tage je Fach
  const PORTION = "__faellig";              // der Stapel "heute fällig"

  /* Die sechs Fächer des Kastens. Der Name sagt, was das Fach über
     die Karte behauptet — die Zahl allein sagt das nicht. */
  const KASTEN_NAMEN = [
    "Neu — sitzt noch nicht",
    "Wackelt noch",
    "Kommt langsam",
    "Sitzt meistens",
    "Sitzt",
    "Sitzt fest"
  ];
  const KASTEN_ZULETZT = ABSTAENDE.length - 1;

  const karteStufe = c => {
    const e = c && kartenPlan[c.id];
    const st = e ? Number(e.stufe) : 0;
    return Number.isFinite(st) ? Math.min(Math.max(st, 0), KASTEN_ZULETZT) : 0;
  };

  /* Karten auf die Fächer verteilen — die Grundlage der Ansicht */
  function kastenVerteilung(karten) {
    const faecher = ABSTAENDE.map(() => []);
    (karten || []).forEach(c => { if (c && c.id) faecher[karteStufe(c)].push(c); });
    return faecher;
  }

  let kartenPlan = store.get("lifeos_karten_plan", {}) || {};
  const kartenPlanSichern = () => store.set("lifeos_karten_plan", kartenPlan);

  const tagPlus = zahl => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + zahl);
    return dateKey(d);
  };

  const karteFaellig = c => {
    const e = c && kartenPlan[c.id];
    return !e || !e.faellig || e.faellig <= todayStr();
  };

  /* ==========================================================
     WIE LANGE EINE KLAUSUR DAUERT
     Das steht nicht im Stundenplan: eine Klausur sprengt die
     Schulstunde und läuft je nach Fach unterschiedlich lang. Ohne
     eigene Angabe gelten 135 Minuten — drei Schulstunden, der
     übliche Fall in der Oberstufe.
     ========================================================== */
  const KLAUSUR_DAUER_VORGABE = 135;
  let klausurDauer = store.get("lifeos_klausurdauer", {});   // { fachId: Minuten }

  const dauerFuer = fach => {
    const d = Number(klausurDauer[fach]);
    return Number.isFinite(d) && d > 0 ? d : KLAUSUR_DAUER_VORGABE;
  };

  function dauerSetzen(fach, minuten) {
    const m = Number(minuten);
    if (!Number.isFinite(m) || m <= 0) delete klausurDauer[fach];
    else klausurDauer[fach] = Math.min(600, Math.round(m));
    store.set("lifeos_klausurdauer", klausurDauer);
    /* Die Dauer steht im Kalender — also muss der Abgleich nachziehen */
    googleAnstossen();
  }

  const dauerText = minuten => {
    const h = Math.floor(minuten / 60), m = minuten % 60;
    return h ? (m ? h + " h " + m + " min" : h + " h") : m + " min";
  };
  /* Hausaufgaben: { id, title, fach, date, wichtig: 1|2|3, erledigt } */
  let hausaufgaben = store.get("lifeos_hausaufgaben", []);

  /* ==========================================================
     STUNDENPLAN — Periode 1
     Das Raster der Stunden gilt für die Schule und steht deshalb
     fest. Kurse, Lehrer und Belegung gehören dagegen dem Nutzer:
     sie liegen in seinem Bestand, damit ein zweites Konto nicht
     den Plan des ersten sieht.

     Was unten als Vorgabe steht, ist Lucas Plan. Er wandert genau
     einmal in den Bestand — beim ersten Konto, dem auch die
     übrigen bisherigen Daten gehören. Jedes weitere Konto fängt
     mit einem leeren Plan an.

     Klausuren zeigen ueber "fach" auf einen Kurs; daraus ergeben
     sich Stunde, Zeit und Raum.
     ========================================================== */
  const STUNDEN = [
    { nr: 1,  von: "08:00", bis: "08:45" },
    { nr: 2,  von: "08:50", bis: "09:35" },
    { nr: 3,  von: "09:55", bis: "10:40" },
    { nr: 4,  von: "10:45", bis: "11:30" },
    { nr: 5,  von: "11:50", bis: "12:35" },
    { nr: 6,  von: "12:40", bis: "13:25" },
    { nr: 7,  von: "13:40", bis: "14:25" },
    { nr: 8,  von: "14:30", bis: "15:15" },
    { nr: 9,  von: "15:20", bis: "16:05" },
    { nr: 10, von: "16:10", bis: "16:55" }
  ];

  /* "ton" steuert nur die Farbe der Kachel im Plan */
  const FAECHER_VORGABE = {
    "LK12-CH1":  { lang: "Leistungskurs Chemie",    kurz: "Chemie LK",    ton: "pink"   },
    "LK12-GEO1": { lang: "Leistungskurs Geografie", kurz: "Geografie LK", ton: "hellgruen"    },
    "gk12-de1":  { lang: "Grundkurs Deutsch",       kurz: "Deutsch",     ton: "rot"     },
    "gk12-eng3": { lang: "Grundkurs Englisch",      kurz: "Englisch",    ton: "orange"    },
    "gk12-ku2":  { lang: "Grundkurs Kunst",         kurz: "Kunst",       ton: "grau"    },
    "gk12-ma1":  { lang: "Grundkurs Mathematik",    kurz: "Mathe",       ton: "blau" },
    "gk12-phi3": { lang: "Grundkurs Philosophie",   kurz: "Philosophie", ton: "cyan"    },
    "gk12-phy1": { lang: "Grundkurs Physik",        kurz: "Physik",      ton: "violett" },
    "spo11":     { lang: "Grundkurs Sport",         kurz: "Sport",       ton: "gelb"  }
  };

  const LEHRER_VORGABE = {
    Ah: "Ahlmeyer Vieira", Ba: "Ballout",  Bar: "Baran",   Bc: "Böttcher",
    Fi: "Fischer",         Hng: "Hanning", Ren: "Rendant", Schm: "Schmidt",
    Ska: "Skrabar",        Vest: "Vester"
  };

  /* tag: 1 = Montag … 5 = Freitag, von/bis sind Stundennummern */
  const STUNDENPLAN_VORGABE = [
    { tag: 1, von: 1, bis: 1,  fach: "LK12-GEO1", lehrer: ["Ah"],        raum: "229" },
    { tag: 1, von: 2, bis: 2,  fach: "gk12-ku2",  lehrer: ["Schm"],      raum: "260" },
    { tag: 1, von: 3, bis: 4,  fach: "gk12-de1",  lehrer: ["Hng"],       raum: "226" },
    { tag: 1, von: 7, bis: 7,  fach: "LK12-CH1",  lehrer: ["Fi"],        raum: "NW3" },
    { tag: 1, von: 8, bis: 8,  fach: "gk12-phi3", lehrer: ["Ska", "Ba"], raum: ""    },

    { tag: 2, von: 1, bis: 2,  fach: "gk12-phi3", lehrer: ["Ska", "Ba"], raum: ""    },
    { tag: 2, von: 3, bis: 4,  fach: "gk12-eng3", lehrer: ["Bar"],       raum: "134" },
    { tag: 2, von: 5, bis: 5,  fach: "gk12-de1",  lehrer: ["Hng"],       raum: "224" },
    { tag: 2, von: 6, bis: 6,  fach: "gk12-phy1", lehrer: ["Bc"],        raum: "NW7" },
    { tag: 2, von: 8, bis: 8,  fach: "gk12-ma1",  lehrer: ["Ren"],       raum: "233" },

    { tag: 3, von: 3, bis: 4,  fach: "LK12-GEO1", lehrer: ["Ah"],        raum: "229" },
    { tag: 3, von: 5, bis: 6,  fach: "LK12-CH1",  lehrer: ["Fi"],        raum: "NW3" },
    { tag: 3, von: 7, bis: 8,  fach: "gk12-ku2",  lehrer: ["Schm"],      raum: "260" },

    { tag: 4, von: 5, bis: 6,  fach: "gk12-phy1", lehrer: ["Bc"],        raum: "NW8" },

    { tag: 5, von: 1, bis: 2,  fach: "LK12-CH1",  lehrer: ["Fi"],        raum: "NW3" },
    { tag: 5, von: 3, bis: 4,  fach: "LK12-GEO1", lehrer: ["Ah"],        raum: "229" },
    { tag: 5, von: 5, bis: 5,  fach: "gk12-eng3", lehrer: ["Bar"],       raum: "223" },
    { tag: 5, von: 7, bis: 8,  fach: "gk12-ma1",  lehrer: ["Ren"],       raum: "147" },
    { tag: 5, von: 9, bis: 10, fach: "spo11",     lehrer: ["Vest"],      raum: "U1"  }
  ];

  /* Der Plan dieses Nutzers. Kein const: er wird gleich aus dem
     Bestand gefuellt und laesst sich spaeter aendern. */
  let FAECHER = {};
  let LEHRER = {};
  let STUNDENPLAN = [];

  /* Ist dies das erste Konto? Nur ihm gehoert die Vorgabe. */
  function ersterNutzer() {
    const n = window.lifeosNutzer;
    if (n && typeof n.verwalter === "boolean") return n.verwalter;
    try { return localStorage.getItem("lifeos_konto_verwalter") === "1"; }
    catch (e) { return false; }
  }

  function planSichern() {
    store.set("lifeos_faecher", FAECHER);
    store.set("lifeos_stundenplan", { stunden: STUNDENPLAN, lehrer: LEHRER });
  }

  function planLaden() {
    const f = store.get("lifeos_faecher", null);
    const p = store.get("lifeos_stundenplan", null);
    if (f && typeof f === "object" && p && Array.isArray(p.stunden)) {
      FAECHER = f;
      STUNDENPLAN = p.stunden;
      LEHRER = (p.lehrer && typeof p.lehrer === "object") ? p.lehrer : {};
      return;
    }

    /* Noch nichts gespeichert. Die Vorgabe nur dann anlegen, wenn der
       Stand des Nutzers auch wirklich vom Server kam — sonst schriebe
       ein Start ohne Server einen spaeter geaenderten Plan wieder auf
       die Vorgabe zurueck. */
    const standDa = window.lifeosBestand && window.lifeosBestand.standGeholt;
    if (ersterNutzer() && standDa) {
      FAECHER = { ...FAECHER_VORGABE };
      LEHRER = { ...LEHRER_VORGABE };
      STUNDENPLAN = STUNDENPLAN_VORGABE.map(l => ({ ...l, lehrer: l.lehrer.slice() }));
      planSichern();
      return;
    }
    /* Ohne Server: die Vorgabe zeigen, aber nichts speichern. */
    if (ersterNutzer()) {
      FAECHER = { ...FAECHER_VORGABE };
      LEHRER = { ...LEHRER_VORGABE };
      STUNDENPLAN = STUNDENPLAN_VORGABE.map(l => ({ ...l, lehrer: l.lehrer.slice() }));
    }
  }
  planLaden();

  const TAGE_LANG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

  const fachInfo = id => FAECHER[id] || { lang: id, kurz: id, ton: "grau" };
  const stundeInfo = nr => STUNDEN[nr - 1];

  /* Stundenblock als Text: "3.–4. Stunde" bzw. "5. Stunde" */
  function blockName(von, bis) {
    return von === bis ? von + ". Stunde" : von + ".–" + bis + ". Stunde";
  }
  function blockZeit(von, bis) {
    return stundeInfo(von).von + "–" + stundeInfo(bis).bis;
  }

  /* Wochentag eines ISO-Datums als 1–5, sonst 0 (Wochenende) */
  function schultag(iso) {
    const d = new Date(iso + "T00:00:00").getDay();
    return d >= 1 && d <= 5 ? d : 0;
  }

  const stundenAmTag = tag => STUNDENPLAN.filter(l => l.tag === tag)
                                        .sort((a, b) => a.von - b.von);

  /* Alle Stunden eines Kurses an einem Datum — Grundlage der Zuordnung */
  function stundenFuerFach(fach, iso) {
    const tag = schultag(iso);
    if (!tag) return [];
    return stundenAmTag(tag).filter(l => l.fach === fach);
  }

  /* Laeuft gerade eine Stunde, und welche kommt als Naechstes? */
  function stundeJetzt(datum = new Date()) {
    const tag = datum.getDay();
    if (tag < 1 || tag > 5) return { jetzt: null, naechste: null };
    const min = datum.getHours() * 60 + datum.getMinutes();
    const alsMin = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    let jetzt = null, naechste = null;
    stundenAmTag(tag).forEach(l => {
      const a = alsMin(stundeInfo(l.von).von), e = alsMin(stundeInfo(l.bis).bis);
      if (min >= a && min <= e) jetzt = l;
      else if (min < a && !naechste) naechste = l;
    });
    return { jetzt, naechste };
  }

  /* Naechstes Datum ab heute, an dem dieser Kurs stattfindet */
  function naechstesDatumFuer(fach) {
    const d = new Date();
    const jetzt = d.getHours() * 60 + d.getMinutes();
    for (let i = 0; i < 14; i++) {
      const iso = dateKey(d);
      const treffer = stundenFuerFach(fach, iso);
      if (treffer.length) {
        if (i > 0) return iso;
        /* Heute zaehlt nur, solange eine Stunde noch nicht zu Ende
           ist. Wer nach dem Unterricht eine Hausaufgabe eintraegt,
           meint die naechste Stunde — nicht die, die er schon hatte. */
        const offen = treffer.some(l => {
          const bis = stundeInfo(l.bis || l.von).bis;
          return Number(bis.slice(0, 2)) * 60 + Number(bis.slice(3)) > jetzt;
        });
        if (offen) return iso;
      }
      d.setDate(d.getDate() + 1);
    }
    return todayStr();
  }

  /* Zusatzzeile fuer Listen: "Chemie · 5.–6. Stunde · NW3".
     Fach und Stunde stehen am Eintrag selbst, damit eine alte Klausur
     nicht mitwandert, wenn sich der Plan spaeter aendert. */
  function klausurZusatz(k) {
    const teile = [];
    if (k.fach) teile.push(fachInfo(k.fach).kurz);
    if (k.von) teile.push(blockName(k.von, k.bis || k.von));
    if (k.raum) teile.push(k.raum);
    return teile.join(" · ");
  }
  let kalorien = store.get("lifeos_kalorien", { date: todayStr(), consumed: 0 });

  // Beim allerersten Start Demo-Werte der letzten 7 Tage, damit das
  // Wochen-Diagramm nicht leer aussieht.
  function seedDemoScreentime() {
    const demo = [ // [Handy, PC] in Minuten, ältester Tag zuerst
      [95, 140], [160, 60], [210, 190], [70, 310], [185, 95], [240, 45], [130, 175]
    ];
    const history = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const [phone, pc] = demo[6 - i];
      history[dateKey(d)] = { phone, pc };
    }
    return { history };
  }
  let screentime = store.get("lifeos_screentime", null);
  if (!screentime) {
    screentime = seedDemoScreentime();
    store.set("lifeos_screentime", screentime);
  }

  /* ---------- Habits (Daten) ----------
     Bis zu 6 Habits werden im Widget angezeigt. Die Beispiel-Historie
     der letzten 21 Tage sorgt dafür, dass die Tages-Kästchen und die
     Streak nicht leer starten. */
  const HABIT_LIMIT = 6;
  const DEFAULT_HABITS = [
    { id: "sport",  name: "Sport"   },
    { id: "lesen",  name: "Lesen"   },
    { id: "wasser", name: "Wasser"  },
    { id: "lernen", name: "Lernen"  },
    { id: "medi",   name: "Meditation" },
    { id: "schlaf", name: "Schlaf"  }
  ];

  function seedDemoHabits(list) {
    // Pro Habit ein eigenes Muster über die letzten 21 Tage (ältester zuerst)
    const muster = {
      sport:  [1,1,0,1,1,1,1, 1,1,1,0,1,1,1, 1,0,1,1,1,1,0],
      lesen:  [1,0,1,1,1,0,1, 1,1,0,1,1,1,1, 0,1,1,1,0,1,0],
      wasser: [1,1,1,1,0,1,1, 1,1,1,1,1,0,1, 1,1,1,1,1,1,0],
      lernen: [0,1,1,0,1,1,1, 1,0,1,1,1,1,0, 1,1,0,1,1,1,0],
      medi:   [1,1,1,0,1,1,0, 1,1,1,0,1,1,1, 1,1,1,0,1,1,0],
      schlaf: [1,0,1,1,1,1,1, 0,1,1,1,1,1,1, 1,1,1,1,0,1,0]
    };
    const done = {};
    const tage = 21;
    for (let i = tage - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = dateKey(d);
      const idx = tage - 1 - i;
      done[key] = list.filter(h => (muster[h.id] || [])[idx] === 1).map(h => h.id);
    }
    return done;
  }

  let habits = store.get("lifeos_habits", null);
  if (!habits || !Array.isArray(habits.list)) {
    habits = { list: DEFAULT_HABITS, done: seedDemoHabits(DEFAULT_HABITS) };
    store.set("lifeos_habits", habits);
  }

  /* ----------------------------------------------------------
     STREAKS — eigener Bereich, unabhängig von den Habits.
     "quelle" hält fest, woher ein Haken kommt: "manuell" heißt
     anklickbar, alles andere ist für eine spätere API gedacht,
     die den Tag selbst abhakt (siehe window.lifeos.streakSetzen).
     ---------------------------------------------------------- */
  const STREAK_LIMIT = 6;
  const TAGESENDE_AB = 20;   // ab 20 Uhr warnt das Widget vor offenen Serien
  const DEFAULT_STREAKS = [
    { id: "duolingo", name: "Duolingo", quelle: "manuell" },
    { id: "schritte", name: "Schritte", quelle: "manuell" },
    { id: "training", name: "Training", quelle: "manuell" },
    { id: "journal",  name: "Journal",  quelle: "manuell" },
    { id: "kochen",   name: "Selbst gekocht", quelle: "manuell" }
  ];

  function seedDemoStreaks(list) {
    // Unterschiedlich lange Serien, damit die Farbstufen sichtbar sind
    const laenge = { duolingo: 34, schritte: 16, training: 8, journal: 4, kochen: 1 };
    const done = {};
    list.forEach(e => {
      for (let t = 1; t <= (laenge[e.id] || 0); t++) {
        const d = new Date(); d.setDate(d.getDate() - t);
        const key = dateKey(d);
        (done[key] = done[key] || []).push(e.id);
      }
    });
    return done;
  }

  let streaks = store.get("lifeos_streaks", null);
  if (!streaks || !Array.isArray(streaks.list)) {
    streaks = { list: DEFAULT_STREAKS, done: seedDemoStreaks(DEFAULT_STREAKS) };
    store.set("lifeos_streaks", streaks);
  }

  /* Einmalig: die fünf Serien so setzen, dass jede Farbstufe genau
     einmal vorkommt (1, 3, 7, 14, 30 Tage) und heute abgehakt ist —
     sonst bleiben die Flammen grau. Der Merker sorgt dafür, dass das
     nur ein einziges Mal passiert und später abgehakte Tage nicht
     wieder überschrieben werden. */
  if (!store.get("lifeos_streak_stufen", false)) {
    const SCHWELLEN = [30, 14, 7, 3, 1];
    const ziele = streaks.list.slice(0, SCHWELLEN.length);
    const ids = new Set(ziele.map(e => e.id));

    Object.keys(streaks.done).forEach(tag => {
      streaks.done[tag] = streaks.done[tag].filter(id => !ids.has(id));
      if (!streaks.done[tag].length) delete streaks.done[tag];
    });

    ziele.forEach((eintrag, i) => {
      for (let t = 0; t < SCHWELLEN[i]; t++) {
        const d = new Date();
        d.setDate(d.getDate() - t);
        (streaks.done[dateKey(d)] = streaks.done[dateKey(d)] || []).push(eintrag.id);
      }
    });

    store.set("lifeos_streaks", streaks);
    store.set("lifeos_streak_stufen", true);
  }

  if (kalorien.date !== todayStr()) {
    kalorien = { date: todayStr(), consumed: 0 };
    store.set("lifeos_kalorien", kalorien);
  }

  /* ---------- Icons ---------- */
  const ICONS = {
    gmail: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="3" y="5.4" width="18" height="13.2" rx="2.6"/><path d="m4 6.8 8 5.8 8-5.8"/></svg>`,
    spotify: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="8.6"/><path d="M7.6 9.8c2.9-1 6.3-.9 8.8.5M8.1 13c2.3-.7 4.8-.6 6.9.4M8.6 15.8c1.7-.5 3.6-.4 5.2.3"/></svg>`,
    youtube: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="2.8" y="5.8" width="18.4" height="12.4" rx="3.4"/><path d="M10.8 9.9v4.2l3.7-2.1-3.7-2.1Z" fill="currentColor" stroke="none"/></svg>`,
    tiktok: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3.8v10.4a3.4 3.4 0 1 1-2.7-3.33"/><path d="M14 3.8c.35 2.1 1.9 3.7 4.1 4.05"/></svg>`,
    school: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 4 2.6 8.8 12 13.6l9.4-4.8L12 4Z"/><path d="M6.4 11.2v4.6c0 1.1 2.6 2.4 5.6 2.4s5.6-1.3 5.6-2.4v-4.6"/></svg>`,
    link: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M9.6 14.4 14.4 9.6"/><path d="M11.2 6.6 12.5 5.3a3.6 3.6 0 1 1 5.1 5.1l-1.3 1.3M12.8 17.4l-1.3 1.3a3.6 3.6 0 1 1-5.1-5.1l1.3-1.3"/></svg>`
  };
  const iconSVG = name => ICONS[name] || ICONS.link;

  const WEATHER_ICONS = {
    sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="4.6"/><path d="M12 2.4v2.4M12 19.2v2.4M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2.4 12h2.4M19.2 12h2.4M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7"/></svg>`,
    cloud: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M7 18h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.7 1.5A3.5 3.5 0 0 0 7 18Z"/></svg>`,
    fog: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 8h16M3 12h18M4 16h16M6.5 20h11"/></svg>`,
    rain: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 15h9.5a3.8 3.8 0 0 0 .4-7.6A5 5 0 0 0 7.4 9.4 3.3 3.3 0 0 0 7 15Z"/><path d="m8 18.6-1 2M12 18.6l-1 2M16 18.6l-1 2"/></svg>`,
    snow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 15h9.5a3.8 3.8 0 0 0 .4-7.6A5 5 0 0 0 7.4 9.4 3.3 3.3 0 0 0 7 15Z"/><path d="M9 19v.01M12 20v.01M15 19v.01"/></svg>`,
    storm: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 13h9.5a3.8 3.8 0 0 0 .4-7.6A5 5 0 0 0 7.4 7.4 3.3 3.3 0 0 0 7 13Z"/><path d="m13 13-2.5 4h3L11 21"/></svg>`
  };
  function weatherCodeInfo(code) {
    if (code === 0) return { icon: "sun", text: "Klarer Himmel" };
    if ([1,2,3].includes(code)) return { icon: "cloud", text: code === 1 ? "Überwiegend klar" : code === 2 ? "Teilweise bewölkt" : "Bedeckt" };
    if ([45,48].includes(code)) return { icon: "fog", text: "Nebel" };
    if ([51,53,55,56,57].includes(code)) return { icon: "rain", text: "Nieselregen" };
    if ([61,63,65,66,67,80,81,82].includes(code)) return { icon: "rain", text: "Regen" };
    if ([71,73,75,77,85,86].includes(code)) return { icon: "snow", text: "Schnee" };
    if ([95,96,99].includes(code)) return { icon: "storm", text: "Gewitter" };
    return { icon: "cloud", text: "—" };
  }

  function escapeHTML(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,6);

  /* ==========================================================
     CLOCK
     ========================================================== */
  const WEEKDAYS = ["Sonntag","Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag"];
  const MONTHS = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];

  function updateClock() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2,"0");
    const mm = String(now.getMinutes()).padStart(2,"0");

    $("heroClock").textContent = `${hh}:${mm}`;
    $("heroDate").textContent = `${String(now.getDate()).padStart(2,"0")}. ${MONTHS[now.getMonth()].slice(0,3)}`;

    const h = now.getHours();
    $("greetingWord").textContent =
      h < 5 ? "Gute Nacht," : h < 11 ? "Guten Morgen," : h < 18 ? "Guten Tag," : h < 22 ? "Guten Abend," : "Gute Nacht,";
    $("greetingName").textContent = settings.name?.trim() || "Luca";

    // Beim Übertritt in den Abend die Streaks einmal neu zeichnen, damit
    // das Warnzeichen ohne Neuladen erscheint. Der allererste Tick merkt
    // sich den Stand nur — zu dem Zeitpunkt steht der Streak-Bereich
    // noch gar nicht bereit.
    const spaet = h >= TAGESENDE_AB;
    if (updateClock._spaet !== undefined && spaet !== updateClock._spaet) renderStreaks();
    updateClock._spaet = spaet;
  }
  updateClock();
  setInterval(updateClock, 1000);

  /* ==========================================================
     WEATHER
     ========================================================== */
  const WEATHER_CACHE_MS = 20 * 60 * 1000;

  let wetterAnsicht = store.get("lifeos_wetter_ansicht", "jetzt");   // "jetzt" | "woche"
  let wetterDaten = null;

  const TROPFEN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">' +
    '<path d="M12 3.5c3.2 3.8 5.5 6.6 5.5 9.4a5.5 5.5 0 0 1-11 0c0-2.8 2.3-5.6 5.5-9.4Z"/></svg>';

  async function loadWeather(force) {
    $("weatherCityLabel").textContent = settings.city || "—";
    const cacheKey = "lifeos_weather_cache";
    const cache = store.get(cacheKey, null);
    const fresh = cache && (Date.now() - cache.ts < WEATHER_CACHE_MS)
      && cache.lat === settings.lat && cache.lon === settings.lon
      && cache.data?.daily?.precipitation_probability_max;   // alter Cache ohne Regenwerte wird verworfen

    if (fresh && !force) { wetterDaten = cache.data; renderWeather(); return; }

    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${settings.lat}&longitude=${settings.lon}` +
        `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code` +
        `&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max` +
        `&forecast_days=7&timezone=auto`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Wetter-API nicht erreichbar");
      const data = await res.json();
      store.set(cacheKey, { ts: Date.now(), lat: settings.lat, lon: settings.lon, data });
      wetterDaten = data;
      renderWeather();
    } catch (err) {
      if (cache) { wetterDaten = cache.data; renderWeather(); }
      else $("weatherBody").innerHTML = `<div class="muted-line">Wetter aktuell nicht verfügbar (offline?).</div>`;
    }
  }

  const WOCHENTAGE_KURZ = ["So","Mo","Di","Mi","Do","Fr","Sa"];

  function renderWeather() {
    const data = wetterDaten;
    if (!data) return;
    const body = $("weatherBody");

    /* Die Karte trägt die Ansicht als Klasse — daran hängt auf dem
       Telefon, ob sie hoch genug für sieben Zeilen wird. */
    const karte = $("card-wetter");
    if (karte) karte.classList.toggle("woche", wetterAnsicht === "woche");

    if (wetterAnsicht === "woche") {
      const d = data.daily;
      const heuteKey = todayStr();
      let zeilen = "";
      for (let i = 0; i < (d.time || []).length; i++) {
        const datum = new Date(d.time[i] + "T00:00:00");
        const info = weatherCodeInfo(d.weather_code[i]);
        const istHeute = d.time[i] === heuteKey;
        zeilen += `
          <div class="wtag${istHeute ? " heute" : ""}" title="${fmtDate(d.time[i])} · ${info.text} · ${d.precipitation_probability_max?.[i] ?? 0}% Regen">
            <span class="wtag-name">${WOCHENTAGE_KURZ[datum.getDay()]}</span>
            <span class="wtag-icon">${WEATHER_ICONS[info.icon]}</span>
            <span class="wtag-regen${(d.precipitation_probability_max?.[i] || 0) >= 30 ? " hoch" : ""}">${TROPFEN_SVG}${d.precipitation_probability_max?.[i] ?? 0}%</span>
            <span class="wtag-min">${Math.round(d.temperature_2m_min[i])}°</span>
            <span class="wtag-max">${Math.round(d.temperature_2m_max[i])}°</span>
          </div>`;
      }
      body.innerHTML = `<div class="weather-woche">${zeilen}</div>`;
    } else {
      const cur = data.current;
      const info = weatherCodeInfo(cur.weather_code);
      const min = data.daily?.temperature_2m_min?.[0];
      const max = data.daily?.temperature_2m_max?.[0];
      const regen = data.daily?.precipitation_probability_max?.[0];
      const tempText = `${Math.round(cur.temperature_2m)}°`;
      body.innerHTML = `
        <div class="weather-main">
          <div class="weather-icon">${WEATHER_ICONS[info.icon]}</div>
          <div class="weather-werte">
            <div class="weather-temp" style="--zeichen:${tempText.length}">${tempText}</div>
            <div class="weather-desc">${info.text}</div>
          </div>
        </div>
        ${max !== undefined ? `
        <div class="weather-minmax">
          <span class="wmm min" title="Tiefstwert heute">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6.5 12.5 12 19l5.5-6.5"/></svg>
            ${Math.round(min)}°
          </span>
          <span class="wmm max" title="Höchstwert heute">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6.5 11.5 12 5l5.5 6.5"/></svg>
            ${Math.round(max)}°
          </span>
        </div>` : ""}
        ${regen !== undefined ? `
        <div class="weather-regen${regen >= 30 ? " hoch" : ""}" title="Regenwahrscheinlichkeit heute">
          ${TROPFEN_SVG}<span>${regen}%</span>
        </div>` : ""}`;
    }
  }

  /* Umschalter: aktuelles Wetter oder 7-Tage-Vorhersage */
  function updateWeatherToggleUI() {
    const btn = $("weatherViewToggle");
    const woche = wetterAnsicht === "woche";
    btn.classList.toggle("active", woche);
    btn.title = woche ? "Aktuelles Wetter anzeigen" : "7-Tage-Vorhersage anzeigen";
  }
  $("weatherViewToggle").addEventListener("click", () => {
    wetterAnsicht = wetterAnsicht === "woche" ? "jetzt" : "woche";
    store.set("lifeos_wetter_ansicht", wetterAnsicht);
    updateWeatherToggleUI();
    renderWeather();
  });
  updateWeatherToggleUI();

  loadWeather(false);
  setInterval(() => loadWeather(false), WEATHER_CACHE_MS);

  async function geocodeCity(name) {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=de&format=json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Geocoding fehlgeschlagen");
    const data = await res.json();
    if (!data.results || !data.results.length) throw new Error("Ort nicht gefunden");
    const r = data.results[0];
    return { lat: r.latitude, lon: r.longitude, name: r.name };
  }

  /* ==========================================================
     KALORIEN — Tick-Gauge (Bogen aus einzelnen Strichen)
     Ziel & Verbrauch werden ausschließlich in den Einstellungen
     gesetzt, nicht im Widget.
     ========================================================== */
  const G_CX = 100, G_CY = 100, G_R_IN = 66, G_R_OUT = 88;
  const G_START = 232;     // Grad, 0 = oben, im Uhrzeigersinn
  const G_SWEEP = 256;     // Öffnung unten
  const G_TICKS = 42;

  function polar(cx, cy, r, deg) {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
  }

  const tickEls = [];
  (function buildTicks() {
    const g = $("calGaugeTicks");
    const NS = "http://www.w3.org/2000/svg";
    for (let i = 0; i < G_TICKS; i++) {
      const a = G_START + (G_SWEEP * i) / (G_TICKS - 1);
      const p1 = polar(G_CX, G_CY, G_R_IN, a);
      const p2 = polar(G_CX, G_CY, G_R_OUT, a);
      const line = document.createElementNS(NS, "line");
      line.setAttribute("class", "cal-tick");
      line.style.setProperty("--i", i);   // steuert die Laufzeit des Lichts
      line.setAttribute("x1", p1.x.toFixed(2));
      line.setAttribute("y1", p1.y.toFixed(2));
      line.setAttribute("x2", p2.x.toFixed(2));
      line.setAttribute("y2", p2.y.toFixed(2));
      g.appendChild(line);
      tickEls.push(line);
    }
  })();

  function renderCalories() {
    if (kalorien.date !== todayStr()) {
      kalorien = { date: todayStr(), consumed: 0 };
      store.set("lifeos_kalorien", kalorien);
    }
    const goal = settings.calGoal || 0;
    const consumed = kalorien.consumed || 0;
    const isEmpty = goal <= 0;
    const over = !isEmpty && consumed > goal;

    $("calConsumed").textContent = consumed;
    $("calGoalDisplay").textContent = goal;
    $("calWidget").classList.toggle("empty", isEmpty);

    const pct = isEmpty ? 0 : Math.min(1, consumed / goal);
    const filled = Math.round(pct * G_TICKS);
    tickEls.forEach((el, i) => {
      el.classList.toggle("on", i < filled);
      el.classList.toggle("over", over && i < filled);
    });
      refreshVorschlag();
  }
  /* Licht einmal über den kompletten Bogen laufen lassen */
  (function ringSweep() {
    const wrap = document.querySelector(".cal-gauge-wrap");
    if (!wrap) return;
    wrap.classList.add("sweep");
    // 42 Striche à 14 ms Versatz + 0,5 s Animation, plus etwas Reserve
    setTimeout(() => wrap.classList.remove("sweep"), G_TICKS * 14 + 700);
  })();

  function setCaloriesConsumed(n) {
    kalorien = { date: todayStr(), consumed: Math.max(0, Math.round(n)) };
    store.set("lifeos_kalorien", kalorien);
    renderCalories();
  }
  renderCalories();

  /* ==========================================================
     BILDSCHIRMZEIT
     ========================================================== */
  function parseDurationToMinutes(str) {
    str = str.trim().toLowerCase().replace(",", ".");
    let m = str.match(/^(\d{1,2}):(\d{2})$/);
    if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
    m = str.match(/^(\d{1,2})\s*h\s*(\d{1,2})?\s*m?$/);
    if (m) return parseInt(m[1]) * 60 + (m[2] ? parseInt(m[2]) : 0);
    m = str.match(/^(\d+(\.\d+)?)\s*h?$/);
    if (m) return Math.round(parseFloat(m[1]) * 60);
    return null;
  }
  /* Unter einer Stunde sagt "0h 31" nichts — dann lieber Minuten */
  function formatMinutes(min) {
    const m = Math.max(0, Math.round(min));
    if (m < 60) return m + " min";
    return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}`;
  }
  function getDayEntry(key) {
    const e = screentime.history[key];
    if (!e || typeof e !== "object") return { phone: 0, pc: 0 };
    return { phone: e.phone || 0, pc: e.pc || 0 };
  }
  function setDayEntry(key, patch) {
    screentime.history[key] = { ...getDayEntry(key), ...patch };
    const keys = Object.keys(screentime.history).sort();
    if (keys.length > 30) delete screentime.history[keys[0]];
    store.set("lifeos_screentime", screentime);
  }

  let stRange = store.get("lifeos_st_range", "24h");

  /* ---------- Diagramm: gestapelte Flächen ----------
     Handy liegt unten, PC darauf — die obere Kante ist damit die
     Gesamtzeit. Beim Überfahren zeigt eine Führungslinie beide
     Einzelwerte plus Summe. */
  let stPunkte = [];          // aktuell gezeichnete Datenreihe
  let stGeometrie = null;     // Maße für die Treffererkennung
  let zeichneErneut = null;   // Timer für einen Nachzeichen-Versuch
  let letzterStand = "";      // Größe + Ansicht + Daten des letzten Aufbaus
  let animierenNext = true;   // nächster Aufbau soll sich einzeichnen

  const NS = "http://www.w3.org/2000/svg";

  /* Glatte Kurve durch die Punkte — monotone Interpolation (Fritsch-Carlson).
     Wichtig gegenüber der früheren Catmull-Rom-Glättung: die Kurve schwingt
     zwischen zwei Punkten nie über deren Wertebereich hinaus. Bei einem
     Absturz auf 0 (z.B. Bildschirmzeit) tauchte sie vorher unter die
     Nulllinie ab — was es in den Daten gar nicht geben kann.
     `yBasis` ist optional die Nulllinie und dient als zusätzliche Sperre. */
  function glatterPfad(punkte, yBasis) {
    const n = punkte.length;
    if (n < 2) return "";

    // Steigungen zwischen benachbarten Punkten
    const delta = [];
    for (let i = 0; i < n - 1; i++) {
      const dx = punkte[i + 1].x - punkte[i].x;
      delta[i] = dx === 0 ? 0 : (punkte[i + 1].y - punkte[i].y) / dx;
    }

    // Tangenten: innen gemittelt, aussen die Randsteigung
    const m = [];
    m[0] = delta[0];
    m[n - 1] = delta[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = (delta[i - 1] + delta[i]) / 2;

    // Tangenten so begrenzen, dass keine Überschwinger entstehen
    for (let i = 0; i < n - 1; i++) {
      if (delta[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      const a = m[i] / delta[i];
      const b = m[i + 1] / delta[i];
      const s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        m[i] = t * a * delta[i];
        m[i + 1] = t * b * delta[i];
      }
    }

    const sperre = y => (typeof yBasis === "number" ? Math.min(y, yBasis) : y);

    let d = `M ${punkte[0].x.toFixed(1)} ${sperre(punkte[0].y).toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) {
      const dx = punkte[i + 1].x - punkte[i].x;
      const c1y = sperre(punkte[i].y + (m[i] * dx) / 3);
      const c2y = sperre(punkte[i + 1].y - (m[i + 1] * dx) / 3);
      d += ` C ${(punkte[i].x + dx / 3).toFixed(1)} ${c1y.toFixed(1)},` +
           ` ${(punkte[i + 1].x - dx / 3).toFixed(1)} ${c2y.toFixed(1)},` +
           ` ${punkte[i + 1].x.toFixed(1)} ${sperre(punkte[i + 1].y).toFixed(1)}`;
    }
    return d;
  }

  function zeichneDiagramm() {
    const chart = $("stChart");
    const svg = $("stSvg");
    const box = svg.getBoundingClientRect();
    // Wird zu früh gezeichnet (Layout noch nicht fertig), liefert die
    // Messung fast 0 — dann lieber gleich noch einmal versuchen.
    if (box.width < 40 || box.height < 40) {
      clearTimeout(zeichneErneut);
      zeichneErneut = setTimeout(zeichneDiagramm, 120);
      return;
    }
    const W = Math.round(box.width);
    const H = Math.round(box.height);
    const padY = 8;

    // Identischer Stand? Dann steht das Diagramm schon richtig da.
    const stand = `${W}x${H}|${stRange}|${stPunkte.map(p => p.phone + "," + p.pc).join(";")}`;
    if (stand === letzterStand && !animierenNext) return;
    // Nur bei neuem Inhalt animieren, nicht bei bloßer Größenänderung
    const inhaltNeu = stand.split("|").slice(1).join("|")
                    !== letzterStand.split("|").slice(1).join("|");
    const sollAnimieren = animierenNext || inhaltNeu;
    animierenNext = false;
    letzterStand = stand;
    chart.classList.toggle("anim", sollAnimieren);

    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = "";

    if (!stPunkte.length) return;

    const maxWert = Math.max(30, ...stPunkte.map(p => p.phone + p.pc)) * 1.12;
    const x = i => stPunkte.length === 1 ? W / 2 : (i / (stPunkte.length - 1)) * W;
    const y = v => H - padY - (v / maxWert) * (H - padY * 2);

    stGeometrie = { W, H, x, y };

    const phonePunkte = stPunkte.map((p, i) => ({ x: x(i), y: y(p.phone) }));
    const gesamtPunkte = stPunkte.map((p, i) => ({ x: x(i), y: y(p.phone + p.pc) }));

    const el = (tag, attrs) => {
      const n = document.createElementNS(NS, tag);
      Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
      return n;
    };

    // Farbverläufe
    const defs = el("defs", {});
    defs.innerHTML = `
      <!-- Zwei Geraete, zwei Toene. Handy traegt das Blau, der Rechner
           ein neutrales Grau: die Unterscheidung ist hier keine
           Bewertung, deshalb hat sie auch keine Signalfarbe verdient.
           Feste Werte statt Variablen — ein stop-color ist ein
           Praesentationsattribut und kennt kein var(). Beide Toene
           tragen auf schwarzem wie auf weissem Grund. -->
      <linearGradient id="stGradPhone" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#007AFF" stop-opacity="0.55"/>
        <stop offset="100%" stop-color="#007AFF" stop-opacity="0.04"/>
      </linearGradient>
      <linearGradient id="stGradPc" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#8E8E93" stop-opacity="0.45"/>
        <stop offset="100%" stop-color="#8E8E93" stop-opacity="0.03"/>
      </linearGradient>`;
    svg.appendChild(defs);

    // Hilfslinien
    for (let i = 1; i <= 3; i++) {
      const gy = padY + ((H - padY * 2) / 4) * i;
      svg.appendChild(el("line", { class: "st-grid", x1: 0, y1: gy, x2: W, y2: gy }));
    }

    // Fläche PC liegt auf der Handy-Fläche (Stapel) …
    const pcFlaeche = glatterPfad(gesamtPunkte, y(0)) +
      ` L ${W} ${y(0)} L 0 ${y(0)} Z`;
    svg.appendChild(el("path", { class: "st-area pc", d: pcFlaeche, fill: "url(#stGradPc)" }));

    // … darüber die Handy-Fläche, damit die Trennlinie sichtbar bleibt
    const phoneFlaeche = glatterPfad(phonePunkte, y(0)) + ` L ${W} ${y(0)} L 0 ${y(0)} Z`;
    svg.appendChild(el("path", { class: "st-area phone", d: phoneFlaeche, fill: "url(#stGradPhone)" }));

    const linienPc = el("path", { class: "st-line pc", d: glatterPfad(gesamtPunkte, y(0)) });
    const linienPhone = el("path", { class: "st-line phone", d: glatterPfad(phonePunkte, y(0)) });
    svg.appendChild(linienPc);
    svg.appendChild(linienPhone);
    // Echte Pfadlänge setzen, damit sich die Linien sauber einzeichnen
    [linienPc, linienPhone].forEach(p => {
      try { p.style.setProperty("--laenge", Math.ceil(p.getTotalLength())); } catch (e) { /* egal */ }
    });

    /* Über jede Kurve läuft dauerhaft ein Licht in der Farbe ihrer Linie.
       Damit es hinten weich in die normale Linie übergeht, besteht es aus
       mehreren Lagen: die vorderste ist kurz und hell, die dahinter werden
       länger und blasser. Alle enden an derselben Stelle — dadurch entsteht
       ein Schweif, der ausläuft statt hart abzubrechen.
       Der Versatz jeder Lage wird um ihre eigene Länge verschoben, damit
       ihre Vorderkante mit der der anderen zusammenfällt. */
    /* Zwei Lagen: ein Kopf und ein blasser Schweif dahinter.
       Das Strichmuster ist absichtlich viel länger als die Kurve — dadurch
       ist das Licht nur etwa die halbe Zeit überhaupt zu sehen und es
       entsteht eine Pause zwischen zwei Durchläufen.
       Beide Lagen benutzen dieselbe Musterlänge, sonst würden sie im
       Lauf gegeneinander verrutschen. */
    const LAGEN = [
      { lang: 16, deckung: 1,    breite: 2.9, kopf: true  },
      { lang: 58, deckung: 0.26, breite: 2.2, kopf: false }
    ];

    [["pc", linienPc], ["phone", linienPhone]].forEach(([reihe, quelle]) => {
      let laenge = 0;
      try { laenge = Math.ceil(quelle.getTotalLength()); } catch (e) { return; }
      if (!laenge) return;
      const muster = Math.round(laenge * 1.6);   // Lauf plus kürzere Pause
      const pfad = quelle.getAttribute("d");
      // Hinterste Lage zuerst, damit die Spitze obenauf liegt
      [...LAGEN].reverse().forEach(lage => {
        const licht = el("path", { class: "st-lauflicht " + reihe + (lage.kopf ? " kopf" : " schweif"), d: pfad });
        licht.style.setProperty("--stueck", lage.lang);
        licht.style.setProperty("--luecke", muster - lage.lang);
        licht.style.setProperty("--breite", lage.breite);
        licht.style.setProperty("--deckung", lage.deckung);
        licht.style.setProperty("--lauf-start", lage.lang);
        licht.style.setProperty("--lauf-ende", lage.lang - muster);
        svg.appendChild(licht);
      });
    });

    // Führungslinie und Punkte (erst beim Überfahren sichtbar)
    svg.appendChild(el("line", { class: "st-guide", id: "stGuide", x1: 0, y1: padY, x2: 0, y2: H - padY }));
    svg.appendChild(el("circle", { class: "st-dot pc", id: "stDotPc", r: 4, cx: 0, cy: 0 }));
    svg.appendChild(el("circle", { class: "st-dot phone", id: "stDotPhone", r: 4, cx: 0, cy: 0 }));

    // Achsenbeschriftung
    const achse = $("stAxis");
    achse.innerHTML = stPunkte
      .map((p, i) => p.label ? `<span class="${p.jetzt ? "jetzt" : ""}">${p.label}</span>` : "")
      .filter(Boolean).join("");
  }

  /* Treffererkennung: nächstgelegener Datenpunkt zur Mausposition */
  function stHover(ev) {
    if (!stGeometrie || !stPunkte.length) return;
    const svg = $("stSvg");
    const box = svg.getBoundingClientRect();
    const mx = ev.clientX - box.left;
    const idx = Math.max(0, Math.min(stPunkte.length - 1,
      Math.round((mx / box.width) * (stPunkte.length - 1))));
    const p = stPunkte[idx];
    const px = stGeometrie.x(idx);

    const guide = $("stGuide"), dotPhone = $("stDotPhone"), dotPc = $("stDotPc");
    if (!guide) return;
    guide.setAttribute("x1", px); guide.setAttribute("x2", px);
    dotPhone.setAttribute("cx", px); dotPhone.setAttribute("cy", stGeometrie.y(p.phone));
    dotPc.setAttribute("cx", px); dotPc.setAttribute("cy", stGeometrie.y(p.phone + p.pc));
    $("stChart").classList.add("aktiv");

    chartTooltip.innerHTML =
      `${p.tooltipLabel}<br>Handy ${formatMinutes(p.phone)} · PC ${formatMinutes(p.pc)}` +
      `<br>Gesamt ${formatMinutes(p.phone + p.pc)}`;
    const cx = box.left + px;
    chartTooltip.style.left = cx + "px";
    chartTooltip.style.top = (box.top - 10) + "px";
    chartTooltip.classList.add("visible");
  }

  function stHoverEnde() {
    $("stChart").classList.remove("aktiv");
    chartTooltip.classList.remove("visible");
  }

  function renderScreenTime(animieren) {
    if (animieren) animierenNext = true;
    const today = todayStr();

    if (stRange === "24h") {
      const e = getDayEntry(today);
      $("stPhoneVal").textContent = formatMinutes(e.phone);
      $("stPcVal").textContent = formatMinutes(e.pc);

      const stunden = hourlyFor(today);
      const jetzt = new Date().getHours();
      stPunkte = stunden.map((h, i) => ({
        phone: h.phone,
        pc: h.pc,
        label: (i % 6 === 0) ? String(i).padStart(2, "0") : "",
        jetzt: i === jetzt,
        tooltipLabel: `${String(i).padStart(2,"0")}–${String((i + 1) % 24).padStart(2,"0")} Uhr`
      }));
    } else {
      let wPhone = 0, wPc = 0;
      const tage = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const key = dateKey(d);
        const e = getDayEntry(key);
        wPhone += e.phone; wPc += e.pc;
        tage.push({
          phone: e.phone,
          pc: e.pc,
          label: WEEKDAYS[d.getDay()].slice(0, 2),
          jetzt: key === today,
          tooltipLabel: WEEKDAYS[d.getDay()]
        });
      }
      $("stPhoneVal").textContent = formatMinutes(wPhone);
      $("stPcVal").textContent = formatMinutes(wPc);
      stPunkte = tage;
    }

    zeichneDiagramm();
    refreshVorschlag();
  }
  /* ---------- 24H: ein Balken pro Stunde ----------
     Solange keine echten Stundendaten vorliegen, wird die Tagessumme über
     einen typischen Tagesverlauf verteilt: die Tagessumme stimmt exakt,
     die Verteilung über die Stunden ist geschätzt. Sobald eine API echte
     Stundenwerte liefert, landen die unter screentime.hours[datum] und
     werden dann bevorzugt genutzt. */
  const HOUR_WEIGHTS = [2,1,0,0,0,1, 2,5,6,5,6,7, 9,7,6,7,8,10, 12,13,11,8,5,3];

  function hourlyFor(key) {
    const stored = screentime.hours && screentime.hours[key];
    if (Array.isArray(stored) && stored.length === 24) return stored;

    const e = getDayEntry(key);
    const isToday = key === todayStr();
    // Nur bereits vergangene Stunden bekommen Zeit zugewiesen. Jede davon
    // erhält mindestens Gewicht 1, damit überhaupt Kapazität da ist.
    const elapsed = isToday ? new Date().getHours() + 1 : 24;
    const w = HOUR_WEIGHTS.map((v, h) => h < elapsed ? Math.max(v, 1) : 0);

    const phone = spreadOverHours(e.phone, w);
    const pc = spreadOverHours(e.pc, w);
    return phone.map((v, i) => ({ phone: v, pc: pc[i] }));
  }

  /* Verteilt Minuten gewichtet auf die Stunden — aber nie mehr als 60
     Minuten pro Stunde (mehr geht pro Gerät physisch nicht). Was durch
     die Deckelung übrig bleibt, wird auf die Stunden mit Restkapazität
     nachverteilt. */
  function spreadOverHours(totalMinutes, weights) {
    const res = new Array(weights.length).fill(0);
    if (totalMinutes <= 0) return res;
    let remaining = totalMinutes;
    const w = weights.slice();

    for (let pass = 0; pass < 8 && remaining > 0.01; pass++) {
      const sum = w.reduce((a, b) => a + b, 0);
      if (sum <= 0) break;
      let placed = 0;
      for (let i = 0; i < w.length; i++) {
        if (w[i] <= 0) continue;
        const room = 60 - res[i];
        if (room <= 0) { w[i] = 0; continue; }
        const add = Math.min(room, (remaining * w[i]) / sum);
        res[i] += add;
        placed += add;
      }
      remaining -= placed;
      if (placed <= 0.01) break;
    }
    return res.map(v => Math.round(v));
  }


  document.querySelectorAll("#screenTimeToggle .stbtn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.range === stRange);
    btn.addEventListener("click", () => {
      stRange = btn.dataset.range;
      store.set("lifeos_st_range", stRange);
      document.querySelectorAll("#screenTimeToggle .stbtn").forEach(b => b.classList.toggle("active", b === btn));
      renderScreenTime(true);
    });
  });

  const chartTooltip = $("chartTooltip");

  // Hilfsfunktion für punktbezogene Tooltips (Streak-Kästchen)
  function positionTooltip(el) {
    const r = el.getBoundingClientRect();
    chartTooltip.style.left = (r.left + r.width / 2) + "px";
    chartTooltip.style.top = (r.top - 8) + "px";
  }

  // Führungslinie folgt der Maus über der gesamten Diagrammfläche
  $("stChart").addEventListener("mousemove", stHover);
  $("stChart").addEventListener("mouseleave", stHoverEnde);

  // Über die Legende eine Reihe hervorheben
  document.querySelectorAll("#stLegend .legend-item").forEach(item => {
    item.addEventListener("mouseenter", () => $("stChart").classList.add("nur-" + item.dataset.series));
    item.addEventListener("mouseleave", () => $("stChart").classList.remove("nur-phone", "nur-pc"));
  });

  // Diagramm neu zeichnen, wenn sich die Kartengröße ändert
  if ("ResizeObserver" in window) {
    new ResizeObserver(() => zeichneDiagramm()).observe($("stChart"));
  }
  window.addEventListener("resize", zeichneDiagramm);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(zeichneDiagramm);
  // Sicherheitsnetze, falls ResizeObserver nicht greift. Sie zeichnen nur
  // dann wirklich, wenn sich Größe oder Daten geändert haben — sonst
  // liefe die Einzeichen-Animation mehrfach.
  setTimeout(zeichneDiagramm, 150);
  setTimeout(zeichneDiagramm, 600);

  renderScreenTime(true);

  /* ==========================================================
     TERMINE / KLAUSUREN
     Nur sichtbar, wenn etwas Dringendes ansteht. Angelegt wird
     (vorerst) über die Smart-Suche, nicht im Widget.
     ========================================================== */
  // TODO: später in einem eigenen Klausurtermine-Panel einstellbar machen
  const URGENCY_DAYS = 14;

  function daysUntil(dateStr) {
    const today = new Date(); today.setHours(0,0,0,0);
    return Math.round((new Date(dateStr + "T00:00:00") - today) / 86400000);
  }
  const isUrgent = dateStr => {
    const d = daysUntil(dateStr);
    return d >= 0 && d <= URGENCY_DAYS;
  };
  function fmtDate(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    return `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")}.${d.getFullYear()}`;
  }
  /* ==========================================================
     SCHULTAGE
     „In 137 Tagen" klingt nach Ewigkeit. Für eine Klausur zählt
     aber, wie oft man bis dahin noch in dem Fach sitzt — und
     zwischen heute und der Klausur liegen Wochenenden, Feiertage
     und Ferien.

     Die Feiertage rechnet das Dashboard selbst aus (Berlin, mit
     dem Osterdatum als Angelpunkt). Die Ferien kommen aus deinem
     Google-Kalender: dort stehen sie ohnehin, und bisher wurden
     sie nur ausgeblendet.
     ========================================================== */
  let ferien = store.get("lifeos_ferien", []);

  /* Osterformel nach Gauß/Butcher — gilt für den gregorianischen
     Kalender und damit für jedes Jahr, das hier vorkommt. */
  function ostersonntag(jahr) {
    const a = jahr % 19, b = Math.floor(jahr / 100), c = jahr % 100;
    const d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const tage = h + l - 7 * m + 114;
    return new Date(jahr, Math.floor(tage / 31) - 1, (tage % 31) + 1);
  }

  const feiertagCache = {};

  /* Die gesetzlichen Feiertage in Berlin. Der Frauentag am 8. März
     ist einer davon — außerhalb Berlins wäre die Liste kürzer. */
  function feiertage(jahr) {
    if (feiertagCache[jahr]) return feiertagCache[jahr];
    const ostern = ostersonntag(jahr);
    const versetzt = tage => {
      const d = new Date(ostern); d.setDate(ostern.getDate() + tage);
      return dateKey(d);
    };
    const fest = (monat, tag) => dateKey(new Date(jahr, monat - 1, tag));

    const liste = {
      [fest(1, 1)]:   "Neujahr",
      [fest(3, 8)]:   "Frauentag",
      [versetzt(-2)]: "Karfreitag",
      [versetzt(1)]:  "Ostermontag",
      [fest(5, 1)]:   "Tag der Arbeit",
      [versetzt(39)]: "Christi Himmelfahrt",
      [versetzt(50)]: "Pfingstmontag",
      [fest(10, 3)]:  "Tag der Deutschen Einheit",
      [fest(12, 25)]: "1. Weihnachtstag",
      [fest(12, 26)]: "2. Weihnachtstag"
    };
    feiertagCache[jahr] = liste;
    return liste;
  }

  const feiertagName = iso =>
    feiertage(Number(String(iso).slice(0, 4)))[iso] || null;

  /* In welchem Ferienblock liegt der Tag? Gibt den Titel zurück,
     damit die Kachel im Kalender sagen kann, welche Ferien es sind. */
  function ferienName(iso) {
    const f = (ferien || []).find(x => x && iso >= x.von && iso <= x.bis);
    return f ? f.titel : null;
  }

  const istWochenende = iso => {
    const t = new Date(iso + "T00:00:00").getDay();
    return t === 0 || t === 6;
  };

  const istSchultag = iso =>
    !istWochenende(iso) && !feiertagName(iso) && !ferienName(iso);

  /* Wie viele Schultage liegen zwischen morgen und diesem Datum —
     der Tag selbst zählt mit, wenn er ein Schultag ist. */
  function schultageBis(iso) {
    const ziel = new Date(iso + "T00:00:00");
    const lauf = new Date(); lauf.setHours(0, 0, 0, 0);
    lauf.setDate(lauf.getDate() + 1);
    let zahl = 0, schutz = 0;
    while (lauf <= ziel && schutz++ < 1500) {
      if (istSchultag(dateKey(lauf))) zahl++;
      lauf.setDate(lauf.getDate() + 1);
    }
    return zahl;
  }

  /* Mit "iso" rechnet die Pille in Schultagen — das ist für alles
     Schulische die ehrlichere Zahl. Ohne "iso" bleibt es beim
     Kalendertag, denn ein Zahnarzttermin schert sich nicht um
     Ferien. */
  const badgeFor = (diff, iso) => {
    if (diff < 0) return diff === -1 ? "seit gestern" : `seit ${-diff} Tagen`;
    if (diff === 0) return "HEUTE";
    if (diff === 1) return "morgen";
    if (!iso) return `in ${diff} Tagen`;
    const schul = schultageBis(iso);
    if (schul === 0) return "erst nach den Ferien";
    return `in ${schul} ${schul === 1 ? "Schultag" : "Schultagen"}`;
  };

  /* Der Pfeil sagt "hier geht es weiter" — er ersetzt das doppelte
     Seitensymbol, das vorher im Malzeichen und im Knopf stand. */
  const SYM_PFEIL_RECHTS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
  const SYM_KALENDER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5h17M8 3.2v3.6M16 3.2v3.6"/></svg>';
  const SYM_WECKER   = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="7.4"/><path d="M12 9.6V13l2.4 1.5M5.2 4.2 3 6.4M18.8 4.2 21 6.4"/></svg>';
  const SYM_LERNEN   = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7.3C10.4 5.9 8.4 5.2 5.6 5.2c-.9 0-1.6.7-1.6 1.6v9.7c0 .9.7 1.6 1.6 1.6 2.8 0 4.8.7 6.4 2.1 1.6-1.4 3.6-2.1 6.4-2.1.9 0 1.6-.7 1.6-1.6V6.8c0-.9-.7-1.6-1.6-1.6-2.8 0-4.8.7-6.4 2.1Z"/><path d="M12 7.3v13"/></svg>';

  /* Farbe nach Restzeit — ab acht Tagen gruen, vier bis sieben gelb,
     drei oder weniger rot. Eine Stelle, damit alle Listen gleich
     einfaerben. */
  /* Hausaufgaben laufen kürzer als Klausuren: bleibt nur noch ein Tag
     (oder ist die Frist vorbei), steht die Zeile rot. */
  function hausFrist(diff) {
    if (diff <= 1) return "frist-rot";
    if (diff <= 3) return "frist-gelb";
    return "frist-gruen";
  }

  function fristKlasse(diff) {
    if (diff < 0) return "frist-vorbei";
    if (diff <= 3) return "frist-rot";
    if (diff <= 7) return "frist-gelb";
    return "frist-gruen";
  }

  /* Wie viele Einträge sollen höchstens erscheinen */
  const NAECHSTE_LIMIT = 5;

  /* Termine und Klausuren in einer Liste, nach Datum sortiert.
     Vergangenes fällt raus, angezeigt wird nur, was noch kommt. */
  function naechsteEintraege() {
    const heute = [];
    termine.forEach(t => heute.push({ ...t, art: "termin" }));
    klausuren.forEach(k => heute.push({ ...k, art: "klausur" }));
    /* Offene Hausaufgaben stehen mit drin — erledigte nicht mehr */
    hausaufgaben.forEach(h => { if (!h.erledigt) heute.push({ ...h, art: "hausaufgabe" }); });
    /* Ein Thema ohne Datum will nichts von einem bestimmten Tag —
       nur die mit Termin gehören in die Liste. */
    themen.forEach(t => { if (t.date) heute.push({ ...t, art: "thema" }); });
    /* Termine und Klausuren sind mit ihrem Tag erledigt. Eine
       Hausaufgabe dagegen bleibt stehen, bis sie abgehakt ist — sonst
       verschwindet ausgerechnet das aus dem Blick, was überfällig ist.
       Nach zwei Wochen ohne Haken lässt auch sie los. */
    return heute
      .filter(e => e.art === "hausaufgabe" ? daysUntil(e.date) >= -14 : daysUntil(e.date) >= 0)
      .sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
  }

  /* Wie sehr ein Eintrag den Platz im Widget verdient. Rein
     chronologisch verdrängt ein Familiengeburtstag in vier Tagen die
     Klausur nächste Woche — und die ist das, wofür man etwas tun
     muss. Angezeigt wird trotzdem chronologisch; die Punkte
     entscheiden nur, wer es in die kurze Liste schafft. */
  function terminGewicht(e) {
    const d = daysUntil(e.date);
    let p = e.art === "klausur" ? 50 : e.art === "hausaufgabe" ? 35 : 10;
    if (d < 0) p += 40;                       // überfällig sticht alles
    else if (d === 0) p += 30;
    else if (d <= 2) p += 20;
    else if (d <= 7) p += 10;
    /* Ein Termin mit Uhrzeit ist eine Verabredung, ein ganztägiger
       oft nur eine Notiz im Kalender. */
    if (e.art === "termin" && e.time) p += 8;
    return p;
  }

  /* Ansichtssache, kein Inhalt: bleibt auf diesem Gerät. */
  let naechsteOffen = localStorage.getItem("lifeos_naechste_offen") === "1";

  function loescheEintrag(id, art) {
    if (art === "hausaufgabe") {
      hausaufgaben = hausaufgaben.filter(h => h.id !== id);
      store.set("lifeos_hausaufgaben", hausaufgaben);
    } else if (art === "klausur") {
      klausuren = klausuren.filter(k => k.id !== id);
      klausurenSichern();
    } else {
      termine = termine.filter(t => t.id !== id);
      store.set("lifeos_termine", termine);
    }
    renderNaechste();
  }

  function renderNaechste() {
    const alle = naechsteEintraege();
    const list = $("naechsteList");
    const widget = $("naechsteWidget");
    list.innerHTML = "";

    /* Eingeklappt nur die gewichtigsten — ausgeklappt alles. */
    const wichtigste = alle.slice()
      .sort((a, b) => terminGewicht(b) - terminGewicht(a))
      .slice(0, NAECHSTE_LIMIT);
    const eintraege = naechsteOffen
      ? alle
      : alle.filter(e => wichtigste.includes(e));

    eintraege.forEach(e => {
      const diff = daysUntil(e.date);
      const li = document.createElement("li");
      const frist = e.art === "hausaufgabe" ? hausFrist(diff) : fristKlasse(diff);
      /* Nach Bild 1 eine Kapsel, nach Bild 2 an einem Strahl:
         links das Malzeichen mit der Farbe der Frist, in der Mitte
         Sache und Zusammenhang, rechts die Frist als Marke.
         Der Punkt am Strahl entsteht in der style.css aus diesen
         Zustandsklassen — heute, bald, sonst. */
      li.className = "insel entry-item " + e.art + " " + frist
                   + (diff === 0 ? " today" : diff <= 3 ? " soon" : "");
      const ton = diff === 0 ? " rot" : diff <= 3 ? " gelb" : " blau";
      li.innerHTML = `
        <span class="i-mal${ton}">${e.art === "termin" ? SYM_KALENDER : SYM_LERNEN}</span>
        <div class="i-text">
          <div class="i-sache">${
            e.art === "klausur" ? (klausurZusatz(e) || pruefungWort(e)) + " · "
            : e.art === "hausaufgabe"
              ? "Hausaufgabe" + (e.fach ? " " + fachInfo(e.fach).kurz : "") + " · "
            : e.art === "thema" ? "Thema · "
              : ""}${fmtDate(e.date)}${e.time ? " · " + e.time : ""}</div>
          <div class="i-wert">${escapeHTML(e.title)}</div>
        </div>
        <span class="i-rechts">
          <span class="marke${ton}">${badgeFor(diff, e.art === "termin" ? null : e.date)}</span>
          <button class="entry-go" data-id="${e.id}" data-art="${e.art}"
            title="${e.art === "termin" ? "Zum Kalender" : "Zur Lernseite"}"
            aria-label="${e.art === "termin" ? "Zum Kalender" : "Zur Lernseite"}">${SYM_PFEIL_RECHTS}</button>
        </span>`;
      list.appendChild(li);
    });

    /* Geloescht wird nur dort, wo der Eintrag zu Hause ist — im Widget
       waere ein Klick daneben zu teuer. Von hier geht es stattdessen
       zur passenden Seite. */
    list.querySelectorAll(".entry-go").forEach(btn => {
      btn.addEventListener("click", () => {
        const e = eintraege.find(x => x.id === btn.dataset.id);
        if (btn.dataset.art === "klausur") lernenZeigen(btn.dataset.id);
        else if (btn.dataset.art === "hausaufgabe") hausaufgabenZeigen(btn.dataset.id);
        else if (btn.dataset.art === "thema") themaZeigen(btn.dataset.id);
        else kalenderZeigen(e ? e.date : null);
      });
    });

    /* Der Ausklapper steht nur da, wenn er etwas zu zeigen hat. */
    const versteckt = alle.length - eintraege.length;
    let mehr = $("naechsteMehr");
    if (versteckt > 0 || naechsteOffen) {
      if (!mehr) {
        mehr = document.createElement("button");
        mehr.type = "button";
        mehr.id = "naechsteMehr";
        mehr.className = "naechste-mehr";
        mehr.addEventListener("click", () => {
          naechsteOffen = !naechsteOffen;
          localStorage.setItem("lifeos_naechste_offen", naechsteOffen ? "1" : "0");
          renderNaechste();
        });
        widget.appendChild(mehr);
      }
      mehr.textContent = naechsteOffen
        ? "Weniger zeigen"
        : "Alle " + alle.length + " zeigen";
      mehr.setAttribute("aria-expanded", naechsteOffen ? "true" : "false");
    } else if (mehr) {
      mehr.remove();
    }

    // Nichts eingetragen: Inhalt unscharf, Hinweis darüber
    widget.classList.toggle("empty", eintraege.length === 0);
    widget.classList.toggle("offen", naechsteOffen);
    /* Die Zahl im Kopf meint immer alles, was ansteht — sonst
       schrumpft sie beim Einklappen und behauptet etwas Falsches. */
    $("naechsteCount").textContent = String(alle.length);
    refreshVorschlag();
  }

  // Beide Namen bleiben erhalten, damit Suche und Einstellungen
  // weiterhin einfach "neu zeichnen" aufrufen können.
  const renderTermine = renderNaechste;
  const renderKlausuren = renderNaechste;
  renderNaechste();

  /* Beim Öffnen der Seite einmal auf knappe Hausaufgaben hinweisen.
     Der Aufruf steht in einem Timer, weil die Hilfsfunktionen weiter
     unten stehen — und weil der Hinweis erst erscheinen soll, wenn
     die Seite fertig eingelaufen ist. */
  function hausaufgabenMelden() {
    const knapp = offeneHausaufgaben().filter(h => daysUntil(h.date) <= 1);
    if (!knapp.length) return;

    const vorbei = knapp.filter(h => daysUntil(h.date) < 0);
    if (knapp.length === 1) {
      const h = knapp[0];
      const wann = daysUntil(h.date) < 0 ? "ist überfällig"
                 : daysUntil(h.date) === 0 ? "ist heute fällig" : "ist morgen fällig";
      showToast(`Hausaufgabe „${h.title}" ${wann}`, "warn");
      return;
    }
    showToast(`${knapp.length} Hausaufgaben ${vorbei.length ? "überfällig oder gleich fällig" : "sind bald fällig"}`,
              "warn");
  }
  setTimeout(hausaufgabenMelden, 1200);

  /* ==========================================================
     STREAKS — eine Serie je Habit
     Vorher zählte ein Tag nur, wenn ALLE Habits erledigt waren.
     Das kam in der Praxis fast nie vor, die Anzeige stand deshalb
     dauerhaft auf 1. Jetzt hat jedes Habit seine eigene Serie —
     das ist eindeutig und braucht keinen willkürlichen Schwellwert.
     ========================================================== */
  const habitErledigt = (id, key) => (habits.done[key] || []).includes(id);

  /* ---- Dieselbe Rechnung, aber auf dem eigenen Streak-Bestand ---- */
  const streakErledigt = (id, key) => (streaks.done[key] || []).includes(id);

  function streakLaenge(id) {
    const d = new Date();
    if (!streakErledigt(id, dateKey(d))) d.setDate(d.getDate() - 1);
    let tage = 0;
    while (streakErledigt(id, dateKey(d))) {
      tage++;
      d.setDate(d.getDate() - 1);
    }
    return tage;
  }

  function streakBest(id) {
    const keys = Object.keys(streaks.done).sort();
    let best = 0, lauf = 0, vorher = null;
    keys.forEach(key => {
      if (!streakErledigt(id, key)) { lauf = 0; vorher = key; return; }
      const d = new Date(key + "T00:00:00");
      const gestern = new Date(d); gestern.setDate(gestern.getDate() - 1);
      lauf = (vorher === dateKey(gestern)) ? lauf + 1 : 1;
      best = Math.max(best, lauf);
      vorher = key;
    });
    return best;
  }

  /* Alle Streaks mit ihrer aktuellen Serie, längste zuerst */
  function alleStreaks() {
    return streaks.list.slice(0, STREAK_LIMIT)
      .map(e => ({ id: e.id, name: e.name, quelle: e.quelle || "manuell", tage: streakLaenge(e.id) }))
      .sort((a, b) => b.tage - a.tage);
  }

  /* Einen Tag setzen oder zurücknehmen. Genau hier hängt sich später
     eine API ein — deshalb ist die Funktion nach außen erreichbar. */
  function streakSetzen(id, key, erledigt) {
    const liste = new Set(streaks.done[key] || []);
    erledigt ? liste.add(id) : liste.delete(id);
    streaks.done[key] = [...liste];
    store.set("lifeos_streaks", streaks);
  }

  function toggleStreak(id, ereignis) {
    const key = todayStr();
    const neu = !streakErledigt(id, key);
    streakSetzen(id, key, neu);
    if (neu) nutzAktion("streak");
    /* Den Punkt abgreifen, solange die angeklickte Zeile noch steht —
       gleich darauf zeichnet renderStreaks sie neu. */
    const punkt = neu ? glutPunkt(ereignis, ".sr-flamme, .sk-flamme") : null;
    renderStreaks(neu ? id : undefined);

    if (neu) {
      /* Die Farbe dagegen erst danach: vorher trug die Zeile noch das
         Grau des offenen Tages, ihre Stufe bekommt sie erst beim
         Neuzeichnen. */
      const frisch = document.querySelector(`.streak-row[data-habit="${id}"] .sr-flamme`)
                  || document.querySelector(`.streak-kachel[data-habit="${id}"] .sk-flamme`);
      if (punkt && frisch) {
        const farbe = (getComputedStyle(frisch).color.match(/\d+/g) || []).slice(0, 3);
        if (farbe.length === 3) punkt.rgb = farbe.join(", ");
      }
      glutZeigen(punkt, streakStufe(streakLaenge(id)));
    }
    refreshVorschlag();
  }

  /* Einstiegspunkt für spätere Anbindungen (z.B. Schritte, Duolingo).
     Beispiel: window.lifeos.streakSetzen("schritte", "2026-08-23", true) */
  window.lifeos = window.lifeos || {};
  window.lifeos.streakSetzen = (id, key, erledigt = true) => {
    streakSetzen(id, key || todayStr(), erledigt);
    renderStreaks();
    refreshVorschlag();
  };
  window.lifeos.streakListe = () => alleStreaks();

  /* Flamme im Stil der bekannten Streak-Anzeigen: je länger die Serie,
     desto "heißer" die Farbe. Ist der Tag noch offen, bleibt sie grau. */
  function streakStufe(tage) {
    if (tage >= 30) return 5;
    if (tage >= 14) return 4;
    if (tage >= 7)  return 3;
    if (tage >= 3)  return 2;
    if (tage >= 1)  return 1;
    return 0;
  }

  const FLAMME_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path class="fl-aussen" d="M12 2.5c.6 2.6-1.6 3.9-2.9 5.6C7.9 9.6 7 11 7 12.8a5 5 0 0 0 10 0c0-2-1-3.4-2-4.6.1 1.7-.6 2.7-1.6 2.7-1.1 0-1.7-1-1.1-2.3.8-1.7.6-4-.4-6.1Z"/>
      <path class="fl-kern" d="M12.1 13.2c.4 1-.7 1.5-.7 2.5a2 2 0 0 0 4 0c0-1-.5-1.7-1-2.2.1.8-.3 1.3-.8 1.3-.5 0-.8-.5-.5-1.1.1-.3.1-.7-.1-1.1-.3.2-.6.4-.9.6Z"/>
    </svg>`;

  /* ==========================================================
     GLUT — was beim Abhaken passiert
     Nichts liegt über der Seite. Das Licht sitzt ganz unten, unter
     allen Widgets: im selben Stockwerk wie der Seitenhintergrund.

     Beim Druck ist die Fläche sofort in der Farbe der Flamme gefärbt
     und zieht sich dann als Kreis auf sie zusammen. Sie endet genau
     dann, wenn die Flamme ihr Aufploppen beendet hat — beide laufen
     deshalb gleich lang.

     Die Karten sind mattes Glas (backdrop-filter): sie greifen ab,
     was darunter leuchtet, und färben sich von selbst ein. Nichts
     wird vergrößert, nichts wird unscharf.
     ========================================================== */
  const GLUT_DAUER = 1400;     // dehnen, kurz stehen, wieder sammeln

  /* "weite" ist der Durchmesser des Scheins, gemessen an der kürzeren
     Bildschirmseite: selbst die höchste Stufe bleibt damit ein Hof um
     die Flamme und nimmt nicht die ganze Seite ein. Die Helligkeit ist
     niedrig gehalten — der Schein steht über eine Sekunde an, das wirkt
     kräftiger als ein kurzer Ausschlag. Stufe 1 bleibt ohne: die erste
     Flamme sollte so bleiben, wie sie war. */
  const GLUT = {
    2: { weite: 0.055, wucht: 0.14 },
    3: { weite: 0.075, wucht: 0.17 },
    4: { weite: 0.090, wucht: 0.20 },
    5: { weite: 0.105, wucht: 0.24 }
  };

  const GLUT_ERSATZ = "168, 85, 247";      // Violett, wenn keine Farbe zu holen ist

  let glutLage = null;

  /* Punkt und Farbe müssen im Klick selbst abgegriffen werden: danach
     ist "currentTarget" leer, und bei den Streaks hat das Neuzeichnen
     die Zeile längst ersetzt. Der Klickpunkt ist der letzte Halt. */
  function glutPunkt(ereignis, auswahl) {
    const zeile = ereignis && ereignis.currentTarget;
    const ziel = zeile && (zeile.querySelector(auswahl) || zeile);

    let x = null, y = null;
    if (ziel) {
      const f = ziel.getBoundingClientRect();
      if (f.width) { x = f.left + f.width / 2; y = f.top + f.height / 2; }
    }
    if (x === null && ereignis && (ereignis.clientX || ereignis.clientY)) {
      x = ereignis.clientX; y = ereignis.clientY;
    }
    if (x === null) return null;

    /* Die Flamme trägt ihre Farbe in "color", der Habit-Knopf als
       Zahlentripel in "--glut". So stehen die Farben nur in der CSS. */
    let rgb = GLUT_ERSATZ;
    if (ziel) {
      const stil = getComputedStyle(ziel);
      const eigen = stil.getPropertyValue("--glut").trim();
      const ausFarbe = (stil.color || "").match(/\d+/g);
      if (eigen) rgb = eigen;
      else if (ausFarbe) rgb = ausFarbe.slice(0, 3).join(", ");
    }
    return { x, y, rgb };
  }

  function glutZeigen(punkt, stufe) {
    /* Der Lichtschein beim Abhaken ist entfernt — auf Wunsch, und er
       passt auch nicht mehr: er lag hinter den Karten und schien durch
       sie hindurch. Die Karten sind jetzt feste Flaechen, eine Scheibe
       die nichts durchlaesst kann auch nichts zeigen. Die Funktion
       bleibt als leere Huelle, damit die zwei Aufrufstellen nichts
       wissen muessen. */
    return;
    const plan = GLUT[stufe];
    if (!plan || !punkt) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    /* Bezug ist die kürzere Bildschirmseite, nicht die Diagonale —
       sonst wächst der Schein auf breiten Schirmen über alles hinaus. */
    const bezug = Math.min(window.innerWidth, window.innerHeight);

    if (glutLage) glutLage.remove();
    const lage = document.createElement("div");
    glutLage = lage;
    lage.className = "glut";
    lage.setAttribute("aria-hidden", "true");

    const setz = (name, wert) => lage.style.setProperty(name, wert);
    setz("--fx", punkt.x + "px");
    setz("--fy", punkt.y + "px");
    setz("--rgb", punkt.rgb);
    setz("--weite", bezug * plan.weite + "px");
    setz("--wucht", String(plan.wucht));
    setz("--dauer", GLUT_DAUER + "ms");

    lage.innerHTML = `<span class="glut-hof"></span>` +
                     `<span class="glut-licht"></span>` +
                     `<span class="glut-welle"></span>`;
    document.body.appendChild(lage);

    /* Dasselbe Licht noch einmal als Spiegelung auf den Karten.
       "background-attachment: fixed" wäre der naheliegende Weg, geht
       hier aber nicht: der backdrop-filter jeder Karte macht sie zum
       Bezugsrahmen, der Lichtfleck säße dann außerhalb von ihr. Also
       bekommt jede Karte den Punkt in ihren eigenen Koordinaten —
       das Ergebnis ist dasselbe, ein Licht über alle Karten hinweg. */
    const wurzel = document.documentElement;
    wurzel.style.setProperty("--glanz-rgb", punkt.rgb);
    document.querySelectorAll(".card").forEach(karte => {
      const feld = karte.getBoundingClientRect();
      karte.style.setProperty("--glanz-fx", (punkt.x - feld.left) + "px");
      karte.style.setProperty("--glanz-fy", (punkt.y - feld.top) + "px");
    });
    wurzel.style.setProperty("--glanz-weit", bezug * plan.weite * 2.2 + "px");
    wurzel.style.setProperty("--glanz-dauer", GLUT_DAUER + "ms");
    document.body.classList.remove("glanzt");
    void document.body.offsetWidth;          // Lauf neu starten
    document.body.classList.add("glanzt");

    setTimeout(() => {
      if (glutLage !== lage) return;      // inzwischen läuft schon die nächste
      lage.remove();
      glutLage = null;
      document.body.classList.remove("glanzt");
    }, GLUT_DAUER + 120);
  }

  function renderStreaks(entfaltenId) {
    const liste = alleStreaks();
    const bestGesamt = Math.max(0, ...streaks.list.map(e => streakBest(e.id)));
    $("streakBest").textContent = `Best ${bestGesamt}`;

    const heute = todayStr();
    // Neigt sich der Tag dem Ende, bekommen offene Serien ein Warnzeichen
    const tagNeigtSich = new Date().getHours() >= TAGESENDE_AB;
    const wrap = $("streakList");
    wrap.innerHTML = "";
    if (!liste.length) {
      wrap.innerHTML = `<div class="leer-hinweis">
          <span>Noch keine Streaks</span>
          <span class="leer-tipp">Mit <b>/streaks neu &lt;Name&gt;</b> anlegen</span>
        </div>`;
      return;
    }

    liste.forEach((eintrag, reihe) => {
      const heuteErledigt = streakErledigt(eintrag.id, heute);
      const stufe = heuteErledigt ? streakStufe(eintrag.tage) : 0;

      const row = document.createElement("button");
      row.type = "button";
      const dringend = !heuteErledigt && tagNeigtSich;
      row.className = "insel streak-row" + (heuteErledigt ? " erledigt stufe-" + stufe : " offen") + (dringend ? " dringend" : "");
      row.style.setProperty("--reihe", reihe);
      row.dataset.habit = eintrag.id;
      row.title = `${eintrag.name}: ${eintrag.tage} ${eintrag.tage === 1 ? "Tag" : "Tage"} am Stück` +
                  ` (Bestwert ${streakBest(eintrag.id)}) — zum Abhaken klicken` +
                  (dringend ? " · heute noch offen!" : "");
      /* Nach Bild 1: links das Malzeichen mit der Flamme, in der
         Mitte die Zahl als Aussage und darueber der Zusammenhang,
         rechts nur noch eine Marke, wenn es etwas zu melden gibt.
         Vorher trug die Flamme die Aussage und die Zahl stand klein
         daneben — genau andersherum gewichtet. */
      row.innerHTML = `
        <span class="i-mal${dringend ? " rot" : heuteErledigt ? " gelb" : ""} sr-flamme${entfaltenId === eintrag.id && heuteErledigt ? " entfalten" : ""}">${FLAMME_SVG}</span>
        <span class="i-text">
          <span class="i-sache">${escapeHTML(eintrag.name)}</span>
          <span class="i-wert">${eintrag.tage}<small> ${eintrag.tage === 1 ? "Tag" : "Tage"}</small></span>
        </span>
        <span class="i-rechts">
          ${dringend ? '<span class="marke rot"><span class="punkt"></span>offen</span>' : heuteErledigt ? '<span class="marke gruen"><span class="punkt"></span>heute</span>' : ''}
        </span>`;
      row.addEventListener("click", e => toggleStreak(eintrag.id, e));
      wrap.appendChild(row);
    });
  }
  renderStreaks();

  /* ==========================================================
     VORSCHLAG — leitet sich aus den vorhandenen Daten ab
     (Kalorien, Bildschirmzeit, Klausuren, Termine, Streak).
     Wird bei jeder Datenänderung neu berechnet.
     ========================================================== */
  const V_ICONS = {
    flame: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 3.2c1.1 3.2-2.1 4.2-2.1 7.6a4.1 4.1 0 0 0 8.2 0c0-1.3-.6-2.4-1.1-2.5.3 2.4-1 3.5-2.2 3.5-1.6 0-2.2-1.5-1.1-3.5.9-1.7.5-3.7-1.7-5.1Z"/></svg>`,
    screen: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="3" y="4.5" width="18" height="13" rx="2.4"/><path d="M8.5 20.5h7"/></svg>`,
    book: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 4 2.6 8.8 12 13.6l9.4-4.8L12 4Z"/><path d="M6.4 11.2v4.6c0 1.1 2.6 2.4 5.6 2.4s5.6-1.3 5.6-2.4v-4.6"/></svg>`,
    calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="3.8" y="5.4" width="16.4" height="14.8" rx="2.6"/><path d="M3.8 10h16.4M8.2 3.4v3.4M15.8 3.4v3.4"/></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`,
    settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="3.3"/><path d="M12 2.6v3M12 18.4v3M21.4 12h-3M5.6 12h-3M18.6 5.4l-2.1 2.1M7.5 16.5l-2.1 2.1M18.6 18.6l-2.1-2.1M7.5 7.5 5.4 5.4"/></svg>`,
    sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="4.4"/><path d="M12 2.6v2.2M12 19.2v2.2M4.4 4.4l1.6 1.6M18 18l1.6 1.6M2.6 12h2.2M19.2 12h2.2M4.4 19.6 6 18M18 6l1.6-1.6"/></svg>`
  };

  function buildSuggestions() {
    const list = [];
    const goal = settings.calGoal || 0;
    const consumed = kalorien.consumed || 0;
    const st = getDayEntry(todayStr());
    const stTotal = st.phone + st.pc;

    // --- Kalorien ---
    if (goal <= 0) {
      list.push({ icon: "settings", tone: "", text: "Setz dein Kalorienziel",
        sub: "Ohne Ziel kann das Kalorien-Widget nichts anzeigen. Dauert 10 Sekunden in den Einstellungen." });
    } else if (consumed > goal) {
      list.push({ icon: "flame", tone: "alert", text: `${consumed - goal} kcal über dem Ziel`,
        sub: "Heute ist es mehr geworden als geplant — morgen wieder ein frischer Tag." });
    } else if (consumed > 0 && consumed < goal) {
      list.push({ icon: "flame", tone: "warn", text: `Noch ${goal - consumed} kcal bis zum Ziel`,
        sub: `Du liegst bei ${consumed} von ${goal} kcal.` });
    } else if (consumed === goal && goal > 0) {
      list.push({ icon: "check", tone: "good", text: "Kalorienziel punktgenau erreicht",
        sub: `${goal} kcal — sauber getroffen.` });
    }

    // --- Bildschirmzeit ---
    if (stTotal >= 360) {
      list.push({ icon: "screen", tone: "alert", text: `${formatMinutes(stTotal)} am Bildschirm`,
        sub: "Das ist ordentlich für einen Tag. Vielleicht mal offline weitermachen?" });
    } else if (stTotal >= 240) {
      list.push({ icon: "screen", tone: "warn", text: `${formatMinutes(stTotal)} Bildschirmzeit heute`,
        sub: st.phone > st.pc ? "Der größere Teil geht aufs Handy." : "Der größere Teil geht auf den PC." });
    }

    // --- Klausuren ---
    const naechsteKlausur = klausuren
      .filter(k => daysUntil(k.date) >= 0)
      .sort((a,b) => a.date.localeCompare(b.date))[0];
    if (naechsteKlausur) {
      const diff = daysUntil(naechsteKlausur.date);
      if (diff <= 14) {
        list.push({ icon: "book", tone: diff <= 3 ? "alert" : "warn",
          text: diff === 0 ? `Heute: Klausur ${naechsteKlausur.title}`
              : `Klausur ${naechsteKlausur.title} in ${diff} ${diff === 1 ? "Tag" : "Tagen"}`,
          sub: diff === 0 ? "Viel Erfolg!" : "Genug Zeit für einen ruhigen Lernplan statt Panik am Vorabend." });
      }
    }

    // --- Termine ---
    const naechsterTermin = termine
      .filter(t => daysUntil(t.date) >= 0)
      .sort((a,b) => (a.date + (a.time||"")).localeCompare(b.date + (b.time||"")))[0];
    if (naechsterTermin) {
      const diff = daysUntil(naechsterTermin.date);
      if (diff <= 7) {
        list.push({ icon: "calendar", tone: diff === 0 ? "alert" : "",
          text: diff === 0 ? `Heute: ${naechsterTermin.title}` : `${naechsterTermin.title} in ${diff} ${diff === 1 ? "Tag" : "Tagen"}`,
          sub: naechsterTermin.time ? `Startet um ${naechsterTermin.time} Uhr.` : "Noch keine Uhrzeit hinterlegt." });
      }
    }

    // --- Streaks (je Habit) ---
    const streakListe = alleStreaks();
    const spitze = streakListe[0];
    if (spitze && spitze.tage >= 2 && !streakErledigt(spitze.id, todayStr())) {
      list.push({ icon: "flame", tone: "warn",
        text: `${spitze.tage}-Tage-Serie bei „${spitze.name}"`,
        sub: "Heute noch nicht abgehakt — die Serie steht auf der Kippe." });
    } else if (spitze && spitze.tage >= 5) {
      list.push({ icon: "check", tone: "good",
        text: `„${spitze.name}" seit ${spitze.tage} Tagen`,
        sub: `Bestwert dieser Serie: ${streakBest(spitze.id)} Tage.` });
    }
    const offeneHeute = habits.list.slice(0, HABIT_LIMIT).filter(h => !habitErledigt(h.id, todayStr()));
    if (offeneHeute.length && offeneHeute.length <= 2) {
      list.push({ icon: "check", tone: "",
        text: offeneHeute.length === 1 ? `Nur noch „${offeneHeute[0].name}"` : "Nur noch zwei Habits offen",
        sub: offeneHeute.map(h => h.name).join(" und ") + " — dann ist der Tag komplett." });
    }

    // --- Fallback ---
    if (!list.length) {
      list.push({ icon: "sun", tone: "good", text: "Alles im grünen Bereich",
        sub: "Keine offenen Punkte — nichts steht an, nichts läuft aus dem Ruder." });
    }
    return list;
  }

  let vorschlaege = [];
  let vorschlagIdx = 0;

  function renderVorschlag(keepIndex) {
    vorschlaege = buildSuggestions();
    if (!keepIndex || vorschlagIdx >= vorschlaege.length) vorschlagIdx = 0;
    const v = vorschlaege[vorschlagIdx];

    const iconEl = $("vorschlagIcon");
    iconEl.className = "vorschlag-icon" + (v.tone ? " " + v.tone : "");
    iconEl.innerHTML = V_ICONS[v.icon] || V_ICONS.sun;
    $("vorschlagText").textContent = v.text;
    $("vorschlagSub").textContent = v.sub;

    const dots = $("vorschlagDots");
    dots.innerHTML = "";
    if (vorschlaege.length > 1) {
      vorschlaege.forEach((_, i) => {
        const d = document.createElement("i");
        if (i === vorschlagIdx) d.className = "on";
        dots.appendChild(d);
      });
    }
    $("vorschlagNext").style.visibility = vorschlaege.length > 1 ? "" : "hidden";
  }

  $("vorschlagNext").addEventListener("click", () => {
    vorschlagIdx = (vorschlagIdx + 1) % vorschlaege.length;
    renderVorschlag(true);
  });
  renderVorschlag();

  // Wird von den anderen Render-Funktionen aufgerufen. `var` ist bewusst:
  // so ist die Variable schon vor dieser Zeile definiert (undefined = falsy),
  // damit frühe Aufrufe während des Seitenaufbaus einfach nichts tun.
  var vorschlagReady = true;
  function refreshVorschlag() {
    if (vorschlagReady) renderVorschlag(true);
  }

  /* ==========================================================
     HABITS — abhakbare Tagesgewohnheiten
     Zeigt pro Habit die letzten 10 Tage als Kästchen. Nur der
     heutige Tag ist anklickbar. Ein Tag gilt für die Streak als
     erledigt, sobald alle Habits abgehakt sind.
     ========================================================== */


  /* Nur Habits zählen, die es noch gibt — sonst schleppt der Zähler
     Einträge gelöschter Habits mit ("1/0"). */
  const habitsDoneToday = () => {
    const vorhanden = new Set(habits.list.map(h => h.id));
    return (habits.done[todayStr()] || []).filter(id => vorhanden.has(id));
  };

  function toggleHabit(id, ereignis) {
    const key = todayStr();
    const list = new Set(habits.done[key] || []);
    const erledigt = !list.has(id);
    erledigt ? list.add(id) : list.delete(id);
    habits.done[key] = [...list];
    store.set("lifeos_habits", habits);
    if (erledigt) nutzAktion("habit");

    /* Nur die angeklickte Zeile anfassen, nicht die Liste neu bauen.
       Beim Neubau muss der Browser die Container-Maße noch einmal
       auflösen; im frisch eingesetzten Baum stand cqh kurzzeitig auf
       null und der Knopf fiel auf Breite 0 zusammen. */
    const name = (habits.list.find(h => h.id === id) || {}).name || "";
    const serie = habitSerie(id);

    document.querySelectorAll(`.hb-zeile[data-habit="${id}"]`).forEach(zeile => {
      zeile.classList.toggle("erledigt", erledigt);
      zeile.setAttribute("aria-pressed", String(erledigt));
      zeile.title = `${name} — heute ${erledigt ? "erledigt" : "offen"}, ` +
                    `${serie} ${serie === 1 ? "Tag" : "Tage"} am Stück`;

      const heuteFeld = zeile.querySelector(".hb-tick.heute");
      if (heuteFeld) {
        heuteFeld.classList.toggle("voll", erledigt);
        heuteFeld.style.setProperty("--ton", erledigt ? punktFarbe(0) : "");
      }

      const zahl = zeile.querySelector(".hb-serie");
      if (zahl) zahl.textContent = serie;

      /* Lichtring am Knopf neu starten, auch wenn noch einer läuft */
      const knopf = zeile.querySelector(".hb-knopf");
      if (knopf) {
        knopf.classList.remove("hb-pop");
        void knopf.offsetWidth;
        if (erledigt) knopf.classList.add("hb-pop");
      }
    });

    const sichtbar = habits.list.slice(0, HABIT_LIMIT);
    $("habitsCount").textContent = `${habitsDoneToday().length}/${sichtbar.length}`;

    /* Dasselbe Licht wie bei den Streaks, nur in der Habit-Farbe.
       Habits haben keine Flamme; unter Stufe 2 fiele der Effekt weg,
       deshalb dort der Mindestwert. */
    if (erledigt) {
      glutZeigen(glutPunkt(ereignis, ".hb-knopf"),
                 Math.max(3, streakStufe(habitSerie(id))));
    }

    refreshVorschlag();
  }

  const HABIT_DAYS = 14;

  /* Violett-Verlauf: je frischer der Tag, desto heller die Kachel */
  /* Montag der Woche, in der dieses Datum liegt */
  function montagVon(d) {
    const m = new Date(d);
    m.setHours(0, 0, 0, 0);
    m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
    return m;
  }

  /* Tage eines Rasters, das an Wochentagen ausgerichtet ist: es endet
     am Sonntag dieser Woche und geht so viele Wochen zurueck. */
  function wochenRaster(wochen) {
    const ende = montagVon(new Date());
    ende.setDate(ende.getDate() + 6);              // Sonntag dieser Woche
    const start = new Date(ende);
    start.setDate(start.getDate() - (wochen * 7 - 1));

    const tage = [];
    for (let d = new Date(start); d <= ende; d.setDate(d.getDate() + 1)) {
      tage.push(dateKey(d));
    }
    return tage;
  }

  /* ==========================================================
     WOCHENZIEL
     Täglich abhaken oder gar nicht — das bestraft einen normalen
     Dienstag und ist der häufigste Grund, warum solche Listen
     einschlafen. Ein Habit darf deshalb sagen, wie oft er in der
     Woche drankommt: "Sport 3× pro Woche" ist erfüllt, sobald drei
     Tage stehen, egal welche.

     Vorgabe ist sieben — für bestehende Habits ändert sich damit
     zunächst gar nichts.
     ========================================================== */
  const habitZiel = h => Math.min(7, Math.max(1, Number(h && h.proWoche) || 7));

  /* Wie oft wurde dieser Habit in der laufenden Woche geschafft? */
  function habitWoche(id) {
    const mo = montagVon(new Date());
    let zahl = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(mo); d.setDate(mo.getDate() + i);
      if (habitErledigt(id, dateKey(d))) zahl++;
    }
    return zahl;
  }

  /* Steht das Wochensoll schon? */
  const habitErfuellt = h => habitWoche(h.id) >= habitZiel(h);

  function habitZielSetzen(id, wert) {
    const h = habits.list.find(x => x.id === id);
    if (!h) return;
    h.proWoche = Math.min(7, Math.max(1, Math.round(Number(wert) || 7)));
    store.set("lifeos_habits", habits);
    renderHabits();
    if (aktuelleSeite === "habits") baueHabits();
  }

  /* Ein abgehakter Tag ist ein erledigter Tag — und Erledigtes ist in
     dieser App gruen. Frueher stand hier ein Violettverlauf mit fest
     eingebauten Kanalwerten; der liess sich weder dem Modus noch der
     Farblogik anpassen. Jetzt traegt der Ton die Bedeutung, und nur
     die Deckkraft erzaehlt das Alter: je frischer der Tag, desto
     kraeftiger der Punkt. */
  function punktFarbe(alterAnteil) {
    const deckung = 0.32 + (1 - alterAnteil * 0.6) * 0.68;
    return `color-mix(in srgb, var(--gruen-voll) ${Math.round(deckung * 100)}%, transparent)`;
  }

  /* Das Widget kann statt der letzten Tage das ganze Jahr zeigen:
     eine Spalte je Woche, sieben Zeilen fuer die Wochentage. Die
     Faerbung sagt, wie viele Habits an dem Tag erledigt waren. */
  let habitAnsicht = store.get("lifeos_habit_ansicht", "tage");

  function habitJahrZeichnen(wrap) {
    const heute = todayStr();
    const ende = montagVon(new Date());
    ende.setDate(ende.getDate() + 6);

    /* Zurueck bis zum Montag der Woche, in die der 1. Januar faellt */
    const start = montagVon(new Date(new Date().getFullYear(), 0, 1));
    const wieViele = habits.list.slice(0, HABIT_LIMIT).length || 1;

    let felder = "";
    let wochen = 0;
    for (let d = new Date(start); d <= ende; d.setDate(d.getDate() + 1)) {
      const key = dateKey(d);
      const anzahl = (habits.done[key] || []).length;
      const stufe = anzahl === 0 ? 0 : Math.min(4, Math.ceil(anzahl / wieViele * 4));
      const kommt = key > heute;
      felder += `<i class="hj-feld s${stufe}${kommt ? " kommt" : ""}${key === heute ? " heute" : ""}"
                   title="${fmtDate(key)} · ${anzahl} von ${wieViele}"></i>`;
      if (d.getDay() === 0) wochen++;
    }

    wrap.className = "habit-list jahr";
    wrap.innerHTML = `<div class="hj-gitter">${felder}</div>`;

    /* Quadratische Felder: die Kantenlaenge ergibt sich aus dem
       knapperen der beiden Masse. Sieben Zeilen muessen in die Hoehe
       passen, alle Wochen in die Breite. */
    const platz = wrap.getBoundingClientRect();
    if (platz.width < 20 || platz.height < 20) {
      clearTimeout(habitJahrTimer);
      habitJahrTimer = setTimeout(() => habitJahrZeichnen(wrap), 120);
      return;
    }
    const luecke = 2;
    const nachHoehe = (platz.height - luecke * 6) / 7;
    const nachBreite = (platz.width - luecke * (wochen - 1)) / Math.max(1, wochen);
    const kante = Math.max(3, Math.floor(Math.min(nachHoehe, nachBreite)));
    wrap.querySelector(".hj-gitter").style.setProperty("--kante", kante + "px");
  }

  let habitJahrTimer = null;

  /* Wie viele Tage am Stück steht dieses Habit? Wie bei den Streaks:
     hat der heutige Tag noch keinen Haken, zählt ab gestern. */
  function habitSerie(id) {
    const d = new Date();
    if (!habitErledigt(id, dateKey(d))) d.setDate(d.getDate() - 1);
    let tage = 0;
    while (habitErledigt(id, dateKey(d))) {
      tage++;
      d.setDate(d.getDate() - 1);
    }
    return tage;
  }

  const HAKEN_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `<path d="m5 12.5 4.6 4.6L19 7.2"/></svg>`;

  /* ==========================================================
     HABITS im Widget
     Eine Zeile je Habit: links der Knopf für heute, in der Mitte
     Name und die letzten 14 Tage als schmale Spur, rechts die
     Serie. Der Knopf ist der heutige Tag — deshalb braucht die Spur
     keinen zweiten Bedienpunkt und bleibt reine Anzeige.
     ========================================================== */
  /* Die Maße der Zeilen kommen aus einer eigenen Messung, nicht aus
     Container-Abfragen. Beim Umschalten einer Klasse hat Chrome die
     Höhe des Containers kurzzeitig auf null gerechnet — Knopf und Spur
     fielen dann in sich zusammen und die Serie riss die Zeile
     auseinander. Eine gemessene Zahl kann das nicht passieren. */
  function habitMasse() {
    document.querySelectorAll(".habit-list").forEach(wrap => {
      const innen = wrap.querySelector(".hb-liste");
      if (!innen) return;

      const platz = wrap.clientHeight;
      if (!platz) return;                       // Seite gerade ausgeblendet

      const reihen = Number(wrap.style.getPropertyValue("--reihen")) || 1;
      const luecke = Math.min(10, platz * 0.018);
      let zeile = Math.max(28, Math.min(96, (platz - (reihen - 1) * luecke) / reihen));

      const setzen = h => {
        innen.style.setProperty("--luecke", luecke.toFixed(1) + "px");
        innen.style.setProperty("--hoehe", h.toFixed(1) + "px");
        innen.style.setProperty("--knopf", Math.max(16, Math.min(40, h * 0.42)).toFixed(1) + "px");
        /* Bei sehr flachen Karten muss der Name weichen */
        innen.classList.toggle("knapp", h < 34);
      };
      setzen(zeile);

      /* Nachkontrolle: Wird gemessen, bevor das Raster steht, ist
         "platz" noch der alte Wert — die Zeilen wären dann zu hoch
         und die letzte fiele aus der Karte. Statt auf den richtigen
         Zeitpunkt zu hoffen, wird hier nachgesehen, ob der Inhalt
         wirklich passt, und notfalls nachgezogen. Auf dem Handy ist
         das der Regelfall, nicht die Ausnahme. */
      const ueber = innen.scrollHeight - wrap.clientHeight;
      if (ueber > 1 && reihen > 0) {
        /* Untergrenze bewusst niedrig: eine sehr flache Zeile ohne
           Namen ist immer noch besser als eine Zeile, die unten aus
           der Karte fällt und gar nicht zu sehen ist. */
        zeile = Math.max(14, zeile - ueber / reihen);
        setzen(zeile);
      }
    });
  }

  /* Ändert sich die Kartengröße, werden die Maße nachgezogen */
  const habitBeobachter = typeof ResizeObserver === "function"
    ? new ResizeObserver(() => habitMasse())
    : null;

  /* Beim ersten Zeichnen steht das Raster noch nicht: die Karte ist
     einen Moment lang höher, als sie am Ende sein wird. Wird genau
     dann gemessen, sind die Zeilen zu hoch und die letzte fällt aus
     der Karte. Deshalb wird nach dem Zeichnen noch einmal gemessen —
     einmal zum nächsten Bild und einmal kurz danach, falls das Bild
     ausbleibt (ausgeblendetes Fenster, Tablet im Hintergrund). */
  let habitNachTimer = null;
  function habitNachmessen() {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(habitMasse);
    clearTimeout(habitNachTimer);
    habitNachTimer = setTimeout(habitMasse, 240);
  }

  /* Dreht jemand das iPad, ändert sich die Kartenform komplett */
  window.addEventListener("resize", habitNachmessen);
  window.addEventListener("orientationchange", habitNachmessen);

  function renderHabits() {
    const wrapJahr = $("habitList");
    if (habitAnsicht === "jahr" && wrapJahr) {
      habitJahrZeichnen(wrapJahr);
      $("habitsCount").textContent =
        `${habitsDoneToday().length}/${habits.list.slice(0, HABIT_LIMIT).length}`;
      return;
    }

    const heute = todayStr();
    const tage = [];
    for (let i = HABIT_DAYS - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      tage.push({ key: dateKey(d), alter: i / (HABIT_DAYS - 1) });
    }
    const sichtbar = habits.list.slice(0, HABIT_LIMIT);

    if (!sichtbar.length) {
      document.querySelectorAll(".habit-list").forEach(wrap => {
        wrap.style.removeProperty("--reihen");
        wrap.innerHTML = `<div class="leer-hinweis">
            <span>Noch keine Habits</span>
            <span class="leer-tipp">Mit <b>/habits neu &lt;Name&gt;</b> anlegen</span>
          </div>`;
      });
      $("habitsCount").textContent = "0/0";
      return;
    }

    const zeilen = sichtbar.map(h => {
      const fertig = habitErledigt(h.id, heute);
      const serie = habitSerie(h.id);

      /* Die Spur ist nur Anzeige: je frischer der Tag, desto kräftiger.
         Der heutige steht am rechten Ende und trägt das Dreieck. */
      const spur = tage.map(t => {
        const voll = habitErledigt(h.id, t.key);
        const klassen = "hb-tick" + (voll ? " voll" : "") + (t.key === heute ? " heute" : "");
        const ton = voll ? `style="--ton:${punktFarbe(t.alter)}"` : "";
        return `<span class="${klassen}" ${ton} title="${fmtDate(t.key)} · ${voll ? "erledigt" : "offen"}"></span>`;
      }).join("");

      /* Rechts steht der Wochenstand, nicht mehr die Serie: er sagt,
         ob heute überhaupt noch etwas ansteht. Die Serie bleibt im
         Tooltip und auf der Habits-Seite. */
      const ziel = habitZiel(h);
      const diese = habitWoche(h.id);
      const erfuellt = diese >= ziel;

      /* Sieben Perlen: die letzte Woche, die aeusserste rechts ist
         heute. Vierzehn Striche waeren in einer Kapsel kein Verlauf
         mehr, sondern ein Muster. */
      const perlen = tage.slice(-7).map(t => {
        const voll = habitErledigt(h.id, t.key);
        return `<i class="perle${voll ? " voll" : ""}${t.key === heute ? " heute" : ""}"
                  title="${fmtDate(t.key)} · ${voll ? "erledigt" : "offen"}"></i>`;
      }).join("");

      /* Das Malzeichen traegt den Anfangsbuchstaben. Ein Symbol
         muesste erst erfunden werden und saehe bei "Lesen" und
         "Lernen" gleich aus. */
      const zeichen = escapeHTML((h.name || "?").trim().charAt(0).toUpperCase());

      return `<button type="button" class="insel hb-zeile${fertig ? " erledigt" : ""}${erfuellt ? " woche-voll" : ""}"
                data-habit="${h.id}"
                title="${escapeHTML(h.name)} — heute ${fertig ? "erledigt" : "offen"} · diese Woche ${diese} von ${ziel} · ${serie} ${serie === 1 ? "Tag" : "Tage"} am Stück"
                aria-pressed="${fertig}">
          <span class="i-mal${erfuellt ? " gruen" : ""}">${zeichen}</span>
          <span class="i-text">
            <span class="i-sache">${erfuellt ? "Woche geschafft" : diese + " von " + ziel + " diese Woche"}</span>
            <span class="i-wert">${escapeHTML(h.name)}</span>
          </span>
          <span class="i-rechts">
            <span class="perlen">${perlen}</span>
            <span class="hb-knopf">${HAKEN_SVG}</span>
          </span>
        </button>`;
    }).join("");

    document.querySelectorAll(".habit-list").forEach(wrap => {
      wrap.style.setProperty("--reihen", String(sichtbar.length));
      /* Die Zeilen sitzen in einem eigenen Kasten: Maße in cqh gehen
         immer auf den nächsten Container darüber — ein Element kann
         seine eigene Höhe nicht abfragen. */
      wrap.innerHTML = '<div class="hb-liste">' + zeilen + '</div>';
      wrap.querySelectorAll(".hb-zeile").forEach(z => {
        z.addEventListener("click", e => toggleHabit(z.dataset.habit, e));
      });
      if (habitBeobachter) { habitBeobachter.unobserve(wrap); habitBeobachter.observe(wrap); }
    });

    habitMasse();
    habitNachmessen();

    $("habitsCount").textContent = `${habitsDoneToday().length}/${sichtbar.length}`;
  }
  renderHabits();

  document.querySelectorAll("#habitAnsicht [data-hansicht]").forEach(b => {
    b.classList.toggle("active", b.dataset.hansicht === habitAnsicht);
    b.addEventListener("click", () => {
      habitAnsicht = b.dataset.hansicht;
      store.set("lifeos_habit_ansicht", habitAnsicht);
      document.querySelectorAll("#habitAnsicht [data-hansicht]").forEach(x =>
        x.classList.toggle("active", x === b));
      /* Die Tagesansicht baut ihr Raster nur einmal auf — darum das
         Feld ganz zuruecksetzen statt nur umzuschalten. */
      const wrap = $("habitList");
      if (wrap) { wrap.className = "habit-list"; wrap.innerHTML = ""; }
      renderHabits();
    });
  });

  /* ==========================================================
     TAB-KARTE — Habits / Kalender / Schule / Vorschlag
     Die Leiste ersetzt die Widget-Überschrift; die Auswahl
     bleibt über Neuladen hinweg erhalten.
     ========================================================== */
  let activeTab = store.get("lifeos_card_tab", "vorschlag");

  /* Gleitender Hintergrund hinter dem aktiven Reiter */
  const tabIndicator = document.createElement("span");
  tabIndicator.className = "tab-indicator";
  $("cardTabs").appendChild(tabIndicator);

  function positionTabIndicator() {
    const aktiv = document.querySelector("#cardTabs .tab.active");
    if (!aktiv) return;
    tabIndicator.style.width = aktiv.offsetWidth + "px";
    tabIndicator.style.transform = `translateX(${aktiv.offsetLeft}px)`;
  }
  // Die Reiter selbst beobachten, nicht nur die Leiste: ihre Breite ändert
  // sich auch, wenn die Leiste gleich breit bleibt (z.B. sobald die Schrift
  // geladen ist). Zusätzlich nach dem Schriftladen einmal nachziehen.
  if ("ResizeObserver" in window) {
    const beobachter = new ResizeObserver(positionTabIndicator);
    beobachter.observe($("cardTabs"));
    document.querySelectorAll("#cardTabs .tab").forEach(t => beobachter.observe(t));
  }
  window.addEventListener("resize", positionTabIndicator);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(positionTabIndicator);
  }


  function setTab(name) {
    activeTab = name;
    store.set("lifeos_card_tab", name);
    document.querySelectorAll("#cardTabs .tab").forEach(t =>
      t.classList.toggle("active", t.dataset.tab === name));
    document.querySelectorAll("#card-vorschlag .tab-panel").forEach(p =>
      p.classList.toggle("active", p.dataset.panel === name));
    if (name === "kalender" || name === "schule") renderTabLists();
    positionTabIndicator();
  }

  document.querySelectorAll("#cardTabs .tab").forEach(t =>
    t.addEventListener("click", () => setTab(t.dataset.tab)));

  /* Kalender- und Schule-Tab: alle anstehenden Einträge (nicht nur die
     dringenden wie in den kleinen Karten), maximal 6 Stück. */
  function renderTabLists() {
    fillTabList("kalenderList", termine
      .filter(t => daysUntil(t.date) >= 0)
      .sort((a,b) => (a.date + (a.time||"")).localeCompare(b.date + (b.time||"")))
      .slice(0, 6), true);

    fillTabList("schuleList", klausuren
      .filter(k => daysUntil(k.date) >= 0)
      .sort((a,b) => a.date.localeCompare(b.date))
      .slice(0, 6), false);
    /* Die fälligen Karten stehen oben — sie sind das Einzige in
       dieser Liste, was heute etwas von einem will. */
    if (typeof faelligAuffrischen === "function") faelligAuffrischen();
  }

  function fillTabList(listId, items, withTime) {
    const list = $(listId);
    if (!list) return;
    list.innerHTML = "";
    items.forEach(item => {
      const diff = daysUntil(item.date);
      const li = document.createElement("li");
      li.className = "entry-item " + fristKlasse(diff)
                   + (diff === 0 ? " today" : diff <= 3 ? " soon" : "");
      li.innerHTML = `
        <span class="entry-accent"></span>
        <div class="entry-main">
          <div class="entry-title">${escapeHTML(item.title)}</div>
          <div class="entry-sub">${klausurZusatz(item) ? klausurZusatz(item) + " · " : ""}${fmtDate(item.date)}${withTime && item.time ? " · " + item.time : ""}</div>
        </div>
        <span class="entry-badge">${badgeFor(diff, item.date)}</span>`;
      list.appendChild(li);
    });
  }

  renderTabLists();
  setTab(activeTab);
  // Erst nach dem ersten Setzen animieren, damit der Indikator
  // beim Laden nicht von links hereinfliegt
  // Timer statt requestAnimationFrame: rAF pausiert in nicht sichtbaren
  // Tabs, der Indikator bliebe dort dauerhaft ohne Übergang.
  setTimeout(() => tabIndicator.classList.add("animiert"), 60);


  /* ==========================================================
     SCHNELLZUGRIFF
     ========================================================== */
  function renderQuickLinks() {
    const grid = $("quickGrid");
    grid.innerHTML = "";
    quickLinks.forEach(l => {
      const a = document.createElement("a");
      a.className = "quick-tile";
      a.href = l.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.title = l.label;
      a.setAttribute("aria-label", l.label);
      a.innerHTML = iconSVG(l.icon);
      grid.appendChild(a);
    });
    const add = document.createElement("button");
    add.type = "button";
    add.className = "quick-tile add-tile";
    add.title = "Link hinzufügen";
    add.setAttribute("aria-label", "Link hinzufügen");
    add.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 5.5v13M5.5 12h13"/></svg>`;
    add.addEventListener("click", openSettings);
    grid.appendChild(add);
  }
  renderQuickLinks();

  /* ==========================================================
     KONTOPANEL
     Der Weg hinein ist das Profilbild links oben — dort erwartet
     man sein Konto, nicht in einem Zahnrad ganz unten. Das Zahnrad
     bleibt trotzdem, es führt an dieselbe Stelle.

     Statt eines kleinen Fensters mit einer langen Liste liegt hier
     die ganze Fläche: links die Bereiche, rechts der gewählte. Die
     Felder sind dieselben wie vorher und tragen dieselben
     Kennungen — sie stehen nur nicht mehr alle untereinander.
     ========================================================== */
  const kpanel = $("kontoPanel");
  let kpOffen = false;

  function kpBereichZeigen(name) {
    kpanel.querySelectorAll(".kop-bereich").forEach(b => {
      b.hidden = b.dataset.bereich !== name;
    });
    kpanel.querySelectorAll(".kop-reiter[data-bereich]").forEach(r => {
      r.classList.toggle("aktiv", r.dataset.bereich === name);
    });
    const bahn = $("kopBahn");
    if (bahn) { bahn.scrollTop = 0; bahn.classList.remove("wechsel"); void bahn.offsetWidth; bahn.classList.add("wechsel"); }

    /* Die drei Kästen fragen den Server. Das passiert erst, wenn man
       den Bereich wirklich ansieht — beim Öffnen des Panels wären es
       sonst drei Abrufe für einen, den man sehen will. */
    if (name === "konto")      kontoZeichnen();
    if (name === "google")     gkStandHolen();
    if (name === "app")      { offZeichnen(); themaZeichnen(); }
    if (name === "papierkorb") papierkorbZeichnen();
  }

  /* ==========================================================
     HELL ODER DUNKEL

     Drei Stellungen. "Automatisch" heisst: kein Attribut setzen,
     dann entscheidet die Medienabfrage in style.css nach der
     Einstellung des Geraets. "Hell" und "Dunkel" setzen das
     Attribut und stechen die Geraeteeinstellung.

     Die Wahl liegt bewusst nur im Browserspeicher dieses Geraets und
     wird nicht mit dem Server abgeglichen: sonst wuerde das Handy,
     das abends auf Dunkel geht, den Rechner mitziehen.

     Gesetzt wird das Attribut schon im Kopf der index.html, vor dem
     ersten Bildaufbau — hier geht es nur noch um den Umschalter und
     um die Farbe der Statusleiste.
     ========================================================== */
  const THEMA = "lifeos_thema";

  const themaWahl = () => {
    try { const w = localStorage.getItem(THEMA); return (w === "hell" || w === "dunkel") ? w : "auto"; }
    catch (f) { return "auto"; }
  };

  /* Welcher Modus am Ende wirklich gilt */
  const themaEcht = () => {
    const w = themaWahl();
    if (w !== "auto") return w;
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dunkel" : "hell";
  };

  /* iOS faerbt die Statusleiste nach diesem Wert. Bleibt er auf dem
     alten Navy stehen, sitzt im Hellen ein dunkler Balken ueber der
     Seite. */
  function statusleisteFaerben() {
    const dunkel = themaEcht() === "dunkel";
    const marke = document.querySelector('meta[name="theme-color"]');
    if (marke) marke.setAttribute("content", dunkel ? "#000000" : "#EDEDEF");
    const ios = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (ios) ios.setAttribute("content", dunkel ? "black" : "default");
  }

  function themaSetzen(wahl) {
    if (wahl === "hell" || wahl === "dunkel") {
      document.documentElement.setAttribute("data-thema", wahl);
      try { localStorage.setItem(THEMA, wahl); } catch (f) { /* dann nur fuer jetzt */ }
    } else {
      document.documentElement.removeAttribute("data-thema");
      try { localStorage.removeItem(THEMA); } catch (f) { /* egal */ }
    }
    statusleisteFaerben();
    themaZeichnen();
  }

  function themaZeichnen() {
    const leiste = $("themaWahl");
    if (!leiste) return;
    const jetzt = themaWahl();
    leiste.querySelectorAll("button[data-thema]").forEach(k =>
      k.classList.toggle("active", k.dataset.thema === jetzt));
    if (!leiste.dataset.gebunden) {
      leiste.dataset.gebunden = "1";
      leiste.addEventListener("click", e => {
        const k = e.target.closest("button[data-thema]");
        if (k) themaSetzen(k.dataset.thema);
      });
    }
  }

  /* Steht der Schalter auf "Automatisch", muss die Seite mitwechseln,
     wenn das Geraet abends umstellt — ohne Neuladen. */
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (themaWahl() === "auto") statusleisteFaerben();
  });
  statusleisteFaerben();

  /* ==========================================================
     DIE SCHWEBENDE LEISTE AUF DEM HANDY

     Zehn Seiten passen nicht nebeneinander in eine Pille, also
     wischt man seitlich. Damit man das ueberhaupt merkt, verlaeuft
     der Rand weich — aber nur auf der Seite, auf der wirklich noch
     etwas liegt. Ein Verlauf, der auch am Anfang steht, wuerde ueber
     den ersten Eintrag waschen und Weiterlaufen behaupten, wo
     Schluss ist.
     ========================================================== */

  /* ==========================================================
     DIE KARTE IST DER WEG ZUR SEITE

     Bisher trug jedes Widget seine Bedienung mit sich herum: Knoepfe,
     Umschalter, Leerzustaende. Bei acht bis zwoelf Dingen pro Karte
     bleibt kein Platz mehr fuer das, was die Karte eigentlich sagen
     will — die Zahl, den naechsten Termin, den Stand.

     Jetzt zeigt jede Karte ihre Kernaussage, und ein Klick auf sie
     fuehrt zur vollen Seite. Verloren geht nichts, es rueckt nur eine
     Ebene tiefer.

     Klicks auf echte Bedienelemente laufen weiter wie bisher: wer ein
     Habit abhakt, will nicht auf die Habit-Seite geschickt werden.
     ========================================================== */
  (function kartenAlsWeg() {
    const ZIEL = {
      "card-kalorien":   "kalorien",
      "card-screentime": "bildschirmzeit",
      "card-wetter":     "kalender",
      "card-naechste":   "kalender",
      "card-streaks":    "habits",
      "card-habits":     "habits"
    };

    Object.entries(ZIEL).forEach(([id, seite]) => {
      const karte = document.getElementById(id);
      if (!karte) return;

      karte.classList.add("karte-fuehrt");
      karte.setAttribute("role", "link");
      karte.setAttribute("tabindex", "0");

      const hin = e => {
        /* Alles, was selbst etwas tut, behaelt sein Verhalten. Sonst
           koennte man kein Habit mehr abhaken, ohne die Seite zu
           wechseln. */
        if (e.target.closest("button, a, input, select, textarea, [role=button], [role=tab], svg[data-klick]")) return;
        /* Wer Text markiert, will lesen, nicht navigieren. */
        const auswahl = window.getSelection();
        if (auswahl && String(auswahl).length > 0) return;
        location.hash = "#/" + seite;
      };

      karte.addEventListener("click", hin);
      karte.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); location.hash = "#/" + seite; }
      });
    });
  })();

  (function leisteRaender() {
    const leiste = document.querySelector(".sidebar");
    const bahn = document.querySelector(".nav-scroll");
    if (!leiste || !bahn) return;

    function raender() {
      const rest = bahn.scrollWidth - bahn.clientWidth - bahn.scrollLeft;
      leiste.classList.toggle("mehr-links", bahn.scrollLeft > 2);
      leiste.classList.toggle("mehr-rechts", rest > 2);
    }
    bahn.addEventListener("scroll", raender, { passive: true });
    window.addEventListener("resize", raender);
    raender();

    /* Der gewaehlte Punkt zieht sich in Sicht, damit er nicht halb
       hinter dem Rand klemmt. */
    bahn.addEventListener("click", e => {
      const k = e.target.closest(".nav-link");
      if (k) setTimeout(() => {
        k.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }, 40);
    });
  })();


  function openSettings(bereich) {
    $("settingName").value = settings.name || "";
    $("settingCity").value = settings.city || "";
    $("settingCalGoal").value = settings.calGoal || "";
    $("settingCalConsumed").value = kalorien.consumed || "";
    const t = getDayEntry(todayStr());
    $("settingStPhone").value = t.phone ? formatMinutes(t.phone) : "";
    $("settingStPc").value = t.pc ? formatMinutes(t.pc) : "";
    $("settingCityStatus").textContent = "";
    renderLinkEditList();
    kpKopfZeichnen();

    kpanel.hidden = false;
    kpanel.classList.remove("schliesst");
    document.body.classList.add("kop-auf");
    kpOffen = true;
    kpBereichZeigen(typeof bereich === "string" ? bereich : "konto");
  }

  function closeSettings() {
    if (!kpOffen) return;
    kpOffen = false;
    document.body.classList.remove("kop-auf");
    /* Erst die Abgangsanimation, dann wirklich weg — sonst
       verschwindet das Panel schlagartig. */
    kpanel.classList.add("schliesst");
    setTimeout(() => {
      kpanel.classList.remove("schliesst");
      kpanel.hidden = true;
    }, 200);
  }

  $("profilKnopf").addEventListener("click", () => openSettings("konto"));
  $("settingsBtn").addEventListener("click", () => openSettings("konto"));
  /* "Details anzeigen" im Kalorien-Widget meint die Felder, nicht das Konto */
  $("calDetailsBtn").addEventListener("click", () => openSettings("werte"));
  $("kopZu").addEventListener("click", closeSettings);
  $("kopAbmelden").addEventListener("click", () => {
    if (window.lifeosAbmelden) window.lifeosAbmelden();
  });

  kpanel.querySelectorAll(".kop-reiter[data-bereich]").forEach(reiter => {
    reiter.addEventListener("click", () => kpBereichZeigen(reiter.dataset.bereich));
  });
  /* "Bearbeiten" neben einem Wert springt in den Bereich, wo er steht */
  kpanel.querySelectorAll("[data-springe]").forEach(knopf => {
    knopf.addEventListener("click", () => kpBereichZeigen(knopf.dataset.springe));
  });

  document.addEventListener("keydown", e => { if (e.key === "Escape") closeSettings(); });

  /* ---------- Kopf des Panels ----------
     Name und Bild stehen an vier Stellen zugleich: in der Leiste
     links, in der Kontokarte und in der Vorschau. Sie kommen alle
     von hier, damit keine davon zurückbleibt. */
  function kpKopfZeichnen() {
    if (!kpanel) return;
    const name = (settings.name || "").trim() || "Gast";
    const konto = window.lifeosNutzer || {};
    const setzen = (id, text) => { const el = $(id); if (el) el.textContent = text; };

    setzen("kopName", name);
    setzen("kopKonto", konto.name ? "Konto: " + konto.name : "angemeldet");
    setzen("kopKarteName", name);
    setzen("kopKarteKonto", konto.name || "–");
    setzen("kopWertName", name);
    setzen("kopWertKonto", konto.name || "–");

    ["kopAvatar", "kopGrossAvatar", "kopVorschau"].forEach(id => avatarFuellen($(id), name));
    const weg = $("kopBildWeg");
    if (weg) weg.disabled = !settings.bild;
  }

  /* ---------- Profilbild ----------
     Es liegt bei den Einstellungen und wandert damit über den
     Bestand auf die anderen Geräte. Damit das gutgeht, wird es
     vorher auf 256 Kanten gestutzt: ein Foto vom Telefon wäre
     mehrere Megabyte groß und würde bei jedem Abgleich mitreisen. */
  const BILD_KANTE = 256;

  function bildVerkleinern(datei) {
    return new Promise((fertig, schiefgehen) => {
      if (!datei.type || datei.type.indexOf("image/") !== 0) {
        return schiefgehen(new Error("Das ist kein Bild."));
      }
      const leser = new FileReader();
      leser.onerror = () => schiefgehen(new Error("Die Datei ließ sich nicht lesen."));
      leser.onload = () => {
        const bild = new Image();
        bild.onerror = () => schiefgehen(new Error("Das Bild ließ sich nicht öffnen."));
        bild.onload = () => {
          /* Mittig quadratisch beschneiden — sonst verzerrt das Rund */
          const kante = Math.min(bild.width, bild.height);
          const platte = document.createElement("canvas");
          platte.width = platte.height = BILD_KANTE;
          const stift = platte.getContext("2d");
          /* Durchsichtige Bilder bekommen einen dunklen Grund; als
             JPEG wäre er sonst schwarz. */
          stift.fillStyle = "#161c2c";
          stift.fillRect(0, 0, BILD_KANTE, BILD_KANTE);
          stift.drawImage(bild,
            (bild.width - kante) / 2, (bild.height - kante) / 2, kante, kante,
            0, 0, BILD_KANTE, BILD_KANTE);
          fertig(platte.toDataURL("image/jpeg", 0.82));
        };
        bild.src = leser.result;
      };
      leser.readAsDataURL(datei);
    });
  }

  async function bildSetzen(datei) {
    if (!datei) return;
    try {
      settings.bild = await bildVerkleinern(datei);
      store.set("lifeos_settings", settings);
      updateAvatar();
      showToast("Profilbild gespeichert.", "success");
    } catch (fehler) {
      showToast(fehler.message, "error");
    }
  }

  const bildFeld = $("kopBildDatei");
  const bildWaehlen = () => { if (bildFeld) { bildFeld.value = ""; bildFeld.click(); } };
  $("kopBildWahl").addEventListener("click", bildWaehlen);
  $("kopBildKnopf").addEventListener("click", bildWaehlen);
  bildFeld.addEventListener("change", e => bildSetzen(e.target.files && e.target.files[0]));
  $("kopBildWeg").addEventListener("click", () => {
    if (!settings.bild) return;
    settings.bild = "";
    store.set("lifeos_settings", settings);
    updateAvatar();
    showToast("Profilbild entfernt.", "success");
  });

  $("settingName").addEventListener("input", e => {
    settings.name = e.target.value;
    store.set("lifeos_settings", settings);
    updateClock();
    updateAvatar();
  });

  $("settingCalGoalSave").addEventListener("click", () => {
    const val = Number($("settingCalGoal").value);
    if (!isNaN(val) && val >= 0) {
      settings.calGoal = val;
      store.set("lifeos_settings", settings);
      renderCalories();
      showToast("Kalorienziel gespeichert.", "success");
    }
  });

  $("settingCalConsumedSave").addEventListener("click", () => {
    const val = Number($("settingCalConsumed").value);
    if (!isNaN(val) && val >= 0) {
      setCaloriesConsumed(val);
      showToast("Kalorien für heute gespeichert.", "success");
    }
  });

  $("settingStPhoneSave").addEventListener("click", () => {
    const input = $("settingStPhone");
    const min = parseDurationToMinutes(input.value);
    if (min === null) { input.placeholder = "Format z.B. 3:45 oder 3h50"; return; }
    setDayEntry(todayStr(), { phone: min });
    renderScreenTime();
    showToast("Handy-Bildschirmzeit gespeichert.", "success");
  });

  $("settingStPcSave").addEventListener("click", () => {
    const input = $("settingStPc");
    const min = parseDurationToMinutes(input.value);
    if (min === null) { input.placeholder = "Format z.B. 3:45 oder 3h50"; return; }
    setDayEntry(todayStr(), { pc: min });
    renderScreenTime();
    showToast("PC-Bildschirmzeit gespeichert.", "success");
  });

  $("settingCitySave").addEventListener("click", async () => {
    const name = $("settingCity").value.trim();
    const statusEl = $("settingCityStatus");
    if (!name) return;
    statusEl.textContent = "Suche Ort …";
    try {
      const geo = await geocodeCity(name);
      settings.city = geo.name;
      settings.lat = geo.lat;
      settings.lon = geo.lon;
      store.set("lifeos_settings", settings);
      statusEl.textContent = `Gespeichert: ${geo.name}`;
      loadWeather(true);
    } catch (err) {
      statusEl.textContent = "Ort nicht gefunden — bitte anders schreiben.";
    }
  });

  function renderLinkEditList() {
    const ul = $("linkEditList");
    ul.innerHTML = "";
    quickLinks.forEach((l, idx) => {
      const li = document.createElement("li");
      li.className = "link-edit-item";
      li.innerHTML = `<span>${escapeHTML(l.label)} — ${escapeHTML(l.url)}</span><button data-idx="${idx}" aria-label="Entfernen">✕</button>`;
      ul.appendChild(li);
    });
    ul.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", () => {
        quickLinks.splice(Number(btn.dataset.idx), 1);
        store.set("lifeos_quicklinks", quickLinks);
        renderLinkEditList();
        renderQuickLinks();
      });
    });
  }

  $("newLinkAdd").addEventListener("click", () => {
    const labelEl = $("newLinkLabel");
    const urlEl = $("newLinkUrl");
    const label = labelEl.value.trim();
    let url = urlEl.value.trim();
    if (!label || !url) return;
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    quickLinks.push({ label, url, icon: "link" });
    store.set("lifeos_quicklinks", quickLinks);
    labelEl.value = "";
    urlEl.value = "";
    renderLinkEditList();
    renderQuickLinks();
  });

  /* ==========================================================
     SMART-SUCHE
     ========================================================== */
  function extractDate(text) {
    const m = text.match(/\b(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?\b/);
    if (!m) return null;
    let [, d, mo, y] = m;
    d = parseInt(d); mo = parseInt(mo);
    if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
    const year = y ? (y.length === 2 ? 2000 + parseInt(y) : parseInt(y)) : new Date().getFullYear();
    let dateObj = new Date(year, mo - 1, d);
    if (!y) {
      const today = new Date(); today.setHours(0,0,0,0);
      if (dateObj < today) dateObj = new Date(year + 1, mo - 1, d);
    }
    return { iso: dateKey(dateObj), raw: m[0] };
  }
  function extractTime(text) {
    const m = text.match(/\b(\d{1,2}):(\d{2})\b/);
    return m ? { time: `${m[1].padStart(2,"0")}:${m[2]}`, raw: m[0] } : null;
  }

  /* Sucht im Text nach einem Kurzname aus dem Stundenplan, damit
     "Hausaufgabe Mathe 12.09" gleich das richtige Fach trifft. */
  function fachAusText(text) {
    const lower = String(text || "").toLowerCase();
    let treffer = null;
    Object.keys(FAECHER).forEach(id => {
      const kurz = fachInfo(id).kurz.replace(/\s*LK$/, "").toLowerCase();
      if (kurz && lower.includes(kurz)) treffer = id;
    });
    return treffer;
  }

  function handleCapture(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();

    // Klausur / Prüfung
    if (/\b(klausur|prüfung|pruefung|test|exam)\b/.test(lower)) {
      const date = extractDate(trimmed);
      if (date) {
        let title = trimmed.replace(date.raw, "").replace(/\b(klausur|prüfung|pruefung|test|exam)\b/i, "").trim();
        if (!title) title = "Klausur";
        klausuren.push({ id: uid(), title, date: date.iso });
        klausurenSichern();
        renderKlausuren();
        showToast(`Klausurtermin „${title}" am ${fmtDate(date.iso)} hinzugefügt.`, "success");
        return;
      }
    }

    // Hausaufgabe
    if (/\b(hausaufgabe|hausaufgaben|ha|aufgabe)\b/.test(lower)) {
      const date = extractDate(trimmed);
      let titel = trimmed.replace(/\b(hausaufgabe|hausaufgaben|ha|aufgabe)\b/i, "");
      if (date) titel = titel.replace(date.raw, "");
      titel = titel.replace(/^[\s,·-]+|[\s,·-]+$/g, "").trim();
      /* Steht ein Fach im Text, kommt es samt Faelligkeit mit */
      const fach = fachAusText(titel);
      if (fach) titel = titel.replace(new RegExp(fachInfo(fach).kurz.split(" ")[0], "i"), "").trim();
      entwurfStarten("hausaufgabe",
        titel || (fach ? "Hausaufgabe " + fachInfo(fach).kurz : "Hausaufgabe"),
        fach, date ? date.iso : null);
      return;
    }

    // Termin (Stichwort oder erkanntes Datum)
    const date = extractDate(trimmed);
    if ((/\btermin\b/.test(lower) || date) && date) {
      const time = extractTime(trimmed);
      let title = trimmed.replace(date.raw, "");
      if (time) title = title.replace(time.raw, "");
      title = title.replace(/\btermin\b/i, "").trim();
      if (!title) title = "Termin";
      termine.push({ id: uid(), title, date: date.iso, time: time ? time.time : "" });
      store.set("lifeos_termine", termine);
      renderTermine();
      showToast(`Termin „${title}" am ${fmtDate(date.iso)} hinzugefügt.`, "success");
      return;
    }

    /* Bevor es ins Netz geht: steht es vielleicht hier drin? */
    const eigene = fundstellen(trimmed);
    if (eigene.length) {
      eigene[0].tun();
      return;
    }

    // Fallback: Google-Suche
    showToast(`Google-Suche wird geöffnet: „${trimmed}"`);
    window.open("https://www.google.com/search?q=" + encodeURIComponent(trimmed), "_blank", "noopener,noreferrer");
  }

  $("captureForm").addEventListener("submit", e => {
    e.preventDefault();
    const input = $("captureInput");
    if (input.value.trim()) nutzAktion("suche");
    handleCapture(input.value);
    input.value = "";
  });

  /* ==========================================================
     TOASTS
     ========================================================== */
  function showToast(msg, type) {
    const stack = $("toastStack");
    const el = document.createElement("div");
    el.className = "toast" + (type ? " " + type : "");
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(() => {
      el.classList.add("fade-out");
      el.addEventListener("animationend", () => el.remove(), { once: true });
    }, 3400);
  }

  /* ==========================================================
     SIDEBAR — Ein-/Ausklappen + aktiver Bereich
     ========================================================== */
  const sidebar = $("sidebar");
  if (store.get("lifeos_sidebar_collapsed", false)) sidebar.classList.add("collapsed");
  $("sidebarToggle").addEventListener("click", () => {
    sidebar.classList.toggle("collapsed");
    store.set("lifeos_sidebar_collapsed", sidebar.classList.contains("collapsed"));
    // Die Karten werden dadurch breiter/schmaler — Indikator und
    // Diagramm nachziehen
    positionTabIndicator();
    zeichneDiagramm();
  });

  const navLinks = Array.from(document.querySelectorAll(".nav-link[data-target]"));
  const sections = navLinks.map(l => $(l.dataset.target)).filter(Boolean);
  if ("IntersectionObserver" in window && sections.length) {
    const spy = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        navLinks.forEach(l => l.classList.toggle("active", l.dataset.target === entry.target.id));
      });
    }, { rootMargin: "-15% 0px -70% 0px", threshold: 0 });
    sections.forEach(sec => spy.observe(sec));
  }

  /* ==========================================================
     AUSWAHLMENÜS
     Ein <select> lässt sich nur außen gestalten. Die aufgeklappte
     Liste kommt vom Betriebssystem: helle Kästen, Systemschrift,
     fremde Ränder — mitten in einem dunklen Layout ein Fremdkörper.
     Und bei 220 Effekten scrollt man sich durch eine Liste ohne
     jede Hilfe.

     Deshalb liegt hier ein eigenes Menü darüber. Das <select>
     bleibt bestehen und behält seinen Wert — es wird nur versteckt
     und weiterhin beschrieben. Jede vorhandene Logik hängt an
     seinem "change" und merkt von diesem Aufsatz nichts.

     Nur am Rechner: auf dem Telefon öffnet ein <select> das
     Auswahlrad des Systems, das mit dem Daumen besser zu bedienen
     ist als jede nachgebaute Liste.
     ========================================================== */
  const AUSWAHL_SUCHE_AB = 12;      // ab so vielen Einträgen ein Suchfeld
  let auswahlOffen = null;

  function auswahlMoeglich() {
    return !document.documentElement.classList.contains("finger");
  }

  function auswahlAufwerten(bereich) {
    if (!auswahlMoeglich()) return;
    (bereich || document).querySelectorAll("select:not([data-aufgewertet])").forEach(feld => {
      feld.dataset.aufgewertet = "1";

      const huelle = document.createElement("div");
      huelle.className = "aw" + (feld.className ? " aw-" + feld.className.split(" ")[0] : "");

      const knopf = document.createElement("button");
      knopf.type = "button";
      knopf.className = "aw-knopf";
      knopf.setAttribute("aria-haspopup", "listbox");
      knopf.setAttribute("aria-expanded", "false");
      knopf.innerHTML = `<span class="aw-wert"></span><span class="aw-pfeil" aria-hidden="true"></span>`;

      feld.parentNode.insertBefore(huelle, feld);
      huelle.appendChild(feld);
      huelle.appendChild(knopf);

      const beschriften = () => {
        const gewaehlt = feld.selectedOptions[0];
        knopf.querySelector(".aw-wert").textContent = gewaehlt ? gewaehlt.textContent : "—";
        knopf.disabled = feld.disabled;
      };
      beschriften();
      /* Ändert sich der Wert von außen — etwa weil ein anderes Gerät
         etwas gesetzt hat —, zieht die Beschriftung mit. */
      feld.addEventListener("change", beschriften);
      feld._awBeschriften = beschriften;

      knopf.addEventListener("click", e => {
        e.stopPropagation();
        auswahlOeffnen(feld, knopf);
      });
      knopf.addEventListener("keydown", e => {
        if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          auswahlOeffnen(feld, knopf);
        }
      });
    });
  }

  function auswahlSchliessen() {
    if (!auswahlOffen) return;
    const { liste, knopf } = auswahlOffen;
    knopf.setAttribute("aria-expanded", "false");
    liste.classList.remove("offen");
    /* Erst nach der Ausblendung entfernen, sonst springt es weg */
    setTimeout(() => liste.remove(), 160);
    auswahlOffen = null;
  }

  function auswahlOeffnen(feld, knopf) {
    if (auswahlOffen && auswahlOffen.feld === feld) return auswahlSchliessen();
    auswahlSchliessen();

    const liste = document.createElement("div");
    liste.className = "aw-liste";
    liste.setAttribute("role", "listbox");

    const eintraege = [...feld.options];
    const vieleEintraege = eintraege.length >= AUSWAHL_SUCHE_AB;

    liste.innerHTML =
      (vieleEintraege
        ? `<div class="aw-suchzeile">
             <input type="text" class="aw-suche" placeholder="Suchen …" autocomplete="off"
                    spellcheck="false" aria-label="In der Liste suchen">
           </div>` : "")
      + `<div class="aw-rollen" role="none"></div>`;

    const rollen = liste.querySelector(".aw-rollen");

    const zeichnen = filter => {
      const f = String(filter || "").trim().toLowerCase();
      const passend = eintraege.filter(o => !f || o.textContent.toLowerCase().includes(f));
      rollen.innerHTML = passend.length
        ? passend.map(o => `
            <button type="button" class="aw-eintrag${o.value === feld.value ? " gewaehlt" : ""}"
                    role="option" aria-selected="${o.value === feld.value}"
                    data-wert="${escapeHTML(o.value)}">
              <span>${escapeHTML(o.textContent)}</span>
              ${o.value === feld.value ? '<i class="aw-haken" aria-hidden="true"></i>' : ""}
            </button>`).join("")
        : `<div class="aw-nichts">Nichts gefunden</div>`;

      rollen.querySelectorAll("[data-wert]").forEach(b =>
        b.addEventListener("click", () => {
          feld.value = b.dataset.wert;
          if (feld._awBeschriften) feld._awBeschriften();
          feld.dispatchEvent(new Event("change", { bubbles: true }));
          auswahlSchliessen();
          knopf.focus();
        }));
    };
    zeichnen("");

    document.body.appendChild(liste);
    auswahlOffen = { feld, knopf, liste };
    knopf.setAttribute("aria-expanded", "true");

    /* Fest im Fenster ausrichten: die Karten haben overflow, ein
       Menü im Fluss würde dort abgeschnitten. Passt es nach unten
       nicht, klappt es nach oben auf. */
    const stellen = () => {
      const r = knopf.getBoundingClientRect();
      const hoehe = liste.offsetHeight;
      const platzUnten = innerHeight - r.bottom - 12;
      const nachOben = platzUnten < hoehe && r.top > platzUnten;
      liste.style.left = Math.max(8, Math.min(r.left, innerWidth - liste.offsetWidth - 8)) + "px";
      liste.style.minWidth = r.width + "px";
      liste.style.top = nachOben ? Math.max(8, r.top - hoehe - 6) + "px" : (r.bottom + 6) + "px";
      liste.classList.toggle("nach-oben", nachOben);
    };
    stellen();
    requestAnimationFrame(() => { stellen(); liste.classList.add("offen"); });

    const suche = liste.querySelector(".aw-suche");
    if (suche) {
      suche.addEventListener("input", () => { zeichnen(suche.value); stellen(); });
      setTimeout(() => suche.focus(), 30);
    } else {
      const gewaehlt = rollen.querySelector(".gewaehlt");
      if (gewaehlt) gewaehlt.scrollIntoView({ block: "center" });
    }

    liste.addEventListener("keydown", e => {
      if (e.key === "Escape") { e.preventDefault(); auswahlSchliessen(); knopf.focus(); }
    });
  }

  /* Ein Zug mit gedrückter Maus gehört zusammen, auch wenn er über
     den Rand des Menüs hinausführt: Wer im Suchfeld Text markiert
     und dabei nach draußen zieht, will das Menü nicht schließen.
     Deshalb wird gemerkt, wo der Zug begann — und solange die Taste
     unten ist, schließt gar nichts. */
  let mausUnten = false;
  let zugBegannImMenue = false;

  document.addEventListener("mousedown", e => {
    mausUnten = true;
    const drin = !!(e.target.closest(".aw-liste") || e.target.closest(".aw-knopf"));
    zugBegannImMenue = drin;
    if (!auswahlOffen || drin) return;
    auswahlSchliessen();
  });

  document.addEventListener("mouseup", () => {
    mausUnten = false;
    /* Erst nach dem Loslassen zurücksetzen: ein Klick außerhalb
       feuert sein mouseup, bevor das nächste mousedown kommt. */
    setTimeout(() => { zugBegannImMenue = false; }, 0);
  });

  window.addEventListener("resize", () => { if (!mausUnten) auswahlSchliessen(); });

  /* Rollt die Seite unter dem Menü weg, steht es an der falschen
     Stelle — dann schließt es. Rollt aber die Liste selbst, ist das
     genau das, was man wollte: dieses Ereignis muss durch.

     Der Lauscher hört in der Einfangphase mit, weil ein Rollen
     innerhalb eines Kastens nicht nach oben steigt. Ohne die
     Ausnahme schloss das Menü beim ersten Radzug.

     Und während die Maustaste unten ist, wird gar nicht geschlossen:
     zieht man beim Markieren über den Rand, rollt der Browser die
     Seite von selbst mit — das Menü verschwand dann mitten im
     Markieren. */
  document.addEventListener("scroll", e => {
    if (!auswahlOffen) return;
    if (mausUnten || zugBegannImMenue) return;
    if (e.target && auswahlOffen.liste.contains(e.target)) return;
    auswahlSchliessen();
  }, true);

  /* Felder entstehen laufend neu — etwa bei jedem Neuzeichnen der
     Lichter. Ein Beobachter fängt sie ein, statt an jeder Stelle
     einen Aufruf nachzutragen. */
  if (auswahlMoeglich() && "MutationObserver" in window) {
    auswahlAufwerten();
    new MutationObserver(aenderungen => {
      let neu = false;
      aenderungen.forEach(a => a.addedNodes.forEach(n => {
        if (n.nodeType !== 1) return;
        if (n.tagName === "SELECT" || n.querySelector?.("select")) neu = true;
      }));
      if (neu) auswahlAufwerten();
    }).observe(document.body, { childList: true, subtree: true });
  }

  /* ---------- Avatar ----------
     Ohne Bild die ersten beiden Buchstaben, mit Bild das Bild. Ein
     Element, zwei Zustände — deshalb hier und nicht an jeder
     Stelle einzeln. */
  function avatarFuellen(el, name) {
    if (!el) return;
    el.innerHTML = "";
    if (settings.bild) {
      const bild = document.createElement("img");
      bild.src = settings.bild;
      bild.alt = "";
      el.appendChild(bild);
      el.classList.add("mit-bild");
      return;
    }
    el.classList.remove("mit-bild");
    el.textContent = name ? name.slice(0, 2).toUpperCase() : "–";
  }

  function updateAvatar() {
    const name = (settings.name || "").trim();
    $("avatarName").textContent = name || "Gast";
    avatarFuellen($("avatarCircle"), name);
    kpKopfZeichnen();
  }
  updateAvatar();

  /* ==========================================================
     WIDGET-RASTER
     Jede Karte belegt eine feste Zahl Spalten (--sp) und Reihen
     (--sz) im Vierundzwanziger-Raster. Die Werte stehen hier und
     bleiben so: Karten lassen sich nicht mehr verschieben und nicht
     in der Größe ziehen.

     Auf Tablet und Telefon greifen diese Werte ohnehin nicht — dort
     legt die CSS eine eigene Aufteilung fest, die zur Bildschirm-
     größe passt.
     ========================================================== */
  const KARTEN_RASTER = [
    { id: "card-vorschlag",  sp: 6,  sz: 3 },
    { id: "card-kalorien",   sp: 6,  sz: 3 },
    { id: "card-screentime", sp: 12, sz: 3 },
    { id: "card-wetter",     sp: 4,  sz: 3 },
    { id: "card-naechste",   sp: 6,  sz: 3 },
    { id: "card-streaks",    sp: 4,  sz: 3 },
    { id: "card-habits",     sp: 10, sz: 3 }
  ];

  KARTEN_RASTER.forEach(k => {
    const karte = $(k.id);
    if (!karte) return;
    karte.style.setProperty("--sp", k.sp);
    karte.style.setProperty("--sz", k.sz);
  });

  // Sobald die Karten einmal eingelaufen sind, wird die Ankunftsanimation
  // stillgelegt — sie gehört zum Seitenaufbau, nicht zum Bedienen.
  setTimeout(() => document.body.classList.add("geladen"), 1200);

  /* ==========================================================
     SEITEN
     Das Dashboard ist eine von mehreren Seiten. Gewechselt wird
     über die Sidebar, über #/name in der Adresse oder über einen
     Slash-Befehl in der Suche.
     ========================================================== */
  const SEITEN = [
    { id: "dashboard",      befehl: "/dashboard",      titel: "Dashboard",         info: "Zur Übersicht" },
    { id: "kalender",       befehl: "/kalender",       titel: "Kalender & Schule", info: "Termine und Klausuren" },
    { id: "habits",         befehl: "/habits",         titel: "Habits & Streaks",  info: "Gewohnheiten und Serien" },
    { id: "kalorien",       befehl: "/kalorien",       titel: "Kalorien",          info: "Heutiger Stand und Verlauf" },
    { id: "bildschirmzeit", befehl: "/bildschirmzeit", titel: "Bildschirmzeit",    info: "Handy und PC im Verlauf" },
    { id: "lernen",         befehl: "/lernen",         titel: "Lernen",            info: "Kurse und anstehende Klausuren" },
    { id: "planung",        befehl: "/automation",     titel: "Automation",        info: "Abläufe mit Zeitpunkt" },
    { id: "projekte",       befehl: "/projekte",       titel: "Projekte",          info: "Schritte und Termine" },
    { id: "licht",          befehl: "/licht",          titel: "Licht",             info: "Lichterketten steuern" },
    { id: "analyse",        befehl: "/analyse",        titel: "Analyse",           info: "Zahlen der letzten Wochen" }
  ];

  let aktuelleSeite = "dashboard";

  /* ==========================================================
     NUTZUNG MITSCHREIBEN
     Das Dashboard weiß alles über den Tag — nur nicht über sich
     selbst. Hier werden deshalb Seitenaufrufe, Verweildauer und
     ausgelöste Aktionen gezählt und gebündelt an den Server
     geschickt. Nur Zahlen, keine Inhalte: dass ein Habit
     abgehakt wurde, nicht welcher.

     Ohne Server sammelt sich das an und geht später mit — genau
     wie beim Abgleich.
     ========================================================== */
  const nutzSeiten = [];        // { name, dauer }
  const nutzAktionen = [];      // "habit", "suche", …
  let nutzSeit = Date.now();    // seit wann die aktuelle Seite offen ist
  let nutzTimer = null;

  function nutzGeraet() {
    const k = document.documentElement.classList;
    if (k.contains("tablet")) return "tablet";
    if (k.contains("finger")) return "handy";
    return "pc";
  }

  function nutzSenden() {
    if (!nutzSeiten.length && !nutzAktionen.length) return;
    const bericht = {
      geraet: nutzGeraet(),
      stunde: new Date().getHours(),
      seiten: nutzSeiten.splice(0, nutzSeiten.length),
      aktionen: nutzAktionen.splice(0, nutzAktionen.length)
    };
    fetch("/api/nutzung", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bericht),
      keepalive: true
    }).catch(() => {
      /* Rechner aus: zurück in die Sammlung, geht beim nächsten Mal mit */
      nutzSeiten.push(...bericht.seiten);
      nutzAktionen.push(...bericht.aktionen);
    });
  }

  function nutzBald() {
    clearTimeout(nutzTimer);
    nutzTimer = setTimeout(nutzSenden, 4000);
  }

  /* Die verstrichene Zeit der bisherigen Seite festhalten */
  function nutzSeiteAbschliessen() {
    const dauer = Math.round((Date.now() - nutzSeit) / 1000);
    nutzSeit = Date.now();
    if (aktuelleSeite && dauer > 1) {
      nutzSeiten.push({ name: aktuelleSeite, dauer });
      nutzBald();
    }
  }

  /* Von überall aufrufbar, wo etwas passiert */
  function nutzAktion(was) {
    nutzAktionen.push(was);
    nutzBald();
  }

  window.addEventListener("pagehide", () => { nutzSeiteAbschliessen(); nutzSenden(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { nutzSeiteAbschliessen(); nutzSenden(); }
    else nutzSeit = Date.now();       // im Hintergrund zählt nicht mit
  });
  /* Auch ohne Seitenwechsel regelmäßig festhalten — sonst ginge eine
     lange Sitzung auf derselben Seite beim Abstürzen verloren. */
  setInterval(() => { if (document.visibilityState === "visible") nutzSeiteAbschliessen(); }, 120000);

  function seiteZeigen(id, ausAdresse) {
    if (!SEITEN.some(s => s.id === id)) id = "dashboard";
    if (aktuelleSeite && aktuelleSeite !== id) nutzSeiteAbschliessen();
    aktuelleSeite = id;

    document.querySelectorAll(".seite").forEach(s => {
      s.classList.toggle("aktiv", s.id === "seite-" + id);
    });
    document.querySelectorAll(".nav-link[data-seite]").forEach(a => {
      a.classList.toggle("active", a.dataset.seite === id);
    });
    document.body.classList.toggle("auf-dashboard", id === "dashboard");

    if (!ausAdresse) location.hash = "#/" + id;

    // Beim Betreten einer Seite dürfen die Widgets einmal einlaufen
    aufbauAnstossen();
    seiteAufbauen(id);
    if (id === "dashboard") zeichneDiagramm();
  }

  document.querySelectorAll(".nav-link[data-seite]").forEach(a => {
    a.addEventListener("click", e => { e.preventDefault(); seiteZeigen(a.dataset.seite); });
  });
  window.addEventListener("hashchange", () => {
    const id = (location.hash || "").replace(/^#\//, "");
    if (id && id !== aktuelleSeite) seiteZeigen(id, true);
  });

  /* ---------- Inhalte je Seite ---------- */
  function seiteAufbauen(id) {
    if (id === "kalender")       baueKalender();
    if (id === "habits")         baueHabits();
    if (id === "kalorien")       baueKalorien();
    if (id === "bildschirmzeit") {
      baueBildschirmzeit();
      bildschirmzeitHolen();
    }
    pcTaktSetzen(id === "bildschirmzeit");
    if (id === "lernen")         baueLernen();
    if (id === "planung")        bauePlanung();
    if (id === "projekte")       baueProjekte();
    if (id === "licht")          baueLicht();
    /* Der Licht-Takt fragt zehn Geräte ab — er läuft nur, solange
       man auch hinschaut. */
    else lichtTaktSetzen(false);
    if (id === "analyse")        baueAnalyse();
  }

  function zeile(inhalt, klassen) {
    const li = document.createElement("li");
    li.className = "voll-zeile" + (klassen ? " " + klassen : "");
    li.innerHTML = inhalt;
    return li;
  }

  /* ---------- Kalender & Schule ----------
     Oben eine Monatsansicht wie in gängigen Kalendern, darunter die
     Listen. Ein Klick auf einen Tag filtert die Liste auf ihn. */
  let monatAnsicht = null;      // erster Tag des gezeigten Monats
  let gewaehlterTag = null;     // angeklickter Tag oder null

  /* Aus dem Widget heraus zum Kalender springen und den Tag markieren,
     damit der Eintrag sofort ins Auge faellt. */
  function kalenderZeigen(datum) {
    gewaehlterTag = datum || null;
    if (datum) {
      monatAnsicht = new Date(datum + "T00:00:00");
      monatAnsicht.setDate(1);
    }
    seiteZeigen("kalender");
  }

  /* Alle Einträge eines Tages, Termine und Klausuren zusammen */
  function eintraegeAm(key) {
    return [
      ...termine.filter(t => t.date === key).map(t => ({ ...t, art: "termin" })),
      ...klausuren.filter(k => k.date === key).map(k => ({ ...k, art: "klausur" })),
      /* Erledigte Hausaufgaben stehen nicht mehr im Kalender */
      ...hausaufgaben.filter(h => h.date === key && !h.erledigt)
                     .map(h => ({ ...h, art: "hausaufgabe" }))
    ].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  }

  function monatZeichnen() {
    if (!monatAnsicht) { monatAnsicht = new Date(); monatAnsicht.setDate(1); }
    const jahr = monatAnsicht.getFullYear(), monat = monatAnsicht.getMonth();
    $("pgMonatTitel").textContent = MONTHS[monat] + " " + jahr;

    // Woche beginnt am Montag
    const versatz = (new Date(jahr, monat, 1).getDay() + 6) % 7;
    const start = new Date(jahr, monat, 1 - versatz);
    const letzter = new Date(jahr, monat + 1, 0).getDate();
    const felder = Math.ceil((versatz + letzter) / 7) * 7;
    const heute = todayStr();

    const gitter = $("pgMonatGitter");
    gitter.innerHTML = "";
    let imMonat = 0;

    for (let i = 0; i < felder; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const key = dateKey(d);
      const fremd = d.getMonth() !== monat;
      const wochenende = d.getDay() === 0 || d.getDay() === 6;
      const eintraege = eintraegeAm(key);
      if (!fremd) imMonat += eintraege.length;

      /* Schulfreie Tage bekommen einen eigenen Grund — sonst sieht
         eine Ferienwoche aus wie eine leere Arbeitswoche. */
      const feier = feiertagName(key);
      const frei = feier || ferienName(key);

      const zelle = document.createElement("button");
      zelle.type = "button";
      zelle.className = "monat-tag" + (fremd ? " fremd" : "") + (wochenende ? " wochenende" : "") +
                        (frei && !wochenende ? (feier ? " feiertag" : " ferien") : "") +
                        (key === heute ? " heute" : "") + (key === gewaehlterTag ? " gewaehlt" : "");
      zelle.dataset.tag = key;
      if (frei) zelle.title = frei;

      // Höchstens drei Einträge zeigen, der Rest als Zähler
      const sichtbar = eintraege.slice(0, 3);
      const chips = sichtbar.map(e =>
        `<span class="mt-chip ${e.art}" title="${escapeHTML(e.title)}${e.time ? " · " + e.time : ""}">
           <span class="mt-punkt"></span>${e.time ? `<span class="mt-zeit">${escapeHTML(e.time.slice(0, 5))}</span>` : ""}
           <span class="mt-name">${escapeHTML(e.title)}</span>
         </span>`).join("");
      const mehr = eintraege.length > 3 ? `<span class="mt-mehr">+${eintraege.length - 3} weitere</span>` : "";

      const freiMarke = frei && !wochenende && !fremd
        ? `<span class="mt-frei">${escapeHTML(feier || "Ferien")}</span>` : "";
      zelle.innerHTML = `<span class="mt-zahl">${d.getDate()}</span>${freiMarke}${chips}${mehr}`;
      gitter.appendChild(zelle);
    }

    $("pgMonatZahl").textContent = imMonat + (imMonat === 1 ? " Eintrag" : " Einträge");

    gitter.querySelectorAll("[data-tag]").forEach(z => {
      z.addEventListener("click", () => {
        gewaehlterTag = gewaehlterTag === z.dataset.tag ? null : z.dataset.tag;
        baueKalender();
      });
    });
  }

  /* Die Terminliste auf der Kalenderseite startet zugeklappt — das
     Monatsgitter darüber ist der Überblick, die Aufzählung braucht
     man erst auf Nachfrage. Der Zustand bleibt auf diesem Gerät und
     wird nicht mit den anderen abgeglichen: Ansicht, kein Inhalt. */
  let termineOffen = localStorage.getItem("lifeos_kalender_termine_offen") === "1";

  function termineKlappen(auf, sofort) {
    const huelle = $("pgTermineHuelle");
    const kopf = $("pgTermineKopf");
    if (!huelle || !kopf) return;
    termineOffen = auf;
    localStorage.setItem("lifeos_kalender_termine_offen", auf ? "1" : "0");
    kopf.setAttribute("aria-expanded", auf ? "true" : "false");
    unterKlappen(huelle, auf, sofort);
  }

  /* Kopfzeile der Terminliste: klicken klappt auf und zu. Der
     Startzustand wird ohne Animation gesetzt, sonst fährt die Liste
     beim Laden der Seite sichtbar zusammen. */
  const termineKopf = $("pgTermineKopf");
  if (termineKopf) {
    termineKopf.addEventListener("click", () => termineKlappen(!termineOffen));
    termineKlappen(termineOffen, true);
  }

  document.querySelectorAll("[data-monat]").forEach(b => {
    b.addEventListener("click", () => {
      if (b.dataset.monat === "heute") {
        // Springt zum laufenden Monat, waehlt aber keinen Tag aus —
        // sonst waere unklar, warum die Liste plotzlich gefiltert ist.
        monatAnsicht = new Date(); monatAnsicht.setDate(1);
      } else {
        if (!monatAnsicht) { monatAnsicht = new Date(); monatAnsicht.setDate(1); }
        monatAnsicht.setMonth(monatAnsicht.getMonth() + Number(b.dataset.monat));
      }
      baueKalender();
    });
  });

  /* ---------- Stundenplan ----------
     Ein Gitter aus 5 Tagen und 10 Stunden. Doppelstunden sind ein
     Feld ueber zwei Zeilen, damit der Plan aussieht wie auf Papier.
     Ein Klick auf ein Feld legt eine Klausur fuer diesen Kurs an. */
  function planZeichnen(hervorFach) {
    const wrap = $("pgPlan");
    if (!wrap) return;

    const heuteTag = new Date().getDay();
    const { jetzt, naechste } = stundeJetzt();
    let html = '<div class="plan-ecke"></div>';

    for (let t = 1; t <= 5; t++) {
      html += `<div class="plan-tag${t === heuteTag ? " heute" : ""}" style="grid-column:${t + 1};grid-row:1">
                 <span class="plan-tag-lang">${TAGE_LANG[t]}</span>
                 <span class="plan-tag-kurz">${TAGE_LANG[t].slice(0, 2)}</span>
               </div>`;
    }

    STUNDEN.forEach(st => {
      html += `<div class="plan-uhr" style="grid-row:${st.nr + 1}">
                 <b>${st.nr}</b><span>${st.von}</span><span>${st.bis}</span>
               </div>`;
      for (let t = 1; t <= 5; t++) {
        html += `<div class="plan-leer${t === heuteTag ? " heute" : ""}" style="grid-column:${t + 1};grid-row:${st.nr + 1}"></div>`;
      }
    });

    STUNDENPLAN.forEach(l => {
      const f = fachInfo(l.fach);
      const matt = hervorFach && l.fach !== hervorFach;
      const klassen = ["plan-fach", "ton-" + f.ton];
      if (l === jetzt) klassen.push("jetzt");
      if (l === naechste) klassen.push("gleich");
      if (matt) klassen.push("matt");
      html += `<button type="button" class="${klassen.join(" ")}" data-fach="${l.fach}" data-von="${l.von}"
                 style="grid-column:${l.tag + 1};grid-row:${l.von + 1}/span ${l.bis - l.von + 1}"
                 title="${escapeHTML(f.lang)} · ${blockZeit(l.von, l.bis)}${l.raum ? " · Raum " + l.raum : ""}">
                 <span class="pf-name">${escapeHTML(f.kurz)}</span>
                 <span class="pf-zeile">${l.lehrer.map(k => escapeHTML(LEHRER[k] || k)).join(", ")}</span>
                 ${l.raum ? `<span class="pf-raum">${escapeHTML(l.raum)}</span>` : ""}
               </button>`;
    });

    wrap.innerHTML = html;

    wrap.querySelectorAll(".plan-fach").forEach(b => {
      b.addEventListener("click", () => fachUebersicht(b.dataset.fach));
    });

    /* Kopfzeile: was laeuft gerade, was kommt als Naechstes */
    const zeile = $("pgPlanJetzt");
    if (jetzt) {
      zeile.textContent = "Jetzt: " + fachInfo(jetzt.fach).kurz + " · bis " + stundeInfo(jetzt.bis).bis
                        + (jetzt.raum ? " · " + jetzt.raum : "");
      zeile.className = "block-unter laeuft";
    } else if (naechste) {
      zeile.textContent = "Gleich: " + fachInfo(naechste.fach).kurz + " · ab " + stundeInfo(naechste.von).von
                        + (naechste.raum ? " · " + naechste.raum : "");
      zeile.className = "block-unter";
    } else {
      const tag = new Date().getDay();
      zeile.textContent = tag >= 1 && tag <= 5 ? "Heute nichts mehr" : "Wochenende";
      zeile.className = "block-unter";
    }

    const stundenZahl = STUNDENPLAN.reduce((sum, l) => sum + (l.bis - l.von + 1), 0);
    $("pgPlanZahl").textContent = stundenZahl + " Std/Woche";

    $("pgPlanLegende").innerHTML = Object.keys(FAECHER).map(id => {
      const f = FAECHER[id];
      const aus = hervorFach && id !== hervorFach ? " matt" : "";
      return `<button type="button" class="pl-fach ton-${f.ton}${aus}" data-fach="${id}">
                <i></i><span>${escapeHTML(f.lang)}</span>
              </button>`;
    }).join("");

    $("pgPlanLegende").querySelectorAll(".pl-fach").forEach(b => {
      b.addEventListener("click", () => {
        planFilter = planFilter === b.dataset.fach ? null : b.dataset.fach;
        planZeichnen(planFilter);
      });
    });
  }

  let planFilter = null;

  /* ==========================================================
     WICHTIG
     Über dem Kalender: was am dringendsten ansteht. Klausuren und
     Hausaufgaben bringen ihre Bewertung schon mit — dieselbe, nach
     der auch die Lernseite sortiert. Ein Termin hat nichts
     vorzubereiten und zählt deshalb nur über seine Nähe.

     Alle drei hängen an derselben Grundgröße 100/(Tage+1), sind
     also vergleichbar: was näher ist, steht weiter oben, und eine
     Klausur ohne Material im Leistungskurs überholt einen Termin
     am selben Tag.
     ========================================================== */
  const WICHTIG_MAX = 4;

  function wichtigPunkte(e) {
    if (e.art === "klausur") return lernPunkte(e);
    if (e.art === "hausaufgabe") return hausPunkte(e);
    return 100 / (Math.max(0, daysUntil(e.date)) + 1);
  }

  /* Ein Satz dazu, warum der Eintrag oben steht */
  function wichtigGrund(e) {
    if (e.art === "klausur") return lernGrund(e);
    if (e.art === "hausaufgabe") return hausGrund(e);
    const tage = daysUntil(e.date);
    const teile = [tage === 0 ? "heute" : tage === 1 ? "morgen" : "in " + tage + " Tagen"];
    if (e.time) teile.push(e.time);
    return teile.join(" · ");
  }

  const WICHTIG_ART = { klausur: "Klausur", hausaufgabe: "Hausaufgabe", termin: "Termin" };

  function wichtigListe() {
    const alle = [];
    termine.forEach(t => alle.push({ ...t, art: "termin" }));
    klausuren.forEach(k => alle.push({ ...k, art: "klausur" }));
    hausaufgaben.forEach(h => { if (!h.erledigt) alle.push({ ...h, art: "hausaufgabe" }); });
    return alle
      /* Wie im Widget auf dem Dashboard: eine offene Hausaufgabe
         bleibt stehen, bis sie abgehakt ist. */
      .filter(e => e.art === "hausaufgabe" ? daysUntil(e.date) >= -14 : daysUntil(e.date) >= 0)
      .map(e => ({ ...e, punkte: wichtigPunkte(e) }))
      .sort((a, b) => b.punkte - a.punkte)
      .slice(0, WICHTIG_MAX);
  }

  /* Der Zähler zeigt Tage — überfällig bekommt ein eigenes Wort */
  function wichtigZaehler(e) {
    const tage = daysUntil(e.date);
    if (tage < 0) return { zahl: Math.abs(tage), einheit: Math.abs(tage) === 1 ? "Tag über" : "Tage über", ton: "rot" };
    if (tage === 0) return { zahl: "heute", einheit: "", ton: "rot" };
    /* Für Schulisches zählen Schultage: bis zu einer Klausur ist
       nicht die Zahl der Kalendertage die Frage, sondern wie oft man
       bis dahin noch in dem Fach sitzt. */
    if (e.art !== "termin" && tage >= 2) {
      const schul = schultageBis(e.date);
      if (schul === 0) return { zahl: "nach", einheit: "den Ferien", ton: "ruhig" };
      return { zahl: schul, einheit: schul === 1 ? "Schultag" : "Schultage",
               ton: tage <= 3 ? "gelb" : "ruhig" };
    }
    return { zahl: tage, einheit: tage === 1 ? "Tag" : "Tage", ton: tage <= 3 ? "gelb" : "ruhig" };
  }

  function wichtigZeichnen() {
    const kasten = $("pgWichtigInhalt");
    if (!kasten) return;
    const liste = wichtigListe();
    $("pgWichtigZahl").textContent = liste.length;

    if (!liste.length) {
      kasten.innerHTML = '<div class="wi-leer">Nichts steht an — nichts vorzubereiten.</div>';
      return;
    }

    const [oben, ...rest] = liste;
    const z = wichtigZaehler(oben);
    const fach = oben.fach ? fachInfo(oben.fach).kurz : "";

    kasten.innerHTML = `
      <button type="button" class="wi-haupt ${oben.art} ton-${z.ton}" data-id="${oben.id}" data-art="${oben.art}">
        <span class="wi-marke">${WICHTIG_ART[oben.art]}${fach ? " · " + escapeHTML(fach) : ""}</span>
        <span class="wi-titel">${escapeHTML(oben.title)}</span>
        <span class="wi-grund">${escapeHTML(wichtigGrund(oben))}</span>
        <span class="wi-zaehler">
          <span class="wi-zahl">${z.zahl}</span>
          ${z.einheit ? `<span class="wi-einheit">${z.einheit}</span>` : ""}
        </span>
      </button>
      ${rest.length ? `<ul class="wi-liste">${rest.map(e => {
        const zz = wichtigZaehler(e);
        const f = e.fach ? fachInfo(e.fach).kurz : "";
        return `<li>
          <button type="button" class="wi-zeile ${e.art} ton-${zz.ton}" data-id="${e.id}" data-art="${e.art}">
            <span class="wi-punkt"></span>
            <span class="wi-zeile-text">
              <span class="wi-zeile-titel">${escapeHTML(e.title)}</span>
              <span class="wi-zeile-sub">${WICHTIG_ART[e.art]}${f ? " · " + escapeHTML(f) : ""} · ${escapeHTML(wichtigGrund(e))}</span>
            </span>
            <span class="wi-zeile-zahl">${zz.zahl}${zz.einheit ? " " + zz.einheit : ""}</span>
          </button>
        </li>`;
      }).join("")}</ul>` : ""}`;

    /* Ein Klick führt dorthin, wo der Eintrag zu Hause ist */
    kasten.querySelectorAll("[data-art]").forEach(b => {
      b.addEventListener("click", () => {
        const art = b.dataset.art, id = b.dataset.id;
        if (art === "klausur") lernenZeigen(id);
        else if (art === "hausaufgabe") hausaufgabenZeigen(id);
        else {
          const e = termine.find(x => x.id === id);
          if (e) { gewaehlterTag = e.date; monatAnsicht = new Date(e.date); monatAnsicht.setDate(1); baueKalender(); }
        }
      });
    });
  }

  function baueKalender() {
    wichtigZeichnen();
    monatZeichnen();
    planZeichnen(planFilter);

    const kommend = e => daysUntil(e.date) >= 0;
    const sortiert = l => [...l].sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));

    // Ist ein Tag gewählt, zeigt die Liste nur ihn
    const t = gewaehlterTag ? sortiert(termine.filter(e => e.date === gewaehlterTag))
                            : sortiert(termine.filter(kommend));
    const k = gewaehlterTag ? sortiert(klausuren.filter(e => e.date === gewaehlterTag))
                            : sortiert(klausuren.filter(kommend));

    $("pgTermineTitel").textContent = gewaehlterTag ? "Am " + fmtDate(gewaehlterTag) : "Kommende Termine";
    $("pgTermineZahl").textContent = t.length;
    /* Wer einen Tag anklickt, will genau dessen Termine sehen —
       dann klappt die Liste von selbst auf. */
    if (gewaehlterTag) termineKlappen(true, true);
    $("pgSchuleZahl").textContent = k.length;
    const haZahl = (gewaehlterTag
      ? offeneHausaufgaben().filter(e => e.date === gewaehlterTag)
      : offeneHausaufgaben()).length;
    $("kalenderSub").textContent = gewaehlterTag
      ? `${t.length + k.length + haZahl} an diesem Tag · nochmal klicken zeigt wieder alles`
      : `${t.length} Termine · ${k.length} Klausuren · ${haZahl} Hausaufgaben`;

    const fuellen = (liste, eintraege, art) => {
      liste.innerHTML = "";
      eintraege.forEach(e => {
        const diff = daysUntil(e.date);
        liste.appendChild(zeile(
          `<span class="vz-punkt ${art}"></span>
           <div class="vz-haupt">
             <div class="vz-titel">${escapeHTML(e.title)}</div>
             <div class="vz-sub">${fmtDate(e.date)}${e.time ? " · " + e.time + " Uhr" : ""}${
               klausurZusatz(e) ? ` <span class="vz-fach">${escapeHTML(klausurZusatz(e))}</span>` : ""}</div>
           </div>
           <span class="vz-badge">${diff >= 0 ? badgeFor(diff, art === "termin" ? null : e.date) : "vorbei"}</span>
           <button class="vz-del" data-id="${e.id}" data-art="${art}" aria-label="Löschen">✕</button>`,
          (art === "hausaufgabe" ? hausFrist(diff) : fristKlasse(diff))
          + (diff === 0 ? " heute" : diff > 0 && diff <= 3 ? " bald" : "")));
      });
      liste.querySelectorAll(".vz-del").forEach(b => {
        b.addEventListener("click", () => { loescheEintrag(b.dataset.id, b.dataset.art); baueKalender(); });
      });
    };
    /* Hausaufgaben stehen nach Faelligkeit, erledigte fallen weg */
    const ha = gewaehlterTag
      ? sortiert(offeneHausaufgaben().filter(e => e.date === gewaehlterTag))
      : sortiert(offeneHausaufgaben());
    $("pgHausZahl").textContent = ha.length;

    fuellen($("pgTermineListe"), t, "termin");
    fuellen($("pgKlausurenListe"), k, "klausur");
    fuellen($("pgHausListe"), ha, "hausaufgabe");

    /* Die Liste ist gerade neu gefüllt worden und damit anders hoch.
       Steht sie offen, muss die gemessene Höhe nachgezogen werden. */
    const huelle = $("pgTermineHuelle");
    if (huelle && termineOffen) huelle.style.height = "auto";
  }

  /* ---------- Habits & Streaks ---------- */
  const SEITE_TAGE = 30;

  function baueHabits() {
    const heute = todayStr();
    const tage = [];
    for (let i = SEITE_TAGE - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      tage.push(dateKey(d));
    }
    const sichtbar = habits.list.slice(0, HABIT_LIMIT);
    const erledigtHeute = habitsDoneToday().length;
    $("pgHabitsZahl").textContent = `${erledigtHeute}/${sichtbar.length}`;
    $("habitsSub").textContent = `Vier Wochen · heute ${erledigtHeute} von ${sichtbar.length}`;

    /* Je Habit ein Feld aus vier Wochen: sieben Spalten Montag bis
       Sonntag, vier Zeilen nach unten — wie im Kalender. Kein Text
       im Raster; abgehakt wird der heutige Tag. */
    const raster = wochenRaster(4);
    const matrix = $("pgHabitMatrix");
    matrix.innerHTML = "";

    sichtbar.forEach(h => {
      const block = document.createElement("div");
      block.className = "hk-block";
      const felder = raster.map(key => {
        const erledigt = (habits.done[key] || []).includes(h.id);
        const istHeute = key === heute;
        const kommt = key > heute;
        const titel = `${escapeHTML(h.name)} · ${fmtDate(key)} · ${
          kommt ? "steht noch aus" : erledigt ? "erledigt" : "offen"}`;
        const cls = "hk-feld" + (erledigt ? " done" : "") + (istHeute ? " heute" : "")
                  + (kommt ? " kommt" : "");
        return istHeute
          ? `<button type="button" class="${cls}" data-habit="${h.id}" title="${titel}"></button>`
          : `<span class="${cls}" title="${titel}"></span>`;
      }).join("");
      /* Kopfzeile je Habit: Name, Wochenstand, Ziel zum Einstellen.
         Das Ziel steht hier und nicht im Widget — dort wird abgehakt,
         nicht eingerichtet. */
      const ziel = habitZiel(h);
      const diese = habitWoche(h.id);
      const serie = habitSerie(h.id);
      block.innerHTML =
        `<div class="hk-kopf">
           <div class="hk-name">${escapeHTML(h.name)}</div>
           <div class="hk-stand${diese >= ziel ? " voll" : ""}">${
             diese >= ziel ? `Ziel erfüllt · ${diese} von ${ziel}` : `${diese}/${ziel} diese Woche`}</div>
           <div class="hk-serie">${serie} ${serie === 1 ? "Tag" : "Tage"} am Stück</div>
           <label class="hk-ziel">
             <span>Ziel</span>
             <select data-hziel="${h.id}" aria-label="Wie oft pro Woche: ${escapeHTML(h.name)}">
               ${[1,2,3,4,5,6,7].map(n =>
                 `<option value="${n}"${n === ziel ? " selected" : ""}>${n}× pro Woche</option>`).join("")}
             </select>
           </label>
         </div>
         <div class="hk-gitter">${felder}</div>`;
      matrix.appendChild(block);
    });
    matrix.querySelectorAll("[data-habit]").forEach(b => {
      b.addEventListener("click", e => { toggleHabit(b.dataset.habit, e); baueHabits(); });
    });
    matrix.querySelectorAll("[data-hziel]").forEach(w => {
      w.addEventListener("change", () => habitZielSetzen(w.dataset.hziel, w.value));
    });

    const liste = alleStreaks();
    $("pgStreakZahl").textContent = liste.filter(s => s.tage > 0).length + " aktiv";
    const tafel = $("pgStreakTafel");
    tafel.innerHTML = "";
    liste.forEach(e => {
      const heuteFertig = streakErledigt(e.id, heute);
      const stufe = heuteFertig ? streakStufe(e.tage) : 0;
      const k = document.createElement("button");
      k.type = "button";
      k.className = "streak-kachel stufe-" + stufe + (heuteFertig ? " erledigt" : "");
      k.dataset.habit = e.id;
      k.title = `${e.name}: ${e.tage} Tage am Stück (Bestwert ${streakBest(e.id)})`;
      k.innerHTML = `<span class="sk-name">${escapeHTML(e.name)}</span>
                     <span class="sk-zahl">${e.tage}</span>
                     <span class="sk-flamme">${FLAMME_SVG}</span>`;
      k.addEventListener("click", ereignis => { toggleStreak(e.id, ereignis); baueHabits(); });
      tafel.appendChild(k);
    });
  }

  /* ---------- Bildschirmzeit ---------- */
  /* Die Handy-Kurve ist aus, solange die Telefonzeit nicht verlaesslich
     ankommt — eine Flaeche aus Demo-Werten waere irrefuehrend. Auf
     true setzen bringt sie samt Legendeneintrag zurueck. */
  const ST_HANDY = false;

  /* Die Seite zeigt drei Zeitraeume; das Widget bleibt davon unberuehrt. */
  let stAnsicht = store.get("lifeos_st_seite", "woche");   // "tag" | "woche" | "monat"

  /* Punkte fuer das Diagramm, je nach gewaehltem Zeitraum. Es geht
     immer nur bis heute — eine Kurve, die fuer kommende Tage auf
     null faellt, waere irrefuehrend. */
  /* ==========================================================
     ECHTE PC-ZEIT VOM SERVER
     Der Browser darf nicht wissen, welche Programme laufen. Der
     Server auf demselben Rechner misst es und liefert es hier aus.
     ========================================================== */
  let pcMessung = null;
  let pcTakt = null;

  function bildschirmzeitHolen() {
    return fetch("/api/bildschirmzeit", { cache: "no-store" })
      .then(r => r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)))
      .then(d => {
        pcMessung = d;

        /* Fuer die PC-Zeit ist die Messung massgeblich, das Handy
           bleibt unberuehrt. Nur Tage mit echter Messung schreiben —
           fehlende Tage duerfen bestehende Werte nicht auf null setzen. */
        let geaendert = false;
        Object.entries(d.tage || {}).forEach(([tag, e]) => {
          if (!e.gesamt) return;
          if (getDayEntry(tag).pc !== e.gesamt) { setDayEntry(tag, { pc: e.gesamt }); geaendert = true; }
        });

        /* Vom Telefon geschickte Zeit — dieselbe Regel: nur Tage
           übernehmen, für die wirklich etwas ankam. */
        Object.entries(d.handy || {}).forEach(([tag, e]) => {
          if (!e.gesamt) return;
          if (getDayEntry(tag).phone !== e.gesamt) { setDayEntry(tag, { phone: e.gesamt }); geaendert = true; }
        });

        if (geaendert) renderScreenTime();
        if (aktuelleSeite === "bildschirmzeit") baueBildschirmzeit();
        return d;
      })
      .catch(fehler => {
        pcMessung = { aktiv: false, fehler: "Server nicht erreichbar (" + fehler.message + ")", tage: {} };
        if (aktuelleSeite === "bildschirmzeit") { appListeZeichnen(); inaktivZeichnen(); katZeichnen(); }
        return pcMessung;
      });
  }

  /* Solange die Seite offen ist, regelmaessig nachfragen */
  function pcTaktSetzen(an) {
    clearInterval(pcTakt);
    pcTakt = an ? setInterval(bildschirmzeitHolen, 60000) : null;
  }

  /* Welche Tage deckt der gewaehlte Zeitraum ab? */
  function stTageImZeitraum() {
    const jetzt = new Date();
    if (stAnsicht === "tag") return [todayStr()];

    const tage = [];
    if (stAnsicht === "woche") {
      const versatz = (jetzt.getDay() + 6) % 7;      // Montag als erster Tag
      for (let i = versatz; i >= 0; i--) {
        const d = new Date(); d.setDate(jetzt.getDate() - i);
        tage.push(dateKey(d));
      }
      return tage;
    }
    if (stAnsicht === "jahr") {
      /* Vom 1. Januar bis heute */
      const d = new Date(jetzt.getFullYear(), 0, 1);
      while (d <= jetzt) { tage.push(dateKey(d)); d.setDate(d.getDate() + 1); }
      return tage;
    }
    for (let t = 1; t <= jetzt.getDate(); t++) {
      tage.push(dateKey(new Date(jetzt.getFullYear(), jetzt.getMonth(), t)));
    }
    return tage;
  }

  /* Programme eines Feldes ("apps" oder "inaktivApps") ueber den
     gewaehlten Zeitraum zusammenzaehlen */
  function appsSummieren(feld) {
    if (!pcMessung || !pcMessung.tage) return [];
    const summe = new Map();
    stTageImZeitraum().forEach(tag => {
      const e = pcMessung.tage[tag];
      if (!e || !e[feld]) return;
      e[feld].forEach(a => summe.set(a.name, (summe.get(a.name) || 0) + a.minuten));
    });
    return [...summe.entries()]
      .map(([name, minuten]) => ({ name, minuten }))
      .sort((a, b) => b.minuten - a.minuten);
  }

  /* Eine Rangliste in eine Liste schreiben — gleiche Form fuer
     genutzte Programme und fuer die inaktive Zeit. */
  function rangListe(liste, apps, leerText) {
    const gesamt = apps.reduce((s, a) => s + a.minuten, 0);
    if (!apps.length) {
      liste.innerHTML = `<li class="app-leer">${escapeHTML(leerText)}</li>`;
      return;
    }
    const max = apps[0].minuten;
    liste.innerHTML = apps.map((a, i) => `
      <li class="app-zeile">
        <span class="app-rang">${i + 1}</span>
        <span class="app-name">${escapeHTML(a.name)}</span>
        <span class="app-spur"><i style="width:${Math.round(a.minuten / max * 100)}%;animation-delay:${Math.min(i * 35, 420)}ms"></i></span>
        <span class="app-anteil">${gesamt ? Math.round(a.minuten / gesamt * 100) : 0} %</span>
        <span class="app-zeit">${formatMinutes(a.minuten)}</span>
      </li>`).join("");
  }

  /* ---------- Inaktive Zeit ----------
     Wird mitgeschrieben, zaehlt aber nicht als Bildschirmzeit. Der
     Balken zeigt, wie sich die Zeit am Rechner darauf verteilt. */
  /* ==========================================================
     WOFÜR DIE ZEIT DRAUFGEHT
     Jede gemessene Minute landet in einer Gruppe. Bei Programmen
     entscheidet der Name, bei einem Browser die besuchte Seite —
     zwei Stunden Chrome sind eben nicht dasselbe, je nachdem ob
     darin TikTok oder ein Kursverlauf lief. Was sich nicht zuordnen
     lässt, bleibt ehrlich unter "Sonstiges" stehen.
     ========================================================== */
  const KATEGORIEN = [
    /* Diese Toene landen als stroke-Attribut im SVG und koennen darum
       keine Variablen sein. Sie kommen aus derselben Palette wie der
       Rest und sind so gewaehlt, dass sie auf beiden Gruenden tragen. */
    { id: "produktiv", titel: "Produktivität", ton: "#34C759" },
    { id: "youtube",   titel: "YouTube",       ton: "#FF3B30" },
    { id: "tiktok",    titel: "TikTok",        ton: "#0A84FF" },
    { id: "spiele",    titel: "Videospiele",   ton: "#FFB800" },
    { id: "rest",      titel: "Sonstiges",     ton: "#8E8E93" }
  ];

  const KAT_BROWSER = ["chrome", "msedge", "firefox", "brave", "opera", "operagx",
                       "vivaldi", "arc", "chromium"];

  /* Die Namen stehen so da, wie sie angezeigt werden — der Server
     macht aus "FortniteClient-Win64-Shipping" schon "Fortnite". */
  const KAT_SPIELE = ["rocket league", "fortnite", "valorant", "apex legends",
    "counter-strike", "elden ring", "gta v", "the witcher", "cyberpunk",
    "palworld", "dota", "minecraft", "roblox", "overwatch", "league of legends",
    "steam", "steamwebhelper", "epicgameslauncher", "battle.net",
    "riotclient", "riotclientservices", "valorant", "leagueoflegends", "league of legends",
    "minecraft", "javaw", "cs2", "csgo", "dota2", "fortnileclient", "fortniteclient",
    "rocketleague", "gta5", "gtav", "roblox", "robloxplayerbeta", "origin", "eadesktop",
    "ubisoftconnect", "cyberpunk2077", "witcher3", "xboxapp", "gamingservices",
    "risk", "leagueclient", "overwatch", "apex", "palworld", "terraria", "stardew",
    "amongus", "fall guys", "fallguys", "forza", "nba2k", "ea sports fc"];

  const KAT_PRODUKTIV = ["code", "devenv", "idea64", "pycharm64", "webstorm64", "clion64",
    "sublime_text", "notepad++", "excel", "winword", "powerpnt", "onenote", "outlook",
    "teams", "notion", "obsidian", "acrobat", "acrord32",
    "figma", "tradingview", "metatrader", "metatrader5", "thinkorswim", "windowsterminal",
    "powershell", "cmd", "wt", "git", "node", "docker", "explorer", "anki",
    "terminal", "claude", "chatgpt", "cursor", "goodnotes", "onenote", "calc",
    "libreoffice", "thunderbird", "zoom", "webex",
    /* Gestalten ist Arbeit. "adobe" deckt alles ab, was den
       Firmennamen im Prozess trägt (Adobe Premiere Pro, Adobe
       Audition, Adobe Media Encoder …). Danach stehen nur die
       Programme, die ohne ihn laufen — After Effects heißt im
       Prozess schlicht AfterFX. */
    "adobe", "afterfx", "photoshop", "illustrator", "indesign",
    "lightroom", "premiere", "blender"];

  /* Seiten, die als Arbeit zählen — Handel, Lernen, Werkzeuge */
  const KAT_PROD_SEITEN = ["tradingview", "investing", "finanzen", "boerse", "coinmarketcap",
    "binance", "bitpanda", "trade", "github", "gitlab", "stackoverflow", "notion",
    "chatgpt", "openai", "claude", "anthropic", "docs", "drive", "office", "onedrive",
    "canva", "figma", "overleaf", "wolframalpha", "duden", "leo", "deepl", "moodle",
    "bolle", "wikipedia", "khanacademy", "studyflix", "simpleclub", "lernen"];

  const enthaelt = (liste, wort) => liste.some(x => wort.includes(x));

  function katVonApp(name) {
    const n = String(name || "").toLowerCase();
    if (enthaelt(KAT_SPIELE, n)) return "spiele";
    if (enthaelt(KAT_PRODUKTIV, n)) return "produktiv";
    return "rest";
  }

  function katVonSeite(domain, titel) {
    const d = String(domain || "").toLowerCase();
    const gesamt = d + " " + String(titel || "").toLowerCase();
    if (d.includes("tiktok") || gesamt.includes("tiktok")) return "tiktok";
    if (d.includes("youtube") || d.includes("youtu.be")) return "youtube";
    if (enthaelt(KAT_PROD_SEITEN, gesamt)) return "produktiv";
    return "rest";
  }

  /* Minuten je Gruppe für den gewählten Zeitraum — und dazu, woraus
     sie sich zusammensetzt. Bei Programmen ist das ihr Name, im
     Browser die besuchte Seite. */
  function katSummieren() {
    const topf = { produktiv: 0, youtube: 0, tiktok: 0, spiele: 0, rest: 0 };
    const teile = { produktiv: [], youtube: [], tiktok: [], spiele: [], rest: [] };
    const dazu = (gruppe, name, minuten) => {
      topf[gruppe] += minuten;
      const da = teile[gruppe].find(x => x.name === name);
      if (da) da.minuten += minuten;
      else teile[gruppe].push({ name, minuten });
    };

    katApps().forEach(a => {
      const name = String(a.name || "").toLowerCase();
      if (!KAT_BROWSER.includes(name)) {
        dazu(katVonApp(name), a.name, a.minuten);
        return;
      }
      /* Browserzeit nach Seiten aufteilen. Was ohne lesbare Adresse
         gemessen wurde, bleibt Rest — raten wäre schlechter als
         zugeben, dass es unbekannt ist. */
      let verteilt = 0;
      seitenEinzeln(a.name).forEach(seite => {
        dazu(katVonSeite(seite.domain, seite.name), seite.name, seite.minuten);
        verteilt += seite.minuten;
      });
      const offen = Math.max(0, a.minuten - verteilt);
      if (offen) dazu("rest", a.name + " (ohne Adresse)", offen);
    });

    Object.values(teile).forEach(l => l.sort((x, y) => y.minuten - x.minuten));
    return { topf, teile };
  }

  /* Programme im Zeitraum des Rings */
  function katApps() {
    if (!pcMessung || !pcMessung.tage) return [];
    const summe = new Map();
    katTage().forEach(tag => {
      const e = pcMessung.tage[tag];
      if (!e || !e.apps) return;
      e.apps.forEach(a => summe.set(a.name, (summe.get(a.name) || 0) + a.minuten));
    });
    return [...summe.entries()]
      .map(([name, minuten]) => ({ name, minuten }))
      .sort((a, b) => b.minuten - a.minuten);
  }

  /* Wie seitenVonBrowser, aber ohne Zusammenfassen nach Website —
     für die Aufschlüsselung zählt die einzelne Seite. */
  function seitenEinzeln(browser) {
    if (!pcMessung || !pcMessung.tage) return [];
    const summe = new Map();
    katTage().forEach(tag => {
      const e = pcMessung.tage[tag];
      const liste = e && e.seiten && e.seiten[browser];
      if (!liste) return;
      liste.forEach(x => {
        const alt2 = summe.get(x.name) || { minuten: 0, domain: "" };
        summe.set(x.name, { minuten: alt2.minuten + x.minuten, domain: x.domain || alt2.domain });
      });
    });
    return [...summe.entries()]
      .map(([name, e]) => ({ name, domain: e.domain, minuten: e.minuten }))
      .sort((a, b) => b.minuten - a.minuten);
  }

  /* Zuletzt gerechnete Aufschlüsselung, für das Schwebefenster */
  let katTeile = {};

  /* Der Ring folgt dem Zeitraum der Seite — ein Schalter für alles */
  const katTage = () => stTageImZeitraum();

  function katZeichnen() {
    const svg = $("pgKatSvg");
    if (!svg) return;
    const gerechnet = katSummieren();
    const topf = gerechnet.topf;
    katTeile = gerechnet.teile;
    const gesamt = Object.values(topf).reduce((a, b) => a + b, 0);
    const teile = KATEGORIEN.map(k => ({ ...k, minuten: topf[k.id] }))
      .filter(k => k.minuten > 0)
      .sort((a, b) => b.minuten - a.minuten);

    $("pgKatGesamt").textContent = gesamt ? formatMinutes(gesamt) : "—";
    $("pgKatZahl").textContent = teile.length
      ? teile.length + (teile.length === 1 ? " Gruppe" : " Gruppen") : "—";

    if (!gesamt) {
      svg.innerHTML = '<circle cx="100" cy="100" r="78" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="26"/>';
      $("pgKatListe").innerHTML = '<li class="kat-leer">Für diesen Zeitraum wurde noch nichts gemessen.</li>';
      return;
    }

    /* Ein Ring aus Bögen: jeder Teil bekommt seinen Anteil am Umfang,
       eine kleine Lücke trennt die Abschnitte sichtbar. */
    const r = 78;
    const umfang = 2 * Math.PI * r;
    const luecke = teile.length > 1 ? 3 : 0;
    let versatz = 0;
    svg.innerHTML =
      '<circle cx="100" cy="100" r="78" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="26"/>' +
      teile.map(k => {
        const laenge = umfang * (k.minuten / gesamt);
        /* Der Bogen startet bei null und wird gleich auf seine Länge
           gesetzt — so fährt er auf, statt fertig dazustehen. */
        const sichtbar = Math.max(0, laenge - luecke).toFixed(2);
        const bogen = `<circle cx="100" cy="100" r="${r}" fill="none" stroke="${k.ton}" data-kat="${k.id}"
            stroke-width="26" stroke-linecap="butt"
            stroke-dasharray="0 ${umfang.toFixed(2)}" data-ziel="${sichtbar} ${(umfang - Number(sichtbar)).toFixed(2)}"
            stroke-dashoffset="${(-versatz).toFixed(2)}"
            transform="rotate(-90 100 100)"><title>${k.titel}: ${formatMinutes(k.minuten)}</title></circle>`;
        versatz += laenge;
        return bogen;
      }).join("");

    /* Erst kurz danach auf die Ziellänge — sonst gäbe es nichts zu
       überblenden, weil die Bögen frisch im Baum stehen. Der Timer
       ist die Absicherung: ein ruhendes Fenster ruft kein
       requestAnimationFrame auf, und dann stünde der Ring leer da. */
    const boegenSetzen = () => {
      svg.querySelectorAll("[data-ziel]").forEach((c, n) => {
        c.style.transitionDelay = Math.min(n * 90, 360) + "ms";
        c.setAttribute("stroke-dasharray", c.dataset.ziel);
      });
    };
    requestAnimationFrame(boegenSetzen);
    setTimeout(boegenSetzen, 60);

    $("pgKatListe").innerHTML = teile.map(k => `
      <li class="kat-zeile" data-kat="${k.id}" style="--ton:${k.ton}">
        <span class="kat-punkt"></span>
        <span class="kat-name">${k.titel}</span>
        <span class="kat-zeit">${formatMinutes(k.minuten)}</span>
        <span class="kat-anteil">${Math.round(k.minuten / gesamt * 100)} %</span>
      </li>`).join("");
  }

  /* ---------- Aufschlüsselung beim Überfahren ----------
     Sowohl der Bogen als auch die Zeile daneben zeigen, woraus sich
     eine Gruppe zusammensetzt. Das Fenster folgt dem Zeiger und
     bleibt dabei im Bild. */
  const katTipp = $("katTipp");

  function katTippZeigen(id, x, y) {
    const gruppe = KATEGORIEN.find(k => k.id === id);
    const liste = katTeile[id] || [];
    if (!gruppe || !liste.length) return katTippWeg();

    const summe = liste.reduce((s, e) => s + e.minuten, 0);
    const zeigen = liste.slice(0, 6);
    katTipp.style.setProperty("--ton", gruppe.ton);
    katTipp.innerHTML =
      `<div class="kt-kopf"><span class="kt-punkt"></span>${gruppe.titel}
         <span class="kt-summe">${formatMinutes(summe)}</span></div>
       <ul class="kt-liste">${zeigen.map(e => `
         <li><span class="kt-name">${escapeHTML(e.name)}</span>
             <span class="kt-zeit">${formatMinutes(e.minuten)}</span></li>`).join("")}</ul>` +
      (liste.length > zeigen.length
        ? `<div class="kt-mehr">und ${liste.length - zeigen.length} weitere</div>` : "");

    katTipp.classList.add("offen");
    const feld = katTipp.getBoundingClientRect();
    const links = Math.min(Math.max(12, x + 16), window.innerWidth - feld.width - 12);
    const oben = Math.min(Math.max(12, y + 14), window.innerHeight - feld.height - 12);
    katTipp.style.left = links + "px";
    katTipp.style.top = oben + "px";
  }

  function katTippWeg() {
    katTipp.classList.remove("offen");
    document.querySelectorAll("#pgKatSvg circle").forEach(c => c.classList.remove("hell"));
  }

  /* Ein Zuhörer für beide Seiten — Ring und Liste */
  ["pgKatSvg", "pgKatListe"].forEach(id => {
    const feld = $(id);
    if (!feld) return;
    feld.addEventListener("mousemove", e => {
      const ziel = e.target.closest("[data-kat]");
      if (!ziel) return katTippWeg();
      document.querySelectorAll("#pgKatSvg circle").forEach(c =>
        c.classList.toggle("hell", c.dataset.kat === ziel.dataset.kat));
      katTippZeigen(ziel.dataset.kat, e.clientX, e.clientY);
    });
    feld.addEventListener("mouseleave", katTippWeg);
  });

  /* ---------- Seiten eines Browsers ----------
     Sie stehen nicht mehr in einem eigenen Block, sondern klappen
     unter dem jeweiligen Browser auf. */
  /* Welche Browser aufgeklappt sind. Die Liste wird bei jedem Abruf
     neu gebaut — ohne dieses Gedaechtnis klappte alles wieder zu,
     waehrend man liest. */
  const offeneBrowser = new Set();

  /* Auf- und zuklappen mit gemessener Hoehe. Ein Raster mit "1fr"
     waere kuerzer, loest in einem Behaelter ohne feste Hoehe aber
     zu null auf — die Liste bliebe unsichtbar. */
  function unterKlappen(unter, auf, sofort) {
    const inhalt = unter.firstElementChild;
    unter.classList.toggle("offen", auf);
    if (sofort) {
      unter.classList.add("sofort");
      unter.style.height = auf ? "auto" : "0px";
      requestAnimationFrame(() => unter.classList.remove("sofort"));
      return;
    }
    if (auf) {
      unter.style.height = inhalt.getBoundingClientRect().height + "px";
      /* Danach auf auto, damit spaetere Aenderungen mitwachsen */
      const fertig = () => { unter.style.height = "auto"; unter.removeEventListener("transitionend", fertig); };
      unter.addEventListener("transitionend", fertig);
    } else {
      unter.style.height = unter.getBoundingClientRect().height + "px";
      void unter.offsetHeight;                 // Zwischenstand erzwingen
      unter.style.height = "0px";
    }
  }

  /* Aus "amazon.de" wird "Amazon", aus "de.wikipedia.org" wird
     "Wikipedia". Landeskennungen und Vorsilben fallen weg, damit
     amazon.de und amazon.com dieselbe Zeile ergeben. */
  const SEITEN_NAMEN = {
    "google": "Google", "youtube": "YouTube", "tiktok": "TikTok",
    "amazon": "Amazon", "instagram": "Instagram", "facebook": "Facebook",
    "reddit": "Reddit", "wikipedia": "Wikipedia", "github": "GitHub",
    "stackoverflow": "Stack Overflow", "twitch": "Twitch", "netflix": "Netflix",
    "spotify": "Spotify", "discord": "Discord", "whatsapp": "WhatsApp",
    "x": "X", "twitter": "X", "chatgpt": "ChatGPT", "openai": "OpenAI",
    "claude": "Claude", "anthropic": "Claude", "ebay": "eBay",
    "paypal": "PayPal", "linkedin": "LinkedIn", "pinterest": "Pinterest",
    "duckduckgo": "DuckDuckGo", "bing": "Bing", "gmail": "Gmail",
    "outlook": "Outlook", "web": "Web.de", "gmx": "GMX", "localhost": "Lokal"
  };

  /* Zusammengesetzte Endungen, bei denen der Name eine Stelle weiter
     vorn steht: co.uk, com.br, co.jp … */
  const ZWEITSTUFE = new Set(["co", "com", "net", "org", "gov", "ac", "edu"]);

  function websiteName(domain) {
    const roh = String(domain || "").trim().toLowerCase();
    if (!roh) return "";

    if (roh.startsWith("localhost")) return "Lokal";

    const teile = roh.split(".").filter(Boolean);
    if (teile.length < 2) return roh;

    /* Bei "amazon.co.uk" steht der Name an drittletzter Stelle */
    let kern = teile[teile.length - 2];
    if (ZWEITSTUFE.has(kern) && teile.length >= 3) kern = teile[teile.length - 3];

    if (SEITEN_NAMEN[kern]) return SEITEN_NAMEN[kern];
    return kern.charAt(0).toUpperCase() + kern.slice(1);
  }

  function seitenVonBrowser(name) {
    if (!pcMessung || !pcMessung.tage) return [];
    /* Nach Website zusammenfassen: drei Amazon-Produkte ergeben eine
       Zeile "Amazon", nicht drei Zeilen mit Produktnamen. Ohne
       lesbare Adresse bleibt der Seitentitel stehen. */
    const summe = new Map();
    stTageImZeitraum().forEach(tag => {
      const e = pcMessung.tage[tag];
      const liste = e && e.seiten && e.seiten[name];
      if (!liste) return;
      liste.forEach(x => {
        const schluessel = x.domain || ("titel:" + x.name);
        const alt = summe.get(schluessel)
          || { minuten: 0, domain: x.domain || "", seiten: new Set() };
        alt.minuten += x.minuten;
        alt.seiten.add(x.name);
        summe.set(schluessel, alt);
      });
    });

    return [...summe.entries()]
      .map(([schluessel, e]) => ({
        name: e.domain ? websiteName(e.domain) : schluessel.slice(6),
        domain: e.domain,
        anzahl: e.seiten.size,
        minuten: e.minuten
      }))
      .sort((a, b) => b.minuten - a.minuten);
  }

  function inaktivZeichnen() {
    const liste = $("pgInaktivListe");
    const balken = $("pgInaktivBalken");
    const zahl = $("pgInaktivZahl");
    if (!liste) return;

    const aktivApps = appsSummieren("apps");
    const stilleApps = appsSummieren("inaktivApps");
    const aktiv = aktivApps.reduce((s, a) => s + a.minuten, 0);
    const still = stilleApps.reduce((s, a) => s + a.minuten, 0);
    const zusammen = aktiv + still;

    zahl.textContent = still ? formatMinutes(still) : "\u2014";

    if (!zusammen) {
      balken.innerHTML = "";
      liste.innerHTML = '<li class="app-leer">F\u00fcr diesen Zeitraum wurde noch nichts gemessen.</li>';
      return;
    }

    const anteilStill = Math.round(still / zusammen * 100);
    balken.innerHTML = `
      <div class="iv-spur">
        <i class="iv-teil aktiv" style="width:${100 - anteilStill}%"></i>
        <i class="iv-teil still" style="width:${anteilStill}%"></i>
      </div>
      <div class="iv-legende">
        <span><i class="iv-punkt aktiv"></i>Aktiv ${formatMinutes(aktiv)} \u00b7 ${100 - anteilStill} %</span>
        <span><i class="iv-punkt still"></i>Inaktiv ${formatMinutes(still)} \u00b7 ${anteilStill} %</span>
      </div>`;

    rangListe(liste, stilleApps, "Keine inaktive Zeit erfasst.");
  }

  function appListeZeichnen() {
    const liste = $("pgAppListe");
    const status = $("pgAppStatus");
    const zahl = $("pgAppZahl");
    if (!liste) return;

    /* Zustand der Messung ehrlich benennen */
    if (!pcMessung) {
      status.textContent = "Messung wird abgefragt \u2026";
      status.className = "block-unter";
      liste.innerHTML = "";
      zahl.textContent = "\u2014";
      return;
    }
    if (!pcMessung.aktiv) {
      status.textContent = pcMessung.fehler
        || "Messung l\u00e4uft nicht \u2014 sie braucht den laufenden Dev-Server unter Windows.";
      status.className = "block-unter warnung";
    } else {
      const z = pcMessung.zuletzt;
      status.textContent = "Wird gemessen, solange der Server l\u00e4uft \u00b7 Takt "
        + pcMessung.takt + " s"
        + (z ? " \u00b7 zuletzt " + (z.prozess || "kein Fenster")
               + " vor " + z.vorSekunden + " s" : "");
      status.className = "block-unter";
    }

    const apps = appsSummieren("apps");
    const gesamt = apps.reduce((s, a) => s + a.minuten, 0);

    zahl.textContent = apps.length ? apps.length + (apps.length === 1 ? " Programm" : " Programme") : "\u2014";

    rangListe(liste, apps, "F\u00fcr diesen Zeitraum wurde noch nichts gemessen.");

    /* Browser bekommen einen Pfeil: ein Klick klappt die Seiten
       darunter auf, eingerueckt und weicher als die Zeile selbst. */
    liste.querySelectorAll(".app-zeile").forEach(zeile => {
      const name = zeile.querySelector(".app-name").textContent;
      const seiten = seitenVonBrowser(name);
      if (!seiten.length) return;

      zeile.classList.add("aufklappbar");
      zeile.insertAdjacentHTML("beforeend",
        `<span class="app-pfeil" aria-hidden="true">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
             stroke-linecap="round" stroke-linejoin="round"><path d="M6 9.5 12 15.5 18 9.5"/></svg>
         </span>`);

      const max = seiten[0].minuten;
      const unter = document.createElement("li");
      unter.className = "app-unter";
      unter.innerHTML = `<div><ul>${seiten.map(x => `
        <li>
          <span class="au-name">${escapeHTML(x.name)}</span>
          <span class="au-domain">${x.anzahl > 1
            ? x.anzahl + " Seiten" : escapeHTML(x.domain || "")}</span>
          <span class="au-spur"><i style="width:${Math.round(x.minuten / max * 100)}%"></i></span>
          <span class="au-zeit">${formatMinutes(x.minuten)}</span>
        </li>`).join("")}</ul></div>`;
      zeile.after(unter);

      /* Zustand von vorhin wiederherstellen, aber ohne Ueberblendung —
         sonst klappt es bei jedem Abruf sichtbar neu auf. */
      if (offeneBrowser.has(name)) {
        zeile.classList.add("offen");
        unterKlappen(unter, true, true);
      }

      zeile.addEventListener("click", () => {
        const offen = zeile.classList.toggle("offen");
        unterKlappen(unter, offen, false);
        if (offen) offeneBrowser.add(name); else offeneBrowser.delete(name);
      });
    });
  }

  function stZeitraum() {
    const heute = todayStr();
    const jetzt = new Date();

    if (stAnsicht === "tag") {
      /* Wichtig: die Kennzahlen kommen aus dem gespeicherten Tageswert.
         hourlyFor() verteilt diesen Wert nur auf 24 Stunden und rundet
         dabei — die Summe der Balken laege sonst ein paar Minuten
         daneben. Die Stunden liefern hier nur die Form der Kurve. */
      const tag = getDayEntry(heute);
      const stunden = hourlyFor(heute);

      let spitzeStunde = 0, spitzeWert = 0;
      stunden.forEach((e, i) => {
        const ges = e.phone + e.pc;
        if (ges > spitzeWert) { spitzeWert = ges; spitzeStunde = i; }
      });
      const bis = String((spitzeStunde + 1) % 24).padStart(2, "0");

      return {
        titel: "Heute",
        summe: { phone: tag.phone, pc: tag.pc },
        zusatz: {
          label: "St\u00e4rkste Stunde",
          wert: spitzeWert ? formatMinutes(spitzeWert) : "\u2014",
          text: spitzeWert ? String(spitzeStunde).padStart(2, "0") + "\u2013" + bis + " Uhr"
                           : "nichts erfasst"
        },
        punkte: stunden.map((e, i) => ({
          phone: e.phone, pc: e.pc,
          label: i % 3 === 0 ? String(i).padStart(2, "0") : "",
          tip: String(i).padStart(2, "0") + "\u2013"
               + String((i + 1) % 24).padStart(2, "0") + " Uhr"
        }))
      };
    }

    const punkte = [];
    let titel;

    if (stAnsicht === "woche") {
      /* Woche beginnt am Montag */
      const versatz = (jetzt.getDay() + 6) % 7;
      for (let i = versatz; i >= 0; i--) {
        const d = new Date(); d.setDate(jetzt.getDate() - i);
        const e = getDayEntry(dateKey(d));
        punkte.push({ phone: e.phone, pc: e.pc,
                      label: WEEKDAYS[d.getDay()].slice(0, 2),
                      tip: WEEKDAYS[d.getDay()] + ", " + fmtDate(dateKey(d)) });
      }
      titel = "Diese Woche";
    } else {
      for (let t = 1; t <= jetzt.getDate(); t++) {
        const d = new Date(jetzt.getFullYear(), jetzt.getMonth(), t);
        const e = getDayEntry(dateKey(d));
        punkte.push({ phone: e.phone, pc: e.pc,
                      label: (t === 1 || t % 5 === 0) ? String(t) : "",
                      tip: fmtDate(dateKey(d)) });
      }
      titel = MONTHS[jetzt.getMonth()];
    }

    if (stAnsicht === "jahr") {
      punkte.length = 0;
      for (let m = 0; m <= jetzt.getMonth(); m++) {
        const letzter = new Date(jetzt.getFullYear(), m + 1, 0).getDate();
        let phone = 0, pc = 0;
        for (let d = 1; d <= letzter; d++) {
          const e = getDayEntry(dateKey(new Date(jetzt.getFullYear(), m, d)));
          phone += e.phone; pc += e.pc;
        }
        punkte.push({ phone, pc, label: MONTHS[m].slice(0, 3), tip: MONTHS[m] });
      }
      titel = String(jetzt.getFullYear());
    }

    /* Hier ist ein Punkt genau ein Tag, die Summe stimmt also exakt */
    let phone = 0, pc = 0, mitNutzung = 0;
    punkte.forEach(p => {
      phone += p.phone; pc += p.pc;
      if (p.phone + p.pc) mitNutzung++;
    });
    const gesamt = phone + pc;

    return {
      titel,
      summe: { phone, pc },
      zusatz: {
        label: stAnsicht === "jahr" ? "Schnitt pro Monat" : "Schnitt pro Tag",
        wert: formatMinutes(mitNutzung ? Math.round(gesamt / mitNutzung) : 0),
        text: mitNutzung + " " + (stAnsicht === "jahr"
          ? (mitNutzung === 1 ? "Monat" : "Monate")
          : (mitNutzung === 1 ? "Tag" : "Tage")) + " mit Nutzung"
      },
      punkte
    };
  }

  function baueBildschirmzeit() {
    document.querySelectorAll("#stAnsicht button").forEach(b =>
      b.classList.toggle("an", b.dataset.ansicht === stAnsicht));

    const { titel, summe, zusatz, punkte } = stZeitraum();
    const gesamt = summe.phone + summe.pc;
    const anteil = teil => gesamt ? Math.round(teil / gesamt * 100) : 0;

    $("stSub").textContent = gesamt
      ? `${titel} \u00b7 ${formatMinutes(gesamt)} insgesamt`
      : `${titel} \u00b7 nichts erfasst`;

    $("pgStKennzahlen").innerHTML = `
      <div class="kennzahl"><div class="kz-label">Gesamt</div>
        <div class="kz-wert">${formatMinutes(gesamt)}</div>
        <div class="kz-zusatz">${escapeHTML(titel)}</div></div>
      <div class="kennzahl"><div class="kz-label">${escapeHTML(zusatz.label)}</div>
        <div class="kz-wert">${escapeHTML(zusatz.wert)}</div>
        <div class="kz-zusatz">${escapeHTML(zusatz.text)}</div></div>
      <div class="kennzahl"><div class="kz-label">Handy</div>
        <div class="kz-wert">${formatMinutes(summe.phone)}</div>
        <div class="kz-zusatz">${anteil(summe.phone)} % der Zeit</div></div>
      <div class="kennzahl"><div class="kz-label">PC</div>
        <div class="kz-wert">${formatMinutes(summe.pc)}</div>
        <div class="kz-zusatz">${anteil(summe.pc)} % der Zeit</div></div>`;

    grossesDiagramm(punkte);

    /* Legende: nur was im Diagramm auch zu sehen ist */
    $("pgStLegende").innerHTML =
      (ST_HANDY
        ? `<span class="legend-item"><span class="legend-dot phone"></span>
             <span class="legend-text">Handy</span><b>${formatMinutes(summe.phone)}</b></span>`
        : "")
      + `<span class="legend-item"><span class="legend-dot pc"></span>
           <span class="legend-text">PC</span><b>${formatMinutes(summe.pc)}</b></span>`;

    appListeZeichnen();
    inaktivZeichnen();
    katZeichnen();
  }

  document.querySelectorAll("#stAnsicht button").forEach(b => b.addEventListener("click", () => {
    if (stAnsicht === b.dataset.ansicht) return;
    stAnsicht = b.dataset.ansicht;
    store.set("lifeos_st_seite", stAnsicht);
    /* Die Kurve wandert auf die neuen Werte, statt zu springen; die
       Balken laufen dazu einmal auf. */
    animierenNext = true;
    grossMorph = true;
    baueBildschirmzeit();
  }));

  /* Die Kurve läuft von links nach rechts ein. Dafür braucht jede
     Linie ihre eigene Länge — sonst passt das Strichmuster nicht. */
  function grossZeichnenLassen(chart, svg) {
    chart.classList.remove("zeichnet");
    svg.querySelectorAll(".st-line").forEach(p => {
      try { p.style.setProperty("--laenge", Math.ceil(p.getTotalLength())); } catch (e) { /* egal */ }
    });
    void chart.offsetWidth;              // Lauf sicher neu starten
    chart.classList.add("zeichnet");
  }

  /* Ein größeres Abbild derselben Kurve wie im Widget */
  /* Kleiner Helfer fuer SVG-Elemente — die Widget-Fassung liegt lokal
     in zeichneDiagramm und ist hier nicht erreichbar. */
  const svgEl = (tag, attrs) => {
    const k = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attrs).forEach(([name, wert]) => k.setAttribute(name, wert));
    return k;
  };

  /* ---------- Y-Achse ----------
     Runde Schritte statt gleichmaessig geteilter Hoechstwerte: eine
     Linie bei "2h" liest sich besser als eine bei "1h 47". */
  const ACHSEN_SCHRITTE = [5, 10, 15, 30, 60, 120, 180, 240, 360, 480, 600,
                           720, 1440, 2880, 4320, 6000, 9000, 14400, 28800];

  function achsenSchritt(max, ziel) {
    const roh = max / (ziel || 4);
    return ACHSEN_SCHRITTE.find(sch => sch >= roh) || ACHSEN_SCHRITTE[ACHSEN_SCHRITTE.length - 1];
  }

  /* Kurz genug fuer eine Achsenbeschriftung: "3h" statt "3h 00" */
  function achsenText(min) {
    if (min === 0) return "0";
    if (min < 60) return min + "m";
    const std = Math.floor(min / 60), rest = min % 60;
    return rest ? std + "h" + String(rest).padStart(2, "0") : std + "h";
  }

  /* Steht hier true, zeichnet sich die große Kurve beim nächsten Mal
     wieder von links nach rechts auf — das gilt nur für den ersten
     Aufbau der Seite. */
  let grossNeuZeichnen = true;

  /* ==========================================================
     ÜBERBLENDUNG DER KURVE
     Beim Wechsel des Zeitraums springt die Kurve nicht auf die neuen
     Werte, sondern wandert dorthin. Weil die Zeiträume verschieden
     viele Punkte haben (24 Stunden, 7 Tage, 30 Tage), wird der alte
     Verlauf erst auf die neue Anzahl umgerechnet — sonst ließe sich
     nichts Punkt für Punkt vergleichen.
     ========================================================== */
  let grossMorph = false;       // soll die Kurve wandern?
  let grossVorher = null;       // zuletzt gezeichnete Werte
  let grossLauf = null;         // laufende Überblendung
  const GROSS_DAUER = 950;
  /* Die Punkte starten nicht alle gleichzeitig: links geht es los,
     rechts folgt kurz darauf. Das macht aus dem Umklappen ein
     Fließen. Der Wert ist der Anteil der Dauer, über den sich der
     Start verteilt. */
  const GROSS_WELLE = 0.4;

  /* Einen Verlauf auf eine andere Punktzahl bringen */
  function grossAbtasten(alt, anzahl) {
    if (!alt.length) return Array.from({ length: anzahl }, () => ({ phone: 0, pc: 0 }));
    if (alt.length === 1) return Array.from({ length: anzahl }, () => ({ ...alt[0] }));
    const raus = [];
    for (let i = 0; i < anzahl; i++) {
      const stelle = anzahl === 1 ? 0 : (i / (anzahl - 1)) * (alt.length - 1);
      const links = Math.floor(stelle);
      const rechts = Math.min(alt.length - 1, links + 1);
      const rest = stelle - links;
      raus.push({
        phone: alt[links].phone + (alt[rechts].phone - alt[links].phone) * rest,
        pc:    alt[links].pc    + (alt[rechts].pc    - alt[links].pc)    * rest
      });
    }
    return raus;
  }

  /* Sinusförmig statt kubisch: kein harter Antritt, keine scharfe
     Bremsung — die Bewegung setzt weich ein und läuft weich aus. */
  const grossWeich = p => 0.5 - Math.cos(Math.PI * Math.min(1, Math.max(0, p))) / 2;

  function grossesDiagramm(tage) {
    const werte = tage.map(p => ({ phone: p.phone, pc: p.pc }));

    /* Läuft schon eine Überblendung, darf ein zwischendurch
       eintreffendes Neuzeichnen sie nicht abwürgen — es kommt etwa
       vom Nachladen der Messwerte. Nur wenn sich das Ziel wirklich
       geändert hat, wird neu angesetzt. */
    if (grossLauf && !grossMorph) {
      const gleich = grossLauf.ziel.length === werte.length
        && grossLauf.ziel.every((z, i) => z.pc === werte[i].pc && z.phone === werte[i].phone);
      if (gleich) return;
    }

    /* Beim ersten Mal gibt es nichts zu überblenden */
    if (!grossVorher || !grossVorher.length || (!grossMorph && !grossLauf)) {
      grossMorph = false;
      grossVorher = werte;
      return grossZeichnen(tage);
    }

    if (grossLauf) cancelAnimationFrame(grossLauf.bild), clearInterval(grossLauf.takt);
    const von = grossAbtasten(grossVorher, tage.length);
    const start = performance.now();

    const schritt = () => {
      const p = Math.min(1, (performance.now() - start) / GROSS_DAUER);
      const letzte = Math.max(1, tage.length - 1);
      grossZeichnen(tage.map((punkt, i) => {
        /* Jeder Punkt hat seinen eigenen Fortschritt: der Beginn
           wandert von links nach rechts durch das Bild. */
        const stelle = i / letzte;
        const w = grossWeich((p * (1 + GROSS_WELLE) - stelle * GROSS_WELLE) / 1);
        return {
          ...punkt,
          phone: von[i].phone + (werte[i].phone - von[i].phone) * w,
          pc:    von[i].pc    + (werte[i].pc    - von[i].pc)    * w
        };
      }));
      if (p >= 1) {
        cancelAnimationFrame(grossLauf.bild);
        clearInterval(grossLauf.takt);
        grossLauf = null;
        grossVorher = werte;
        grossZeichnen(tage);
        return;
      }
      grossLauf.bild = requestAnimationFrame(schritt);
    };

    /* Der Takt ist die Absicherung: ein ruhendes Fenster ruft kein
       requestAnimationFrame auf, dann bliebe die Kurve auf halbem
       Weg stehen. */
    grossLauf = { ziel: werte, bild: requestAnimationFrame(schritt), takt: setInterval(schritt, 40) };
    grossMorph = false;
  }

  function grossZeichnen(tage) {
    const chart = $("pgStChart");
    const svg = $("pgStSvg");
    const box = svg.getBoundingClientRect();
    if (box.width < 40 || box.height < 40) { setTimeout(() => grossZeichnen(tage), 120); return; }
    const W = Math.round(box.width), H = Math.round(box.height), padY = 10;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = "";

    const werte = tage.map(t => ST_HANDY ? t.phone + t.pc : t.pc);
    const maxWert = Math.max(60, ...werte) * 1.15;

    /* Die Beschriftung links waechst mit den Zahlen: "45m" braucht
       weniger Platz als "450h". Ein fester Rand wuerde bei grossen
       Werten abschneiden und bei kleinen Platz verschenken. */
    const schritt = achsenSchritt(maxWert, 4);
    const marken = [];
    for (let wert = 0; wert <= maxWert; wert += schritt) marken.push(wert);
    const laengste = Math.max(...marken.map(m => achsenText(m).length));
    const padL = Math.round(Math.min(96, Math.max(30, laengste * 6.4 + 14)));
    const x = i => padL + (i / Math.max(1, tage.length - 1)) * (W - padL);
    const y = v => H - padY - (v / maxWert) * (H - padY * 2);

    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    defs.innerHTML =
      `<linearGradient id="pgGradPc" x1="0" y1="0" x2="0" y2="1">
         <stop offset="0%" stop-color="rgba(167,139,250,0.42)"/><stop offset="100%" stop-color="rgba(167,139,250,0)"/>
       </linearGradient>
       <linearGradient id="pgGradPhone" x1="0" y1="0" x2="0" y2="1">
         <stop offset="0%" stop-color="rgba(91,140,255,0.42)"/><stop offset="100%" stop-color="rgba(91,140,255,0)"/>
       </linearGradient>`;
    svg.appendChild(defs);

    /* Y-Achse: waagerechte Linien mit Beschriftung, vor den Kurven
       gezeichnet, damit die Flaechen darueber liegen. */
    marken.forEach(wert => {
      const yy = y(wert);
      svg.appendChild(svgEl("line", { class: "st-raster",
        x1: padL, y1: yy, x2: W, y2: yy }));
      const beschriftung = svgEl("text", { class: "st-achse-y",
        x: padL - 8, y: yy + 3.5, "text-anchor": "end" });
      beschriftung.textContent = achsenText(wert);
      svg.appendChild(beschriftung);
    });

    /* Ohne Handy-Kurve waere eine gestapelte Gesamtlinie irrefuehrend:
       sie enthielte die Telefonzeit, ohne sie zu zeigen. Dann wird
       schlicht die PC-Zeit fuer sich gezeichnet. */
    const oben = tage.map((t, i) => ({ x: x(i), y: y(ST_HANDY ? t.phone + t.pc : t.pc) }));

    svg.appendChild(svgEl("path", { class: "st-area pc",
      d: glatterPfad(oben, y(0)) + ` L ${W} ${y(0)} L ${padL} ${y(0)} Z`, fill: "url(#pgGradPc)" }));

    if (ST_HANDY) {
      const pPhone = tage.map((t, i) => ({ x: x(i), y: y(t.phone) }));
      svg.appendChild(svgEl("path", { class: "st-area phone",
        d: glatterPfad(pPhone, y(0)) + ` L ${W} ${y(0)} L ${padL} ${y(0)} Z`, fill: "url(#pgGradPhone)" }));
      svg.appendChild(svgEl("path", { class: "st-line phone", d: glatterPfad(pPhone, y(0)) }));
    }

    svg.appendChild(svgEl("path", { class: "st-line pc", d: glatterPfad(oben, y(0)) }));

    /* Welche Punkte beschriftet werden, entscheidet der Aufrufer */
    /* Fuehrungslinie und Punkte fuer das Ueberfahren — unsichtbar,
       bis der Zeiger ueber dem Diagramm ist. */
    svg.appendChild(svgEl("line", { class: "st-guide", id: "pgGuide",
      x1: padL, y1: padY, x2: padL, y2: H - padY }));
    if (ST_HANDY) svg.appendChild(svgEl("circle", { class: "st-dot phone", id: "pgDotPhone", r: 3.5 }));
    svg.appendChild(svgEl("circle", { class: "st-dot pc", id: "pgDotPc", r: 3.5 }));

    pgGeometrie = { x, y, padL, punkte: tage };

    /* Gleicher Einzug wie das Feld, sonst stehen die Tage versetzt */
    $("pgStAxis").style.paddingLeft = padL + "px";

    /* So viele Beschriftungen, wie nebeneinander lesbar sind. Wird das
       Fenster schmaler, faellt jede zweite weg statt zu ueberlappen.
       Die leeren Felder bleiben stehen, sonst verrutscht der Rest. */
    const beschriftet = tage.map((t, i) => t.label ? i : -1).filter(i => i >= 0);
    const passen = Math.max(2, Math.floor((W - padL) / 46));
    const jede = Math.ceil(beschriftet.length / passen);
    const behalten = new Set(beschriftet.filter((_, k) => k % jede === 0));

    $("pgStAxis").innerHTML = tage
      .map((t, i) => `<span>${behalten.has(i) ? escapeHTML(t.label) : ""}</span>`).join("");
    /* Nur beim allerersten Aufbau zeichnet sich die Linie ein.
       Danach wandert sie, statt neu zu entstehen. */
    if (grossNeuZeichnen) {
      grossNeuZeichnen = false;
      grossZeichnenLassen(chart, svg);
    } else if (!grossLauf) {
      chart.classList.remove("zeichnet");
    }
  }

  /* Naechstgelegener Punkt zur Zeigerposition */
  let pgGeometrie = null;

  function pgHover(ev) {
    if (!pgGeometrie || !pgGeometrie.punkte.length) return;
    const svg = $("pgStSvg");
    const box = svg.getBoundingClientRect();
    const anzahl = pgGeometrie.punkte.length;
    /* Der Einzug links gehoert nicht zum Feld — sonst laege der
       getroffene Punkt um ein paar Tage daneben. */
    const feldBreite = Math.max(1, box.width - pgGeometrie.padL);
    const anteil = (ev.clientX - box.left - pgGeometrie.padL) / feldBreite;
    const idx = Math.max(0, Math.min(anzahl - 1, Math.round(anteil * (anzahl - 1))));
    const p = pgGeometrie.punkte[idx];
    const px = pgGeometrie.x(idx);

    const guide = $("pgGuide");
    if (!guide) return;
    guide.setAttribute("x1", px); guide.setAttribute("x2", px);
    const dotPhone = $("pgDotPhone");
    if (dotPhone) {
      dotPhone.setAttribute("cx", px);
      dotPhone.setAttribute("cy", pgGeometrie.y(p.phone));
    }
    $("pgDotPc").setAttribute("cx", px);
    $("pgDotPc").setAttribute("cy", pgGeometrie.y(ST_HANDY ? p.phone + p.pc : p.pc));
    $("pgStChart").classList.add("aktiv");

    chartTooltip.innerHTML = `${escapeHTML(p.tip || p.label || "")}<br>`
      + (ST_HANDY
          ? `Handy ${formatMinutes(p.phone)} \u00b7 PC ${formatMinutes(p.pc)}`
            + `<br>Gesamt ${formatMinutes(p.phone + p.pc)}`
          : `PC ${formatMinutes(p.pc)}`);
    chartTooltip.style.left = (box.left + px) + "px";
    chartTooltip.style.top = (box.top - 10) + "px";
    chartTooltip.classList.add("visible");
  }

  function pgHoverEnde() {
    const chart = $("pgStChart");
    if (chart) chart.classList.remove("aktiv");
    chartTooltip.classList.remove("visible");
  }

  (() => {
    const chart = $("pgStChart");
    if (!chart) return;
    chart.addEventListener("pointermove", pgHover);
    chart.addEventListener("pointerleave", pgHoverEnde);
  })();

  /* ---------- Lernen ----------
     Zeigt jeden Kurs mit seinem Umfang im Stundenplan und der
     naechsten eingetragenen Klausur. Was am dringendsten ist,
     steht oben. */
  let lernKlausur = null;   // id der im Unterfenster geoeffneten Klausur

  function lernenZeigen(id) {
    lernKlausur = id || null;
    /* Auf den richtigen Reiter schalten — sonst landet man auf der
       Lernseite, während oben noch die Hausaufgaben offen sind und
       von der Klausur nichts zu sehen ist. */
    lernReiter = "klausuren";
    store.set("lifeos_lern_reiter", lernReiter);
    seiteZeigen("lernen");
  }

  /* Wie viele Stunden dieses Kurses liegen noch vor der Klausur?
     Das ist die eigentliche Lernzeit, die noch bleibt. */
  function stundenBisKlausur(fach, iso) {
    const ziel = new Date(iso + "T00:00:00");
    const d = new Date(); d.setHours(0, 0, 0, 0);
    let zahl = 0, schutz = 0;
    while (d <= ziel && schutz++ < 400) {
      zahl += stundenFuerFach(fach, dateKey(d)).reduce((s, l) => s + (l.bis - l.von + 1), 0);
      d.setDate(d.getDate() + 1);
    }
    return zahl;
  }

  /* ==========================================================
     FACH-UEBERSICHT
     Ein Klick im Stundenplan zeigt erst alles zum Kurs — Stunden,
     Lehrer, Raeume, anstehende Klausuren. Der Knopf oben rechts
     legt von dort aus einen Klausurtermin an.
     ========================================================== */
  const fachSchicht = $("fachSchicht");
  const fachFenster = $("fachFenster");
  let fachOffen = null;

  /* Wann findet der Kurs das naechste Mal statt? Heute zaehlen nur
     Stunden, die noch nicht angefangen haben. */
  function naechsteStundeVon(fach) {
    const d = new Date();
    const jetzt = d.getHours() * 60 + d.getMinutes();
    for (let i = 0; i < 14; i++) {
      const iso = dateKey(d);
      const treffer = stundenFuerFach(fach, iso);
      if (treffer.length) {
        if (i > 0) return { iso, stunde: treffer[0] };
        const spaeter = treffer.find(l => {
          const t = stundeInfo(l.von).von;
          return Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) > jetzt;
        });
        if (spaeter) return { iso, stunde: spaeter };
      }
      d.setDate(d.getDate() + 1);
    }
    return null;
  }

  function fachUebersicht(id) {
    fachOffen = id;
    fachFensterZeichnen();
  }

  function fachSchliessen() {
    fachOffen = null;
    fachSchicht.classList.remove("open");
  }

  function fachFensterZeichnen() {
    if (!fachOffen) return fachSchliessen();
    const id = fachOffen;
    const f = fachInfo(id);

    const stunden = STUNDENPLAN.filter(l => l.fach === id)
      .sort((a, b) => a.tag - b.tag || a.von - b.von);
    const proWoche = stunden.reduce((summe, l) => summe + (l.bis - l.von + 1), 0);
    const lehrer = [...new Set(stunden.flatMap(l => l.lehrer))]
      .map(x => LEHRER[x] || x).join(", ");
    const raeume = [...new Set(stunden.map(l => l.raum).filter(Boolean))].join(", ");
    const naechste = naechsteStundeVon(id);
    const klaus = klausuren.filter(k => k.fach === id && daysUntil(k.date) >= 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    const haus = offeneHausaufgaben().filter(h => h.fach === id)
      .sort((a, b) => hausPunkte(b) - hausPunkte(a));

    const feld = (name, wert) => wert
      ? `<div class="ff-feld"><span>${name}</span><b>${escapeHTML(String(wert))}</b></div>` : "";

    fachFenster.className = "modal fach-fenster ton-" + f.ton;
    fachFenster.innerHTML = `
      <div class="ff-kopf">
        <div class="ff-name">
          <span class="ff-punkt"></span>
          <div>
            <h3 id="ffTitel">${escapeHTML(f.lang)}</h3>
            <span class="ff-kuerzel">${escapeHTML(id)}</span>
          </div>
        </div>
        <button type="button" class="ff-neu" data-ff="haus">Hausaufgabe</button>
        <button type="button" class="ff-neu" data-ff="klausur">Klausurtermin festlegen</button>
        <button type="button" class="ff-zu" data-ff="zu" aria-label="Schlie\u00dfen">\u2715</button>
      </div>

      <div class="ff-gitter">
        ${feld("Pro Woche", proWoche + (proWoche === 1 ? " Stunde" : " Stunden"))}
        ${feld("Lehrer", lehrer)}
        ${feld("Raum", raeume || "wechselnd")}
        ${feld("N\u00e4chste Stunde", naechste
          ? TAGE_LANG[schultag(naechste.iso)].slice(0, 2) + ", " + stundeInfo(naechste.stunde.von).von
          : "diese Woche nicht")}
      </div>

      <div class="ff-abschnitt">
        <div class="ff-ueber">Stunden in der Woche</div>
        <ul class="ff-liste">${stunden.map(l => `
          <li>
            <span class="ff-tag">${TAGE_LANG[l.tag]}</span>
            <span class="ff-block">${blockName(l.von, l.bis)}</span>
            <span class="ff-zeit">${blockZeit(l.von, l.bis)}</span>
            <span class="ff-raum">${escapeHTML(l.raum || "\u2014")}</span>
          </li>`).join("")}</ul>
      </div>

      <div class="ff-abschnitt">
        <div class="ff-ueber">Anstehende Klausuren<span>${klaus.length}</span></div>
        ${klaus.length ? `<ul class="ff-klausuren">${klaus.map(k => `
          <li class="${fristKlasse(daysUntil(k.date))}" data-klausur="${k.id}">
            <span class="ffk-titel">${escapeHTML(k.title)}</span>
            <span class="ffk-wann">${fmtDate(k.date)}${
              k.von ? " \u00b7 " + blockName(k.von, k.bis || k.von) : ""}</span>
            <span class="ffk-badge">${badgeFor(daysUntil(k.date), k.date)}</span>
          </li>`).join("")}</ul>`
          : '<div class="ff-leer">Noch keine Klausur eingetragen</div>'}
      </div>

      <div class="ff-abschnitt">
        <div class="ff-ueber">Offene Hausaufgaben<span>${haus.length}</span></div>
        ${haus.length ? `<ul class="ff-klausuren">${haus.map(h => `
          <li class="${fristKlasse(daysUntil(h.date))}" data-haus="${h.id}">
            <span class="ffk-titel">${escapeHTML(h.title)}</span>
            <span class="ffk-wann">${hausGrund(h)}</span>
            <span class="ffk-badge">${HA_STUFEN[h.wichtig || 1]}</span>
          </li>`).join("")}</ul>`
          : '<div class="ff-leer">Nichts offen</div>'}
      </div>`;

    fachFenster.querySelector('[data-ff="zu"]').addEventListener("click", fachSchliessen);
    fachFenster.querySelector('[data-ff="klausur"]').addEventListener("click", () => {
      fachSchliessen();
      entwurfStarten("klausur", "Klausur " + f.kurz, id);
    });
    /* Hausaufgabe fuer genau dieses Fach — Titel und Faelligkeit
       kommen aus dem Stundenplan, faellig ist die naechste Stunde. */
    fachFenster.querySelector('[data-ff="haus"]').addEventListener("click", () => {
      fachSchliessen();
      entwurfStarten("hausaufgabe", "Hausaufgabe " + f.kurz, id);
    });
    /* Eine offene Hausaufgabe fuehrt auf die Lernseite */
    fachFenster.querySelectorAll("[data-haus]").forEach(li =>
      li.addEventListener("click", () => {
        fachSchliessen();
        lernReiter = "hausaufgaben";
        store.set("lifeos_lern_reiter", lernReiter);
        seiteZeigen("lernen");
      }));
    /* Eine anstehende Klausur fuehrt in ihr Unterfenster auf der Lernseite */
    fachFenster.querySelectorAll("[data-klausur]").forEach(li =>
      li.addEventListener("click", () => {
        fachSchliessen();
        lernenZeigen(li.dataset.klausur);
      }));

    fachSchicht.classList.add("open");
  }

  fachSchicht.addEventListener("mousedown", e => {
    if (e.target === fachSchicht) fachSchliessen();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && fachOffen) fachSchliessen();
  });

  /* ==========================================================
     LERNKARTEN
     Ein Stapel je Klausur. Das Fenster hat zwei Seiten: eine Liste
     zum Bearbeiten und eine Abfrage, bei der die Karte umschlaegt.
     ========================================================== */
  const kartenSchicht = $("kartenSchicht");
  const kartenFenster = $("kartenFenster");
  let kartenKlausur = null;      // welche Klausur ist offen
  let kartenSeite = "liste";     // "liste" | "abfrage" | "kasten"
  let abfrageIndex = 0;
  /* Aus welchem Fach die laufende Abfrage kommt (null = ganzer
     Stapel) und wohin die letzte Karte gewandert ist. */
  let abfrageFach = null;
  let abfrageWanderung = "";
  let abfrageOffen = false;      // Rueckseite sichtbar?
  let abfrageStapel = [];
  let abfrageGewusst = 0;
  let abfrageErstLaenge = 0;
  /* Für Auswahl, Lücke und Wahr/Falsch: was angetippt bzw. getippt
     wurde, und ob schon geprüft ist. */
  let abfrageWahl = new Set();
  let abfrageText = [];
  let abfrageErgebnis = null;      // null = noch nicht geprüft

  function abfrageZuruecksetzen() {
    abfrageOffen = false;
    abfrageWahl = new Set();
    abfrageText = [];
    abfrageErgebnis = null;
  }

  /* ==========================================================
     LERNPLAN — WANN IST EINE KARTE WIEDER DRAN
     Eine Karte, die man kann, muss man morgen nicht nochmal sehen;
     eine, die man nicht kann, schon. Deshalb hat jede Karte eine
     Stufe: gewusst rückt eine hoch, nicht gewusst fällt auf null
     zurück. Die Stufe bestimmt, wie viele Tage bis zum Wiedersehen
     vergehen.

     Neue Karten haben noch keine Stufe — die sind sofort fällig.
     ========================================================== */
  /* Alle fälligen Karten quer über Klausuren und eigene Themen.
     Ein Stapel, dessen Besitzer gelöscht wurde, zählt nicht mit. */
  function faelligeKarten() {
    const raus = [];
    Object.entries(lernkarten).forEach(([besitzer, karten]) => {
      if (!Array.isArray(karten)) return;
      const wo = klausuren.find(k => k.id === besitzer) || themen.find(t => t.id === besitzer);
      /* Ein Stapel ohne Besitzer wird nicht abgefragt: man wüsste
         beim Antworten nicht, wozu die Karte gehört. Verloren ist er
         trotzdem nicht — er steht unter „Sonstiges" und lässt sich
         von dort als eigenes Thema übernehmen. */
      if (!wo) return;
      karten.forEach(c => { if (karteFaellig(c)) raus.push({ ...c, ausStapel: wo.title }); });
    });
    return raus;
  }

  /* Bewusst eine Funktionsdeklaration: die Zahl wird schon beim
     ersten Zeichnen der Dashboard-Reiter gebraucht. */
  function faelligZahl() { return faelligeKarten().length; }

  /* Nach jeder Antwort: Stufe setzen und den nächsten Termin
     ausrechnen. Das passiert auch beim normalen Abfragen eines
     Stapels — sonst hätte man zwei Wahrheiten. */
  /* Gibt zurück, wohin die Karte gewandert ist — die Abfrage zeigt
     das an, sonst bleibt der Kasten eine Behauptung. */
  function karteBewerten(c, gewusst) {
    if (!c || !c.id) return null;
    const vorher = karteStufe(c);
    /* Ein Fach vor oder ein Fach zurück. Nicht bis auf null: wer
       eine Vokabel fünfmal konnte und einmal nicht, hat sie nicht
       vergessen — sie wackelt. */
    const stufe = gewusst ? Math.min(vorher + 1, KASTEN_ZULETZT)
                          : Math.max(vorher - 1, 0);
    kartenPlan[c.id] = {
      stufe,
      /* Was zurückfällt, kommt morgen wieder dran; was vorwärts
         geht, nach dem Abstand seines neuen Fachs. */
      faellig: tagPlus(gewusst ? ABSTAENDE[stufe] : 1),
      zuletzt: todayStr()
    };
    kartenPlanSichern();
    return { vorher, nachher: stufe };
  }

  const kartenVon = id => id === PORTION ? faelligeKarten() : (lernkarten[id] || []);

  /* Für den Kasten zählt der ganze Stapel, nicht nur was heute
     dran ist — sonst sähe man Fach 5 nie, weil es 16 Tage schläft. */
  function alleKartenVon(id) {
    if (id !== PORTION) return lernkarten[id] || [];
    const raus = [];
    Object.entries(lernkarten).forEach(([besitzer, karten]) => {
      if (!Array.isArray(karten)) return;
      const wo = klausuren.find(k => k.id === besitzer) || themen.find(t => t.id === besitzer);
      if (!wo) return;
      karten.forEach(c => raus.push({ ...c, ausStapel: wo.title }));
    });
    return raus;
  }
  const kartenSichern = () => store.set("lifeos_lernkarten", lernkarten);

  /* ==========================================================
     KLAUSUREN SICHERN — UND GOOGLE BESCHEID SAGEN
     Der Abgleich läuft von selbst alle 15 Minuten. Wer aber eine
     Klausur löscht und danach in den Kalender schaut, will sie
     dort nicht mehr sehen — und nicht erst in einer Viertelstunde.

     Deshalb stößt jede Änderung einen Lauf an, kurz verzögert:
     wer ein Datum verstellt, tippt oft mehrmals, und jeder
     Tastendruck sollte nicht einen eigenen Abgleich auslösen.
     ========================================================== */
  let googleTakt = null;

  function googleAnstossen() {
    if (googleTakt) clearTimeout(googleTakt);
    googleTakt = setTimeout(() => {
      googleTakt = null;
      const faecher = {};
      Object.keys(FAECHER || {}).forEach(id => { faecher[id] = fachInfo(id).lang; });
      fetch("/api/google/abgleich", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ faecher, dauern: klausurDauer })
      })
        .then(a => a.json())
        .then(d => {
          if (!d.ok) return;                       // nicht verbunden: still bleiben
          /* Nur melden, wenn wirklich etwas im Kalender passiert ist */
          if (d.geloescht) {
            showToast(d.geloescht === 1
              ? "Aus dem Google-Kalender entfernt: " + (d.geloeschteNamen || [])[0]
              : d.geloescht + " Einträge aus dem Google-Kalender entfernt");
          }
          if (window.lifeosBestand) window.lifeosBestand.nachschauen(true);
        })
        .catch(() => { /* offline: der Takt holt es später nach */ });
    }, 1500);
  }

  /* Ab hier gehen alle Klausur-Änderungen hier durch */
  function klausurenSichern() {
    store.set("lifeos_klausuren", klausuren);
    googleAnstossen();
  }

  /* ==========================================================
     VON WANN BIS WANN
     Im Kalender soll nicht „irgendwann am Donnerstag" stehen,
     sondern die Zeit. Woher sie kommt, hängt von der Art ab:

       Klausur      beginnt mit ihrer Stunde und dauert so lange,
                    wie für das Fach eingestellt ist (135 min).
       Hausaufgabe  ist zum Beginn der Stunde fällig, in der sie
                    abgegeben wird — der Zeitpunkt, der zählt.

     Beides steht danach im Eintrag selbst, damit der Abgleich am
     Server ohne Stundenplan auskommt.
     ========================================================== */
  function zeitenEintragen(eintrag, art) {
    if (!eintrag || !eintrag.date) return eintrag;

    /* Die Stunde des Fachs an diesem Tag */
    const stunden = eintrag.fach ? stundenFuerFach(eintrag.fach, eintrag.date) : [];
    const block = eintrag.von ? { von: eintrag.von } : stunden[0];
    /* Eine Stundennummer außerhalb des Plans gibt es nicht — dann
       bleibt der Eintrag lieber ganztägig als falsch terminiert. */
    const info = block ? stundeInfo(block.von) : null;
    const beginn = info ? info.von : null;

    if (art === "hausaufgabe") {
      /* Kein Zeitraum: der Beginn der Stunde ist der Zeitpunkt. Ohne
         Stunde bleibt sie ganztägig — besser als eine erfundene. */
      eintrag.startZeit = beginn || "";
      eintrag.endeZeit = beginn ? zeitPlus(beginn, 15) : "";
      delete eintrag.dauer;
      return eintrag;
    }

    if (art === "klausur") {
      eintrag.dauer = eintrag.pruefung === "test" ? TEST_DAUER : dauerFuer(eintrag.fach);
      eintrag.startZeit = beginn || "";
      eintrag.endeZeit = beginn ? zeitPlus(beginn, eintrag.dauer) : "";
      return eintrag;
    }

    /* Termine bringen ihre Zeit schon mit — aus dem Feld „time" */
    const teile = String(eintrag.time || "").split("–");
    if (teile[0] && /^\d{1,2}:\d{2}$/.test(teile[0].trim())) {
      eintrag.startZeit = teile[0].trim();
      eintrag.endeZeit = (teile[1] && teile[1].trim()) || zeitPlus(teile[0].trim(), 60);
    }
    return eintrag;
  }

  /* Minuten auf eine Uhrzeit addieren — „08:00" + 135 = „10:15" */
  function zeitPlus(uhr, minuten) {
    const [h, m] = String(uhr || "").split(":").map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return "";
    const gesamt = h * 60 + m + (Number(minuten) || 0);
    return String(Math.floor(gesamt / 60) % 24).padStart(2, "0")
         + ":" + String(gesamt % 60).padStart(2, "0");
  }

  /* Kopieren, auch wo die moderne Schnittstelle fehlt: Safari gibt
     sie nur im sicheren Kontext heraus, und auf dem iPad war die
     Seite lange über http offen. Der zweite Weg über ein
     verstecktes Feld funktioniert überall. */
  function inZwischenablage(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(() => true).catch(() => altKopieren(text));
    }
    return Promise.resolve(altKopieren(text));
  }

  function altKopieren(text) {
    try {
      const feld = document.createElement("textarea");
      feld.value = text;
      feld.setAttribute("readonly", "");
      feld.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
      document.body.appendChild(feld);
      feld.select();
      feld.setSelectionRange(0, text.length);       // iOS braucht das ausdrücklich
      const ok = document.execCommand("copy");
      feld.remove();
      return ok;
    } catch (fehler) { return false; }
  }

  /* ==========================================================
     KARTEN AUS EINER MARKDOWN-DATEI
     Der Weg dahin ist meist: Unterlagen einer KI zeigen, sie
     schreiben lassen, Datei hier ablegen. Damit das ohne Nacharbeit
     klappt, muss das Format zwei Dinge zugleich sein — für ein
     Sprachmodell exakt treffbar und für einen Menschen lesbar.

     Deshalb gewöhnliches Markdown mit einem Typ in eckigen Klammern:

       ## [frage] Was ist die Ableitung von x²?
       2x

       ## [auswahl] Welche Regel gilt für ein Produkt?
       - [x] Produktregel
       - [ ] Kettenregel

       ## [luecke] Die Ableitung von sin(x) ist {{cos(x)}}.

       ## [wahrfalsch] Jede stetige Funktion ist differenzierbar.
       falsch
       Gegenbeispiel: |x| ist bei 0 nicht differenzierbar.

     Beim Lesen wird großzügig ausgelegt: Groß- und Kleinschreibung
     egal, Umlaut und Umschrift gleichwertig, englische Namen
     erlaubt. Ein Modell, das sich um eine Kleinigkeit vertut, soll
     nicht die ganze Datei kosten.
     ========================================================== */
  const KARTEN_ARTEN = {
    frage:      ["frage", "f", "q", "question", "karte", "card"],
    auswahl:    ["auswahl", "a", "mc", "multiplechoice", "multiple-choice", "choice", "wahl"],
    luecke:     ["luecke", "lücke", "lucke", "lueckentext", "lückentext", "cloze", "gap", "l"],
    wahrfalsch: ["wahrfalsch", "wahr-falsch", "wahr/falsch", "wf", "truefalse", "true-false", "tf"]
  };

  const ART_NAMEN = {
    frage: "Frage", auswahl: "Auswahl", luecke: "Lücke", wahrfalsch: "Wahr / Falsch"
  };

  function artErkennen(wort) {
    const w = String(wort || "").toLowerCase().replace(/\s+/g, "");
    for (const [art, namen] of Object.entries(KARTEN_ARTEN)) {
      if (namen.includes(w)) return art;
    }
    return null;
  }

  /* Alte Karten kennen keine Art — sie sind Frage und Antwort. */
  const kartenArt = c => (c && c.art && ART_NAMEN[c.art]) ? c.art : "frage";

  function kartenAusMarkdown(text) {
    const zeilen = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    const karten = [];
    const fehler = [];
    let kopf = {};             // fach/thema aus dem Vorspann
    let i = 0;

    /* Vorspann zwischen --- … --- ist freiwillig */
    if (zeilen[0] && zeilen[0].trim() === "---") {
      let j = 1;
      while (j < zeilen.length && zeilen[j].trim() !== "---") {
        const t = zeilen[j].match(/^\s*([\wäöüÄÖÜß-]+)\s*:\s*(.*)$/);
        if (t) kopf[t[1].toLowerCase()] = t[2].trim();
        j++;
      }
      if (j < zeilen.length) i = j + 1;
    }

    /* Jede Überschrift beginnt eine Karte, alles bis zur nächsten
       gehört dazu. */
    let offen = null;
    const abschliessen = () => {
      if (!offen) return;
      const karte = karteBauen(offen, kopf, fehler);
      if (karte) karten.push(karte);
      offen = null;
    };

    for (; i < zeilen.length; i++) {
      const zeile = zeilen[i];
      const ueber = zeile.match(/^\s{0,3}#{1,6}\s+(.*)$/);
      if (ueber) {
        abschliessen();
        const rest = ueber[1].trim();
        const marke = rest.match(/^\[([^\]]{1,24})\]\s*(.*)$/);
        offen = {
          art: marke ? artErkennen(marke[1]) : null,
          markeRoh: marke ? marke[1] : null,
          titel: marke ? marke[2].trim() : rest,
          zeilen: [],
          nummer: i + 1
        };
        continue;
      }
      if (offen) offen.zeilen.push(zeile);
    }
    abschliessen();

    return { karten, fehler, kopf };
  }

  function karteBauen(roh, kopf, fehler) {
    const zeilen = roh.zeilen;
    const text = zeilen.join("\n").trim();
    const stelle = "Zeile " + roh.nummer;

    if (roh.markeRoh && !roh.art) {
      fehler.push(`${stelle}: „${roh.markeRoh}“ ist kein bekannter Typ — als Frage gelesen`);
    }

    /* Optionen erkennen: - [x] / - [ ] / * [X] */
    const optionen = [];
    zeilen.forEach(z => {
      const t = z.match(/^\s*[-*+]\s*\[([ xX])\]\s*(.+?)\s*$/);
      if (t) optionen.push({ text: t[2], richtig: t[1].toLowerCase() === "x" });
    });

    /* Ohne Marke aus der Form schließen — so kostet ein vergessener
       Typ nicht die Karte. */
    let art = roh.art;
    if (!art) {
      if (optionen.length >= 2) art = "auswahl";
      else if (/\{\{[^}]*\}\}/.test(roh.titel + "\n" + text)) art = "luecke";
      else art = "frage";
    }

    const frage = roh.titel;
    if (!frage) { fehler.push(`${stelle}: Karte ohne Frage — übersprungen`); return null; }

    const gemeinsam = {
      id: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      art, frage,
      thema: kopf.thema || kopf.topic || ""
    };

    if (art === "auswahl") {
      if (optionen.length < 2) {
        fehler.push(`${stelle}: Auswahl braucht mindestens zwei Möglichkeiten — übersprungen`);
        return null;
      }
      if (!optionen.some(o => o.richtig)) {
        fehler.push(`${stelle}: bei „${frage}“ ist keine Möglichkeit angekreuzt — übersprungen`);
        return null;
      }
      /* Zeilen unterhalb der Optionen sind die Erklärung */
      const erklaerung = zeilen
        .filter(z => !/^\s*[-*+]\s*\[[ xX]\]/.test(z))
        .join("\n").trim();
      return { ...gemeinsam, optionen, erklaerung,
               antwort: optionen.filter(o => o.richtig).map(o => o.text).join(", ") };
    }

    if (art === "luecke") {
      /* Die Lücken stehen im Satz selbst — Frage und Rest zusammen,
         damit {{…}} auch unter der Überschrift stehen darf. */
      const satz = (frage + (text ? "\n" + text : "")).trim();
      const luecken = [...satz.matchAll(/\{\{([^}]*)\}\}/g)].map(m => m[1].trim());
      if (!luecken.length) {
        fehler.push(`${stelle}: Lückentext ohne {{Lücke}} — als Frage gelesen`);
        return { ...gemeinsam, art: "frage", antwort: text };
      }
      return { ...gemeinsam, satz, luecken,
               antwort: luecken.join(", ") };
    }

    if (art === "wahrfalsch") {
      const erste = (zeilen.find(z => z.trim()) || "").trim().toLowerCase();
      const jaNein = /^(wahr|richtig|stimmt|true|ja|w|r)\b/.test(erste) ? true
                   : /^(falsch|unwahr|nein|false|f)\b/.test(erste) ? false : null;
      if (jaNein === null) {
        fehler.push(`${stelle}: bei „${frage}“ fehlt „wahr“ oder „falsch“ — übersprungen`);
        return null;
      }
      const erklaerung = zeilen.join("\n").trim().split("\n").slice(1).join("\n").trim();
      return { ...gemeinsam, stimmt: jaNein, erklaerung,
               antwort: jaNein ? "Wahr" : "Falsch" };
    }

    /* Frage → Antwort */
    if (!text) { fehler.push(`${stelle}: „${frage}“ hat keine Antwort — übersprungen`); return null; }
    return { ...gemeinsam, antwort: text };
  }

  /* Der Text, den ein anderes Modell braucht, um eine Datei zu
     schreiben, die hier ohne Nacharbeit durchläuft. Er steht
     absichtlich vollständig da — mit Beispiel und den Regeln, an
     denen der Leser hier sonst scheitert. */
  function kartenPrompt(k) {
    const fach = k && k.fach ? fachInfo(k.fach).lang : "";
    const thema = k ? k.title : "";
    return `Du schreibst mir eine Markdown-Datei mit Karteikarten zum Lernen.
Halte dich exakt an das Format unten — die Datei wird von einem Programm
gelesen, das nur diese Schreibweise versteht.

FACH: ${fach || "(trag hier dein Fach ein)"}
THEMA: ${thema || "(trag hier dein Thema ein)"}
QUELLE: Die Unterlagen, die ich dir gebe.

AUFBAU DER DATEI

Oben ein Vorspann zwischen zwei Zeilen aus drei Bindestrichen:

---
fach: ${fach || "Mathematik"}
thema: ${thema || "Ableitungen"}
---

Danach eine Karte je Überschrift. Die Überschrift beginnt mit ## und
enthält direkt danach den Typ in eckigen Klammern. Es gibt vier Typen:

1. [frage] — Frage auf der Vorderseite, Antwort darunter

## [frage] Was ist die Ableitung von x²?
2x

2. [auswahl] — Antwortmöglichkeiten, richtige mit [x] angekreuzt.
   Mindestens zwei Möglichkeiten, mindestens eine richtig; es dürfen
   auch mehrere richtig sein. Eine Zeile darunter ohne Kästchen ist
   die Erklärung und freiwillig.

## [auswahl] Welche Regel gilt für f(x) = u(x) · v(x)?
- [x] Produktregel
- [ ] Kettenregel
- [ ] Quotientenregel
Die Produktregel lautet u'·v + u·v'.

3. [luecke] — Lückentext. Was eingesetzt werden soll, steht in
   doppelten geschweiften Klammern. Mehrere Lücken pro Satz sind erlaubt.

## [luecke] Die Ableitung von sin(x) ist {{cos(x)}}, die von cos(x) ist {{-sin(x)}}.

4. [wahrfalsch] — Eine Behauptung. Darunter steht in der ersten Zeile
   allein das Wort wahr oder falsch, danach freiwillig die Begründung.

## [wahrfalsch] Jede stetige Funktion ist differenzierbar.
falsch
Gegenbeispiel: |x| ist stetig, aber bei 0 nicht differenzierbar.

REGELN

- Schreib die Datei am Stück, ohne Text davor oder danach.
- Jede Karte prüft genau eine Sache. Lieber zwei kurze als eine lange.
- Die Frage steht vollständig in der Überschrift, nicht darunter.
- Keine Nummerierung in den Überschriften.
- Mische die Typen: Auswahl und Wahr/Falsch für Verständnis,
  Lücke für Formeln und Vokabeln, Frage für alles Übrige.
- Formeln als Text schreiben (x^2, sqrt(2), ->), kein LaTeX.
- Umfang: so viele Karten, wie der Stoff hergibt — bei einem
  Kapitel sind 15 bis 30 üblich.

Gib die Datei als eine einzige Markdown-Datei aus.`;
  }

  function kartenOeffnen(klausurId, seite) {
    kartenKlausur = klausurId;
    kartenSeite = seite || "liste";
    if (kartenSeite === "abfrage") abfrageStarten();
    kartenZeichnen();
  }

  function kartenSchliessen() {
    /* Zurück zu dem Unterfenster, aus dem die Karten kamen */
    const warThema = !!themen.find(x => x.id === kartenKlausur);
    const warPortion = kartenKlausur === PORTION;
    kartenKlausur = null;
    kartenSchicht.classList.remove("open");
    /* Nach der Tagesportion sind Zahlen im Menü und im Dashboard
       überholt — sie werden hier nachgezogen. */
    if (warPortion) { faelligAuffrischen(); renderTabLists(); return; }
    if (warThema) { themaPanelZeichnen(); baueThemen(); }
    else lernPanelZeichnen();
  }

  /* Ohne Angabe der ganze Stapel; mit Angabe nur ein Fach des
     Kastens. */
  function abfrageStarten(nurFach) {
    abfrageFach = (nurFach === undefined || nurFach === null) ? null : Number(nurFach);
    const quelle = abfrageFach === null
      ? kartenVon(kartenKlausur)
      : alleKartenVon(kartenKlausur).filter(c => karteStufe(c) === abfrageFach);
    abfrageStapel = quelle.slice();
    /* Gemischt, damit man nicht die Reihenfolge auswendig lernt */
    for (let i = abfrageStapel.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [abfrageStapel[i], abfrageStapel[j]] = [abfrageStapel[j], abfrageStapel[i]];
    }
    abfrageIndex = 0;
    abfrageGewusst = 0;
    /* Wie viele Karten der Durchgang ursprünglich hatte — was danach
       hinten wieder draufkommt, zählt für den Lernplan nicht mehr. */
    abfrageErstLaenge = abfrageStapel.length;
    abfrageZuruecksetzen();
  }

  function kartenZeichnen() {
    if (!kartenKlausur) return kartenSchliessen();
    /* Karten hängen an einer Klausur oder an einem eigenen Thema —
       für das Fenster ist das dasselbe: ein Name und eine Kennung. */
    /* Die Tagesportion gehört keinem Stapel — sie ist einer */
    const k = kartenKlausur === PORTION
      ? { id: PORTION, title: "Heute fällig" }
      : (klausuren.find(x => x.id === kartenKlausur)
         || themen.find(x => x.id === kartenKlausur));
    if (!k) return kartenSchliessen();
    /* Ein eigenes Thema hat kein Fach \u2014 dann steht das statt eines
       Gedankenstrichs, sonst wirkt der Kopf halb leer. */
    const istThema = !!themen.find(x => x.id === kartenKlausur);
    const f = k.fach ? fachInfo(k.fach)
            : { kurz: k.id === PORTION ? "aus allen Stapeln"
                     : istThema ? "Eigenes Thema" : "\u2014",
                ton: k.id === PORTION ? "blau" : "grau" };
    const karten = kartenVon(k.id);

    kartenFenster.className = "modal karten-fenster ton-" + f.ton;
    kartenFenster.innerHTML = `
      <div class="kf-kopf">
        <div class="kf-name">
          <span class="kf-punkt"></span>
          <div>
            <h3>${escapeHTML(k.title)}</h3>
            <span class="kf-unter">${karten.length} ${karten.length === 1 ? "Karte" : "Karten"}
              \u00b7 ${escapeHTML(f.kurz)}</span>
          </div>
        </div>
        <div class="kf-schalter">
          ${k.id === PORTION ? "" : `
          <button type="button" class="kf-tab${kartenSeite === "liste" ? " an" : ""}" data-kf="liste">Bearbeiten</button>`}
          <button type="button" class="kf-tab${kartenSeite === "abfrage" ? " an" : ""}" data-kf="abfrage"
            ${karten.length ? "" : "disabled"}>Abfragen</button>
          <button type="button" class="kf-tab${kartenSeite === "kasten" ? " an" : ""}" data-kf="kasten"
            ${alleKartenVon(k.id).length ? "" : "disabled"}>Kasten</button>
        </div>
        <button type="button" class="kf-zu" data-kf="zu" aria-label="Schlie\u00dfen">\u2715</button>
      </div>
      ${kartenSeite === "liste" ? listeHtml(karten)
        : kartenSeite === "kasten" ? kastenHtml(k) : abfrageHtml()}`;

    kartenFenster.querySelectorAll("[data-kf]").forEach(b => b.addEventListener("click", () => {
      const was = b.dataset.kf;
      if (was === "zu") return kartenSchliessen();
      kartenSeite = was;
      if (was === "abfrage") abfrageStarten();
      kartenZeichnen();
    }));

    if (kartenSeite === "liste") listeBinden(k);
    else if (kartenSeite === "kasten") kastenBinden();
    else abfrageBinden();

    kartenSchicht.classList.add("open");
  }

  /* ---------- Seite 3: der Kasten ----------
     Sechs Fächer nebeneinander, jedes mit seinem Bestand. Wer ein
     Fach antippt, fragt genau dieses ab — so kann man gezielt an
     dem üben, was noch wackelt, statt jedes Mal alles zu sehen. */
  function kastenHtml(k) {
    const alle = alleKartenVon(k.id);
    const faecher = kastenVerteilung(alle);
    const groesstes = Math.max(1, ...faecher.map(f => f.length));

    const zeilen = faecher.map((fach, i) => {
      const faellig = fach.filter(karteFaellig).length;
      const abstand = ABSTAENDE[i];
      return `<li class="kk-fach kk-s${i}">
        <span class="kk-nr">${i + 1}</span>
        <div class="kk-text">
          <div class="kk-titel">${KASTEN_NAMEN[i]}</div>
          <div class="kk-unter">${abstand === 1 ? "täglich" : "alle " + abstand + " Tage"}${
            faellig ? " · " + faellig + " heute dran" : ""}</div>
        </div>
        <div class="kk-balken"><i style="width:${
          Math.round(100 * fach.length / groesstes)}%"></i></div>
        <span class="kk-zahl">${fach.length}</span>
        <button type="button" class="kk-ab" data-kasten="${i}"
          ${fach.length ? "" : "disabled"}>Abfragen</button>
      </li>`;
    }).join("");

    return `<div class="kk-raum">
      <p class="kk-regel">Gewusst geht ein Fach weiter, nicht gewusst ein Fach zurück —
        aus Fach 1 fällt nichts heraus. Was hinten liegt, sitzt.</p>
      <ul class="kk-liste">${zeilen}</ul>
      <div class="kk-fuss">${alle.length} ${alle.length === 1 ? "Karte" : "Karten"} im Kasten</div>
    </div>`;
  }

  function kastenBinden() {
    kartenFenster.querySelectorAll("[data-kasten]").forEach(b =>
      b.addEventListener("click", () => {
        kartenSeite = "abfrage";
        abfrageStarten(Number(b.dataset.kasten));
        kartenZeichnen();
      }));
  }

  /* ---------- Seite 1: bearbeiten ---------- */
  /* Der Lückensatz mit sichtbaren Lücken statt {{…}} */
  const lueckeAnzeige = c =>
    String(c.satz || c.frage || "").replace(/\{\{([^}]*)\}\}/g, "____");

  /* Was in der Liste unter der Frage steht — je Art das, was die
     Karte ausmacht. */
  function kartenRueckseite(c) {
    const art = kartenArt(c);
    if (art === "auswahl") {
      return `<ul class="kf-optionen">${(c.optionen || []).map(o =>
        `<li class="${o.richtig ? "richtig" : ""}">
           <span class="kf-haken">${o.richtig ? "✓" : ""}</span>${escapeHTML(o.text)}</li>`).join("")}</ul>
        ${c.erklaerung ? `<div class="kf-erklaerung">${escapeHTML(c.erklaerung)}</div>` : ""}`;
    }
    if (art === "luecke") {
      return `<div class="kf-loesung">${(c.luecken || []).map(l =>
        `<span class="kf-luecke-wort">${escapeHTML(l)}</span>`).join("")}</div>`;
    }
    if (art === "wahrfalsch") {
      return `<div class="kf-loesung">
          <span class="kf-wf ${c.stimmt ? "wahr" : "falsch"}">${c.stimmt ? "Wahr" : "Falsch"}</span>
        </div>
        ${c.erklaerung ? `<div class="kf-erklaerung">${escapeHTML(c.erklaerung)}</div>` : ""}`;
    }
    return `<div class="kf-loesung">${escapeHTML(c.antwort || "—")}</div>`;
  }

  function listeHtml(karten) {
    return `
      <ul class="kf-liste">${karten.map((c, i) => {
        const art = kartenArt(c);
        /* Nur die einfache Karte ist frei bearbeitbar. Die anderen
           tragen eine Struktur, die ein Textfeld nicht abbildet \u2014
           sie zeigen sie stattdessen an. */
        const inhalt = art === "frage"
          ? `<textarea class="kf-frage" rows="1" data-feld="frage"
               placeholder="Frage">${escapeHTML(c.frage)}</textarea>
             <textarea class="kf-antwort" rows="1" data-feld="antwort"
               placeholder="Antwort">${escapeHTML(c.antwort || "")}</textarea>`
          : `<div class="kf-frage-fest">${escapeHTML(
               art === "luecke" ? lueckeAnzeige(c) : c.frage)}</div>
             ${kartenRueckseite(c)}`;
        return `
        <li data-karte="${c.id}" class="art-${art}">
          <span class="kf-nr">${i + 1}</span>
          <div class="kf-paar">
            ${art === "frage" ? "" : `<span class="kf-art">${ART_NAMEN[art]}</span>`}
            ${inhalt}
          </div>
          <button type="button" class="kf-weg" aria-label="Karte l\u00f6schen">\u2715</button>
        </li>`; }).join("") ||
        '<li class="kf-leer">Noch keine Karten \u2014 unten anlegen oder mehrere auf einmal einf\u00fcgen.</li>'}
      </ul>

      <form class="kf-neu">
        <input type="text" data-neu="frage" placeholder="Frage" autocomplete="off">
        <input type="text" data-neu="antwort" placeholder="Antwort" autocomplete="off">
        <button type="submit">Karte anlegen</button>
      </form>

      <details class="kf-import" open>
        <summary>Karten aus einer Datei</summary>
        <p class="kf-import-text">Eine <b>.md</b>-Datei mit dem Aufbau unten wird
          gelesen und in Karten verwandelt \u2014 beliebig viele auf einmal, in vier
          Arten. Den Prompt darunter gibst du einem KI-Modell zusammen mit deinen
          Unterlagen; was dabei herauskommt, landet hier.</p>

        <div class="kf-ablage" id="kfAblage" tabindex="0" role="button">
          <span class="kf-ablage-gross">.md-Datei hierher ziehen</span>
          <span class="kf-ablage-klein">oder klicken zum Ausw\u00e4hlen</span>
          <input type="file" class="kf-ablage-feld" accept=".md,.markdown,text/markdown"
                 multiple hidden>
        </div>

        <div class="kf-werkzeuge">
          <button type="button" class="kf-prompt-knopf">Prompt kopieren</button>
          <button type="button" class="kf-muster-knopf">Beispiel einf\u00fcgen</button>
        </div>

        <!-- Der Prompt steht auch im Klartext da: Zwischenablagen
             sind auf dem iPad launisch, und ohne diesen Weg k\u00e4me man
             an den Text sonst gar nicht heran. -->
        <details class="kf-aufbau" id="kfPromptFach">
          <summary>Prompt zum Mitnehmen</summary>
          <textarea class="kf-prompt-feld" rows="8" readonly></textarea>
        </details>

        <details class="kf-aufbau">
          <summary>Wie die Datei aussehen muss</summary>
          <pre class="kf-aufbau-code">## [frage] Was ist die Ableitung von x\u00b2?
2x

## [auswahl] Welche Regel gilt f\u00fcr ein Produkt?
- [x] Produktregel
- [ ] Kettenregel

## [luecke] Die Ableitung von sin(x) ist {{cos(x)}}.

## [wahrfalsch] Jede stetige Funktion ist differenzierbar.
falsch
Gegenbeispiel: |x| ist bei 0 nicht differenzierbar.</pre>
        </details>

        <details class="kf-aufbau">
          <summary>Oder Text einf\u00fcgen</summary>
          <p class="kf-import-text">Inhalt einer .md-Datei hier hineinkopieren \u2014
            oder je Zeile <b>Frage :: Antwort</b> f\u00fcr den schnellen Fall.</p>
          <textarea class="kf-import-feld" rows="5"
            placeholder="## [frage] Was ist eine Redoxreaktion?&#10;Elektronen\u00fcbergang zwischen zwei Stoffen"></textarea>
          <button type="button" class="kf-import-knopf">Einf\u00fcgen</button>
        </details>
      </details>`;
  }

  function listeBinden(k) {
    const karten = kartenVon(k.id);

    /* Beim Tippen sofort sichern — kein Speichern-Knopf noetig */
    kartenFenster.querySelectorAll("[data-karte]").forEach(li => {
      const c = karten.find(x => x.id === li.dataset.karte);
      li.querySelectorAll("textarea").forEach(t => {
        const hoehe = () => { t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; };
        hoehe();
        /* Noch einmal, wenn das Fenster seine endgültige Breite hat:
           beim ersten Messen steht es teils noch in der Animation,
           und ein Text, der später umbricht, wurde abgeschnitten. */
        setTimeout(hoehe, 0);
        t.addEventListener("input", () => { c[t.dataset.feld] = t.value; kartenSichern(); hoehe(); });
      });
      li.querySelector(".kf-weg").addEventListener("click", () => {
        lernkarten[k.id] = karten.filter(x => x.id !== c.id);
        kartenSichern();
        kartenZeichnen();
      });
    });

    kartenFenster.querySelector(".kf-neu").addEventListener("submit", e => {
      e.preventDefault();
      const frage = e.target.querySelector('[data-neu="frage"]').value.trim();
      const antwort = e.target.querySelector('[data-neu="antwort"]').value.trim();
      if (!frage) return;
      lernkarten[k.id] = kartenVon(k.id).concat({ id: "c" + Date.now(), frage, antwort });
      kartenSichern();
      kartenZeichnen();
    });

    /* ---------- Aus Text: Markdown, sonst Frage :: Antwort ---------- */
    kartenFenster.querySelector(".kf-import-knopf").addEventListener("click", () => {
      const feld = kartenFenster.querySelector(".kf-import-feld");
      if (!kartenEinlesen(k, feld.value, "Eingef\u00fcgter Text")) return;
      feld.value = "";
    });

    /* ---------- Aus einer Datei ---------- */
    const ablage = kartenFenster.querySelector(".kf-ablage");
    const feld = kartenFenster.querySelector(".kf-ablage-feld");

    const dateienLesen = liste => {
      const dateien = [...liste].filter(d => /\.(md|markdown)$/i.test(d.name));
      const abgelehnt = [...liste].filter(d => !/\.(md|markdown)$/i.test(d.name));
      if (abgelehnt.length) {
        showToast("Nur .md-Dateien: " + abgelehnt.map(d => d.name).join(", ") + " \u00fcbersprungen", "warn");
      }
      dateien.forEach(d => {
        d.text().then(inhalt => kartenEinlesen(k, inhalt, d.name))
                .catch(() => showToast("\u201e" + d.name + "\u201c lie\u00df sich nicht lesen", "warn"));
      });
    };

    ablage.addEventListener("click", () => feld.click());
    ablage.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); feld.click(); }
    });
    feld.addEventListener("change", () => { dateienLesen(feld.files); feld.value = ""; });

    ["dragenter", "dragover"].forEach(art => ablage.addEventListener(art, e => {
      e.preventDefault(); ablage.classList.add("drueber");
    }));
    ["dragleave", "drop"].forEach(art => ablage.addEventListener(art, e => {
      e.preventDefault(); ablage.classList.remove("drueber");
    }));
    ablage.addEventListener("drop", e => {
      if (e.dataTransfer && e.dataTransfer.files) dateienLesen(e.dataTransfer.files);
    });

    /* ---------- Prompt und Beispiel ---------- */
    /* Das Feld tr\u00e4gt den Prompt immer \u2014 der Knopf ist nur die
       Abk\u00fcrzung. Scheitert das Kopieren, klappt das Feld auf und
       markiert den Text, damit man ihn von Hand mitnehmen kann. */
    const promptFeld = kartenFenster.querySelector(".kf-prompt-feld");
    if (promptFeld) promptFeld.value = kartenPrompt(k);

    kartenFenster.querySelector(".kf-prompt-knopf").addEventListener("click", knopfE => {
      const knopf = knopfE.currentTarget;
      inZwischenablage(kartenPrompt(k)).then(ok => {
        if (ok) {
          const alt = knopf.textContent;
          knopf.textContent = "Kopiert";
          setTimeout(() => { knopf.textContent = alt; }, 1600);
          return;
        }
        const fach = $("kfPromptFach");
        if (fach) {
          fach.open = true;
          fach.scrollIntoView({ block: "nearest" });
          if (promptFeld) { promptFeld.focus(); promptFeld.select(); }
        }
        showToast("Kopieren war nicht erlaubt \u2014 der Prompt steht jetzt markiert unten", "warn");
      });
    });

    kartenFenster.querySelector(".kf-muster-knopf").addEventListener("click", () => {
      kartenEinlesen(k, KARTEN_MUSTER, "Beispiel");
    });
  }

  /* Nimmt Text entgegen, macht Karten daraus und sagt, was dabei
     herauskam. Erkennt selbst, ob Markdown oder die alte Zeilenform
     \u201eFrage :: Antwort\u201c vorliegt \u2014 beides soll durchgehen. */
  function kartenEinlesen(k, text, herkunft) {
    const roh = String(text || "").trim();
    if (!roh) { showToast("Nichts zu lesen", "warn"); return false; }

    let neue = [], fehler = [];

    if (/^\s{0,3}#{1,6}\s/m.test(roh)) {
      const gelesen = kartenAusMarkdown(roh);
      neue = gelesen.karten;
      fehler = gelesen.fehler;
    } else {
      /* Kein Markdown: die schnelle Zeilenform */
      neue = roh.split("\n")
        .map(z => z.split("::"))
        .filter(t => t.length >= 2 && t[0].trim())
        .map((t, i) => ({ id: "c" + Date.now().toString(36) + i, art: "frage",
                          frage: t[0].trim(), antwort: t.slice(1).join("::").trim() }));
    }

    if (!neue.length) {
      showToast(fehler.length
        ? "Keine Karte gefunden \u2014 " + fehler[0]
        : "Keine Karte gefunden. \u00dcberschriften beginnen mit ## und dem Typ, z.B. ## [frage] \u2026", "warn");
      return false;
    }

    lernkarten[k.id] = kartenVon(k.id).concat(neue);
    kartenSichern();
    kartenZeichnen();

    /* Z\u00e4hlen, was hereinkam \u2014 das beantwortet die erste Frage nach
       dem Ablegen, ohne dass man die Liste durchgehen muss. */
    const proArt = {};
    neue.forEach(c => { const a = kartenArt(c); proArt[a] = (proArt[a] || 0) + 1; });
    const teile = Object.entries(proArt).map(([a, n]) => n + "\u00d7 " + ART_NAMEN[a]);

    showToast(neue.length + (neue.length === 1 ? " Karte" : " Karten") + " aus \u201e"
              + herkunft + "\u201c \u00b7 " + teile.join(", "), "success");
    if (fehler.length) {
      showToast(fehler.length === 1 ? fehler[0]
                : fehler.length + " Stellen \u00fcbersprungen \u2014 erste: " + fehler[0], "warn");
    }
    return true;
  }

  /* Ein Beispiel, das alle vier Arten zeigt \u2014 man sieht schneller,
     was gemeint ist, als jede Beschreibung erkl\u00e4ren kann. */
  const KARTEN_MUSTER = `---
fach: Beispiel
thema: So sieht eine Datei aus
---

## [frage] Was ist die Ableitung von x\u00b2?
2x

## [auswahl] Welche Regel gilt f\u00fcr f(x) = u(x) \u00b7 v(x)?
- [x] Produktregel
- [ ] Kettenregel
- [ ] Quotientenregel
Die Produktregel lautet u'\u00b7v + u\u00b7v'.

## [luecke] Die Ableitung von sin(x) ist {{cos(x)}}, die von cos(x) ist {{-sin(x)}}.

## [wahrfalsch] Jede stetige Funktion ist differenzierbar.
falsch
Gegenbeispiel: |x| ist stetig, aber bei 0 nicht differenzierbar.`;

  /* ---------- Seite 2: abfragen ---------- */
  function abfrageHtml() {
    if (!abfrageStapel.length) return '<div class="kf-leer-gross">Keine Karten zum Abfragen</div>';
    if (abfrageIndex >= abfrageStapel.length) {
      const anteil = Math.round(100 * abfrageGewusst / abfrageStapel.length);
      return `
        <div class="kf-ende">
          <div class="kf-ende-zahl">${abfrageGewusst} / ${abfrageStapel.length}</div>
          <div class="kf-ende-text">${anteil} % gewusst</div>
          <button type="button" class="kf-nochmal">Noch eine Runde</button>
        </div>`;
    }
    const c = abfrageStapel[abfrageIndex];
    const balken = `<div class="kf-fortschritt"><i style="width:${
      100 * abfrageIndex / abfrageStapel.length}%"></i></div>`;
    /* Woher die Karte kommt und wohin die letzte gegangen ist —
       ohne das bleibt der Kasten eine Behauptung. */
    const fach = karteStufe(c);
    const zaehler = `<div class="kf-zaehler">
        <span>Karte ${abfrageIndex + 1} von ${abfrageStapel.length}</span>
        <span class="kf-fach kf-s${fach}">Fach ${fach + 1}</span>
        ${abfrageWanderung ? `<span class="kf-wandert">${abfrageWanderung}</span>` : ""}
      </div>`;
    const art = kartenArt(c);

    /* Die einfache Karte bleibt Selbsteinsch\u00e4tzung: nur du wei\u00dft,
       ob du es wirklich wusstest. Die anderen drei pr\u00fcfen sich
       selbst \u2014 da gibt es nichts einzusch\u00e4tzen. */
    if (art === "frage") {
      return `${balken}
        <div class="kf-karte${abfrageOffen ? " offen" : ""}">
          <div class="kf-seite kf-vorn">
            <span class="kf-marke">Frage</span>
            <div class="kf-inhalt">${escapeHTML(c.frage)}</div>
            <span class="kf-tipp">Klicken zum Umdrehen</span>
          </div>
          <div class="kf-seite kf-hinten">
            <span class="kf-marke">Antwort</span>
            <div class="kf-inhalt">${escapeHTML(c.antwort) || "\u2014"}</div>
          </div>
        </div>
        <div class="kf-urteil${abfrageOffen ? " da" : ""}">
          <button type="button" class="kf-nochmal-karte" data-urteil="nein">Nochmal</button>
          <button type="button" class="kf-gewusst" data-urteil="ja">Gewusst</button>
        </div>
        ${zaehler}`;
    }

    const geprueft = abfrageErgebnis !== null;
    let mitte = "";

    if (art === "auswahl") {
      const mehrfach = (c.optionen || []).filter(o => o.richtig).length > 1;
      mitte = `
        <div class="kf-aufgabe">
          <span class="kf-marke">${ART_NAMEN.auswahl}${mehrfach ? " \u00b7 mehrere richtig" : ""}</span>
          <div class="kf-inhalt">${escapeHTML(c.frage)}</div>
          <ul class="kf-wahl${geprueft ? " geprueft" : ""}">${(c.optionen || []).map((o, i) => {
            const gewaehlt = abfrageWahl.has(i);
            const klasse = !geprueft ? (gewaehlt ? "gewaehlt" : "")
              : o.richtig ? "richtig" : gewaehlt ? "daneben" : "";
            return `<li><button type="button" class="kf-option ${klasse}" data-option="${i}"
                      ${geprueft ? "disabled" : ""}>
                      <span class="kf-kasten">${
                        geprueft ? (o.richtig ? "\u2713" : gewaehlt ? "\u2715" : "")
                                 : (gewaehlt ? "\u25cf" : "")}</span>
                      <span>${escapeHTML(o.text)}</span>
                    </button></li>`; }).join("")}
          </ul>
        </div>`;
    }

    if (art === "luecke") {
      let nr = -1;
      const satz = String(c.satz || c.frage || "").replace(/\{\{([^}]*)\}\}/g, (_, loesung) => {
        nr++;
        const wert = abfrageText[nr] || "";
        if (!geprueft) {
          return `<input type="text" class="kf-luecke-feld" data-luecke="${nr}"
                    value="${escapeHTML(wert)}" autocomplete="off" autocapitalize="off"
                    spellcheck="false" size="${Math.max(6, loesung.length)}">`;
        }
        const stimmt = luecktGleich(wert, loesung);
        return `<span class="kf-luecke-fest ${stimmt ? "richtig" : "daneben"}">${
          escapeHTML(wert || "\u2014")}${stimmt ? "" :
          ` <b>${escapeHTML(loesung)}</b>`}</span>`;
      });
      mitte = `
        <div class="kf-aufgabe">
          <span class="kf-marke">${ART_NAMEN.luecke}</span>
          <div class="kf-inhalt kf-lueckensatz">${satz}</div>
        </div>`;
    }

    if (art === "wahrfalsch") {
      const gewaehlt = abfrageWahl.has(1) ? true : abfrageWahl.has(0) ? false : null;
      const knopf = (wert, text) => {
        const ist = gewaehlt === wert;
        const klasse = !geprueft ? (ist ? "gewaehlt" : "")
          : c.stimmt === wert ? "richtig" : ist ? "daneben" : "";
        return `<button type="button" class="kf-wf-knopf ${klasse}" data-wf="${wert ? 1 : 0}"
                  ${geprueft ? "disabled" : ""}>${text}</button>`;
      };
      mitte = `
        <div class="kf-aufgabe">
          <span class="kf-marke">${ART_NAMEN.wahrfalsch}</span>
          <div class="kf-inhalt">${escapeHTML(c.frage)}</div>
          <div class="kf-wf-wahl">${knopf(true, "Wahr")}${knopf(false, "Falsch")}</div>
        </div>`;
    }

    const erklaerung = geprueft && c.erklaerung
      ? `<div class="kf-erklaerung gross">${escapeHTML(c.erklaerung)}</div>` : "";

    const unten = geprueft
      ? `<div class="kf-ergebnis ${abfrageErgebnis ? "gut" : "schlecht"}">
           <span>${abfrageErgebnis ? "Richtig" : "Nicht ganz"}</span>
           <button type="button" class="kf-weiter" data-weiter="1">Weiter</button>
         </div>`
      : `<div class="kf-urteil da">
           <button type="button" class="kf-gewusst" data-pruefen="1">Pr\u00fcfen</button>
         </div>`;

    return `${balken}${mitte}${erklaerung}${unten}${zaehler}`;
  }

  /* Beim Vergleich nachsichtig sein: Gro\u00df- und Kleinschreibung,
     Randabst\u00e4nde und doppelte Leerzeichen sollen keine Rolle
     spielen. Wer \u201ecos(x)\u201c statt \u201ecos (x)\u201c schreibt, hat es
     gewusst. */
  function luecktGleich(eingabe, loesung) {
    const putzen = s => String(s || "").toLowerCase()
      .replace(/\s+/g, "").replace(/[.,;!?]+$/, "");
    if (putzen(eingabe) === putzen(loesung)) return true;
    /* Mehrere zul\u00e4ssige Antworten mit | trennen: {{cos(x)|kosinus}} */
    return String(loesung).split("|").some(v => putzen(v) === putzen(eingabe));
  }

  /* Hat die aktuelle Karte gestimmt? */
  function abfragePruefen(c) {
    const art = kartenArt(c);
    if (art === "auswahl") {
      const richtige = new Set((c.optionen || [])
        .map((o, i) => o.richtig ? i : -1).filter(i => i >= 0));
      if (abfrageWahl.size !== richtige.size) return false;
      return [...abfrageWahl].every(i => richtige.has(i));
    }
    if (art === "luecke") {
      return (c.luecken || []).every((l, i) => luecktGleich(abfrageText[i], l));
    }
    if (art === "wahrfalsch") {
      const gewaehlt = abfrageWahl.has(1) ? true : abfrageWahl.has(0) ? false : null;
      return gewaehlt === c.stimmt;
    }
    return false;
  }

  function abfrageBinden() {
    const karte = kartenFenster.querySelector(".kf-karte");
    if (karte) karte.addEventListener("click", () => { abfrageOffen = !abfrageOffen; kartenZeichnen(); });

    kartenFenster.querySelectorAll("[data-urteil]").forEach(b => b.addEventListener("click", e => {
      e.stopPropagation();
      if (!abfrageOffen) return;
      abfrageWeiter(b.dataset.urteil === "ja");
    }));

    /* ---------- Auswahl ---------- */
    kartenFenster.querySelectorAll("[data-option]").forEach(b => b.addEventListener("click", () => {
      const i = Number(b.dataset.option);
      const c = abfrageStapel[abfrageIndex];
      const mehrfach = (c.optionen || []).filter(o => o.richtig).length > 1;
      /* Ist nur eine richtig, ersetzt ein Klick die vorige Wahl —
         sonst tippt man versehentlich zwei an und liegt daneben. */
      if (!mehrfach) abfrageWahl.clear();
      if (abfrageWahl.has(i)) abfrageWahl.delete(i); else abfrageWahl.add(i);
      kartenZeichnen();
    }));

    /* ---------- Wahr / Falsch: antippen prüft gleich mit ---------- */
    kartenFenster.querySelectorAll("[data-wf]").forEach(b => b.addEventListener("click", () => {
      abfrageWahl = new Set([Number(b.dataset.wf)]);
      abfrageErgebnis = abfragePruefen(abfrageStapel[abfrageIndex]);
      kartenZeichnen();
    }));

    /* ---------- Lücke ---------- */
    const felder = kartenFenster.querySelectorAll("[data-luecke]");
    felder.forEach((f, i) => {
      f.addEventListener("input", () => { abfrageText[Number(f.dataset.luecke)] = f.value; });
      f.addEventListener("keydown", e => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        /* Enter springt zur nächsten Lücke, in der letzten prüft es */
        if (i + 1 < felder.length) felder[i + 1].focus();
        else abfrageJetztPruefen();
      });
    });
    if (felder.length && abfrageErgebnis === null) felder[0].focus();

    const pruefen = kartenFenster.querySelector("[data-pruefen]");
    if (pruefen) pruefen.addEventListener("click", abfrageJetztPruefen);

    const weiter = kartenFenster.querySelector("[data-weiter]");
    if (weiter) weiter.addEventListener("click", () => abfrageWeiter(abfrageErgebnis));

    const nochmal = kartenFenster.querySelector(".kf-nochmal");
    if (nochmal) nochmal.addEventListener("click", () => { abfrageStarten(); kartenZeichnen(); });
  }

  function abfrageJetztPruefen() {
    const c = abfrageStapel[abfrageIndex];
    if (!c) return;
    const art = kartenArt(c);
    if (art === "auswahl" && !abfrageWahl.size) {
      return showToast("Erst eine Möglichkeit antippen", "warn");
    }
    abfrageErgebnis = abfragePruefen(c);
    kartenZeichnen();
  }

  function abfrageWeiter(gewusst) {
    const laufende = abfrageStapel[abfrageIndex];
    if (gewusst) abfrageGewusst++;
    /* Nicht Gewusstes kommt hinten wieder drauf */
    else abfrageStapel.push(laufende);
    /* Und in den Lernplan: davon hängt ab, wann die Karte wieder
       auf dem Tagesstapel liegt. Nur beim ersten Durchgang, sonst
       zählte eine Karte doppelt, die man hinten nochmal sieht. */
    if (abfrageIndex < abfrageErstLaenge) {
      const weg = karteBewerten(laufende, gewusst);
      if (weg) {
        abfrageWanderung = weg.vorher === weg.nachher
          ? "bleibt in Fach " + (weg.nachher + 1)
          : "Fach " + (weg.vorher + 1) + " \u2192 " + (weg.nachher + 1);
      }
    }
    abfrageIndex++;
    abfrageZuruecksetzen();
    kartenZeichnen();
    /* Die Zahl im Menü und auf dem Dashboard zieht mit */
    faelligAuffrischen();
  }

  kartenSchicht.addEventListener("mousedown", e => {
    if (e.target === kartenSchicht) kartenSchliessen();
  });
  document.addEventListener("keydown", e => {
    if (!kartenKlausur) return;
    if (e.key === "Escape") return kartenSchliessen();
    if (kartenSeite !== "abfrage") return;
    /* In einem Lückenfeld gehören Leertaste und Enter dem Tippen —
       das Umdrehen darf sie dort nicht abfangen. */
    if (tipptGerade()) return;
    /* Umgedreht wird nur die einfache Karte; die anderen Arten
       haben eigene Knöpfe und kennen kein Vorn und Hinten. */
    const laufende = abfrageStapel[abfrageIndex];
    if (!laufende || kartenArt(laufende) !== "frage") return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      abfrageOffen = !abfrageOffen;
      kartenZeichnen();
    }
  });

  /* ==========================================================
     DATEIABLAGE
     Scans und PDFs sind zu gross fuer localStorage — dort ist bei
     rund 5 MB Schluss. Die Dateien liegen deshalb in IndexedDB;
     an der Klausur steht nur, welche dazugehoeren.
     ========================================================== */
  const DB_NAME = "lifeos_dateien";
  const DB_LAGER = "dateien";
  const DATEI_MAX = 60 * 1024 * 1024;     // groesser wird unhandlich
  let dbOffen = null;

  function datenbank() {
    if (dbOffen) return dbOffen;
    dbOffen = new Promise((fertig, fehler) => {
      const anfrage = indexedDB.open(DB_NAME, 1);
      anfrage.onupgradeneeded = () => {
        const d = anfrage.result;
        if (!d.objectStoreNames.contains(DB_LAGER)) d.createObjectStore(DB_LAGER, { keyPath: "id" });
      };
      anfrage.onsuccess = () => fertig(anfrage.result);
      anfrage.onerror = () => fehler(anfrage.error);
    });
    return dbOffen;
  }

  function dateiSchreiben(satz) {
    return datenbank().then(d => new Promise((fertig, fehler) => {
      const t = d.transaction(DB_LAGER, "readwrite");
      t.objectStore(DB_LAGER).put(satz);
      t.oncomplete = () => fertig();
      t.onerror = () => fehler(t.error);
    }));
  }

  function dateiHolen(id) {
    return datenbank().then(d => new Promise((fertig, fehler) => {
      const a = d.transaction(DB_LAGER, "readonly").objectStore(DB_LAGER).get(id);
      a.onsuccess = () => fertig(a.result || null);
      a.onerror = () => fehler(a.error);
    }));
  }

  function dateiEntfernen(id) {
    return datenbank().then(d => new Promise((fertig, fehler) => {
      const t = d.transaction(DB_LAGER, "readwrite");
      t.objectStore(DB_LAGER).delete(id);
      t.oncomplete = () => fertig();
      t.onerror = () => fehler(t.error);
    }));
  }

  const groesseText = b => b < 1024 ? b + " B"
    : b < 1048576 ? (b / 1024).toFixed(0) + " KB"
    : (b / 1048576).toFixed(1) + " MB";

  /* GoodNotes-Dateien sind ein eigenes, geschlossenes Format. Sie
     lassen sich ablegen und wieder herunterladen, aber nicht im
     Browser anzeigen — dafuer aus GoodNotes als PDF ausgeben. */
  function dateiArt(datei) {
    const name = (datei.name || "").toLowerCase();
    if (/\.(goodnotes|note)$/.test(name)) return "goodnotes";
    if ((datei.typ || datei.type || "").startsWith("image/")) return "bild";
    if ((datei.typ || datei.type || "") === "application/pdf" || name.endsWith(".pdf")) return "pdf";
    return "sonst";
  }

  const dateienVon = k => Array.isArray(k.dateien) ? k.dateien : [];

  /* Dateien an den offenen Eintrag haengen. "art" sagt, wo er wohnt:
     an einer Klausur oder an einer Hausaufgabe. */
  /* ==========================================================
     KLAUSUR ALS PROJEKT
     Sobald zu einer Klausur die erste Unterlage kommt, ist aus dem
     Termin eine Aufgabe geworden — mit einem festen Ende. Genau
     dann entsteht das Projekt: Name der Klausur, ihr Datum als
     Frist, und drei Schritte, die für jede Klausur gelten.

     Die drei Schritte stehen bewusst schon drin. Ein leeres Projekt
     ist der Grund, warum der Baukasten bisher nie benutzt wurde:
     bis etwas passiert, sind sechs Handgriffe nötig. So ist der
     erste Zustand bereits brauchbar und wird angepasst statt
     aufgebaut.

     Die Unterlagen bleiben an der Klausur. Das Projekt zeigt sie
     nur — doppelt gespeichert wären sie ein Fehler, der irgendwann
     auseinanderläuft.
     ========================================================== */
  const KLAUSUR_SCHRITTE = [
    "Material sichten und ordnen",
    "Zusammenfassung schreiben",
    "Aufgaben üben"
  ];

  const projektZuKlausur = id => projekte.find(x => x.quelleKlausur === id) || null;

  function klausurProjekt(k, anlegen) {
    let pr = projektZuKlausur(k.id);

    if (pr) {
      /* Verschiebt sich die Klausur, verschiebt sich die Frist mit */
      let geaendert = false;
      if (pr.deadline !== k.date) { pr.deadline = k.date; geaendert = true; }
      if (pr.name !== k.title && !pr.eigenerName) { pr.name = k.title; geaendert = true; }
      if (geaendert) store.set("lifeos_projekte", projekte);
      return pr;
    }
    if (!anlegen) return null;

    pr = {
      id: "p" + Date.now(),
      name: k.title,
      datum: todayStr(),
      fertig: false,
      quelleKlausur: k.id,
      deadline: k.date,
      schritte: KLAUSUR_SCHRITTE.map(t => ({ id: uid(), art: "schritt", werte: { text: t } }))
    };
    projekte.push(pr);
    store.set("lifeos_projekte", projekte);
    nutzAktion("projekt");
    return pr;
  }

  function dateienAufnehmen(k, liste, art) {
    const istHaus = art === "hausaufgabe";
    const sichern = () => {
      if (istHaus) { store.set("lifeos_hausaufgaben", hausaufgaben); hausPanelZeichnen(); }
      else { klausurenSichern(); lernPanelZeichnen(); }
    };
    /* Bei einer Klausur entsteht mit der ersten Unterlage das Projekt */
    const vorher = istHaus ? null : projektZuKlausur(k.id);
    return dateienAufnehmenTun(k, liste, () => {
      sichern();
      if (istHaus) return;
      const pr = klausurProjekt(k, true);
      if (pr && !vorher) {
        if (aktuelleSeite === "projekte") baueBaukasten();
        showToast("Projekt „" + pr.name + "\u201c angelegt — mit Frist und drei Schritten");
      }
    });
  }

  function dateienAufnehmenTun(k, liste, sichern) {
    const dateien = [...liste];
    if (!dateien.length) return;
    let angenommen = 0, zuGross = [];

    Promise.all(dateien.map(datei => {
      if (datei.size > DATEI_MAX) { zuGross.push(datei.name); return Promise.resolve(); }
      const id = "d" + Date.now() + Math.random().toString(36).slice(2, 7);
      const satz = { id, gehoert: k.id, name: datei.name, typ: datei.type,
                     groesse: datei.size, datum: todayStr(), inhalt: datei };
      return dateiSchreiben(satz).then(() => {
        k.dateien = dateienVon(k).concat({ id, name: datei.name, typ: datei.type,
                                           groesse: datei.size, art: dateiArt(datei) });
        angenommen++;
      });
    })).then(() => {
      sichern();
      if (angenommen) showToast(angenommen === 1 ? "1 Datei angeh\u00e4ngt"
                                                 : angenommen + " Dateien angeh\u00e4ngt");
      if (zuGross.length) showToast("Zu gro\u00df (max " + groesseText(DATEI_MAX) + "): "
                                    + zuGross.join(", "), "warn");
    }).catch(f => showToast("Konnte nicht speichern: " + f.message, "warn"));
  }

  /* ---------- Vorschau ---------- */
  const dateiSchicht = $("dateiSchicht");
  const dateiRahmen = $("dateiRahmen");
  let vorschauUrl = null;

  function vorschauSchliessen() {
    dateiSchicht.classList.remove("open");
    dateiRahmen.innerHTML = "";
    if (vorschauUrl) { URL.revokeObjectURL(vorschauUrl); vorschauUrl = null; }
  }

  function vorschauZeigen(id) {
    dateiHolen(id).then(satz => {
      if (!satz) return showToast("Datei nicht gefunden", "warn");
      if (vorschauUrl) URL.revokeObjectURL(vorschauUrl);
      vorschauUrl = URL.createObjectURL(satz.inhalt);
      const art = dateiArt(satz);
      const koerper = art === "bild"
        ? `<img src="${vorschauUrl}" alt="${escapeHTML(satz.name)}">`
        : art === "pdf"
        ? `<iframe src="${vorschauUrl}" title="${escapeHTML(satz.name)}"></iframe>`
        : `<div class="dv-hinweis">Dieses Format l\u00e4sst sich im Browser nicht anzeigen.<br>
             In GoodNotes \u00fcber <b>Teilen \u2192 PDF</b> ausgeben, dann klappt die Vorschau.</div>`;
      dateiRahmen.innerHTML = `
        <div class="dv-kopf">
          <span class="dv-name">${escapeHTML(satz.name)}</span>
          <span class="dv-groesse">${groesseText(satz.groesse)}</span>
          <a class="dv-knopf" href="${vorschauUrl}" download="${escapeHTML(satz.name)}">Speichern</a>
          <button type="button" class="dv-zu" aria-label="Schlie\u00dfen">\u2715</button>
        </div>
        <div class="dv-koerper">${koerper}</div>`;
      dateiRahmen.querySelector(".dv-zu").addEventListener("click", vorschauSchliessen);
      dateiSchicht.classList.add("open");
    });
  }

  /* Faellt eine Datei daneben, oeffnet der Browser sie sonst im Tab
     und die Seite ist weg. */
  ["dragover", "drop"].forEach(art =>
    window.addEventListener(art, e => { if (!e.target.closest(".lp-ablage")) e.preventDefault(); }));

  dateiSchicht.addEventListener("mousedown", e => {
    if (e.target === dateiSchicht) vorschauSchliessen();
  });

  /* ---------- Lerntage einer Klausur ----------
     Abgehakte Tage stehen als Datum am Eintrag. Daraus entsteht das
     Fortschrittsbild: ein Kasten je Tag im Vorbereitungsfenster. */
  const LERN_FENSTER_MAX = 70;   // laenger wird das Gitter unuebersichtlich
  const TAG_MS = 86400000;

  function lernTage(k) {
    return Array.isArray(k.gelernt) ? k.gelernt : [];
  }

  function lernStand(k) {
    const gelernt = lernTage(k);
    const heute = todayStr();
    const zielD = new Date(k.date + "T00:00:00");

    /* Fenster: vom ersten Lerntag — spaetestens ab heute — bis zur
       Klausur, aber nie laenger als LERN_FENSTER_MAX Kaesten. */
    const frueh = gelernt.length ? [...gelernt].sort()[0] : heute;
    let startD = new Date((frueh < heute ? frueh : heute) + "T00:00:00");
    let gesamt = Math.round((zielD - startD) / TAG_MS) + 1;
    if (gesamt > LERN_FENSTER_MAX) {
      startD = new Date(zielD.getTime() - (LERN_FENSTER_MAX - 1) * TAG_MS);
      gesamt = LERN_FENSTER_MAX;
    }
    gesamt = Math.max(1, gesamt);

    const heuteD = new Date(heute + "T00:00:00");
    const vergangen = Math.min(gesamt, Math.max(1, Math.round((heuteD - startD) / TAG_MS) + 1));
    const anzahl = gelernt.length;

    const aktuell = Math.min(100, Math.round(100 * anzahl / gesamt));

    /* Hochrechnung: bleibt das Tempo, wo landet es bis zur Klausur?
       Das rohe Verhaeltnis waere am ersten Tag entweder 0 oder 100 —
       ein einziger Haken sagt aber noch nichts ueber das Tempo. Drei
       gedachte Tage daempfen den Start, ihr Gewicht verschwindet mit
       jedem echten Tag. */
    const tempo = (anzahl + 1) / (vergangen + 3);
    const geschaetzt = Math.min(100,
      Math.round(100 * (anzahl + tempo * (gesamt - vergangen)) / gesamt));

    const tage = [];
    for (let i = 0; i < gesamt; i++) {
      const d = new Date(startD.getTime() + i * TAG_MS);
      const key = dateKey(d);
      tage.push({ key,
                  gelernt: gelernt.includes(key),
                  heute: key === heute,
                  vorbei: key < heute });
    }
    return { tage, anzahl, gesamt, vergangen, aktuell, geschaetzt,
             heuteGelernt: gelernt.includes(heute) };
  }

  function lernPanelZeichnen() {
    const panel = $("pgLernPanel");
    if (!panel) return;
    const k = lernKlausur ? klausuren.find(x => x.id === lernKlausur) : null;
    if (!k) {
      lernKlausur = null;
      panel.classList.remove("offen");
      panel.innerHTML = "";
      return;
    }

    const f = k.fach ? fachInfo(k.fach) : { lang: "Ohne Fach", kurz: "\u2014", ton: "grau" };
    const diff = daysUntil(k.date);
    const wtag = TAGE_LANG[new Date(k.date + "T00:00:00").getDay()];
    const lehrer = k.fach
      ? (STUNDENPLAN.find(l => l.fach === k.fach) || { lehrer: [] }).lehrer
          .map(x => LEHRER[x] || x).join(", ")
      : "";

    const feld = (name, wert) => wert
      ? `<div class="lp-feld"><span>${name}</span><b>${escapeHTML(String(wert))}</b></div>` : "";

    const stand = lernStand(k);
    const dateien = dateienVon(k);
    const karten = kartenVon(k.id);

    panel.className = "lern-panel offen ton-" + f.ton + " " + fristKlasse(diff);
    panel.innerHTML = `
      <div class="lp-kopf">
        <span class="lp-fach"><i></i>${escapeHTML(f.lang)}</span>
        ${istTest(k) ? '<span class="lp-marke">Test</span>' : ""}
        <span class="lp-frist">${diff >= 0 ? badgeFor(diff, k.date) : "vorbei"}</span>
        <button type="button" class="lp-zu" aria-label="Schlie\u00dfen">\u2715</button>
      </div>
      <h3 class="lp-titel">${escapeHTML(k.title)}</h3>
      <div class="lp-gitter">
        ${feld("Datum", wtag + ", " + fmtDate(k.date))}
        ${feld("Stunde", k.von ? blockName(k.von, k.bis || k.von) : "")}
        ${feld("Zeit", k.time)}
        ${feld("Raum", k.raum)}
        ${feld("Lehrer", lehrer)}
        ${k.fach && diff >= 0
          ? feld("Bis dahin", stundenBisKlausur(k.fach, k.date) + " Stunden Unterricht") : ""}
      </div>
      <div class="lp-material">
        <div class="lp-mat-kopf">Material<span>${(k.material || []).length}</span></div>
        <ul class="lp-mat-liste">${(k.material || []).map((m, i) =>
          `<li><span>${escapeHTML(m)}</span>
             <button type="button" class="lp-mat-weg" data-i="${i}" aria-label="Entfernen">\u2715</button></li>`
          ).join("") || '<li class="lp-mat-leer">Noch nichts hinterlegt</li>'}</ul>
        <form class="lp-mat-form">
          <input type="text" placeholder="Zusammenfassung, Buchseite, Link \u2026" autocomplete="off">
          <button type="submit">Hinzuf\u00fcgen</button>
        </form>
      </div>
      <button type="button" class="lp-haken${stand.heuteGelernt ? " an" : ""}" data-lp="gelernt">
        <span class="lh-box">\u2713</span>
        <span class="lh-text">${stand.heuteGelernt
          ? "Heute daf\u00fcr gelernt" : "Heute daf\u00fcr gelernt?"}</span>
        <span class="lh-zahl">${stand.anzahl} ${stand.anzahl === 1 ? "Tag" : "Tage"}</span>
      </button>

      <div class="fortschritt">
        <div class="fs-links">
          <div class="fs-titel">Vorbereitung</div>
          <div class="fs-text">Ein Kasten je Tag bis zum Termin \u2014 abgehakte leuchten.</div>
          <div class="fs-gitter">${stand.tage.map(t =>
            `<i class="fs-tag${t.gelernt ? " voll" : t.vorbei ? " vorbei" : ""}${
              t.heute ? " heute" : ""}" title="${fmtDate(t.key)}${t.gelernt ? " \u00b7 gelernt" : ""}"></i>`
            ).join("")}</div>
        </div>
        <div class="fs-rechts">
          <div class="fs-wert">
            <span class="fs-label">Aktuell</span>
            <b class="fs-zahl">${stand.aktuell}</b>
          </div>
          <div class="fs-wert">
            <span class="fs-label">Gesch\u00e4tzt</span>
            <b class="fs-zahl matt">${stand.geschaetzt}</b>
          </div>
        </div>
      </div>

      <div class="lp-dateien">
        <div class="lp-mat-kopf">Unterlagen<span>${dateien.length}</span></div>
        <div class="lp-ablage" data-lp="ablage">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/></svg>
          <span>Scans hierher ziehen oder <b>ausw\u00e4hlen</b></span>
          <small>Bilder und PDF lassen sich ansehen \u00b7 GoodNotes-Dateien werden abgelegt</small>
        </div>
        ${dateien.length ? `<ul class="lp-dateiliste">${dateien.map(d => `
          <li data-datei="${d.id}" class="art-${d.art || "sonst"}">
            <span class="ld-art">${d.art === "bild" ? "BILD" : d.art === "pdf" ? "PDF"
              : d.art === "goodnotes" ? "GN" : "DAT"}</span>
            <span class="ld-name">${escapeHTML(d.name)}</span>
            <span class="ld-groesse">${groesseText(d.groesse)}</span>
            <button type="button" class="ld-weg" aria-label="Entfernen">\u2715</button>
          </li>`).join("")}</ul>` : ""}
      </div>

      <div class="lp-karten">
        <div class="lp-mat-kopf">Lernkarten<span>${karten.length}</span></div>
        <div class="lk-zeile">
          <button type="button" class="lp-knopf" data-lp="karten">
            ${karten.length ? "Karten bearbeiten" : "Karten anlegen"}</button>
          <button type="button" class="lp-knopf stark" data-lp="abfrage"
            ${karten.length ? "" : "disabled"}>Abfragen</button>
        </div>
      </div>

      <div class="lp-fuss">
        <button type="button" class="lp-knopf" data-lp="kalender">Im Kalender zeigen</button>
      </div>`;

    /* Material haengt am Eintrag selbst und wandert mit ihm mit */
    const materialSichern = () => {
      klausurenSichern();
      baueLernen();
    };
    panel.querySelector(".lp-mat-form").addEventListener("submit", ev => {
      ev.preventDefault();
      const feld = ev.target.querySelector("input");
      const text = feld.value.trim();
      if (!text) return;
      k.material = (k.material || []).concat(text);
      feld.value = "";
      materialSichern();
      showToast(`Material hinzugef\u00fcgt: \u201e${text}"`);
    });
    panel.querySelectorAll(".lp-mat-weg").forEach(b => b.addEventListener("click", () => {
      k.material.splice(Number(b.dataset.i), 1);
      materialSichern();
    }));

    panel.querySelector(".lp-zu").addEventListener("click", () => {
      lernKlausur = null;
      lernPanelZeichnen();
    });
    panel.querySelector('[data-lp="gelernt"]').addEventListener("click", () => {
      const tage = lernTage(k).slice();
      const heute = todayStr();
      const i = tage.indexOf(heute);
      if (i >= 0) tage.splice(i, 1); else tage.push(heute);
      k.gelernt = tage;
      klausurenSichern();
      lernPanelZeichnen();
      showToast(i >= 0 ? "Lerntag zur\u00fcckgenommen"
                       : `Lerntag eingetragen \u2014 ${k.title}`);
    });
    /* ---- Unterlagen ---- */
    const ablage = panel.querySelector('[data-lp="ablage"]');
    const wahl = $("dateiWahl");
    ablage.addEventListener("click", () => {
      wahl.value = "";
      wahl.onchange = () => dateienAufnehmen(k, wahl.files);
      wahl.click();
    });
    ["dragenter", "dragover"].forEach(art => ablage.addEventListener(art, e => {
      e.preventDefault();
      ablage.classList.add("drueber");
    }));
    ["dragleave", "drop"].forEach(art => ablage.addEventListener(art, e => {
      e.preventDefault();
      ablage.classList.remove("drueber");
    }));
    ablage.addEventListener("drop", e => {
      if (e.dataTransfer && e.dataTransfer.files.length) dateienAufnehmen(k, e.dataTransfer.files);
    });

    panel.querySelectorAll("[data-datei]").forEach(li => {
      li.addEventListener("click", e => {
        if (e.target.closest(".ld-weg")) return;
        vorschauZeigen(li.dataset.datei);
      });
      li.querySelector(".ld-weg").addEventListener("click", () => {
        dateiEntfernen(li.dataset.datei).then(() => {
          k.dateien = dateienVon(k).filter(d => d.id !== li.dataset.datei);
          klausurenSichern();
          lernPanelZeichnen();
        });
      });
    });

    /* ---- Lernkarten ---- */
    panel.querySelector('[data-lp="karten"]').addEventListener("click", () => kartenOeffnen(k.id, "liste"));
    const abfrageKnopf = panel.querySelector('[data-lp="abfrage"]');
    if (!abfrageKnopf.disabled) {
      abfrageKnopf.addEventListener("click", () => kartenOeffnen(k.id, "abfrage"));
    }

    panel.querySelector('[data-lp="kalender"]').addEventListener("click", () => kalenderZeigen(k.date));
  }

  /* Gruppen der Lernseite. "wichtig" schlaegt alles andere: was in
     drei Tagen ansteht oder ganz oben in der Reihenfolge steht,
     gehoert nach vorn — egal ob Material da ist. */
  const LERN_GRUPPEN = [
    { id: "wichtig",  titel: "Wichtig",                unter: "Das solltest du zuerst angehen" },
    { id: "offen",    titel: "Material fehlt",         unter: "Hier ist noch nichts hinterlegt" },
    { id: "bereit",   titel: "Material hinzugefügt", unter: "Vorbereitung liegt bereit" }
  ];

  const hatMaterial = k => Array.isArray(k.material) && k.material.length > 0;
  const istLK = k => !!k.fach && k.fach.slice(0, 2).toUpperCase() === "LK";

  /* ==========================================================
     HAUSAUFGABEN
     Bewertet wird wie bei den Klausuren: wie nah die Frist ist,
     wie wichtig die Aufgabe eingestuft wurde und ob sie zu einem
     Leistungskurs gehört. Überfälliges steht immer oben.
     ========================================================== */
  const HA_STUFEN = { 1: "Normal", 2: "Wichtig", 3: "Sehr wichtig" };
  const offeneHausaufgaben = () => hausaufgaben.filter(h => !h.erledigt);

  function hausPunkte(h) {
    const tage = daysUntil(h.date);
    const naehe = tage < 0 ? 180 : 100 / (tage + 1);
    const stufe = 0.8 + 0.35 * (h.wichtig || 1);       // 1,15 · 1,50 · 1,85
    const gewicht = istLK(h) ? 1.6 : 1;
    return naehe * stufe * gewicht;
  }

  /* Kurze Begründung, damit die Reihenfolge nachvollziehbar bleibt */
  function hausGrund(h) {
    const tage = daysUntil(h.date);
    const teile = [tage < 0 ? "überfällig"
                 : tage === 0 ? "heute fällig"
                 : tage === 1 ? "morgen fällig"
                 : "in " + tage + " Tagen fällig"];
    if ((h.wichtig || 1) > 1) teile.push(HA_STUFEN[h.wichtig].toLowerCase());
    if (istLK(h)) teile.push("Leistungskurs");
    return teile.join(" · ");
  }

  const HA_GRUPPEN = [
    { id: "jetzt",   titel: "Jetzt dran",   unter: "Überfällig oder heute fällig" },
    { id: "woche",   titel: "Diese Woche",  unter: "In den nächsten sieben Tagen" },
    { id: "spaeter", titel: "Später",       unter: "Hat noch Zeit" }
  ];

  function hausGruppe(h) {
    const tage = daysUntil(h.date);
    if (tage <= 0) return "jetzt";
    return tage <= 7 ? "woche" : "spaeter";
  }

  /* Abhaken statt löschen: erledigte Aufgaben bleiben im Bestand,
     verschwinden aber aus Liste und Kalender. */
  function hausAbhaken(id) {
    const h = hausaufgaben.find(x => x.id === id);
    if (!h) return;
    h.erledigt = !h.erledigt;
    /* Wann sie fertig wurde — ohne dieses Datum lässt sich später
       nicht sagen, ob sie rechtzeitig fertig war oder erst danach. */
    if (h.erledigt) { h.fertigAm = todayStr(); nutzAktion("hausaufgabe_fertig"); }
    else delete h.fertigAm;
    store.set("lifeos_hausaufgaben", hausaufgaben);
  }

  /* Nur was geplant ist — Vergangenes hat auf der Lernseite nichts
     mehr verloren. */
  const geplanteKlausuren = (nurTests) => klausuren
    .filter(k => daysUntil(k.date) >= 0)
    .filter(k => nurTests === undefined || istTest(k) === !!nurTests)
    .sort((a, b) => a.date.localeCompare(b.date));

  /* ---------- Was zuerst lernen? ----------
     Vier Dinge zaehlen: wie nah die Klausur ist, wie viele Stunden
     des Kurses noch davor liegen, ob schon Material bereitliegt und
     ob es ein Leistungskurs ist. Daraus entsteht eine Reihenfolge,
     die neben jeder Zeile als Nummer steht. */
  function lernPunkte(k) {
    const tage = Math.max(0, daysUntil(k.date));
    const naehe = 100 / (tage + 1);
    const stunden = k.fach ? stundenBisKlausur(k.fach, k.date) : 0;
    const knapp = 1 + 1 / (stunden + 1);      // wenig Unterricht davor draengt
    const material = hatMaterial(k) ? 0.75 : 1.15;
    /* Ein Leistungskurs zaehlt im Abitur doppelt — hier genauso */
    const gewicht = istLK(k) ? 2 : 1;
    return naehe * knapp * material * gewicht;
  }

  /* Kurze Begruendung, damit die Reihenfolge nachvollziehbar bleibt */
  function lernGrund(k) {
    const tage = daysUntil(k.date);
    const teile = [tage === 0 ? "heute" : tage === 1 ? "morgen" : "in " + tage + " Tagen"];
    if (!hatMaterial(k)) teile.push("kein Material");
    if (k.fach) {
      const st = stundenBisKlausur(k.fach, k.date);
      if (st === 0) teile.push("keine Stunde mehr davor");
      else if (st <= 2) teile.push("nur noch " + st + (st === 1 ? " Stunde" : " Stunden"));
    }
    if (istLK(k)) teile.push("Leistungskurs");
    return teile.join(" · ");
  }

  /* Welcher Reiter auf der Lernseite offen ist */
  let lernReiter = store.get("lifeos_lern_reiter", "klausuren");

  /* Welcher Behälter zu welchem Reiter gehört — für die
     Fehleranzeige unten. Dieselbe Zuordnung wie in reiterAnwenden. */
  const LERN_BEHAELTER = {
    klausuren: "pgLernGruppen", tests: "pgLernGruppen",
    hausaufgaben: "pgHausGruppen", themen: "pgThemenGruppen"
  };

  function lernFehlerZeigen(fehler) {
    console.error("[Lernseite]", fehler);
    const id = LERN_BEHAELTER[lernReiter] || "pgLernGruppen";
    const behaelter = $(id);
    if (!behaelter) return;
    behaelter.innerHTML =
      `<div class="block lern-leer lern-fehler">
         <div class="ll-titel">Diese Ansicht ist abgestürzt</div>
         <div class="ll-text">Etwas in den Daten hat das Zeichnen unterbrochen — deine
           Einträge sind deshalb nicht weg, nur gerade nicht zu sehen. Die Meldung
           unten sagt genau, woran es lag.</div>
         <pre class="lern-fehler-text">${escapeHTML(String((fehler && fehler.message) || fehler))}</pre>
         <button type="button" class="lp-knopf" data-lern-neu-laden="1">Seite neu laden</button>
       </div>`;
    const knopf = behaelter.querySelector("[data-lern-neu-laden]");
    if (knopf) knopf.addEventListener("click", () => location.reload());
  }

  function baueLernen() {
    /* Alles hier drin, auch das Umschalten der Reiter-Klassen — ein
       Fehler dort ließe die Anzeige sonst genauso stumm leer wie
       einer beim eigentlichen Zeichnen. */
    try {
      reiterAnwenden();
      faelligAuffrischen();
      if (lernReiter === "hausaufgaben") { hausPanelZeichnen(); baueHausaufgaben(); }
      else if (lernReiter === "themen") { themaPanelZeichnen(); baueThemen(); }
      else baueLernKlausuren();
    } catch (fehler) {
      lernFehlerZeigen(fehler);
    }
  }

  function reiterAnwenden() {
    document.querySelectorAll("#lernReiter [data-lreiter]").forEach(b =>
      b.classList.toggle("active", b.dataset.lreiter === lernReiter));
    /* Je Reiter ein Paar aus Unterfenster und Liste — sichtbar ist
       immer nur das des offenen Reiters. */
    /* Klausuren und Tests benutzen dasselbe Unterfenster und
       dieselbe Liste — sie unterscheiden sich nur darin, was
       gefiltert wird. */
    const zeigen = {
      klausuren:    ["pgLernPanel", "pgLernGruppen"],
      tests:        ["pgLernPanel", "pgLernGruppen"],
      hausaufgaben: ["pgHausPanel", "pgHausGruppen"],
      themen:       ["pgThemaPanel", "pgThemenGruppen"]
    };
    /* Klausuren und Tests zeigen auf dieselben zwei Behälter. Über
       die Reiter einzeln zu iterieren hieße: wer zuletzt geprüft
       wird, gewinnt — und "tests" kommt nach "klausuren", also
       stand der Behälter bei jedem Blick auf die Klausuren wieder
       auf "aus", egal was direkt zuvor galt. Deshalb erst pro
       Behälter zusammentragen, ob IRGENDEIN Reiter, der auf ihn
       zeigt, gerade der offene ist. */
    const sichtbar = new Map();
    Object.entries(zeigen).forEach(([reiter, felder]) => {
      felder.forEach(id => {
        if (reiter === lernReiter) sichtbar.set(id, true);
        else if (!sichtbar.has(id)) sichtbar.set(id, false);
      });
    });
    sichtbar.forEach((istOffen, id) => {
      const e = $(id);
      if (e) e.classList.toggle("aus", !istOffen);
    });
    /* Der Plus-Knopf sagt, was er anlegt — er hängt am Reiter. */
    const plus = $("lernPlus");
    if (plus) {
      const was = lernReiter === "hausaufgaben" ? "Hausaufgabe"
                : lernReiter === "themen" ? "Thema"
                : lernReiter === "tests" ? "Test" : "Klausur";
      plus.title = was + " anlegen";
      plus.setAttribute("aria-label", was + " anlegen");
    }
  }

  document.querySelectorAll("#lernReiter [data-lreiter]").forEach(b =>
    b.addEventListener("click", () => {
      lernReiter = b.dataset.lreiter;
      store.set("lifeos_lern_reiter", lernReiter);
      baueLernen();
    }));

  /* Das Plus legt an, was zum offenen Reiter passt — dieselben
     Fenster wie über die Suche, nur ohne Umweg. */
  const lernPlus = $("lernPlus");
  if (lernPlus) lernPlus.addEventListener("click", () => {
    if (lernReiter === "themen") return entwurfStarten("thema", "Neues Thema");
    if (lernReiter === "hausaufgaben") return sucheMitBefehl("/hausaufgaben neu ");
    if (lernReiter === "tests") return sucheMitBefehl("/tests neu ");
    sucheMitBefehl("/klausuren neu ");
  });

  /* ==========================================================
     EIGENE THEMEN
     Was man lernt, ohne dass eine Klausur dahintersteht. Sie
     brauchen weniger als eine Klausur: einen Namen, Karten, und
     wenn man mag ein Datum. Kein Fach, keine Stunde, kein Raum —
     die kommen aus einem Stundenplan, den es hier nicht gibt.
     ========================================================== */
  let offenesThema = null;

  const themaVon = id => themen.find(t => t.id === id) || null;
  const themenSichern = () => store.set("lifeos_themen", themen);

  /* ---------- Stapel ohne Besitzer ----------
     Wird eine Klausur gelöscht, gehen ihre Karten normalerweise mit.
     Bleibt einmal einer übrig — durch einen Abgleich von zwei Geräten
     oder weil eine Liste zurückgesetzt wurde —, hängt er in der Luft:
     kein Fenster führt hin, und in der Tagesportion würde man nach
     Karten gefragt, deren Klausur es nicht mehr gibt.

     Deshalb stehen sie sichtbar unter „Sonstiges", mit genau zwei
     Wegen: als eigenes Thema übernehmen oder wegwerfen. */
  function verwaisteStapel() {
    return Object.entries(lernkarten)
      .filter(([id, karten]) => Array.isArray(karten) && karten.length
        && !klausuren.some(k => k.id === id)
        && !themen.some(t => t.id === id))
      .map(([id, karten]) => ({
        id,
        anzahl: karten.length,
        /* Ein Name aus dem, was auf den Karten steht — besser als
           „Stapel 1". */
        name: (karten.find(c => c && c.thema) || {}).thema || "Übernommene Karten"
      }));
  }

  function stapelUebernehmen(alt, name) {
    const karten = lernkarten[alt];
    if (!Array.isArray(karten) || !karten.length) return null;
    const neu = { id: "t" + Date.now().toString(36), title: name, date: "", notiz: "" };
    themen.unshift(neu);
    /* Die Karten behalten ihre Kennungen — damit bleibt auch der
       Lernplan gültig, den sie schon haben. */
    lernkarten[neu.id] = karten;
    delete lernkarten[alt];
    themenSichern();
    kartenSichern();
    return neu;
  }

  function themenSortiert() {
    /* Mit Datum zuerst und nach Nähe, danach der Rest alphabetisch —
       was eine Frist hat, drängt. */
    const mit = themen.filter(t => t.date).sort((a, b) => a.date.localeCompare(b.date));
    const ohne = themen.filter(t => !t.date)
      .sort((a, b) => String(a.title).localeCompare(String(b.title), "de"));
    return mit.concat(ohne);
  }

  function themaAnlegen(titel, datum) {
    const name = String(titel || "").trim();
    if (!name) return null;
    const t = { id: "t" + Date.now().toString(36), title: name, date: datum || "", notiz: "" };
    themen.push(t);
    themenSichern();
    nutzAktion("thema");
    return t;
  }

  function themaLoeschen(id) {
    themen = themen.filter(t => t.id !== id);
    themenSichern();
    /* Die Karten des Themas gehen mit — sie hingen nur daran. */
    if (lernkarten[id]) { delete lernkarten[id]; kartenSichern(); }
    if (offenesThema === id) offenesThema = null;
  }

  /* Vom Dashboard-Widget aus zum Thema springen */
  function themaZeigen(id) {
    offenesThema = id;
    lernReiter = "themen";
    store.set("lifeos_lern_reiter", lernReiter);
    seiteZeigen("lernen");
    baueLernen();
  }

  /* Der Kasten mit den herrenlosen Stapeln — er hängt unter der
     Themenliste und ist meistens gar nicht da. */
  function verwaisteHtml() {
    const weg = verwaisteStapel();
    if (!weg.length) return "";
    const karten = weg.reduce((s, x) => s + x.anzahl, 0);
    return `<div class="block lern-gruppe">
      <div class="block-kopf"><h3>Karten ohne Thema</h3>
        <span class="block-zahl">${karten}</span></div>
      <div class="block-unter">Diese Stapel gehörten zu Klausuren, die es nicht mehr gibt.
        Abgefragt werden sie erst wieder, wenn sie ein Thema haben.</div>
      <ul class="voll-liste">${weg.map(x => `
        <li class="voll-zeile ton-grau">
          <span class="vz-punkt termin"></span>
          <div class="vz-haupt">
            <div class="vz-titel">${escapeHTML(x.name)}</div>
            <div class="vz-sub">${x.anzahl} ${x.anzahl === 1 ? "Karte" : "Karten"} · ohne Klausur</div>
          </div>
          <button type="button" class="vw-knopf" data-vw-nimm="${escapeHTML(x.id)}">Als Thema übernehmen</button>
          <button type="button" class="vz-del" data-vw-weg="${escapeHTML(x.id)}"
            aria-label="Stapel löschen">✕</button>
        </li>`).join("")}</ul>
    </div>`;
  }

  function verwaisteBinden(behaelter) {
    behaelter.querySelectorAll("[data-vw-nimm]").forEach(b =>
      b.addEventListener("click", () => {
        const alt = b.dataset.vwNimm;
        const eintrag = verwaisteStapel().find(x => x.id === alt);
        const neu = stapelUebernehmen(alt, eintrag ? eintrag.name : "Übernommene Karten");
        if (!neu) return;
        offenesThema = neu.id;
        themaPanelZeichnen();
        baueThemen();
        faelligAuffrischen();
        showToast("Als Thema „" + neu.title + "“ übernommen.", "success");
      }));

    behaelter.querySelectorAll("[data-vw-weg]").forEach(b =>
      b.addEventListener("click", () => {
        const id = b.dataset.vwWeg;
        const anzahl = (lernkarten[id] || []).length;
        if (!confirm(anzahl + " Karten endgültig löschen?")) return;
        delete lernkarten[id];
        kartenSichern();
        baueThemen();
        faelligAuffrischen();
        showToast(anzahl + " Karten gelöscht");
      }));
  }

  function baueThemen() {
    const behaelter = $("pgThemenGruppen");
    if (!behaelter) return;
    const liste = themenSortiert();
    const verwaist = verwaisteHtml();

    if (!liste.length) {
      $("lernenSub").textContent = "Keine eigenen Themen";
      behaelter.innerHTML =
        `<div class="block lern-leer">
           <div class="ll-titel">Noch kein eigenes Thema</div>
           <div class="ll-text">Alles, was du lernst, ohne dass eine Klausur dahintersteht —
             eine Sprache, ein Kapitel nebenher, die Theorieprüfung.
             Über das <b>+</b> oben rechts oder mit <b>/themen neu</b>.</div>
         </div>` + verwaist;
      verwaisteBinden(behaelter);
      return;
    }

    $("lernenSub").textContent = liste.length + (liste.length === 1 ? " Thema" : " Themen");
    behaelter.innerHTML =
      `<div class="block lern-gruppe">
         <div class="block-kopf"><h3>Eigene Themen</h3>
           <span class="block-zahl">${liste.length}</span></div>
         <ul class="voll-liste">${liste.map(t => {
           const anzahl = kartenVon(t.id).length;
           const tage = t.date ? daysUntil(t.date) : null;
           return `<li class="voll-zeile ton-grau klickbar${
                       offenesThema === t.id ? " empfohlen" : ""}${
                       tage !== null ? " " + fristKlasse(tage) : ""}" data-thema="${t.id}">
             <span class="vz-punkt termin"></span>
             <div class="vz-haupt">
               <div class="vz-titel">${escapeHTML(t.title)}</div>
               <div class="vz-sub">${anzahl ? anzahl + (anzahl === 1 ? " Karte" : " Karten")
                                             : "noch keine Karten"}${
                 t.date ? " · " + fmtDate(t.date) : ""}</div>
             </div>
             ${t.date ? `<span class="vz-badge">${badgeFor(tage, t.date)}</span>` : ""}
             <button class="vz-del" data-thema-weg="${t.id}" aria-label="Thema löschen">✕</button>
           </li>`; }).join("")}
         </ul>
       </div>` + verwaist;

    verwaisteBinden(behaelter);

    behaelter.querySelectorAll("[data-thema]").forEach(li =>
      li.addEventListener("click", e => {
        if (e.target.closest("[data-thema-weg]")) return;
        offenesThema = li.dataset.thema;
        themaPanelZeichnen();
        baueThemen();
      }));

    behaelter.querySelectorAll("[data-thema-weg]").forEach(b =>
      b.addEventListener("click", e => {
        e.stopPropagation();
        const t = themaVon(b.dataset.themaWeg);
        themaLoeschen(b.dataset.themaWeg);
        themaPanelZeichnen();
        baueThemen();
        renderNaechste();
        if (t) showToast(`Thema „${t.title}" gelöscht`);
      }));
  }

  function themaPanelZeichnen() {
    const panel = $("pgThemaPanel");
    if (!panel) return;
    const t = offenesThema ? themaVon(offenesThema) : null;
    /* Ob der Reiter gerade dran ist, entscheidet reiterAnwenden —
       das darf hier nicht verlorengehen. */
    const aus = panel.classList.contains("aus") ? " aus" : "";
    if (!t) { panel.innerHTML = ""; panel.className = "lern-panel leer" + aus; return; }

    const anzahl = kartenVon(t.id).length;
    const tage = t.date ? daysUntil(t.date) : null;

    /* Ohne "offen" bleibt das Unterfenster auf display:none stehen —
       es war gefüllt, aber unsichtbar, und das Thema ließ sich nach
       dem Anlegen mit nichts mehr bedienen. Klausuren und
       Hausaufgaben setzen ihre Klassen an derselben Stelle. */
    panel.className = "lern-panel offen ton-grau" + aus
                    + (tage !== null ? " " + fristKlasse(tage) : "");

    panel.innerHTML = `
      <div class="lp-kopf">
        <span class="lp-fach"><i></i>Eigenes Thema</span>
        ${t.date ? `<span class="lp-frist">${badgeFor(tage, t.date)}</span>` : ""}
        <button type="button" class="lp-zu" data-tp="zu" aria-label="Schließen">✕</button>
      </div>
      <div class="lp-titel">${escapeHTML(t.title)}</div>

      <div class="lp-gitter">
        <label class="lp-feld tp-datum">
          <span>Termin</span>
          <input type="date" data-tp="datum" value="${escapeHTML(t.date || "")}">
        </label>
        <div class="lp-feld">
          <span>Karten</span>
          <b>${anzahl || "—"}</b>
        </div>
        ${t.date ? `<div class="lp-feld">
          <span>Noch</span>
          <b>${tage < 0 ? "vorbei" : tage === 0 ? "heute"
            : tage + (tage === 1 ? " Tag" : " Tage")}</b>
        </div>` : ""}
      </div>

      <label class="lp-feld tp-notiz">
        <span>Notiz</span>
        <textarea data-tp="notiz" rows="2"
          placeholder="Was gehört dazu?">${escapeHTML(t.notiz || "")}</textarea>
      </label>

      <div class="lp-fuss">
        <button type="button" class="lp-knopf stark" data-tp="karten">Karten anlegen</button>
        <button type="button" class="lp-knopf" data-tp="abfrage"${anzahl ? "" : " disabled"}>Abfragen</button>
      </div>`;

    panel.querySelector('[data-tp="zu"]').addEventListener("click", () => {
      offenesThema = null; themaPanelZeichnen(); baueThemen();
    });

    panel.querySelector('[data-tp="datum"]').addEventListener("change", e => {
      t.date = e.target.value || "";
      themenSichern();
      themaPanelZeichnen();
      baueThemen();
      renderNaechste();
      if (aktuelleSeite === "kalender") baueKalender();
    });

    panel.querySelector('[data-tp="notiz"]').addEventListener("input", e => {
      t.notiz = e.target.value;
      themenSichern();
    });

    panel.querySelector('[data-tp="karten"]')
      .addEventListener("click", () => kartenOeffnen(t.id, "liste"));
    const ab = panel.querySelector('[data-tp="abfrage"]');
    if (ab && !ab.disabled) ab.addEventListener("click", () => kartenOeffnen(t.id, "abfrage"));
  }

  /* ==========================================================
     HAUSAUFGABEN-PANEL
     Dasselbe Unterfenster wie bei den Klausuren, nur auf das
     zugeschnitten, was eine Hausaufgabe braucht: Notizen und
     Blätter. Gelernt-Tage und Lernkarten gibt es hier nicht.
     ========================================================== */
  let hausOffen = null;

  function hausPanelZeichnen() {
    const panel = $("pgHausPanel");
    if (!panel) return;
    const h = hausOffen ? hausaufgaben.find(x => x.id === hausOffen) : null;
    if (!h) {
      hausOffen = null;
      panel.classList.remove("offen");
      panel.innerHTML = "";
      return;
    }

    const f = h.fach ? fachInfo(h.fach) : { lang: "Ohne Fach", kurz: "—", ton: "grau" };
    const diff = daysUntil(h.date);
    const wtag = TAGE_LANG[new Date(h.date + "T00:00:00").getDay()];
    const stufe = h.wichtig || 1;
    const notizen = Array.isArray(h.notizen) ? h.notizen : [];
    const dateien = dateienVon(h);
    const lehrer = h.fach
      ? (STUNDENPLAN.find(l => l.fach === h.fach) || { lehrer: [] }).lehrer
          .map(x => LEHRER[x] || x).join(", ")
      : "";

    const feld = (name, wert) => wert
      ? `<div class="lp-feld"><span>${name}</span><b>${escapeHTML(String(wert))}</b></div>` : "";

    panel.className = "lern-panel offen ton-" + f.ton + " " + hausFrist(diff);
    panel.innerHTML = `
      <div class="lp-kopf">
        <span class="lp-fach"><i></i>${escapeHTML(f.lang)}</span>
        <span class="lp-frist">${badgeFor(diff, h.date)}</span>
        <button type="button" class="lp-zu" aria-label="Schließen">✕</button>
      </div>
      <h3 class="lp-titel">${escapeHTML(h.title)}</h3>
      <div class="lp-gitter">
        ${feld("Fällig", wtag + ", " + fmtDate(h.date))}
        ${feld("Fach", f.kurz)}
        ${feld("Lehrer", lehrer)}
      </div>

      <div class="lp-material">
        <div class="lp-mat-kopf">Notizen<span>${notizen.length}</span></div>
        <ul class="lp-mat-liste">${notizen.map((n, i) =>
          `<li><span>${escapeHTML(n)}</span>
             <button type="button" class="lp-mat-weg" data-i="${i}" aria-label="Entfernen">✕</button></li>`
          ).join("") || '<li class="lp-mat-leer">Noch nichts notiert</li>'}</ul>
        <form class="lp-mat-form">
          <input type="text" placeholder="Seite, Aufgabe, was zu tun ist …" autocomplete="off">
          <button type="submit">Hinzufügen</button>
        </form>
      </div>

      <div class="lp-dateien">
        <div class="lp-mat-kopf">Blätter<span>${dateien.length}</span></div>
        <div class="lp-ablage" data-lp="ablage">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/></svg>
          <span>Blätter hierher ziehen oder <b>auswählen</b></span>
          <small>Bilder und PDF lassen sich ansehen · GoodNotes-Dateien werden abgelegt</small>
        </div>
        ${dateien.length ? `<ul class="lp-dateiliste">${dateien.map(d => `
          <li data-datei="${d.id}" class="art-${d.art || "sonst"}">
            <span class="ld-art">${d.art === "bild" ? "BILD" : d.art === "pdf" ? "PDF"
              : d.art === "goodnotes" ? "GN" : "DAT"}</span>
            <span class="ld-name">${escapeHTML(d.name)}</span>
            <span class="ld-groesse">${groesseText(d.groesse)}</span>
            <button type="button" class="ld-weg" aria-label="Entfernen">✕</button>
          </li>`).join("")}</ul>` : ""}
      </div>

      <button type="button" class="lp-haken" data-lp="erledigt">
        <span class="lh-box">✓</span>
        <span class="lh-text">Erledigt</span>
      </button>

      <div class="lp-fuss">
        <button type="button" class="lp-knopf ha-stufe stufe-${stufe}" data-lp="wichtig">${HA_STUFEN[stufe]}</button>
        <button type="button" class="lp-knopf" data-lp="kalender">Im Kalender zeigen</button>
      </div>`;

    const sichern = () => {
      store.set("lifeos_hausaufgaben", hausaufgaben);
      hausPanelZeichnen();
      baueHausaufgaben();
    };

    panel.querySelector(".lp-zu").addEventListener("click", () => {
      hausOffen = null;
      hausPanelZeichnen();
    });

    /* ---- Notizen ---- */
    panel.querySelector(".lp-mat-form").addEventListener("submit", ev => {
      ev.preventDefault();
      const feldEl = ev.target.querySelector("input");
      const text = feldEl.value.trim();
      if (!text) return;
      h.notizen = notizen.concat(text);
      feldEl.value = "";
      sichern();
      showToast(`Notiz hinzugefügt: „${text}"`);
    });
    panel.querySelectorAll(".lp-mat-weg").forEach(b => b.addEventListener("click", () => {
      h.notizen = notizen.filter((_, i) => i !== Number(b.dataset.i));
      sichern();
    }));

    /* ---- Blätter ---- */
    const ablage = panel.querySelector('[data-lp="ablage"]');
    const wahl = $("dateiWahl");
    ablage.addEventListener("click", () => {
      wahl.value = "";
      wahl.onchange = () => dateienAufnehmen(h, wahl.files, "hausaufgabe");
      wahl.click();
    });
    ["dragenter", "dragover"].forEach(art => ablage.addEventListener(art, e => {
      e.preventDefault();
      ablage.classList.add("drueber");
    }));
    ["dragleave", "drop"].forEach(art => ablage.addEventListener(art, e => {
      e.preventDefault();
      ablage.classList.remove("drueber");
    }));
    ablage.addEventListener("drop", e => {
      if (e.dataTransfer && e.dataTransfer.files.length)
        dateienAufnehmen(h, e.dataTransfer.files, "hausaufgabe");
    });

    panel.querySelectorAll("[data-datei]").forEach(li => {
      li.addEventListener("click", e => {
        if (e.target.closest(".ld-weg")) return;
        vorschauZeigen(li.dataset.datei);
      });
      li.querySelector(".ld-weg").addEventListener("click", () => {
        dateiEntfernen(li.dataset.datei).then(() => {
          h.dateien = dateienVon(h).filter(d => d.id !== li.dataset.datei);
          sichern();
        });
      });
    });

    /* ---- Fuß ---- */
    panel.querySelector('[data-lp="wichtig"]').addEventListener("click", () => {
      h.wichtig = (h.wichtig || 1) % 3 + 1;
      sichern();
    });
    panel.querySelector('[data-lp="erledigt"]').addEventListener("click", () => {
      hausAbhaken(h.id);
      hausOffen = null;
      hausPanelZeichnen();
      baueHausaufgaben();
      if (aktuelleSeite === "kalender") baueKalender();
      renderNaechste();
      showToast("Hausaufgabe abgehakt", "success");
    });
    panel.querySelector('[data-lp="kalender"]').addEventListener("click", () => kalenderZeigen(h.date));
  }

  /* Aus dem Widget heraus direkt zum Hausaufgabenreiter */
  function hausaufgabenZeigen(id) {
    lernReiter = "hausaufgaben";
    store.set("lifeos_lern_reiter", lernReiter);
    if (id) hausOffen = id;
    seiteZeigen("lernen");
  }

  /* ---------- Reiter: Hausaufgaben ---------- */
  function baueHausaufgaben() {
    const behaelter = $("pgHausGruppen");
    if (!behaelter) return;
    behaelter.innerHTML = "";

    const alle = offeneHausaufgaben();
    if (!alle.length) {
      $("lernenSub").textContent = "Keine offenen Hausaufgaben";
      behaelter.innerHTML =
        `<div class="block lern-leer">
           <div class="ll-titel">Nichts offen</div>
           <div class="ll-text">Mit <b>/hausaufgaben neu</b> eine anlegen — oder im
             Stundenplan auf ein Fach klicken.</div>
         </div>`;
      return;
    }

    /* Eine Reihenfolge über alle Gruppen hinweg, damit die Nummern
       durchlaufen wie bei den Klausuren. */
    const reihenfolge = [...alle].sort((a, b) => hausPunkte(b) - hausPunkte(a));
    const rang = new Map(reihenfolge.map((h, i) => [h.id, i + 1]));
    const erste = reihenfolge[0];

    $("lernenSub").textContent =
      `${alle.length} offen · zuerst: ${erste.title} — ${hausGrund(erste)}`;

    HA_GRUPPEN.forEach(g => {
      const drin = alle.filter(h => hausGruppe(h) === g.id)
                       .sort((a, b) => rang.get(a.id) - rang.get(b.id));
      if (!drin.length) return;

      const block = document.createElement("div");
      block.className = "block lern-gruppe gruppe-" + g.id;
      block.innerHTML =
        `<div class="block-kopf">
           <h3>${g.titel}</h3>
           <span class="block-zahl">${drin.length}</span>
         </div>
         <div class="block-unter">${g.unter}</div>
         <ul class="voll-liste"></ul>`;
      const liste = block.querySelector(".voll-liste");

      drin.forEach(h => {
        const f = h.fach ? fachInfo(h.fach) : { lang: "Ohne Fach", kurz: "—", ton: "grau" };
        const diff = daysUntil(h.date);
        const stufe = h.wichtig || 1;
        const zuerst = h.id === erste.id;
        liste.appendChild(zeile(
          `<span class="vz-rang">${rang.get(h.id)}</span>
           <span class="vz-punkt"></span>
           <div class="vz-haupt">
             <div class="vz-titel">${escapeHTML(h.title)}${
               zuerst ? '<span class="vz-tipp">Zuerst</span>' : ""}</div>
             <div class="vz-sub">${escapeHTML(f.lang)} · ${escapeHTML(hausGrund(h))}</div>
           </div>
           <span class="ha-stufe stufe-${stufe}">${HA_STUFEN[stufe]}</span>
           <span class="vz-badge">${diff >= 0 ? badgeFor(diff, h.date) : "überfällig"}</span>
           <button type="button" class="ha-haken" data-haus="${h.id}"
             aria-label="Als erledigt abhaken">${HAKEN_SVG}</button>`,
          "ton-" + f.ton + " " + hausFrist(diff) + " klickbar" + (zuerst ? " empfohlen" : "")));
        liste.lastElementChild.dataset.oeffne = h.id;
      });

      /* Klick auf die Zeile öffnet das Unterfenster, der Haken hakt ab */
      liste.querySelectorAll("[data-oeffne]").forEach(li =>
        li.addEventListener("click", () => {
          hausOffen = li.dataset.oeffne;
          hausPanelZeichnen();
          $("pgHausPanel").scrollIntoView({ block: "nearest", behavior: "smooth" });
        }));
      liste.querySelectorAll("[data-haus]").forEach(b =>
        b.addEventListener("click", ev => {
          ev.stopPropagation();
          hausAbhaken(b.dataset.haus);
          if (hausOffen === b.dataset.haus) { hausOffen = null; hausPanelZeichnen(); }
          baueHausaufgaben();
          if (aktuelleSeite === "kalender") baueKalender();
          renderNaechste();
          showToast("Hausaufgabe abgehakt", "success");
        }));

      behaelter.appendChild(block);
    });
  }

  function baueLernKlausuren() {
    lernPanelZeichnen();

    const behaelter = $("pgLernGruppen");
    if (!behaelter) return;
    behaelter.innerHTML = "";

    const tests = lernReiter === "tests";
    const alle = geplanteKlausuren(tests);

    if (!alle.length) {
      $("lernenSub").textContent = "Nichts geplant";
      behaelter.innerHTML =
        `<div class="block lern-leer">
           <div class="ll-titel">${tests ? "Kein Test geplant" : "Keine Klausur geplant"}</div>
           <div class="ll-text">Mit <b>${tests ? "/tests neu" : "/klausuren neu"}</b> einen anlegen —
             Fach, Stunde und Raum kommen dann aus deinem Stundenplan.</div>
         </div>`;
      return;
    }

    /* Reihenfolge einmal fuer alle bilden, damit die Nummern ueber die
       Gruppen hinweg durchlaufen. */
    const reihenfolge = [...alle].sort((a, b) => lernPunkte(b) - lernPunkte(a));
    const rang = new Map(reihenfolge.map((k, i) => [k.id, i + 1]));
    const empfohlen = reihenfolge[0];

    $("lernenSub").textContent =
      `Als Nächstes: ${empfohlen.title} · ${lernGrund(empfohlen)}`;

    const gruppeVon = k => {
      if (k.id === empfohlen.id || daysUntil(k.date) <= 3) return "wichtig";
      return hatMaterial(k) ? "bereit" : "offen";
    };

    LERN_GRUPPEN.forEach(g => {
      const drin = alle.filter(k => gruppeVon(k) === g.id)
                       .sort((a, b) => rang.get(a.id) - rang.get(b.id));
      if (!drin.length) return;

      const block = document.createElement("div");
      block.className = "block lern-gruppe gruppe-" + g.id;
      block.innerHTML =
        `<div class="block-kopf">
           <h3>${g.titel}</h3>
           <span class="block-zahl">${drin.length}</span>
         </div>
         <div class="block-unter">${g.unter}</div>
         <ul class="voll-liste"></ul>`;
      const liste = block.querySelector(".voll-liste");

      drin.forEach(k => {
        const f = k.fach ? fachInfo(k.fach) : { lang: "Ohne Fach", kurz: "—", ton: "grau" };
        const diff = daysUntil(k.date);
        const zahl = hatMaterial(k) ? k.material.length : 0;
        const wo = klausurZusatz(k);
        const erster = k.id === empfohlen.id;
        liste.appendChild(zeile(
          `<span class="vz-rang">${rang.get(k.id)}</span>
           <span class="vz-punkt"></span>
           <div class="vz-haupt">
             <div class="vz-titel">${escapeHTML(k.title)}${
               erster ? '<span class="vz-tipp">Als N\u00e4chstes</span>' : ""}</div>
             <div class="vz-sub">${erster ? escapeHTML(lernGrund(k))
               : escapeHTML(f.lang) + " · " + fmtDate(k.date) + (wo ? " · " + escapeHTML(wo) : "")}</div>
           </div>
           <span class="vz-material${zahl ? " da" : ""}">${
             zahl ? zahl + (zahl === 1 ? " Material" : " Materialien") : "kein Material"}</span>
           <span class="vz-badge">${badgeFor(diff, k.date)}</span>`,
          "ton-" + f.ton + " " + fristKlasse(diff) + " klickbar" + (erster ? " empfohlen" : "")));
        liste.lastElementChild.addEventListener("click", () => {
          lernKlausur = k.id;
          lernPanelZeichnen();
          $("pgLernPanel").scrollIntoView({ block: "nearest", behavior: "smooth" });
        });
      });

      behaelter.appendChild(block);
    });

    /* Die Dauern gehören zu den Klausuren. Ein Test dauert eine
       Schulstunde — dafür braucht es keine Tabelle, nur einen Satz. */
    if (tests) {
      const hinweis = document.createElement("div");
      hinweis.className = "block";
      hinweis.innerHTML =
        `<div class="block-kopf"><h3>Wie lange dauert ein Test?</h3>
           <span class="block-zahl">${TEST_DAUER} min</span></div>
         <div class="block-unter">Eine Schulstunde, so steht er auch im Kalender.
           Für Klausuren lässt sich die Dauer je Fach einstellen — im Reiter daneben.</div>`;
      behaelter.appendChild(hinweis);
    } else {
      behaelter.appendChild(dauerBlock());
    }
  }

  /* ==========================================================
     KLAUSURDAUER JE FACH
     Steht unter den Klausuren, weil man sie dort braucht und sonst
     nirgends. Eingestellt wird nur, was vom Üblichen abweicht — die
     Vorgabe von 135 Minuten steht blass im Feld, solange nichts
     eigenes drin ist. Die Zeit wandert direkt in den Kalender.
     ========================================================== */
  function dauerBlock() {
    const block = document.createElement("div");
    block.className = "block dauer-block";

    const faecher = Object.keys(FAECHER || {});
    block.innerHTML =
      `<button type="button" class="block-kopf klappbar" id="dauerKopf"
               aria-expanded="false" aria-controls="dauerHuelle">
         <span class="block-pfeil" aria-hidden="true"></span>
         <h3>Wie lange dauert eine Klausur?</h3>
         <span class="block-zahl">${KLAUSUR_DAUER_VORGABE} min</span>
       </button>
       <div class="block-unterschlupf" id="dauerHuelle"><div>
         <div class="block-unter">Gilt je Fach und steht so im Kalender.
           Leer heißt ${KLAUSUR_DAUER_VORGABE} Minuten.</div>
         <ul class="dauer-liste">${faecher.map(id => {
           const f = fachInfo(id);
           const eigen = Number(klausurDauer[id]) > 0;
           return `<li class="ton-${f.ton}">
             <span class="dauer-punkt"></span>
             <span class="dauer-name">${escapeHTML(f.kurz)}</span>
             <span class="dauer-lang">${escapeHTML(f.lang)}</span>
             <span class="dauer-eingabe">
               <input type="number" min="5" max="600" step="5" data-dauer="${id}"
                      value="${eigen ? klausurDauer[id] : ""}"
                      placeholder="${KLAUSUR_DAUER_VORGABE}"
                      inputmode="numeric" aria-label="Dauer ${escapeHTML(f.kurz)} in Minuten">
               <em>min</em>
             </span>
             <span class="dauer-klar">${dauerText(dauerFuer(id))}</span>
           </li>`; }).join("")}
         </ul>
       </div></div>`;

    const kopf = block.querySelector("#dauerKopf");
    const huelle = block.querySelector("#dauerHuelle");
    kopf.addEventListener("click", () => {
      const auf = kopf.getAttribute("aria-expanded") !== "true";
      kopf.setAttribute("aria-expanded", auf ? "true" : "false");
      localStorage.setItem("lifeos_dauer_offen", auf ? "1" : "0");
      unterKlappen(huelle, auf, false);
    });
    /* Zustand von vorhin, ohne Überblendung */
    const warOffen = localStorage.getItem("lifeos_dauer_offen") === "1";
    kopf.setAttribute("aria-expanded", warOffen ? "true" : "false");
    unterKlappen(huelle, warOffen, true);

    block.querySelectorAll("[data-dauer]").forEach(feld => {
      feld.addEventListener("change", () => {
        dauerSetzen(feld.dataset.dauer, feld.value);
        const zeile = feld.closest("li");
        const klar = zeile.querySelector(".dauer-klar");
        if (klar) klar.textContent = dauerText(dauerFuer(feld.dataset.dauer));
        showToast(fachInfo(feld.dataset.dauer).kurz + ": "
                  + dauerText(dauerFuer(feld.dataset.dauer)), "success");
      });
    });
    return block;
  }

  /* ==========================================================
     LICHT — WLED
     Die Lichterketten hängen als eigene kleine Server im Netz. Der
     Browser fragt sie nicht selbst: über HTTPS wäre eine Anfrage an
     HTTP verboten, und der Server hier kann es ohnehin besser —
     er kennt alle Geräte und wartet nicht auf eines, das gerade
     stromlos ist.

     Gezeigt wird nur, was man täglich anfasst: an, Helligkeit,
     Effekt, Palette, Farben. Alles Weitere — Segmente, Zeitpläne,
     Netzwerkkram — steht in WLED selbst besser aufgehoben.
     ========================================================== */
  let lichtGeraete = [];
  let lichtOffen = null;          // welches Gerät ist aufgeklappt
  let lichtBearbeitet = null;     // bei welchem sind Name und Gruppe offen

  /* ==========================================================
     EIGENE NAMEN UND GRUPPEN
     Ein Gerät heißt im Netz so, wie es beim Einrichten getauft
     wurde — „WLED Luefter", „Effekt". Hier soll es heißen, wie man
     im Zimmer darüber spricht.

     Diese Namen bleiben ausdrücklich hier: an WLED wird nichts
     geschickt. Wer das Gerät über seine eigene App oder eine
     andere Anwendung ansieht, findet dort weiterhin den Namen, den
     es immer hatte — sonst würde ein Umbenennen hier still an
     Stellen wirken, die man gerade gar nicht im Blick hat.

     Gespeichert wird im Bestand, also auf allen Geräten gleich.
     ========================================================== */
  let lichtEigen = store.get("lifeos_licht_eigen", {});   // { ip: {name, gruppe} }

  const eigenSichern = () => store.set("lifeos_licht_eigen", lichtEigen);

  /* Der Name, der angezeigt wird: eigener, sonst der vom Gerät */
  const lichtName = g => (lichtEigen[g.ip] && lichtEigen[g.ip].name) || g.name || g.ip;
  const lichtGruppe = g => (lichtEigen[g.ip] && lichtEigen[g.ip].gruppe) || "";

  /* Alle vergebenen Gruppen, für die Vorschlagsliste */
  function lichtGruppen() {
    const raus = new Set();
    Object.values(lichtEigen).forEach(e => { if (e && e.gruppe) raus.add(e.gruppe); });
    return [...raus].sort((a, b) => a.localeCompare(b, "de"));
  }

  function eigenSetzen(ip, name, gruppe) {
    const eintrag = lichtEigen[ip] || {};
    const n = String(name || "").trim();
    const gr = String(gruppe || "").trim();
    if (n) eintrag.name = n; else delete eintrag.name;
    if (gr) eintrag.gruppe = gr; else delete eintrag.gruppe;
    if (Object.keys(eintrag).length) lichtEigen[ip] = eintrag;
    else delete lichtEigen[ip];
    eigenSichern();
  }
  let lichtListen = {};           // Effekt- und Palettennamen je Gerät
  let lichtLaeuft = false;
  let lichtEingelaufen = false;   // die Einlaufanimation gibt es einmal

  /* Wer am Regler zieht, erzeugt Dutzende Werte je Sekunde. An das
     Licht geht nur der letzte — sonst kommt es mit dem Antworten
     nicht nach und ruckelt. */
  const lichtWartet = new Map();

  function lichtSenden(ip, wunsch, sofort) {
    const alt = lichtWartet.get(ip);
    if (alt) clearTimeout(alt.uhr);
    const zusammen = { ...(alt ? alt.wunsch : {}), ...wunsch };

    const losschicken = () => {
      lichtWartet.delete(ip);
      fetch("/api/wled/setzen", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip, ...zusammen })
      })
        .then(a => a.json())
        .then(d => {
          if (!d.ok) throw new Error(d.fehler || "ging nicht");
          if (d.zustand) {
            const i = lichtGeraete.findIndex(g => g.ip === ip);
            if (i >= 0) { lichtGeraete[i] = d.zustand; lichtZeichnen(); }
          }
          /* Die Geräte hören einander zu: WLED verschickt Änderungen
             im Netz, und wer sie empfängt, zieht mit. Ein Griff hier
             kann deshalb drei Lichter umlegen — die Seite fragt
             danach alle nach, sonst stimmt sie bis zum Neuladen
             nicht. Nur bei echten Schaltvorgängen, nicht bei jedem
             Schritt am Regler. */
          if (zusammen.an != null || zusammen.umschalten
              || zusammen.effekt != null || zusammen.palette != null
              || zusammen.farben) lichtNachfassen();
        })
        .catch(f => showToast("Licht antwortet nicht: " + f.message, "warn"));
    };

    if (sofort) return losschicken();
    lichtWartet.set(ip, { wunsch: zusammen, uhr: setTimeout(losschicken, 120) });
  }

  /* ==========================================================
     NACHFASSEN
     Zwei Wege, auf denen sich ein Licht ändert, ohne dass diese
     Seite es veranlasst hat:

       – die Geräte hören einander zu und ziehen mit,
       – jemand greift zur WLED-App oder zu einem Taster.

     Beides sieht man hier sonst erst nach dem Neuladen. Deshalb
     wird nach jedem Schaltvorgang kurz nachgefragt, und solange die
     Seite offen liegt, auch von selbst alle acht Sekunden.
     ========================================================== */
  let lichtNachfassUhr = null;
  let lichtTakt = null;

  function lichtNachfassen() {
    if (lichtNachfassUhr) clearTimeout(lichtNachfassUhr);
    /* Kurz warten: die Sync-Nachrichten im Netz brauchen einen
       Moment, und ein sofortiger Abruf liefe ihnen davon. */
    lichtNachfassUhr = setTimeout(() => { lichtNachfassUhr = null; lichtHolen(true); }, 450);
  }

  function lichtTaktSetzen(an) {
    if (lichtTakt) { clearInterval(lichtTakt); lichtTakt = null; }
    if (!an) return;
    lichtTakt = setInterval(() => {
      /* Nicht dazwischenfunken, während jemand am Regler zieht oder
         ein Menü offen steht — sonst springt die Anzeige weg. */
      if (document.hidden || lichtWartet.size || auswahlOffen) return;
      lichtHolen(true);
    }, 8000);
  }

  function baueLicht() {
    lichtZeichnen();
    lichtHolen();
    lichtTaktSetzen(true);
  }

  /* `leise` heißt: kein Fehlerkasten, wenn gerade nichts geht — beim
     Nachfassen im Hintergrund wäre das nur störend. */
  function lichtHolen(leise) {
    if (lichtLaeuft) return;
    lichtLaeuft = true;
    fetch("/api/wled/geraete", { cache: "no-store" })
      .then(a => a.json())
      .then(d => {
        lichtLaeuft = false;
        if (!d.ok) throw new Error(d.fehler || "Liste nicht lesbar");
        lichtGeraete = d.geraete || [];

        /* Erst die Effektnamen holen, dann einmal zeichnen. Zeichnete
           man vorher und ließe jede eintreffende Liste neu zeichnen,
           liefe das Gitter zehnmal hintereinander neu auf — die
           Einlaufanimation würde jedes Mal abgeschnitten, und statt
           der Namen stünde kurz „Effekt 0" da. */
        const fehlen = lichtGeraete.filter(g => g.da && !lichtListen[g.ip]);
        if (!fehlen.length) return lichtZeichnen();
        Promise.all(fehlen.map(lichtListenHolen)).then(() => lichtZeichnen());
      })
      .catch(f => {
        lichtLaeuft = false;
        if (leise) return;                     // im Hintergrund still bleiben
        const gitter = $("lichtGitter");
        if (gitter) gitter.innerHTML =
          `<div class="block li-leer"><div class="ll-titel">Keine Verbindung</div>
             <div class="ll-text">${escapeHTML(f.message)}</div></div>`;
      });
  }

  /* Holt die Namen und legt sie ab — gezeichnet wird vom Aufrufer,
     wenn alle da sind. */
  function lichtListenHolen(g) {
    return fetch("/api/wled/listen?ip=" + encodeURIComponent(g.ip))
      .then(a => a.json())
      .then(d => {
        if (!d.ok) return;
        lichtListen[g.ip] = { effekte: d.effekte || [], paletten: d.paletten || [] };
      })
      .catch(() => { /* dann eben Nummern statt Namen */ });
  }

  /* Wie weit der Balken gefüllt ist. Ein Regler zeigt von sich aus
     nur einen Punkt auf einer Schiene — erst die gefüllte Strecke
     davor sagt auf einen Blick, wie hell es ist. CSS kann das nicht
     allein: die Zahl muss von hier kommen. */
  function fuellstand(regler) {
    const min = Number(regler.min) || 0;
    const max = Number(regler.max) || 100;
    const wert = Number(regler.value);
    const anteil = max > min ? ((wert - min) / (max - min)) * 100 : 0;
    regler.style.setProperty("--fuell", Math.max(0, Math.min(100, anteil)) + "%");
  }

  /* Aus [255,0,0] wird #ff0000 und zurück */
  const alsHex = c => "#" + (Array.isArray(c) ? c : [0, 0, 0]).slice(0, 3)
    .map(n => Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, "0")).join("");
  const ausHex = h => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(h || ""));
    if (!m) return [0, 0, 0];
    const z = parseInt(m[1], 16);
    return [(z >> 16) & 255, (z >> 8) & 255, z & 255];
  };

  /* ==========================================================
     UMSORTIEREN OHNE SPRUNG
     Schaltet man ein Licht ein, wandert seine Kachel vom unteren
     Abschnitt nach oben und wird dabei größer. Weil das Gitter neu
     geschrieben wird, geschieht das schlagartig — man sieht nicht,
     was wohin ging, und die Nachbarn springen mit.

     Deshalb werden vor dem Neuschreiben alle Positionen gemerkt.
     Danach bekommt jede Kachel den Weg, den sie zurückgelegt hat,
     als Startpunkt aufgedrückt und gleitet von dort an ihren neuen
     Platz. Das Auge folgt der Bewegung und weiß hinterher, welche
     Kachel welche war.
     ========================================================== */
  function positionenMerken(gitter) {
    const karte = new Map();
    gitter.querySelectorAll("[data-licht]").forEach(e => {
      const r = e.getBoundingClientRect();
      karte.set(e.dataset.licht, { x: r.left, y: r.top, b: r.width, h: r.height });
    });
    return karte;
  }

  function positionenGleiten(gitter, vorher) {
    if (!vorher || !vorher.size) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    gitter.querySelectorAll("[data-licht]").forEach(e => {
      const alt = vorher.get(e.dataset.licht);
      if (!alt) return;
      const neu = e.getBoundingClientRect();
      const dx = alt.x - neu.left;
      const dy = alt.y - neu.top;
      /* Unter einem Pixel lohnt keine Bewegung */
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;

      e.style.transition = "none";
      e.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        e.style.transition = "transform 0.42s cubic-bezier(0.22, 1, 0.36, 1)";
        e.style.transform = "";
        setTimeout(() => { e.style.transition = ""; }, 460);
      });
    });
  }

  /* `ohneGleiten` beim Auf- und Zuklappen: dort wächst die Karte
     selbst, und die gemessenen Zielpositionen der Nachbarn stimmen
     nicht mehr, sobald der Inhalt seine eigene Animation läuft.
     Beide zusammen ließen die Kacheln übereinander stehenbleiben. */
  function lichtZeichnen(ohneGleiten) {
    const gitter = $("lichtGitter");
    if (!gitter) return;
    const vorherigePlaetze = ohneGleiten ? null : positionenMerken(gitter);

    const erreichbar = lichtGeraete.filter(g => g.da);
    const an = erreichbar.filter(g => g.an).length;
    const sub = $("lichtSub");
    if (sub) {
      sub.textContent = !lichtGeraete.length ? "Noch nichts gefunden"
        : an + " von " + erreichbar.length + " an"
          + (lichtGeraete.length > erreichbar.length
             ? " · " + (lichtGeraete.length - erreichbar.length) + " nicht erreichbar" : "");
    }

    if (!lichtGeraete.length) {
      gitter.innerHTML =
        `<div class="block li-leer">
           <div class="ll-titel">Noch keine Lichter</div>
           <div class="ll-text">Oben auf <b>Suchen</b> tippen — das durchsucht das
             Heimnetz nach WLED-Geräten. Das dauert einen Moment.</div>
         </div>`;
      return;
    }

    /* Was an ist, steht oben und nimmt Platz ein — das ist der
       Zustand, den man verändern will. Was aus ist, rutscht nach
       unten und wird zur schmalen Zeile: da gibt es nichts
       einzustellen außer dem Einschalten. Nicht erreichbare Geräte
       ganz zuletzt, sie sind gerade ohnehin nicht zu ändern. */
    /* Innerhalb von An und Aus stehen die Geräte nach Gruppe
       beieinander — was zusammengehört, soll auch zusammenstehen.
       Ohne Gruppe ganz unten, sonst wäre die leere Gruppe die
       erste. */
    const rang = g => (!g.da ? 2 : g.an ? 0 : 1);
    const nachGruppe = g => lichtGruppe(g) || "￿";
    const sortiert = [...lichtGeraete].sort((a, b) =>
      rang(a) - rang(b)
      || nachGruppe(a).localeCompare(nachGruppe(b), "de")
      || lichtName(a).localeCompare(lichtName(b), "de"));

    const brennen = sortiert.filter(g => g.da && g.an);
    const dunkel = sortiert.filter(g => g.da && !g.an);
    const weg = sortiert.filter(g => !g.da);

    const abschnitt = (titel, liste, klasse) => liste.length
      ? `<div class="li-trenner ${klasse}"><span>${titel}</span><i>${liste.length}</i></div>`
        + liste.map(g => lichtKarte(g)).join("")
      : "";

    gitter.innerHTML =
      abschnitt("An", brennen, "ist-an")
      + abschnitt("Aus", dunkel, "ist-aus")
      + abschnitt("Nicht erreichbar", weg, "ist-weg")
      /* Schon vergebene Gruppen schlagen sich beim Tippen selbst
         vor — so entstehen keine zwei Schreibweisen derselben. */
      + `<datalist id="lichtGruppenListe">${lichtGruppen()
          .map(n => `<option value="${escapeHTML(n)}">`).join("")}</datalist>`;

    /* Einlaufen nur beim ersten Aufbau der Seite. Bei jedem
       Neuzeichnen — und das geschieht bei jedem Knopfdruck — würde
       die ganze Wand ständig neu hochspringen. Die Verzögerung je
       Kachel lässt sie nacheinander erscheinen statt alle auf
       einmal; sie ist gedeckelt, damit die zehnte nicht ewig
       braucht. */
    /* Erst wenn wirklich Kacheln dastehen. Beim ersten Zeichnen ist
       die Liste noch leer und es steht nur der Hinweis dort — der
       würde die einmalige Animation sonst aufbrauchen. */
    if (!lichtEingelaufen && gitter.querySelector(".li-karte")) {
      lichtEingelaufen = true;
      [...gitter.children].forEach((e, i) => {
        e.classList.add("laeuft-ein");
        e.style.setProperty("--verzug", Math.min(i * 45, 420) + "ms");
      });
      setTimeout(() => [...gitter.children].forEach(e => {
        e.classList.remove("laeuft-ein");
        e.style.removeProperty("--verzug");
      }), 1200);
    } else {
      /* Kein Einlauf mehr, aber vielleicht ist etwas umgezogen */
      positionenGleiten(gitter, vorherigePlaetze);
    }

    lichtBinden();
  }

  function lichtKarte(g) {
    if (!g.da) {
      const gr = lichtGruppe(g);
      return `<div class="block li-karte aus-dem-netz" data-licht="${escapeHTML(g.ip)}">
          <div class="li-kopf">
            <span class="li-punkt weg"></span>
            <div class="li-name"><b>${escapeHTML(lichtName(g))}${
              gr ? `<span class="li-gruppe">${escapeHTML(gr)}</span>` : ""}</b>
              <span>${escapeHTML(g.ip)} · antwortet nicht</span></div>
          </div>
        </div>`;
    }

    const offen = lichtOffen === g.ip;
    const bearbeitet = lichtBearbeitet === g.ip;
    const gruppe = lichtGruppe(g);
    const listen = lichtListen[g.ip] || { effekte: [], paletten: [] };
    const farbe = alsHex(g.farben && g.farben[0]);
    const prozent = Math.round((g.helligkeit / 255) * 100);

    return `<div class="block li-karte${g.an ? " an" : ""}${offen ? " offen" : ""}"
                 data-licht="${escapeHTML(g.ip)}" style="--licht: ${farbe}">
        <div class="li-kopf">
          <button type="button" class="li-schalter${g.an ? " an" : ""}" data-schalt="${escapeHTML(g.ip)}"
                  role="switch" aria-checked="${g.an}" aria-label="${escapeHTML(g.name)} an oder aus">
            <span class="li-knauf"></span>
          </button>
          <div class="li-name">
            <b>${escapeHTML(lichtName(g))}${gruppe
              ? `<span class="li-gruppe">${escapeHTML(gruppe)}</span>` : ""}</b>
            <span>${gruppe
              ? `<span class="li-gruppe li-gruppe-klein">${escapeHTML(gruppe)}</span>` : ""}${
              g.an ? escapeHTML(lichtEffektName(g))
                   : (g.lichter ? g.lichter + " LEDs" : escapeHTML(g.ip))}</span>
          </div>
          <button type="button" class="li-stift" data-stift="${escapeHTML(g.ip)}"
                  aria-expanded="${bearbeitet}" aria-label="Name und Gruppe">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M16.4 4.6a2 2 0 0 1 2.8 2.8L8.5 18.1l-3.7.9.9-3.7Z"/>
            </svg>
          </button>
          <button type="button" class="li-mehr" data-mehr="${escapeHTML(g.ip)}"
                  aria-expanded="${offen}" aria-label="Einstellungen">
            <span class="li-pfeil"></span>
          </button>
        </div>

        ${bearbeitet ? `
        <form class="li-taufe li-umbenennen" data-eigen="${escapeHTML(g.ip)}">
          <label class="li-feld">
            <span>Name auf dieser Website</span>
            <input type="text" data-feld="name" maxlength="30" autocomplete="off"
                   value="${escapeHTML(lichtEigen[g.ip]?.name || "")}"
                   placeholder="${escapeHTML(g.name)}">
          </label>
          <label class="li-feld">
            <span>Gruppe</span>
            <input type="text" data-feld="gruppe" maxlength="24" autocomplete="off"
                   list="lichtGruppenListe" placeholder="z. B. Schlafzimmer"
                   value="${escapeHTML(lichtGruppe(g))}">
          </label>
          <div class="li-umbenennen-fuss">
            <span class="li-hinweis">Bleibt hier — an das Gerät wird nichts geschickt.
              Es heißt weiterhin „${escapeHTML(g.name)}".</span>
            <div class="li-umbenennen-knoepfe">
              <button type="submit">Sichern</button>
              <button type="button" data-eigen-zu>Schließen</button>
            </div>
          </div>
        </form>` : ""}

        ${g.an ? `<div class="li-regler">
          <input type="range" min="1" max="255" value="${g.helligkeit || 1}"
                 data-hell="${escapeHTML(g.ip)}" aria-label="Helligkeit ${escapeHTML(g.name)}">
          <span class="li-prozent">${prozent} %</span>
        </div>` : ""}

        ${offen ? `
        <div class="li-tiefe">
          <label class="li-feld">
            <span>Effekt</span>
            <select data-fx="${escapeHTML(g.ip)}">${
              (listen.effekte.length ? listen.effekte : [String(g.effekt)]).map((name, i) =>
                `<option value="${i}"${i === g.effekt ? " selected" : ""}>${escapeHTML(name)}</option>`
              ).join("")}</select>
          </label>

          <label class="li-feld">
            <span>Palette</span>
            <select data-pal="${escapeHTML(g.ip)}">${
              (listen.paletten.length ? listen.paletten : [String(g.palette)]).map((name, i) =>
                `<option value="${i}"${i === g.palette ? " selected" : ""}>${escapeHTML(name)}</option>`
              ).join("")}</select>
          </label>

          <div class="li-farben">
            <span class="li-marke">Farben</span>
            <div class="li-farbreihe">${[0, 1, 2].map(i => `
              <label class="li-farbe${i === 0 ? " haupt" : ""}">
                <input type="color" value="${alsHex((g.farben || [])[i])}"
                       data-farbe="${escapeHTML(g.ip)}" data-nr="${i}"
                       aria-label="Farbe ${i + 1}">
                <span style="background:${alsHex((g.farben || [])[i])}"></span>
              </label>`).join("")}
            </div>
          </div>

          <div class="li-schnell">${LICHT_FARBEN.map(f => `
            <button type="button" class="li-tupfer" style="background:${f.hex}"
                    data-schnell="${escapeHTML(g.ip)}" data-hex="${f.hex}"
                    title="${escapeHTML(f.name)}" aria-label="${escapeHTML(f.name)}"></button>`).join("")}
          </div>

          ${palettenReihe(g)}

          <div class="li-zwei">
            <label class="li-feld">
              <span>Tempo</span>
              <input type="range" min="0" max="255" value="${g.tempo == null ? 128 : g.tempo}"
                     data-sx="${escapeHTML(g.ip)}">
            </label>
            <label class="li-feld">
              <span>Stärke</span>
              <input type="range" min="0" max="255" value="${g.staerke == null ? 128 : g.staerke}"
                     data-ix="${escapeHTML(g.ip)}">
            </label>
          </div>

          <div class="li-fuss">${g.lichter ? g.lichter + " LEDs · " : ""}${escapeHTML(g.ip)}</div>
        </div>` : ""}
      </div>`;
  }

  /* ==========================================================
     EIGENE FARBPALETTEN
     Eine Farbe zu treffen dauert; sie an zehn Geräten wieder zu
     treffen, dauert zehnmal so lang. Deshalb lassen sich die drei
     Farben eines Lichts unter einem Namen ablegen und anderswo mit
     einem Tippen wieder aufrufen.

     Gespeichert wird im Bestand — die Paletten stehen damit auch
     auf iPad und Telefon bereit.
     ========================================================== */
  let farbpaletten = store.get("lifeos_farbpaletten", []);

  const palettenSichern = () => store.set("lifeos_farbpaletten", farbpaletten);

  function paletteAnlegen(name, farben) {
    const p = {
      id: "fp" + Date.now().toString(36),
      name: String(name || "").trim() || "Ohne Namen",
      farben: [0, 1, 2].map(i => (farben || [])[i] || [0, 0, 0])
    };
    farbpaletten.push(p);
    palettenSichern();
    return p;
  }

  function paletteLoeschen(id) {
    farbpaletten = farbpaletten.filter(p => p.id !== id);
    palettenSichern();
  }

  /* Die Reihe unter den Farbfeldern: gespeicherte Paletten als
     dreifarbige Streifen, dahinter der Knopf zum Ablegen. */
  function palettenReihe(g) {
    return `<div class="li-paletten">
        <span class="li-marke">Eigene Paletten</span>
        <div class="li-palettenreihe">
          ${farbpaletten.map(p => `
            <button type="button" class="li-palette" data-palette="${escapeHTML(p.id)}"
                    data-ip="${escapeHTML(g.ip)}" title="${escapeHTML(p.name)} anwenden">
              <span class="li-streifen">${p.farben.map(f =>
                `<i style="background:${alsHex(f)}"></i>`).join("")}</span>
              <b>${escapeHTML(p.name)}</b>
              <i class="li-palette-weg" data-weg="${escapeHTML(p.id)}"
                 role="button" tabindex="0" aria-label="Palette löschen">✕</i>
            </button>`).join("")}
          <button type="button" class="li-palette neu" data-merken="${escapeHTML(g.ip)}"
                  title="Die drei Farben dieses Lichts ablegen">
            <span class="li-plus" aria-hidden="true">+</span>
            <b>Merken</b>
          </button>
        </div>
        <form class="li-taufe" data-taufe="${escapeHTML(g.ip)}" hidden>
          <span class="li-streifen">${(g.farben || []).slice(0, 3).map(f =>
            `<i style="background:${alsHex(f)}"></i>`).join("")}</span>
          <input type="text" placeholder="Name der Palette" maxlength="24"
                 autocomplete="off" aria-label="Name der Palette">
          <button type="submit">Sichern</button>
          <button type="button" data-abbrechen>Abbrechen</button>
        </form>
      </div>`;
  }

  /* Ein paar Farben, die man ohne Farbwähler trifft */
  const LICHT_FARBEN = [
    { name: "Warmweiß", hex: "#ffb46b" }, { name: "Weiß", hex: "#ffffff" },
    { name: "Rot", hex: "#ff2d2d" },      { name: "Orange", hex: "#ff8c1a" },
    { name: "Gelb", hex: "#ffd400" },     { name: "Grün", hex: "#25d366" },
    { name: "Türkis", hex: "#00d4c8" },   { name: "Blau", hex: "#2d6cff" },
    { name: "Violett", hex: "#8b5cf6" },  { name: "Pink", hex: "#ff3ea5" }
  ];

  function lichtEffektName(g) {
    const l = lichtListen[g.ip];
    if (l && l.effekte && l.effekte[g.effekt]) return l.effekte[g.effekt];
    return "Effekt " + g.effekt;
  }

  function lichtBinden() {
    const gitter = $("lichtGitter");

    gitter.querySelectorAll("[data-schalt]").forEach(b =>
      b.addEventListener("click", () => {
        const ip = b.dataset.schalt;
        const g = lichtGeraete.find(x => x.ip === ip);
        if (!g) return;
        /* Sofort umschalten, ohne auf die Antwort zu warten — das
           Licht braucht einen Moment, der Knopf soll das nicht. */
        g.an = !g.an;
        lichtZeichnen();
        lichtSenden(ip, { an: g.an }, true);
      }));

    /* ---------- Name und Gruppe ---------- */
    gitter.querySelectorAll("[data-stift]").forEach(b =>
      b.addEventListener("click", () => {
        const ip = b.dataset.stift;
        lichtBearbeitet = lichtBearbeitet === ip ? null : ip;
        lichtZeichnen(true);
        const feld = gitter.querySelector(`[data-eigen="${ip}"] [data-feld="name"]`);
        if (feld) { feld.focus(); feld.select(); }
      }));

    gitter.querySelectorAll("[data-eigen]").forEach(form => {
      const zu = () => { lichtBearbeitet = null; lichtZeichnen(true); };
      form.querySelector("[data-eigen-zu]").addEventListener("click", zu);
      form.addEventListener("keydown", e => { if (e.key === "Escape") zu(); });
      form.addEventListener("submit", e => {
        e.preventDefault();
        const ip = form.dataset.eigen;
        const g = lichtGeraete.find(x => x.ip === ip);
        eigenSetzen(ip,
          form.querySelector('[data-feld="name"]').value,
          form.querySelector('[data-feld="gruppe"]').value);
        lichtBearbeitet = null;
        lichtZeichnen();
        if (g) showToast("Heißt hier jetzt „" + lichtName(g) + "“"
                         + (lichtGruppe(g) ? " · " + lichtGruppe(g) : ""), "success");
      });
    });

    gitter.querySelectorAll("[data-mehr]").forEach(b =>
      b.addEventListener("click", () => {
        const ip = b.dataset.mehr;
        lichtOffen = lichtOffen === ip ? null : ip;
        if (lichtOffen && !lichtListen[lichtOffen]) {
          const g = lichtGeraete.find(x => x.ip === lichtOffen);
          if (g) lichtListenHolen(g).then(() => lichtZeichnen(true));
        }
        lichtZeichnen(true);
      }));

    gitter.querySelectorAll("[data-hell]").forEach(r => {
      fuellstand(r);
      r.addEventListener("input", () => {
        const ip = r.dataset.hell;
        const g = lichtGeraete.find(x => x.ip === ip);
        if (g) { g.helligkeit = Number(r.value); g.an = true; }
        fuellstand(r);
        /* Die Prozentzahl daneben zieht sofort mit — sie wartet nicht
           auf die Antwort des Geräts. */
        const zahl = r.parentElement.querySelector(".li-prozent");
        if (zahl) zahl.textContent = Math.round(r.value / 255 * 100) + " %";
        lichtSenden(ip, { helligkeit: Number(r.value), an: true });
      });
    });

    /* Auch Tempo und Stärke bekommen ihren Balken */
    gitter.querySelectorAll("[data-sx], [data-ix]").forEach(r => {
      fuellstand(r);
      r.addEventListener("input", () => fuellstand(r));
    });

    gitter.querySelectorAll("[data-fx]").forEach(w =>
      w.addEventListener("change", () => lichtSenden(w.dataset.fx, { effekt: Number(w.value) }, true)));
    gitter.querySelectorAll("[data-pal]").forEach(w =>
      w.addEventListener("change", () => lichtSenden(w.dataset.pal, { palette: Number(w.value) }, true)));

    gitter.querySelectorAll("[data-farbe]").forEach(f =>
      f.addEventListener("input", () => {
        const ip = f.dataset.farbe;
        const nr = Number(f.dataset.nr);
        const g = lichtGeraete.find(x => x.ip === ip);
        if (!g) return;
        const farben = [0, 1, 2].map(i => (g.farben || [])[i] || [0, 0, 0]);
        farben[nr] = ausHex(f.value);
        g.farben = farben;
        const punkt = f.nextElementSibling;
        if (punkt) punkt.style.background = f.value;
        lichtSenden(ip, { farben });
      }));

    gitter.querySelectorAll("[data-schnell]").forEach(b =>
      b.addEventListener("click", () => {
        const ip = b.dataset.schnell;
        const g = lichtGeraete.find(x => x.ip === ip);
        if (!g) return;
        const farben = [0, 1, 2].map(i => (g.farben || [])[i] || [0, 0, 0]);
        farben[0] = ausHex(b.dataset.hex);
        g.farben = farben;
        /* Eine gewählte Farbe will man sehen — also auf einfarbig
           und an, sonst passiert scheinbar nichts. */
        lichtSenden(ip, { farben, effekt: 0, an: true }, true);
      }));

    gitter.querySelectorAll("[data-sx]").forEach(r =>
      r.addEventListener("input", () => lichtSenden(r.dataset.sx, { tempo: Number(r.value) })));
    gitter.querySelectorAll("[data-ix]").forEach(r =>
      r.addEventListener("input", () => lichtSenden(r.dataset.ix, { staerke: Number(r.value) })));

    /* ---------- Eigene Paletten ---------- */
    gitter.querySelectorAll("[data-palette]").forEach(b =>
      b.addEventListener("click", e => {
        if (e.target.closest("[data-weg]")) return;      // das Kreuz löscht
        const p = farbpaletten.find(x => x.id === b.dataset.palette);
        const g = lichtGeraete.find(x => x.ip === b.dataset.ip);
        if (!p || !g) return;
        g.farben = p.farben.map(f => f.slice());
        lichtSenden(g.ip, { farben: g.farben, an: true }, true);
        showToast("„" + p.name + "“ auf " + g.name, "success");
      }));

    gitter.querySelectorAll("[data-weg]").forEach(x => {
      const weg = e => {
        e.stopPropagation();
        e.preventDefault();
        const p = farbpaletten.find(y => y.id === x.dataset.weg);
        paletteLoeschen(x.dataset.weg);
        lichtZeichnen();
        if (p) showToast("Palette „" + p.name + "“ gelöscht");
      };
      x.addEventListener("click", weg);
      x.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") weg(e); });
    });

    /* Merken klappt ein kleines Feld auf, statt ein Systemfenster zu
       öffnen — das steht in einer Website-App quer und lässt sich
       auf dem Telefon kaum bedienen. */
    gitter.querySelectorAll("[data-merken]").forEach(b =>
      b.addEventListener("click", () => {
        const form = gitter.querySelector(`[data-taufe="${b.dataset.merken}"]`);
        if (!form) return;
        form.hidden = false;
        b.hidden = true;
        const feld = form.querySelector("input");
        feld.value = "Palette " + (farbpaletten.length + 1);
        feld.focus();
        feld.select();
      }));

    gitter.querySelectorAll("[data-taufe]").forEach(form => {
      const schliessen = () => {
        form.hidden = true;
        const knopf = gitter.querySelector(`[data-merken="${form.dataset.taufe}"]`);
        if (knopf) knopf.hidden = false;
      };
      form.querySelector("[data-abbrechen]").addEventListener("click", schliessen);
      form.addEventListener("keydown", e => { if (e.key === "Escape") schliessen(); });
      form.addEventListener("submit", e => {
        e.preventDefault();
        const g = lichtGeraete.find(x => x.ip === form.dataset.taufe);
        if (!g) return;
        const p = paletteAnlegen(form.querySelector("input").value, g.farben);
        lichtZeichnen();
        showToast("Palette „" + p.name + "“ gemerkt", "success");
      });
    });
  }

  /* ---------- Die Knöpfe oben ---------- */
  const lichtAlle = (wunsch, text) => {
    fetch("/api/wled/setzen", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alle: true, ...wunsch })
    })
      .then(a => a.json())
      .then(d => {
        const schief = (d.ergebnis || []).filter(x => !x.ok).length;
        showToast(text + (schief ? " · " + schief + " antworteten nicht" : ""),
                  schief ? "warn" : "success");
        lichtHolen();
      })
      .catch(f => showToast("Ging nicht: " + f.message, "warn"));
  };

  const lichtAn = $("lichtAlleAn");
  if (lichtAn) lichtAn.addEventListener("click", () => lichtAlle({ an: true }, "Alle an"));
  const lichtAus = $("lichtAlleAus");
  if (lichtAus) lichtAus.addEventListener("click", () => lichtAlle({ an: false }, "Alle aus"));

  const lichtSuch = $("lichtSuchen");
  if (lichtSuch) lichtSuch.addEventListener("click", () => {
    const alt = lichtSuch.textContent;
    lichtSuch.disabled = true;
    lichtSuch.textContent = "Sucht …";
    fetch("/api/wled/suchen", { method: "POST" })
      .then(a => a.json())
      .then(d => {
        if (!d.ok) throw new Error(d.fehler || "Suche fehlgeschlagen");
        lichtGeraete = d.geraete || [];
        lichtZeichnen();
        const fehlen = lichtGeraete.filter(g => g.da && !lichtListen[g.ip]);
        if (fehlen.length) Promise.all(fehlen.map(lichtListenHolen)).then(() => lichtZeichnen());
        showToast(d.gefunden + (d.gefunden === 1 ? " Gerät gefunden" : " Geräte gefunden"), "success");
      })
      .catch(f => showToast(f.message, "warn"))
      .finally(() => { lichtSuch.disabled = false; lichtSuch.textContent = alt; });
  });

  /* ---------- Projekte ---------- */
  let projekte = store.get("lifeos_projekte", null);
  if (!Array.isArray(projekte)) {
    projekte = [];
    store.set("lifeos_projekte", projekte);
  }

  /* ==========================================================
     RÜCKFRAGE
     Ein kleines Fenster für Schritte, die sich nicht zurücknehmen
     lassen. Es meldet sich über einen Rückruf, damit der Aufrufer
     einfach weiterschreiben kann.
     ========================================================== */
  const frageSchicht = $("frageSchicht");
  let frageDann = null;

  function frageNach(titel, text, knopf, dann) {
    $("frageTitel").textContent = titel;
    $("frageText").textContent = text;
    $("frageJa").textContent = knopf || "Löschen";
    frageDann = dann;
    frageSchicht.classList.add("open");
    $("frageJa").focus();
  }

  function frageSchliessen() {
    frageSchicht.classList.remove("open");
    frageDann = null;
  }

  $("frageJa").addEventListener("click", () => {
    const tun = frageDann;
    frageSchliessen();
    if (tun) tun();
  });
  $("frageNein").addEventListener("click", frageSchliessen);
  frageSchicht.addEventListener("mousedown", ev => {
    if (ev.target === frageSchicht) frageSchliessen();
  });
  document.addEventListener("keydown", ev => {
    if (ev.key === "Escape" && frageSchicht.classList.contains("open")) frageSchliessen();
  });

  /* ==========================================================
     AUTOMATION UND PROJEKTE — Baukasten
     Zwei Fenster mit demselben Werkzeug, aber verschiedenem Zweck:

       Automation – ein Ablauf aus Bausteinen, der von selbst
                  losläuft, sobald sein Zeitpunkt erreicht ist.
                  Kennung und Speicher heißen weiterhin „planung":
                  ein Umbenennen dort würde die Daten auf allen
                  Geräten verlieren.
       Projekte – Schritte zum Abhaken und Termine für den Kalender,
                  von Hand ausgeführt.

     Ein Baustein beschreibt sich vollständig selbst: welche Felder er
     hat, welche Farbe, und was beim Ausführen passiert. Ein neuer
     Baustein braucht deshalb nur einen Eintrag hier.
     ========================================================== */
  const BAUSTEINE = {
    /* ---- Zeitpunkt: sagt, wann ein Ablauf startet ---- */
    umUhr: {
      titel: "Um diese Uhrzeit", ton: "blau", symbol: "◷", zeitpunkt: true,
      info: "Startet den Ablauf ab dieser Uhrzeit",
      felder: [{ name: "zeit", art: "zeit", platz: "Uhrzeit" }],
      tun: () => null
    },
    amDatum: {
      titel: "An diesem Tag", ton: "cyan", symbol: "▤", zeitpunkt: true,
      info: "Nur an einem bestimmten Datum",
      felder: [{ name: "datum", art: "datum", platz: "Datum" }],
      tun: () => null
    },
    anWochentag: {
      titel: "An diesem Wochentag", ton: "tuerkis", symbol: "↻", zeitpunkt: true,
      info: "Jede Woche am gewählten Tag",
      felder: [{ name: "tag", art: "auswahl", platz: "Wochentag",
                 werte: () => [1,2,3,4,5,6,0].map(n => ({ wert: String(n), text: TAGE_LANG[n] })) }],
      tun: () => null
    },

    /* ---- Was passieren soll ---- */
    hinweis: {
      titel: "Hinweis zeigen", ton: "grau", symbol: "!",
      info: "Blendet kurz eine Nachricht ein",
      felder: [{ name: "text", art: "text", platz: "Was soll dastehen?" }],
      tun: w => { showToast(w.text || "Hinweis"); return "Hinweis gezeigt"; }
    },
    seite: {
      titel: "Seite öffnen", ton: "blau", symbol: "→",
      info: "Wechselt auf eine Seite der Website",
      felder: [{ name: "seite", art: "auswahl", platz: "Seite",
                 werte: () => SEITEN.map(x => ({ wert: x.id, text: x.titel })) }],
      tun: w => {
        if (!w.seite) return null;
        seiteZeigen(w.seite);
        return (SEITEN.find(x => x.id === w.seite) || {}).titel + " geöffnet";
      }
    },
    habit: {
      titel: "Habit abhaken", ton: "violett", symbol: "✓",
      info: "Setzt den heutigen Tag auf erledigt",
      felder: [{ name: "habit", art: "auswahl", platz: "Habit",
                 werte: () => habits.list.slice(0, HABIT_LIMIT).map(h => ({ wert: h.id, text: h.name })) }],
      tun: w => {
        const h = habits.list.find(x => x.id === w.habit);
        if (!h) return null;
        if (habitErledigt(h.id, todayStr())) return h.name + " war schon abgehakt";
        toggleHabit(h.id);
        return h.name + " abgehakt";
      }
    },
    streak: {
      titel: "Streak abhaken", ton: "orange", symbol: "▲",
      info: "Trägt den heutigen Tag in die Serie ein",
      felder: [{ name: "streak", art: "auswahl", platz: "Streak",
                 werte: () => streaks.list.slice(0, STREAK_LIMIT).map(x => ({ wert: x.id, text: x.name })) }],
      tun: w => {
        const e = streaks.list.find(x => x.id === w.streak);
        if (!e) return null;
        if (streakErledigt(e.id, todayStr())) return e.name + " war schon abgehakt";
        streakSetzen(e.id, todayStr(), true);
        renderStreaks();
        return e.name + " abgehakt";
      }
    },
    kalorien: {
      titel: "Kalorien eintragen", ton: "gelb", symbol: "+",
      info: "Rechnet den Wert auf den heutigen Stand",
      felder: [{ name: "menge", art: "zahl", platz: "kcal" }],
      tun: w => {
        const menge = Number(w.menge);
        if (!menge) return null;
        kalorien.consumed = Math.max(0, (kalorien.consumed || 0) + menge);
        store.set("lifeos_kalorien", kalorien);
        kalorienMerken();
        renderCalories();
        return menge + " kcal eingetragen";
      }
    },
    hausaufgabe: {
      titel: "Hausaufgabe anlegen", ton: "pink", symbol: "✎",
      info: "Fällig ist die nächste Stunde des Fachs",
      felder: [
        { name: "titel", art: "text", platz: "Was ist zu tun?" },
        { name: "fach", art: "auswahl", platz: "Fach",
          werte: () => Object.keys(FAECHER).map(id => ({ wert: id, text: fachInfo(id).kurz })) },
        { name: "wichtig", art: "auswahl", platz: "Wichtigkeit",
          werte: () => [1, 2, 3].map(n => ({ wert: String(n), text: HA_STUFEN[n] })) }
      ],
      tun: w => {
        if (!w.titel) return null;
        const datum = w.fach ? naechstesDatumFuer(w.fach) : todayStr();
        hausaufgaben.push({ id: uid(), title: w.titel, fach: w.fach || null,
                            date: datum, wichtig: Number(w.wichtig) || 1, erledigt: false });
        store.set("lifeos_hausaufgaben", hausaufgaben);
        renderNaechste();
        if (aktuelleSeite === "lernen") baueLernen();
        if (aktuelleSeite === "kalender") baueKalender();
        return "Hausaufgabe auf " + fmtDate(datum);
      }
    },
    lerntag: {
      titel: "Lerntag eintragen", ton: "rot", symbol: "★",
      info: "Hakt bei einer Klausur den heutigen Lerntag ab",
      felder: [{ name: "klausur", art: "auswahl", platz: "Klausur",
                 werte: () => geplanteKlausuren().map(k => ({ wert: k.id, text: k.title })) }],
      tun: w => {
        const k = klausuren.find(x => x.id === w.klausur);
        if (!k) return null;
        const tage = lernTage(k).slice();
        if (tage.includes(todayStr())) return k.title + ": Lerntag stand schon";
        tage.push(todayStr());
        k.gelernt = tage;
        klausurenSichern();
        if (aktuelleSeite === "lernen") baueLernen();
        return "Lerntag für " + k.title;
      }
    },

    /* ---- Nur in den Projekten ---- */
    schritt: {
      titel: "Schritt", ton: "hellgruen", symbol: "≡",
      info: "Ein Arbeitsschritt zum Abhaken",
      felder: [{ name: "text", art: "text", platz: "Was ist zu tun?" }],
      haken: true,
      tun: () => null
    },
    unterschritt: {
      titel: "Unterschritt", ton: "hellgruen", symbol: "└",
      info: "Gehört zum Schritt darüber",
      /* Zwei Gesichter: entweder ein Name oder eine Anzahl, die
         heruntergezählt wird. Der Umschalter sitzt oben im Block. */
      schalter: { name: "modus", standard: "name",
                  werte: [{ wert: "name", text: "Name" },
                          { wert: "anzahl", text: "Anzahl" }] },
      felder: w => w.modus === "anzahl"
        ? [{ name: "ziel", art: "zahl", platz: "wie oft?" }]
        : [{ name: "text", art: "text", platz: "Was ist zu tun?" }],
      haken: true, unter: true,
      /* Nur zulässig, wenn darüber schon ein Schritt steht */
      erlaubt: schritte => schritte.some(x => x.art === "schritt"),
      warum: "Dafür braucht es erst einen Schritt darüber",
      tun: () => null
    },
    termin: {
      titel: "Termin eintragen", ton: "cyan", symbol: "▤",
      info: "Legt einen Termin im Kalender an",
      felder: [
        { name: "titel", art: "text", platz: "Worum geht es?" },
        { name: "datum", art: "datum", platz: "Datum" },
        { name: "zeit", art: "zeit", platz: "Uhrzeit" }
      ],
      /* Der Eintrag entsteht schon beim Ausfüllen (terminAbgleichen),
         nicht erst beim Ausführen — in den Projekten gibt es keins. */
      tun: () => null
    }
  };

  /* Welche Bausteine welches Fenster anbietet */
  const BAU_PLANUNG = ["umUhr", "amDatum", "anWochentag", "hinweis", "seite",
                       "habit", "streak", "kalorien", "hausaufgabe", "lerntag"];
  const BAU_PROJEKT = ["schritt", "unterschritt", "termin"];

  let planung = store.get("lifeos_planung", null);
  if (!Array.isArray(planung)) { planung = []; store.set("lifeos_planung", planung); }

  const schritteVon = e => Array.isArray(e.schritte) ? e.schritte : [];

  /* Die Gliederung ergibt sich aus der Reihenfolge: ein Unterschritt
     gehört zum nächsten Schritt über ihm. Steht keiner darüber, ist
     er für sich allein — dann verhält er sich wie ein Schritt. */
  function gliederung(schritte) {
    const kinder = new Map();
    const eltern = new Map();
    let offen = null;
    schritte.forEach((sch, i) => {
      if (sch.art === "schritt") { offen = i; kinder.set(i, []); return; }
      if (sch.art !== "unterschritt") { offen = null; return; }
      if (offen === null) return;
      kinder.get(offen).push(i);
      eltern.set(i, offen);
    });
    return { kinder, eltern };
  }

  /* Ein Schritt mit Unterschritten ist erst fertig, wenn alle es sind */
  function istFertig(schritte, i) {
    const { kinder } = gliederung(schritte);
    const meine = kinder.get(i);
    if (meine && meine.length) return meine.every(k => !!schritte[k].fertig);
    return !!schritte[i].fertig;
  }

  /* Die beiden Fenster unterscheiden sich nur in ihren Daten und der
     Auswahl an Bausteinen — alles andere ist dieselbe Maschinerie. */
  const BEREICHE = {
    planung: {
      id: "planung", was: "Ablauf", laufen: true,
      bausteine: BAU_PLANUNG,
      liste: "pgPlanungListe", bau: "pgPlanungBau", zahl: "pgPlanungZahl",
      form: "planungForm", feld: "planungInput",
      holen: () => planung,
      setzen: l => { planung = l; store.set("lifeos_planung", planung); },
      sichern: () => store.set("lifeos_planung", planung),
      leerText: "Zuerst einen Ablauf anlegen — dann einen Zeitpunkt wählen und darunter, was passieren soll."
    },
    projekt: {
      id: "projekt", was: "Projekt", laufen: false,
      bausteine: BAU_PROJEKT,
      liste: "pgProjektListe", bau: "pgProjektBau", zahl: "pgProjektZahl",
      form: "projektForm", feld: "projektInput",
      holen: () => projekte,
      setzen: l => { projekte = l; store.set("lifeos_projekte", projekte); },
      sichern: () => store.set("lifeos_projekte", projekte),
      leerText: "Zuerst ein Projekt anlegen — dann Schritte zusammensetzen und Termine in den Kalender legen."
    }
  };

  const offeneMappe = { planung: null, projekt: null };

  /* In den Projekten gibt es kein Ausführen — ein Terminbaustein
     schreibt seinen Eintrag deshalb sofort in den Kalender und hält
     ihn dort auf Stand. Die Kennung des Eintrags bleibt am Baustein,
     damit spätere Änderungen denselben Termin treffen. */
  function terminAbgleichen(sch) {
    const w = sch.werte || {};
    const vorhanden = sch.terminId ? termine.find(x => x.id === sch.terminId) : null;

    if (!w.titel || !w.datum) {
      if (vorhanden) terminLoesen(sch);
      return;
    }
    if (vorhanden) {
      vorhanden.title = w.titel;
      vorhanden.date = w.datum;
      vorhanden.time = w.zeit || "";
    } else {
      const frisch = { id: uid(), title: w.titel, date: w.datum, time: w.zeit || "" };
      termine.push(frisch);
      sch.terminId = frisch.id;
    }
    store.set("lifeos_termine", termine);
    renderNaechste();
    if (aktuelleSeite === "kalender") baueKalender();
  }

  /* Fällt der Baustein weg, geht auch sein Termin */
  function terminLoesen(sch) {
    if (!sch.terminId) return;
    termine = termine.filter(x => x.id !== sch.terminId);
    delete sch.terminId;
    store.set("lifeos_termine", termine);
    renderNaechste();
    if (aktuelleSeite === "kalender") baueKalender();
  }

  function bauePlanung() {
    bereichZeichnen(BEREICHE.planung);
    const an = planung.filter(e => !e.aus).length;
    $("planungSub").textContent = planung.length
      ? an + " von " + planung.length + (planung.length === 1 ? " Ablauf aktiv" : " Abläufen aktiv")
      : "Noch nichts angelegt";
  }

  function baueProjekte() {
    bereichZeichnen(BEREICHE.projekt);
    const offen = projekte.filter(p => !p.fertig).length;
    $("projekteSub").textContent = projekte.length
      ? offen + " offen · " + (projekte.length - offen) + " erledigt"
      : "Noch nichts angelegt";
  }

  /* Beide Fenster auf einmal — nach Änderungen, die beide betreffen */
  function baueBaukasten() { bauePlanung(); baueProjekte(); }

  /* ---------- Liste links ---------- */
  function bereichZeichnen(b) {
    const eintraege = b.holen();
    $(b.zahl).textContent = eintraege.length;

    if (offeneMappe[b.id] && !eintraege.some(e => e.id === offeneMappe[b.id])) offeneMappe[b.id] = null;

    const liste = $(b.liste);
    liste.innerHTML = "";
    eintraege.forEach(e => {
      const anzahl = schritteVon(e).length;
      const wann = b.id === "planung" ? planWann(e) : "";
      liste.appendChild(zeile(
        `<span class="vz-punkt ${e.fertig ? "erledigt" : ""}"></span>
         <div class="vz-haupt">
           <div class="vz-titel"${e.fertig ? ' style="text-decoration:line-through;opacity:.55"' : ""}>${escapeHTML(e.name)}</div>
           <div class="vz-sub">${anzahl ? anzahl + (anzahl === 1 ? " Schritt" : " Schritte") : "noch keine Schritte"}${
             wann ? " · " + escapeHTML(wann) : ""}${
             e.deadline ? ' · <span class="vz-frist ' + fristKlasse(daysUntil(e.deadline)) + '">'
               + (daysUntil(e.deadline) < 0 ? "vorbei" : badgeFor(daysUntil(e.deadline))) + '</span>' : ""}</div>
         </div>
         ${b.id === "projekt"
           ? `<button class="vz-badge" data-fertig="${e.id}">${e.fertig ? "Wieder öffnen" : "Erledigt"}</button>`
           : `<button class="vz-badge" data-an="${e.id}">${e.aus ? "Aus" : "An"}</button>`}
         <button class="vz-del" data-loesch="${e.id}" aria-label="Löschen">✕</button>`,
        "klickbar" + (e.id === offeneMappe[b.id] ? " empfohlen" : "")));
      liste.lastElementChild.dataset.mappe = e.id;
    });

    liste.querySelectorAll("[data-mappe]").forEach(li =>
      li.addEventListener("click", () => {
        offeneMappe[b.id] = li.dataset.mappe;
        bereichZeichnen(b);
      }));
    liste.querySelectorAll("[data-fertig]").forEach(k => k.addEventListener("click", ev => {
      ev.stopPropagation();
      const e = eintraege.find(x => x.id === k.dataset.fertig);
      if (e) { e.fertig = !e.fertig; b.sichern(); baueBaukasten(); }
    }));
    liste.querySelectorAll("[data-an]").forEach(k => k.addEventListener("click", ev => {
      ev.stopPropagation();
      const e = eintraege.find(x => x.id === k.dataset.an);
      if (e) { e.aus = !e.aus; b.sichern(); baueBaukasten(); }
    }));
    liste.querySelectorAll("[data-loesch]").forEach(k => k.addEventListener("click", ev => {
      ev.stopPropagation();
      const e = eintraege.find(x => x.id === k.dataset.loesch);
      if (!e) return;
      const anzahl = schritteVon(e).length;
      frageNach(
        e.name + " löschen?",
        b.was + " und " + (anzahl ? anzahl + (anzahl === 1 ? " Baustein" : " Bausteine") : "alles darin")
          + " werden entfernt. Das lässt sich nicht zurücknehmen.",
        "Löschen",
        () => {
          schritteVon(e).forEach(sch => { if (sch.art === "termin") terminLoesen(sch); });
          b.setzen(b.holen().filter(x => x.id !== e.id));
          baueBaukasten();
          showToast(b.was + " „" + e.name + "\" gelöscht");
        });
    }));

    bauZeichnen(b);
  }

  /* Kurzfassung des Zeitpunkts für die Liste */
  function planWann(e) {
    const teile = [];
    schritteVon(e).forEach(sch => {
      const w = sch.werte || {};
      if (sch.art === "umUhr" && w.zeit) teile.push("ab " + w.zeit);
      if (sch.art === "amDatum" && w.datum) teile.push("am " + fmtDate(w.datum));
      if (sch.art === "anWochentag" && w.tag) teile.push("jeden " + TAGE_LANG[Number(w.tag)]);
    });
    if (e.aus) teile.push("abgeschaltet");
    return teile.join(" · ");
  }

  /* ==========================================================
     ÜBERSICHT IM PROJEKT
     Steht eine Frist dahinter, ist sie das Wichtigste am Projekt —
     sie gehört über die Schritte, nicht in eine Ecke. Kommt das
     Projekt von einer Klausur, stehen deren Unterlagen gleich
     daneben: sie liegen weiter an der Klausur, hier ist nur der
     Zugang dazu.
     ========================================================== */
  function projektUebersicht(e) {
    if (!e || (!e.deadline && !e.quelleKlausur)) return "";

    const k = e.quelleKlausur ? klausuren.find(x => x.id === e.quelleKlausur) : null;
    const tage = e.deadline ? daysUntil(e.deadline) : null;
    const offen = schritteVon(e).filter(x => x.art === "schritt");
    const fertig = offen.filter(x => x.fertig).length;
    const dateien = k ? dateienVon(k) : [];

    const frist = tage === null ? "" :
      `<div class="pu-frist ${fristKlasse(tage)}">
         <span class="pu-zahl">${tage < 0 ? Math.abs(tage) : tage}</span>
         <span class="pu-einheit">${tage < 0 ? "Tage vorbei" : tage === 1 ? "Tag" : "Tage"}</span>
       </div>`;

    return `<div class="pj-uebersicht">
      ${frist}
      <div class="pu-mitte">
        <div class="pu-zeile">
          ${e.deadline ? `<span class="pu-marke">Frist</span><b>${fmtDate(e.deadline)}</b>` : ""}
          ${k && k.fach ? `<span class="pu-fach">${escapeHTML(fachInfo(k.fach).lang)}</span>` : ""}
        </div>
        <div class="pu-fortschritt">
          <div class="pu-spur"><div class="pu-fuell" style="width:${
            offen.length ? Math.round(fertig / offen.length * 100) : 0}%"></div></div>
          <span>${fertig} von ${offen.length} Schritten</span>
        </div>
      </div>
      ${k ? `<div class="pu-unterlagen">
        <div class="pu-titel">Unterlagen<span>${dateien.length}</span></div>
        ${dateien.length
          ? `<ul class="pu-liste">${dateien.slice(0, 6).map(d =>
              `<li class="art-${d.art || "sonst"}">
                 <span class="pu-art">${d.art === "bild" ? "BILD" : d.art === "pdf" ? "PDF"
                   : d.art === "goodnotes" ? "GN" : "DAT"}</span>
                 <span class="pu-name">${escapeHTML(d.name)}</span>
               </li>`).join("")}${dateien.length > 6
              ? `<li class="pu-mehr">und ${dateien.length - 6} weitere</li>` : ""}</ul>`
          : '<div class="pu-leer">Noch nichts angehängt</div>'}
        <button type="button" class="pu-hin" data-pj-klausur="${k.id}">Zur Klausur</button>
      </div>` : ""}
    </div>`;
  }

  /* ---------- Baukasten rechts ---------- */
  function bauZeichnen(b) {
    const kasten = $(b.bau);
    if (!kasten) return;
    const e = offeneMappe[b.id] ? b.holen().find(x => x.id === offeneMappe[b.id]) : null;

    if (!e) {
      kasten.classList.remove("offen");
      kasten.innerHTML =
        `<div class="pj-leer">
           <div class="pj-leer-titel">Kein ${b.was} gewählt</div>
           <div class="pj-leer-text">${b.leerText}</div>
         </div>`;
      return;
    }

    const schritte = schritteVon(e);
    kasten.classList.add("offen");
    kasten.innerHTML =
      `<div class="pj-kopf">
         <div class="pj-kopf-text">
           <h3>${escapeHTML(e.name)}</h3>
           <span>${schritte.length ? schritte.length + (schritte.length === 1 ? " Schritt" : " Schritte") : "leer"}${
             b.id === "planung" && planWann(e) ? " · " + escapeHTML(planWann(e)) : ""}</span>
         </div>
         ${b.laufen ? `<button type="button" class="pj-knopf stark" data-pj="laufen"
           ${schritte.length ? "" : "disabled"}>Ausführen</button>` : ""}
       </div>
       ${projektUebersicht(e)}
       <ol class="pj-schritte">${schritte.map((sch, i) => {
         const bs = BAUSTEINE[sch.art];
         if (!bs) return "";
         if (!sch.id) sch.id = uid();
         const gl = gliederung(schritte);
         const meine = gl.kinder.get(i) || [];
         const eingerueckt = bs.unter && gl.eltern.has(i);
         const fertig = istFertig(schritte, i);
         const gesperrt = meine.length > 0;
         return `<li class="pj-schritt ton-${bs.ton}${bs.zeitpunkt ? " zeitpunkt" : ""}${
             fertig ? " abgehakt" : ""}${eingerueckt ? " unter" : ""}" data-i="${i}" data-sid="${sch.id}">
             <span class="ps-griff" data-griff="${i}" title="Zum Sortieren ziehen">
               <i></i><i></i><i></i><i></i><i></i><i></i>
             </span>
             ${bs.haken
               ? `<button type="button" class="ps-haken${gesperrt ? " gesperrt" : ""}${
                      zaehlZiel(sch) ? " zaehlt" : ""}" data-haken="${i}"
                    ${gesperrt ? `disabled title="Hakt sich von selbst ab, wenn alle ${
                      meine.length} Unterschritte erledigt sind"` : ""}
                    aria-label="Abhaken">${
                      fertig ? "✓" : zaehlZiel(sch) ? (sch.stand || 0) : ""}</button>`
               : `<span class="ps-nummer">${i + 1}</span>`}
             <span class="ps-symbol">${bs.symbol}</span>
             <div class="ps-haupt">
               <div class="ps-titel">
                 <span>${bs.titel}</span>${
                 meine.length ? ` <span class="ps-zahl">${
                   meine.filter(k => schritte[k].fertig).length}/${meine.length}</span>` : ""}${
                 zaehlZiel(sch) ? ` <span class="ps-zahl">${sch.stand || 0}/${zaehlZiel(sch)}</span>` : ""}${
                 bs.schalter ? `<span class="seg-toggle ps-schalter">${
                   bs.schalter.werte.map(o => `<button type="button" class="stbtn${
                     ((sch.werte || {})[bs.schalter.name] || bs.schalter.standard) === o.wert ? " active" : ""
                   }" data-schalter="${i}" data-wert="${o.wert}">${o.text}</button>`).join("")
                 }</span>` : ""}
               </div>
               <div class="ps-felder">${feldListe(bs, sch.werte || {})
                 .map(f => feldHTML(f, sch.werte || {}, i)).join("")}</div>
             </div>
             <div class="ps-werkzeug">
               <button type="button" data-weg="${i}" aria-label="Entfernen">✕</button>
             </div>
           </li>`;
       }).join("") || '<li class="pj-leer-schritt">Noch keine Schritte</li>'}</ol>
       <button type="button" class="pj-plus" data-pj="neu">
         <span>+</span> Baustein hinzufügen
       </button>`;

    /* Felder schreiben direkt in den Schritt zurück */
    kasten.querySelectorAll("[data-feld]").forEach(el => {
      const merken = () => {
        const sch = schritte[Number(el.dataset.i)];
        sch.werte = sch.werte || {};
        sch.werte[el.dataset.feld] = el.value;
        if (sch.art === "termin") terminAbgleichen(sch);
        b.sichern();
        if (b.id === "planung") bereichZeichnen(b);
      };
      el.addEventListener(el.tagName === "SELECT" || el.type === "date" || el.type === "time"
                          ? "change" : "input", merken);
      /* Beim Verlassen des Feldes einmal nachzeichnen — dann stimmt
         auch die Zahl im Titel. Waehrend des Tippens waere das zu
         viel: die Neuzeichnung nimmt den Cursor mit. */
      el.addEventListener("change", () => { merken(); bauZeichnen(b); });
    });

    kasten.querySelectorAll("[data-feldknopf]").forEach(k => k.addEventListener("click", () => {
      const sch = schritte[Number(k.dataset.i)];
      const feld = k.dataset.feldknopf;
      const jetzt = (sch.werte || {})[feld] || "";
      const uebernehmen = wert => {
        sch.werte = sch.werte || {};
        sch.werte[feld] = wert;
        if (sch.art === "termin") terminAbgleichen(sch);
        b.sichern();
        bereichZeichnen(b);
      };
      if (k.dataset.art === "datum") fremdDatum(k, jetzt, uebernehmen);
      else fremdZeit(k, jetzt, uebernehmen);
    }));

    kasten.querySelectorAll("[data-schalter]").forEach(k => k.addEventListener("click", () => {
      const sch = schritte[Number(k.dataset.schalter)];
      const name = BAUSTEINE[sch.art].schalter.name;
      sch.werte = sch.werte || {};
      if (sch.werte[name] === k.dataset.wert) return;
      sch.werte[name] = k.dataset.wert;
      /* Beim Wechsel den Stand zurücksetzen — sonst steht eine Zahl
         aus dem anderen Gesicht noch halb abgehakt da. */
      sch.stand = 0;
      sch.fertig = false;
      b.sichern();
      bauZeichnen(b);
    }));

    kasten.querySelectorAll("[data-haken]").forEach(k => k.addEventListener("click", () => {
      const sch = schritte[Number(k.dataset.haken)];
      const ziel = zaehlZiel(sch);
      if (ziel) {
        /* Jeder Klick eine Runde weiter; ist die Zahl voll, geht der
           nächste Klick wieder von vorn los. */
        if (sch.fertig) { sch.stand = 0; sch.fertig = false; }
        else {
          sch.stand = (sch.stand || 0) + 1;
          if (sch.stand >= ziel) sch.fertig = true;
        }
      } else {
        sch.fertig = !sch.fertig;
      }
      b.sichern();
      bauZeichnen(b);
    }));

    kasten.querySelectorAll("[data-weg]").forEach(k => k.addEventListener("click", () => {
      const raus = schritte[Number(k.dataset.weg)];
      if (raus && raus.art === "termin") terminLoesen(raus);
      schritte.splice(Number(k.dataset.weg), 1);
      e.schritte = schritte;
      b.sichern();
      bereichZeichnen(b);
    }));
    /* ---- Sortieren durch Ziehen ----
       Angefasst wird der Griff links. Der Block hängt dann an der
       Hand und fährt über den anderen entlang — aber nur senkrecht,
       seitlich bleibt er in der Spur. Unter ihm wandert eine Lücke in
       seiner Größe mit: die übrigen Blöcke schieben sich auseinander
       und geben genau dort Platz frei, wo er beim Loslassen landet.
       Die Zeilen rücken dafür weich nach: erst wird gemessen, wo sie
       standen, dann werden sie an die alte Stelle zurückgesetzt und
       von dort auf die neue geschoben (die übliche FLIP-Technik).
       ------------------------------------------------------------ */
    const leiste = kasten.querySelector(".pj-schritte");

    /* Weiches Nachrücken um eine Änderung an der Liste herum */
    function nachruecken(elemente, aendern) {
      const vorher = elemente.map(el => el.getBoundingClientRect().top);
      aendern();
      elemente.forEach((el, n) => {
        const weg = vorher[n] - el.getBoundingClientRect().top;
        if (!weg) return;
        el.style.transition = "none";
        el.style.transform = "translateY(" + weg + "px)";
        requestAnimationFrame(() => {
          el.style.transition = "transform 0.2s cubic-bezier(0.2, 0, 0.2, 1)";
          el.style.transform = "";
        });
      });
    }

    kasten.querySelectorAll("[data-griff]").forEach(griff => {
      let zieht = null, luecke = null, griffVersatz = 0;

      griff.addEventListener("pointerdown", ev => {
        ev.preventDefault();
        zieht = griff.closest(".pj-schritt");
        const feld = zieht.getBoundingClientRect();
        const rahmen = leiste.getBoundingClientRect();
        griffVersatz = ev.clientY - feld.top;

        /* Die Lücke nimmt den Platz ein, den der Block eben hatte —
           genauso hoch, damit sich ringsum nichts verschiebt. */
        luecke = document.createElement("li");
        luecke.className = "ps-luecke";
        luecke.style.height = feld.height + "px";
        zieht.after(luecke);

        /* Der Block verlässt den Fluss und hängt fortan an der Hand.
           Bezug ist die Liste selbst, deshalb steht sie auf relativ. */
        zieht.style.width = feld.width + "px";
        zieht.style.left = (feld.left - rahmen.left) + "px";
        zieht.style.top = (feld.top - rahmen.top) + "px";
        zieht.classList.add("zieht");
        leiste.classList.add("sortiert");
        try { griff.setPointerCapture(ev.pointerId); } catch (fehler) { /* Zeiger schon weg */ }
      });

      griff.addEventListener("pointermove", ev => {
        if (!zieht || !luecke) return;
        const rahmen = leiste.getBoundingClientRect();
        zieht.style.top = (ev.clientY - griffVersatz - rahmen.top) + "px";

        /* Wohin die Lücke wandert: vor die erste Zeile, deren Mitte
           unter dem Zeiger liegt — sonst ans Ende. */
        const andere = [...leiste.children]
          .filter(li => li !== zieht && li !== luecke && li.classList.contains("pj-schritt"));
        const davor = andere.find(li => {
          const r = li.getBoundingClientRect();
          return ev.clientY < r.top + r.height / 2;
        });
        const schonRichtig = davor
          ? luecke.nextElementSibling === davor
          : leiste.lastElementChild === luecke;
        if (schonRichtig) return;

        nachruecken(andere, () => {
          if (davor) leiste.insertBefore(luecke, davor);
          else leiste.appendChild(luecke);
        });
      });

      const loslassen = ev => {
        if (!zieht) return;
        try { griff.releasePointerCapture(ev.pointerId); } catch (fehler) { /* egal */ }

        if (luecke) {
          leiste.insertBefore(zieht, luecke);
          luecke.remove();
          luecke = null;
        }
        zieht.classList.remove("zieht");
        leiste.classList.remove("sortiert");
        leiste.querySelectorAll(".pj-schritt").forEach(li => li.removeAttribute("style"));
        zieht = null;

        const folge = [...leiste.querySelectorAll(".pj-schritt")].map(li => li.dataset.sid);
        e.schritte = folge.map(id => schritte.find(x => x.id === id)).filter(Boolean);
        b.sichern();
        bereichZeichnen(b);
      };
      griff.addEventListener("pointerup", loslassen);
      griff.addEventListener("pointercancel", loslassen);
    });

    kasten.querySelector('[data-pj="neu"]').addEventListener("click", () => waehlerOeffnen(b));
    const start = kasten.querySelector('[data-pj="laufen"]');
    if (start && !start.disabled) start.addEventListener("click", () => ablaufLaufen(e, b, true));
  }

  /* Zählt dieser Baustein hoch? Dann steht hier sein Ziel. */
  function zaehlZiel(sch) {
    const bs = BAUSTEINE[sch.art] || {};
    if (!bs.schalter) return 0;
    const w = sch.werte || {};
    if ((w[bs.schalter.name] || bs.schalter.standard) !== "anzahl") return 0;
    return Math.max(0, Number(w.ziel) || 0);
  }

  /* Ein Baustein kann seine Felder auch nach Lage entscheiden */
  const feldListe = (bs, werte) =>
    typeof bs.felder === "function" ? bs.felder(werte) : bs.felder;

  /* Ein einzelnes Feld eines Bausteins */
  function feldHTML(f, werte, i) {
    const wert = werte[f.name] != null ? String(werte[f.name]) : "";
    if (f.art === "auswahl") {
      return `<select class="ps-feld" data-feld="${f.name}" data-i="${i}">
          <option value=""${wert ? "" : " selected"}>${escapeHTML(f.platz)} …</option>
          ${f.werte().map(o => `<option value="${escapeHTML(o.wert)}"${
            o.wert === wert ? " selected" : ""}>${escapeHTML(o.text)}</option>`).join("")}
        </select>`;
    }
    /* Datum und Uhrzeit bekommen keinen Eingabekasten, sondern einen
       Knopf: dahinter öffnet sich dasselbe Kalenderblatt und dieselben
       Weckerräder wie beim Anlegen eines Termins. */
    if (f.art === "datum" || f.art === "zeit") {
      const beschriftung = wert
        ? (f.art === "datum" ? fmtDate(wert) : wert)
        : (f.art === "datum" ? "Tag hinzufügen" : "Uhrzeit hinzufügen");
      return `<button type="button" class="ps-knopf${wert ? " gesetzt" : ""}"
          data-feldknopf="${f.name}" data-art="${f.art}" data-i="${i}">
          ${f.art === "datum" ? SYM_KALENDER : SYM_WECKER}
          <span>${escapeHTML(beschriftung)}</span>
        </button>`;
    }

    const art = f.art === "zahl" ? "number" : "text";
    return `<input class="ps-feld" type="${art}"
        data-feld="${f.name}" data-i="${i}" value="${escapeHTML(wert)}"
        placeholder="${escapeHTML(f.platz)}" title="${escapeHTML(f.platz)}" autocomplete="off">`;
  }

  /* ---------- Bausteinauswahl ---------- */
  /* Von der Übersicht zurück zur Klausur, an der die Dateien hängen */
  document.addEventListener("click", ev => {
    const hin = ev.target.closest("[data-pj-klausur]");
    if (!hin) return;
    lernenZeigen(hin.dataset.pjKlausur);
  });

  const pjSchicht = $("pjSchicht");
  const pjWaehler = $("pjWaehler");

  function waehlerOeffnen(b) {
    const offen = b.holen().find(x => x.id === offeneMappe[b.id]) || { schritte: [] };
    pjWaehler.innerHTML =
      `<div class="pw-kopf">Baustein wählen</div>
       <div class="pw-gitter">${b.bausteine.map(art => {
         const bs = BAUSTEINE[art];
         const geht = !bs.erlaubt || bs.erlaubt(schritteVon(offen));
         return `<button type="button" class="pw-karte ton-${bs.ton}${geht ? "" : " gesperrt"}"
             data-art="${art}"${geht ? "" : " disabled"}>
             <span class="pw-symbol">${bs.symbol}</span>
             <span class="pw-titel">${bs.titel}</span>
             <span class="pw-info">${geht ? bs.info : bs.warum}</span>
           </button>`;
       }).join("")}</div>`;
    pjWaehler.querySelectorAll("[data-art]").forEach(k =>
      k.addEventListener("click", () => {
        const e = b.holen().find(x => x.id === offeneMappe[b.id]);
        if (!e) return;
        e.schritte = schritteVon(e).concat({ id: uid(), art: k.dataset.art, werte: {} });
        b.sichern();
        waehlerSchliessen();
        bereichZeichnen(b);
      }));
    pjSchicht.classList.add("open");
  }

  function waehlerSchliessen() { pjSchicht.classList.remove("open"); }
  pjSchicht.addEventListener("mousedown", ev => { if (ev.target === pjSchicht) waehlerSchliessen(); });
  document.addEventListener("keydown", ev => {
    if (ev.key === "Escape" && pjSchicht.classList.contains("open")) waehlerSchliessen();
  });

  /* ---------- Ausführen ----------
     Die Schritte laufen der Reihe nach. Zeitpunkte tun selbst nichts,
     sie sagen nur, wann der Ablauf dran ist. */
  function ablaufLaufen(e, b, vonHand) {
    const bericht = [];
    schritteVon(e).forEach(sch => {
      const bs = BAUSTEINE[sch.art];
      if (!bs || bs.zeitpunkt) return;
      try {
        const satz = bs.tun(sch.werte || {});
        if (satz) bericht.push(satz);
      } catch (fehler) {
        bericht.push(bs.titel + " ging nicht: " + fehler.message);
      }
    });
    if (b) bereichZeichnen(b);
    if (!bericht.length) {
      if (vonHand) showToast("Nichts zu tun — Felder noch leer?", "warn");
      return false;
    }
    showToast(e.name + ": " + bericht.join(" · "), "success");
    return true;
  }

  /* ---------- Von selbst starten ----------
     Jede Minute wird geprüft, ob ein Ablauf dran ist. Datum und
     Wochentag müssen passen, die Uhrzeit muss erreicht sein — und
     jeder Ablauf startet höchstens einmal am Tag. */
  function planPruefen() {
    const jetzt = new Date();
    const heute = dateKey(jetzt);
    const minute = jetzt.getHours() * 60 + jetzt.getMinutes();
    let gelaufen = false;

    planung.forEach(e => {
      if (e.aus || e.zuletzt === heute) return;
      const zeiten = schritteVon(e).filter(s => (BAUSTEINE[s.art] || {}).zeitpunkt);
      if (!zeiten.length) return;                 // ohne Zeitpunkt nur von Hand

      const passt = zeiten.every(s => {
        const w = s.werte || {};
        if (s.art === "amDatum") return w.datum ? w.datum === heute : true;
        if (s.art === "anWochentag") return w.tag ? Number(w.tag) === jetzt.getDay() : true;
        if (s.art === "umUhr") {
          if (!w.zeit) return false;
          return minute >= Number(w.zeit.slice(0, 2)) * 60 + Number(w.zeit.slice(3, 5));
        }
        return true;
      });
      if (!passt) return;

      e.zuletzt = heute;
      gelaufen = true;
      ablaufLaufen(e, null, false);
    });

    if (gelaufen) {
      store.set("lifeos_planung", planung);
      if (aktuelleSeite === "planung") bauePlanung();
    }
  }
  setTimeout(planPruefen, 2500);
  setInterval(planPruefen, 60000);

  /* ---------- Anlegen ---------- */
  Object.values(BEREICHE).forEach(b => {
    $(b.form).addEventListener("submit", ev => {
      ev.preventDefault();
      const name = $(b.feld).value.trim();
      if (!name) return;
      const frisch = { id: b.id[0] + Date.now(), name, datum: todayStr(), fertig: false, schritte: [] };
      b.holen().push(frisch);
      b.sichern();
      $(b.feld).value = "";
      offeneMappe[b.id] = frisch.id;
      bereichZeichnen(b);
      baueBaukasten();
      showToast(b.was + " angelegt — jetzt Bausteine hinzufügen");
    });
  });

  /* ---------- Analyse ---------- */
/* ==========================================================
     ANALYSE
     Fünf Reiter, ein gemeinsamer Zeitraum. Jede Zahl bekommt,
     wo es geht, einen Vergleich zum gleich langen Zeitraum davor
     — eine Zahl allein sagt wenig, erst die Richtung sagt etwas.

     Die Daten liegen schon alle vor: die Messung des Rechners
     (Programme und besuchte Seiten je Tag), Habits, Streaks,
     Klausuren, Hausaufgaben, Kalorien — und seit Neuestem, wie
     das Dashboard selbst benutzt wird.
     ========================================================== */
  let anReiter = "ueberblick";
  let anTage = 30;
  let nutzDaten = null;         // Antwort von /api/nutzung

  const AN_TAFELN = {
    ueberblick: "anUeberblick", bildschirm: "anBildschirm",
    habits: "anHabits", schule: "anSchule", kalorien: "anKalorien",
    nutzung: "anNutzung"
  };

  /* Datumsliste eines Zeitraums, ältester Tag zuerst.
     "versatz" schiebt sie nach hinten — so entsteht der Vergleich
     mit dem gleich langen Zeitraum davor. */
  function anSpanne(tage, versatz) {
    const raus = [];
    for (let i = tage - 1 + (versatz || 0); i >= (versatz || 0); i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      raus.push(dateKey(d));
    }
    return raus;
  }

  /* Minuten je Kategorie für einen einzelnen Tag. Dieselbe
     Einteilung wie im Ringdiagramm, nur eben tageweise. */
  function katAmTag(tag) {
    const topf = { produktiv: 0, youtube: 0, tiktok: 0, spiele: 0, rest: 0, gesamt: 0 };
    const e = pcMessung && pcMessung.tage ? pcMessung.tage[tag] : null;
    if (!e) return topf;

    (e.apps || []).forEach(a => {
      const istBrowser = KAT_BROWSER.some(b => a.name.toLowerCase().includes(b));
      if (istBrowser) return;                 // Browser zählt über seine Seiten
      topf[katVonApp(a.name)] += a.minuten;
      topf.gesamt += a.minuten;
    });
    Object.values(e.seiten || {}).forEach(liste => {
      liste.forEach(x => {
        topf[katVonSeite(x.domain, x.name)] += x.minuten;
        topf.gesamt += x.minuten;
      });
    });
    return topf;
  }

  /* Kategoriesummen über eine Datumsliste */
  function katUeberSpanne(spanne) {
    const summe = { produktiv: 0, youtube: 0, tiktok: 0, spiele: 0, rest: 0, gesamt: 0 };
    spanne.forEach(tag => {
      const t = katAmTag(tag);
      Object.keys(summe).forEach(k => summe[k] += t[k]);
    });
    return summe;
  }

  /* ---------- Anzeigehilfen ---------- */

  /* Veränderung in Prozent, als fertiges Stück HTML mit Pfeil.
     "gutWennRunter" dreht die Farbe um — bei TikTok ist weniger
     besser, bei Produktivität mehr. */
  function anTrend(jetzt, vorher, gutWennRunter) {
    if (!vorher) return '<span class="an-trend neutral">neu</span>';
    const prozent = Math.round((jetzt - vorher) / vorher * 100);
    if (Math.abs(prozent) < 3) return '<span class="an-trend neutral">±0 %</span>';
    const rauf = prozent > 0;
    const gut = gutWennRunter ? !rauf : rauf;
    return `<span class="an-trend ${gut ? "gut" : "schlecht"}">${rauf ? "▲" : "▼"} ${Math.abs(prozent)} %</span>`;
  }

  function anKennzahl(label, wert, zusatz, trend) {
    return `<div class="kennzahl">
      <div class="kz-label">${label}</div>
      <div class="kz-wert">${wert}</div>
      <div class="kz-zusatz">${zusatz || ""} ${trend || ""}</div>
    </div>`;
  }

  /* Eine Balkenzeile wie in der bisherigen Habit-Tafel */
  function anBalken(name, anteil, wert, ton) {
    return `<div class="bt-zeile">
      <div class="bt-name">${escapeHTML(name)}</div>
      <div class="bt-spur"><div class="bt-fuellung" style="width:${Math.max(0, Math.min(100, anteil))}%${ton ? ";background:" + ton : ""}"></div></div>
      <div class="bt-wert">${wert}</div>
    </div>`;
  }

  function anBlock(titel, inhalt, zahl) {
    return `<div class="block">
      <div class="block-kopf"><h3>${titel}</h3>${zahl !== undefined ? `<span class="block-zahl">${zahl}</span>` : ""}</div>
      ${inhalt}
    </div>`;
  }

  function anLeer(text) { return `<div class="an-leer">${text}</div>`; }

  /* Kleines Säulendiagramm über die Tage — als reines HTML, das
     reicht für einen Verlauf und bleibt anklickbar. */
  function anSaeulen(werte, beschriften) {
    const hoechst = Math.max(1, ...werte.map(w => w.wert));
    return `<div class="an-saeulen">${werte.map(w => {
      const h = Math.round(w.wert / hoechst * 100);
      return `<div class="an-saeule${w.auffaellig ? " auffaellig" : ""}" title="${escapeHTML(w.titel || "")}">
        <div class="an-saeule-spur"><div class="an-saeule-fuell" style="height:${h}%${w.ton ? ";background:" + w.ton : ""}"></div></div>
        ${beschriften ? `<div class="an-saeule-fuss">${escapeHTML(w.kurz || "")}</div>` : ""}
      </div>`;
    }).join("")}</div>`;
  }

  /* ---------- Habits über eine Spanne ---------- */
  /* Die Quote misst gegen das Wochenziel, nicht gegen jeden Tag.
     Bei "3× pro Woche" zählen drei Tage als voll erfüllt — sonst
     stünde ein bewusst gesetztes Ziel dauerhaft bei 43 %. */
  function anHabitQuote(spanne) {
    const sichtbar = habits.list.slice(0, HABIT_LIMIT);
    const proHabit = sichtbar.map(h => ({ id: h.id, name: h.name, anzahl: 0, ziel: habitZiel(h) }));
    let treffer = 0, moeglich = 0;

    /* Nach Wochen gruppieren: das Ziel gilt je Woche. */
    const wochen = {};
    spanne.forEach(tag => {
      const mo = dateKey(montagVon(new Date(tag + "T12:00:00")));
      (wochen[mo] = wochen[mo] || []).push(tag);
    });

    Object.values(wochen).forEach(tage => {
      sichtbar.forEach((h, i) => {
        const geschafft = tage.filter(t => (habits.done[t] || []).includes(h.id)).length;
        proHabit[i].anzahl += geschafft;
        /* Angebrochene Wochen zählen anteilig, sonst zöge die
           laufende Woche die Quote künstlich nach unten. */
        const anteil = Math.min(1, tage.length / 7);
        const soll = habitZiel(h) * anteil;
        if (soll <= 0) return;
        moeglich += soll;
        treffer += Math.min(geschafft, soll);
      });
    });

    return {
      treffer: Math.round(treffer), moeglich: Math.round(moeglich),
      quote: moeglich ? Math.round(treffer / moeglich * 100) : 0,
      proHabit, sichtbar
    };
  }

  /* ---------- Reiter: Überblick ---------- */
  function anBaueUeberblick() {
    const jetzt = anSpanne(anTage), vorher = anSpanne(anTage, anTage);
    const kJetzt = katUeberSpanne(jetzt), kVorher = katUeberSpanne(vorher);
    const hJetzt = anHabitQuote(jetzt), hVorher = anHabitQuote(vorher);

    const prodAnteil = kJetzt.gesamt ? Math.round(kJetzt.produktiv / kJetzt.gesamt * 100) : 0;
    const prodVorher = kVorher.gesamt ? Math.round(kVorher.produktiv / kVorher.gesamt * 100) : 0;

    const offen = offeneHausaufgaben();
    const ueberfaellig = offen.filter(h => daysUntil(h.date) < 0).length;
    const laengste = alleStreaks()[0] || { name: "—", tage: 0 };

    const kennzahlen = `<div class="kennzahl-reihe">
      ${anKennzahl("Bildschirmzeit", formatMinutes(Math.round(kJetzt.gesamt / anTage)),
        "pro Tag", anTrend(kJetzt.gesamt, kVorher.gesamt, true))}
      ${anKennzahl("Produktivanteil", prodAnteil + " %",
        formatMinutes(kJetzt.produktiv), anTrend(prodAnteil, prodVorher, false))}
      ${anKennzahl("Habit-Quote", hJetzt.quote + " %",
        hJetzt.treffer + " von " + hJetzt.moeglich, anTrend(hJetzt.quote, hVorher.quote, false))}
      ${anKennzahl("Längste Serie", laengste.tage, escapeHTML(laengste.name), "")}
      ${anKennzahl("Offene Aufgaben", offen.length,
        ueberfaellig ? ueberfaellig + " überfällig" : "nichts überfällig", "")}
      ${anKennzahl("Anstehend", termine.filter(t => daysUntil(t.date) >= 0).length
        + klausuren.filter(k => daysUntil(k.date) >= 0).length, "Termine und Klausuren", "")}
    </div>`;

    /* Was springt ins Auge? Nur Kategorien, die sich deutlich
       bewegt haben — sonst steht hier bei jedem Öffnen Rauschen. */
    const auffaellig = KATEGORIEN.filter(k => k.id !== "rest").map(k => {
      const a = kJetzt[k.id], b = kVorher[k.id];
      if (!b || a + b < 60) return null;               // zu wenig für eine Aussage
      const prozent = Math.round((a - b) / b * 100);
      if (Math.abs(prozent) < 20) return null;
      const runterIstGut = k.id !== "produktiv";
      const gut = prozent < 0 ? runterIstGut : !runterIstGut;
      return { titel: k.titel, prozent, ton: k.ton, gut, minuten: a };
    }).filter(Boolean).sort((a, b) => Math.abs(b.prozent) - Math.abs(a.prozent));

    const hinweise = auffaellig.length
      ? `<ul class="an-hinweise">${auffaellig.map(a => `
          <li class="${a.gut ? "gut" : "schlecht"}">
            <span class="an-punkt" style="background:${a.ton}"></span>
            <b>${escapeHTML(a.titel)}</b> ${a.prozent > 0 ? "+" : ""}${a.prozent} % zum Zeitraum davor
            <span class="an-neben">${formatMinutes(a.minuten)}</span>
          </li>`).join("")}</ul>`
      : anLeer("Nichts Auffälliges — alles im gewohnten Rahmen.");

    /* Verlauf der täglichen Bildschirmzeit, Ausreißer markiert */
    const proTag = jetzt.map(tag => {
      const k = katAmTag(tag);
      const d = new Date(tag + "T12:00:00");
      return { tag, wert: k.gesamt, kurz: d.getDate(),
               titel: fmtDate(tag) + ": " + formatMinutes(k.gesamt) };
    });
    const mittel = proTag.reduce((s, x) => s + x.wert, 0) / Math.max(1, proTag.length);
    proTag.forEach(x => { x.auffaellig = mittel > 0 && x.wert > mittel * 1.5; });

    const bericht = anWochenBericht();

    $("anUeberblick").innerHTML =
      `<div class="block">${kennzahlen}</div>` +
      anZieleBlock() +
      anBlock("Auffälligkeiten", hinweise) +
      anZusammenBlock(jetzt) +
      (bericht || "") +
      anBlock("Bildschirmzeit pro Tag", anSaeulen(proTag, anTage <= 31) +
        `<div class="an-fuss">Schnitt ${formatMinutes(Math.round(mittel))} · markiert: mehr als das Anderthalbfache</div>`);
  }

  /* ---------- Reiter: Bildschirmzeit ---------- */
  function anBaueBildschirm() {
    const jetzt = anSpanne(anTage), vorher = anSpanne(anTage, anTage);
    const kJetzt = katUeberSpanne(jetzt), kVorher = katUeberSpanne(vorher);

    /* Kategorien mit Anteil und Richtung */
    const kategorien = KATEGORIEN.map(k => ({ ...k, minuten: kJetzt[k.id], vorher: kVorher[k.id] }))
      .filter(k => k.minuten > 0 || k.vorher > 0)
      .sort((a, b) => b.minuten - a.minuten);

    const katTafel = kategorien.length
      ? `<div class="balken-tafel">${kategorien.map(k => `
          <div class="bt-zeile">
            <div class="bt-name"><span class="an-punkt" style="background:${k.ton}"></span>${escapeHTML(k.titel)}</div>
            <div class="bt-spur"><div class="bt-fuellung" style="width:${kJetzt.gesamt ? Math.round(k.minuten / kJetzt.gesamt * 100) : 0}%;background:${k.ton}"></div></div>
            <div class="bt-wert">${formatMinutes(k.minuten)} ${anTrend(k.minuten, k.vorher, k.id !== "produktiv")}</div>
          </div>`).join("")}</div>`
      : anLeer("Für diesen Zeitraum wurde noch nichts gemessen.");

    /* Muster über die Wochentage — wo sitzt die Zeit wirklich? */
    const WOCHE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
    const proWochentag = WOCHE.map(() => ({ summe: 0, tage: 0 }));
    jetzt.forEach(tag => {
      const d = new Date(tag + "T12:00:00");
      const i = (d.getDay() + 6) % 7;
      proWochentag[i].summe += katAmTag(tag).gesamt;
      proWochentag[i].tage++;
    });
    const wochenWerte = proWochentag.map((w, i) => ({
      wert: w.tage ? Math.round(w.summe / w.tage) : 0,
      kurz: WOCHE[i],
      titel: WOCHE[i] + ": Schnitt " + formatMinutes(w.tage ? Math.round(w.summe / w.tage) : 0)
    }));
    const staerkster = wochenWerte.reduce((a, b) => b.wert > a.wert ? b : a, wochenWerte[0]);

    /* Ranglisten: Programme und Seiten über den ganzen Zeitraum */
    const appSumme = {}, seitenSumme = {};
    jetzt.forEach(tag => {
      const e = pcMessung && pcMessung.tage ? pcMessung.tage[tag] : null;
      if (!e) return;
      (e.apps || []).forEach(a => {
        if (KAT_BROWSER.some(b => a.name.toLowerCase().includes(b))) return;
        appSumme[a.name] = (appSumme[a.name] || 0) + a.minuten;
      });
      Object.values(e.seiten || {}).forEach(liste => liste.forEach(x => {
        const name = x.domain || x.name;
        seitenSumme[name] = (seitenSumme[name] || 0) + x.minuten;
      }));
    });
    const rangliste = (obj, grenze) => Object.entries(obj)
      .map(([name, minuten]) => ({ name, minuten }))
      .sort((a, b) => b.minuten - a.minuten).slice(0, grenze);

    const apps = rangliste(appSumme, 8), seiten = rangliste(seitenSumme, 8);
    const hoechstApp = apps.length ? apps[0].minuten : 1;
    const hoechstSeite = seiten.length ? seiten[0].minuten : 1;

    $("anBildschirm").innerHTML =
      anBlock("Wofür die Zeit draufging", katTafel, formatMinutes(kJetzt.gesamt)) +
      anBlock("Nach Wochentag", anSaeulen(wochenWerte, true) +
        `<div class="an-fuss">Am meisten am ${staerkster.kurz} — Schnitt ${formatMinutes(staerkster.wert)}</div>`) +
      anBlock("Programme", apps.length
        ? `<div class="balken-tafel">${apps.map(a =>
            anBalken(a.name, a.minuten / hoechstApp * 100, formatMinutes(a.minuten))).join("")}</div>`
        : anLeer("Keine Programme gemessen."), apps.length) +
      anBlock("Seiten im Browser", seiten.length
        ? `<div class="balken-tafel">${seiten.map(a =>
            anBalken(a.name, a.minuten / hoechstSeite * 100, formatMinutes(a.minuten))).join("")}</div>`
        : anLeer("Keine Seiten gemessen."), seiten.length);
  }

  /* ---------- Reiter: Habits ---------- */
  function anBaueHabits() {
    const jetzt = anSpanne(anTage), vorher = anSpanne(anTage, anTage);
    const h = anHabitQuote(jetzt), hv = anHabitQuote(vorher);

    /* Quote je Tag als Verlauf */
    const proTag = jetzt.map(tag => {
      const geschafft = (habits.done[tag] || []).filter(id => h.sichtbar.some(x => x.id === id)).length;
      const d = new Date(tag + "T12:00:00");
      return { wert: geschafft, kurz: d.getDate(),
               titel: fmtDate(tag) + ": " + geschafft + " von " + h.sichtbar.length };
    });

    /* Je Habit: bester und schwächster Wochentag */
    const WOCHE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
    const zeilen = h.proHabit.map(ph => {
      const tafel = WOCHE.map(() => ({ ja: 0, gesamt: 0 }));
      jetzt.forEach(tag => {
        const i = (new Date(tag + "T12:00:00").getDay() + 6) % 7;
        tafel[i].gesamt++;
        if ((habits.done[tag] || []).includes(ph.id)) tafel[i].ja++;
      });
      const mitQuote = tafel.map((t, i) => ({ tag: WOCHE[i], q: t.gesamt ? t.ja / t.gesamt : 0, gesamt: t.gesamt }))
        .filter(x => x.gesamt > 0);
      const best = mitQuote.reduce((a, b) => b.q > a.q ? b : a, mitQuote[0] || { tag: "—", q: 0 });
      const schwach = mitQuote.reduce((a, b) => b.q < a.q ? b : a, mitQuote[0] || { tag: "—", q: 0 });
      /* Soll über den Zeitraum: das Wochenziel mal die Zahl der
         Wochen. Sonst stünde "3× pro Woche" dauerhaft bei 43 %. */
      const soll = Math.max(1, Math.round(habitZiel(ph) * anTage / 7));
      return { ...ph, best, schwach, soll, anteil: Math.min(100, Math.round(ph.anzahl / soll * 100)) };
    }).sort((a, b) => b.anzahl - a.anzahl);

    const streaks = alleStreaks();

    $("anHabits").innerHTML =
      `<div class="block"><div class="kennzahl-reihe">
        ${anKennzahl("Quote", h.quote + " %", h.treffer + " von " + h.moeglich, anTrend(h.quote, hv.quote, false))}
        ${anKennzahl("Bester Tag", proTag.length ? Math.max(...proTag.map(x => x.wert)) : 0,
          "von " + h.sichtbar.length + " Habits", "")}
        ${anKennzahl("Serien", streaks.length, streaks.length ? "längste " + streaks[0].tage + " Tage" : "keine", "")}
      </div></div>` +
      anBlock("Geschaffte Habits pro Tag", anSaeulen(proTag, anTage <= 31)) +
      anBlock("Je Habit", zeilen.length
        ? `<div class="balken-tafel">${zeilen.map(z => `
            <div class="bt-zeile">
              <div class="bt-name">${escapeHTML(z.name)}<span class="an-neben">stark ${z.best.tag} · schwach ${z.schwach.tag}</span></div>
              <div class="bt-spur"><div class="bt-fuellung" style="width:${z.anteil}%"></div></div>
              <div class="bt-wert">${z.anzahl}/${z.soll}</div>
            </div>`).join("")}</div>`
        : anLeer("Noch keine Habits angelegt."), zeilen.length) +
      anBlock("Serien", streaks.length
        ? `<div class="balken-tafel">${streaks.map(s =>
            anBalken(s.name, s.tage / Math.max(1, streaks[0].tage) * 100, s.tage + " Tage")).join("")}</div>`
        : anLeer("Noch keine Serie."), streaks.length);
  }

  /* ---------- Reiter: Schule ---------- */
  function anBaueSchule() {
    const jetzt = anSpanne(anTage);
    const vonTag = jetzt[0];

    /* Hausaufgaben, die in den Zeitraum fielen */
    const imZeitraum = hausaufgaben.filter(h => h.date >= vonTag && h.date <= todayStr());
    const fertig = imZeitraum.filter(h => h.erledigt);
    /* Pünktlich heißt: spätestens am Fälligkeitstag abgehakt. Ohne
       Erledigungsdatum lässt sich das für ältere Einträge nicht mehr
       sagen — die zählen als unbekannt, nicht als unpünktlich. */
    const mitDatum = fertig.filter(h => h.fertigAm);
    const puenktlich = mitDatum.filter(h => h.fertigAm <= h.date);
    const quote = mitDatum.length ? Math.round(puenktlich.length / mitDatum.length * 100) : null;

    const offen = offeneHausaufgaben();
    const ueberfaellig = offen.filter(h => daysUntil(h.date) < 0);

    /* Aufwand je Fach: Hausaufgaben und Klausuren zusammen */
    const proFach = {};
    hausaufgaben.forEach(h => {
      if (!h.fach) return;
      const f = (proFach[h.fach] = proFach[h.fach] || { ha: 0, kl: 0 });
      f.ha++;
    });
    klausuren.forEach(k => {
      if (!k.fach) return;
      const f = (proFach[k.fach] = proFach[k.fach] || { ha: 0, kl: 0 });
      f.kl++;
    });
    const faecher = Object.entries(proFach)
      .map(([id, f]) => ({ id, name: fachInfo(id).kurz, lang: fachInfo(id).lang, ha: f.ha, kl: f.kl, summe: f.ha + f.kl }))
      .sort((a, b) => b.summe - a.summe).slice(0, 8);
    const hoechstFach = faecher.length ? faecher[0].summe : 1;

    /* Klausurdichte: wie viele stehen je Monat an? */
    const kommende = klausuren.filter(k => daysUntil(k.date) >= 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    const proMonat = {};
    kommende.forEach(k => {
      const m = k.date.slice(0, 7);
      proMonat[m] = (proMonat[m] || 0) + 1;
    });
    const monate = Object.entries(proMonat).sort().map(([m, n]) => {
      const d = new Date(m + "-01T12:00:00");
      return { wert: n, kurz: MONTHS[d.getMonth()].slice(0, 3), titel: n + " Klausuren" };
    });

    const naechste = kommende[0];
    const naechsteText = naechste
      ? escapeHTML(naechste.title) + " · " + fmtDate(naechste.date)
      : "keine geplant";

    $("anSchule").innerHTML =
      '<div class="block"><div class="kennzahl-reihe">'
      + anKennzahl("Pünktlich", quote === null ? "—" : quote + " %",
          mitDatum.length ? puenktlich.length + " von " + mitDatum.length : "noch keine Daten", "")
      + anKennzahl("Offen", offen.length,
          ueberfaellig.length ? ueberfaellig.length + " überfällig" : "nichts überfällig", "")
      + anKennzahl("Erledigt", fertig.length, "im Zeitraum", "")
      + anKennzahl("Nächste Klausur", naechste ? daysUntil(naechste.date) + " T" : "—", naechsteText, "")
      + '</div></div>'
      + anBlock("Aufwand je Fach", faecher.length
          ? '<div class="balken-tafel">' + faecher.map(f =>
              '<div class="bt-zeile">'
              + '<div class="bt-name">' + escapeHTML(f.lang || f.name)
              + '<span class="an-neben">' + f.ha + ' Aufgaben · ' + f.kl + ' Klausuren</span></div>'
              + '<div class="bt-spur"><div class="bt-fuellung" style="width:'
              + Math.round(f.summe / hoechstFach * 100) + '%"></div></div>'
              + '<div class="bt-wert">' + f.summe + '</div>'
              + '</div>').join("") + '</div>'
          : anLeer("Noch nichts eingetragen."), faecher.length)
      + anBlock("Klausuren je Monat", monate.length
          ? anSaeulen(monate, true)
          : anLeer("Keine Klausuren geplant."), kommende.length)
      + anBlock("Überfällig", ueberfaellig.length
          ? '<ul class="an-hinweise">' + ueberfaellig
              .sort((a, b) => a.date.localeCompare(b.date))
              .map(h => '<li class="schlecht">'
                + '<span class="an-punkt" style="background:var(--red)"></span>'
                + '<b>' + escapeHTML(h.title) + '</b>'
                + '<span class="an-neben">seit ' + Math.abs(daysUntil(h.date))
                + ' Tagen · ' + fmtDate(h.date) + '</span></li>').join("") + '</ul>'
          : anLeer("Nichts überfällig."), ueberfaellig.length);
  }

  /* ---------- Reiter: Nutzung ---------- */
  const AN_AKTION_NAMEN = {
    habit: "Habit abgehakt", streak: "Streak abgehakt", termin: "Termin angelegt",
    klausur: "Klausur angelegt", hausaufgabe: "Hausaufgabe angelegt",
    hausaufgabe_fertig: "Hausaufgabe erledigt", kalorien: "Kalorien eingetragen",
    suche: "Suche benutzt", slash: "Slash-Befehl", lernkarte: "Lernkarte",
    projekt: "Projekt bearbeitet", planung: "Ablauf bearbeitet", einstellungen: "Einstellungen",
    notiz: "Notiz angelegt"
  };
  const AN_GERAET_NAMEN = { pc: "Rechner", tablet: "iPad", handy: "Telefon" };

  function anBaueNutzung() {
    const kasten = $("anNutzung");
    if (!nutzDaten) { kasten.innerHTML = anLeer("Wird geladen …"); return; }

    const spanne = anSpanne(anTage);
    const tage = spanne.map(t => nutzDaten[t]).filter(Boolean);

    if (!tage.length) {
      kasten.innerHTML = anBlock("Nutzung des Dashboards",
        anLeer("Noch nichts aufgezeichnet. Ab jetzt wird mitgeschrieben, welche Seiten du öffnest, wie lange sie offen sind und was du tust."));
      return;
    }

    const seiten = {}, aktionen = {}, geraete = {};
    const stunden = Array.from({ length: 24 }, () => 0);
    tage.forEach(t => {
      Object.entries(t.seiten || {}).forEach(([name, e]) => {
        const s = seiten[name] || (seiten[name] = { auf: 0, dauer: 0 });
        s.auf += e.auf || 0; s.dauer += e.dauer || 0;
      });
      Object.entries(t.aktionen || {}).forEach(([k, v]) => { aktionen[k] = (aktionen[k] || 0) + v; });
      Object.entries(t.geraete || {}).forEach(([k, v]) => { geraete[k] = (geraete[k] || 0) + v; });
      Object.entries(t.stunden || {}).forEach(([k, v]) => { stunden[Number(k)] += v; });
    });

    const seitenListe = Object.entries(seiten)
      .map(([name, e]) => ({ name, auf: e.auf, dauer: e.dauer }))
      .sort((a, b) => b.dauer - a.dauer);
    const hoechstDauer = seitenListe.length ? seitenListe[0].dauer : 1;
    const gesamtDauer = seitenListe.reduce((s, x) => s + x.dauer, 0);
    const gesamtAuf = seitenListe.reduce((s, x) => s + x.auf, 0);

    const aktionsListe = Object.entries(aktionen)
      .map(([id, n]) => ({ id: id, name: AN_AKTION_NAMEN[id] || id, n: n }))
      .sort((a, b) => b.n - a.n);
    const hoechstAktion = aktionsListe.length ? aktionsListe[0].n : 1;

    const stundenWerte = stunden.map((w, i) => ({
      wert: w, kurz: i % 3 === 0 ? String(i).padStart(2, "0") : "",
      titel: String(i).padStart(2, "0") + " Uhr: " + w + " Ereignisse"
    }));
    const wachste = stunden.indexOf(Math.max(...stunden));

    const geraeteListe = Object.entries(geraete)
      .map(([id, n]) => ({ name: AN_GERAET_NAMEN[id] || id, n: n }))
      .sort((a, b) => b.n - a.n);
    const geraeteSumme = geraeteListe.reduce((s, x) => s + x.n, 0) || 1;

    const seitenNamen = {};
    SEITEN.forEach(s => { seitenNamen[s.id] = s.titel; });

    kasten.innerHTML =
      '<div class="block"><div class="kennzahl-reihe">'
      + anKennzahl("Aufrufe", gesamtAuf, "an " + tage.length + " Tagen", "")
      + anKennzahl("Zeit im Dashboard", formatMinutes(Math.round(gesamtDauer / 60)),
          "Schnitt " + formatMinutes(Math.round(gesamtDauer / 60 / tage.length)) + " pro Tag", "")
      + anKennzahl("Meistgenutzt", seitenListe.length
          ? escapeHTML(seitenNamen[seitenListe[0].name] || seitenListe[0].name) : "—",
          seitenListe.length ? formatMinutes(Math.round(seitenListe[0].dauer / 60)) : "", "")
      + anKennzahl("Aktivste Stunde", String(wachste).padStart(2, "0") + " Uhr",
          Math.max.apply(null, stunden) + " Ereignisse", "")
      + '</div></div>'
      + anBlock("Seiten", '<div class="balken-tafel">' + seitenListe.map(s =>
          '<div class="bt-zeile">'
          + '<div class="bt-name">' + escapeHTML(seitenNamen[s.name] || s.name)
          + '<span class="an-neben">' + s.auf + '× geöffnet</span></div>'
          + '<div class="bt-spur"><div class="bt-fuellung" style="width:'
          + Math.round(s.dauer / hoechstDauer * 100) + '%"></div></div>'
          + '<div class="bt-wert">' + formatMinutes(Math.round(s.dauer / 60)) + '</div>'
          + '</div>').join("") + '</div>', seitenListe.length)
      + anBlock("Wann du das Dashboard benutzt", anSaeulen(stundenWerte, true))
      + anBlock("Was du tust", aktionsListe.length
          ? '<div class="balken-tafel">' + aktionsListe.map(a =>
              anBalken(a.name, a.n / hoechstAktion * 100, a.n)).join("") + '</div>'
          : anLeer("Noch keine Aktionen gezählt."), aktionsListe.length)
      + anBlock("Geräte", geraeteListe.length
          ? '<div class="balken-tafel">' + geraeteListe.map(g =>
              anBalken(g.name, g.n / geraeteSumme * 100, Math.round(g.n / geraeteSumme * 100) + " %")).join("") + '</div>'
          : anLeer("—"));
  }


  /* ==========================================================
     ZIELE UND GRENZWERTE
     Eine Zahl allein sagt wenig — erst gegen ein Ziel gehalten
     wird sie zu einer Aussage. Die Werte gelten pro Tag und
     gehen über den Abgleich auf alle Geräte mit.

     "richtung" sagt, wohin es gut ist: bei TikTok ist weniger
     besser, bei Produktivzeit mehr.
     ========================================================== */
  const ZIEL_ARTEN = [
    { id: "bildschirm", titel: "Bildschirmzeit",  einheit: "min", richtung: "runter", vorgabe: 240 },
    { id: "produktiv",  titel: "Produktivzeit",   einheit: "min", richtung: "rauf",   vorgabe: 120 },
    { id: "tiktok",     titel: "TikTok",          einheit: "min", richtung: "runter", vorgabe: 45 },
    { id: "spiele",     titel: "Videospiele",     einheit: "min", richtung: "runter", vorgabe: 90 },
    { id: "habitQuote", titel: "Habit-Quote",     einheit: "%",   richtung: "rauf",   vorgabe: 80 }
  ];

  let ziele = store.get("lifeos_ziele", null);
  if (!ziele || typeof ziele !== "object") {
    ziele = {};
    ZIEL_ARTEN.forEach(z => { ziele[z.id] = z.vorgabe; });
    store.set("lifeos_ziele", ziele);
  }

  /* Der heutige Stand je Zielart */
  function zielHeute(id) {
    if (id === "habitQuote") {
      const sichtbar = habits.list.slice(0, HABIT_LIMIT);
      const geschafft = (habits.done[todayStr()] || []).filter(x => sichtbar.some(h => h.id === x)).length;
      return sichtbar.length ? Math.round(geschafft / sichtbar.length * 100) : 0;
    }
    const k = katAmTag(todayStr());
    return id === "bildschirm" ? k.gesamt : k[id] || 0;
  }

  /* Wird ein Grenzwert gerissen? Nur die Richtung "runter" kann
     gerissen werden — ein nicht erreichtes Ziel ist keine Warnung. */
  function zieleGerissen() {
    return ZIEL_ARTEN
      .filter(z => z.richtung === "runter")
      .map(z => ({ ...z, wert: zielHeute(z.id), grenze: Number(ziele[z.id]) || 0 }))
      .filter(z => z.grenze > 0 && z.wert > z.grenze);
  }

  function anZieleBlock() {
    const zeilen = ZIEL_ARTEN.map(z => {
      const wert = zielHeute(z.id);
      const ziel = Number(ziele[z.id]) || 0;
      const anteil = ziel ? Math.min(100, Math.round(wert / ziel * 100)) : 0;
      const erreicht = z.richtung === "rauf" ? wert >= ziel : wert <= ziel;
      const zeigWert = z.einheit === "min" ? formatMinutes(wert) : wert + " %";
      const zeigZiel = z.einheit === "min" ? formatMinutes(ziel) : ziel + " %";
      return '<div class="bt-zeile zl-zeile">'
        + '<div class="bt-name">' + escapeHTML(z.titel)
        + '<span class="an-neben">' + (z.richtung === "rauf" ? "mindestens " : "höchstens ") + zeigZiel + '</span></div>'
        + '<div class="bt-spur"><div class="bt-fuellung ' + (erreicht ? "gut" : "schlecht") + '" style="width:' + anteil + '%"></div></div>'
        + '<div class="bt-wert ' + (erreicht ? "gut" : "schlecht") + '">' + zeigWert + '</div>'
        + '<input class="zl-feld" type="number" min="0" step="5" value="' + ziel + '" data-ziel="' + z.id + '" aria-label="Ziel für ' + escapeHTML(z.titel) + '">'
        + '</div>';
    }).join("");

    return anBlock("Ziele heute",
      '<div class="balken-tafel">' + zeilen + '</div>'
      + '<div class="an-fuss">Die Zahl rechts lässt sich ändern — sie gilt pro Tag und auf allen Geräten.</div>');
  }

  /* Änderungen an den Zielfeldern übernehmen */
  document.addEventListener("change", e => {
    const feld = e.target.closest(".zl-feld");
    if (!feld) return;
    const wert = Math.max(0, Math.round(Number(feld.value) || 0));
    ziele[feld.dataset.ziel] = wert;
    store.set("lifeos_ziele", ziele);
    if (aktuelleSeite === "analyse") baueAnalyse();
  });

  /* ==========================================================
     ZUSAMMENHÄNGE
     Nicht "wie viel", sondern "was hängt womit zusammen". Die
     Tage werden am Mittelwert des einen Werts geteilt und der
     andere Wert in beiden Hälften verglichen.

     Bewusst zurückhaltend: unter sechs Tagen je Hälfte oder bei
     einem Unterschied unter 15 Prozent wird nichts behauptet.
     Aus vier Tagen lässt sich nichts ableiten, und ein Satz, der
     so klingt als wüsste er etwas, wäre schlimmer als keiner.
     ========================================================== */
  const ZUSAMMEN_MIN_TAGE = 6;

  function anTagesWerte(spanne) {
    const sichtbar = habits.list.slice(0, HABIT_LIMIT);
    return spanne.map(tag => {
      const k = katAmTag(tag);
      const geschafft = (habits.done[tag] || []).filter(x => sichtbar.some(h => h.id === x)).length;
      const fertig = hausaufgaben.filter(h => h.fertigAm === tag).length;
      return { tag, gesamt: k.gesamt, produktiv: k.produktiv, spiele: k.spiele,
               tiktok: k.tiktok, youtube: k.youtube, habits: geschafft, hausaufgaben: fertig };
    }).filter(t => t.gesamt > 0 || t.habits > 0);
  }

  /* Teilt die Tage am Mittelwert von "treiber" und vergleicht
     "wirkung". Gibt einen fertigen Satz zurück oder null. */
  function anZusammenhang(werte, treiber, wirkung, text) {
    const brauchbar = werte.filter(w => w[treiber] !== undefined);
    if (brauchbar.length < ZUSAMMEN_MIN_TAGE * 2) return null;
    const mittel = brauchbar.reduce((s, w) => s + w[treiber], 0) / brauchbar.length;
    const viel = brauchbar.filter(w => w[treiber] > mittel);
    const wenig = brauchbar.filter(w => w[treiber] <= mittel);
    if (viel.length < ZUSAMMEN_MIN_TAGE || wenig.length < ZUSAMMEN_MIN_TAGE) return null;

    const schnitt = l => l.reduce((s, w) => s + w[wirkung], 0) / l.length;
    const a = schnitt(viel), b = schnitt(wenig);
    if (!b) return null;
    const abstand = Math.round((a - b) / b * 100);
    if (Math.abs(abstand) < 15) return null;

    return { text: text(a, b, Math.abs(abstand), abstand > 0), abstand: Math.abs(abstand) };
  }

  function anZusammenBlock(spanne) {
    const werte = anTagesWerte(spanne);
    const ein = n => n.toFixed(1).replace(".", ",");

    const kandidaten = [];

    let z = anZusammenhang(werte, "spiele", "habits",
      (a, b, p, rauf) => "An Tagen mit viel <b>Videospielzeit</b> schaffst du im Schnitt <b>"
        + ein(a) + "</b> Habits — an den übrigen <b>" + ein(b) + "</b>.");
    if (z) kandidaten.push(z);

    z = anZusammenhang(werte, "produktiv", "habits",
      (a, b) => "An Tagen mit viel <b>Produktivzeit</b> schaffst du <b>" + ein(a)
        + "</b> Habits — sonst <b>" + ein(b) + "</b>.");
    if (z) kandidaten.push(z);

    z = anZusammenhang(werte, "gesamt", "hausaufgaben",
      (a, b) => "An Tagen mit viel <b>Bildschirmzeit</b> hakst du <b>" + ein(a)
        + "</b> Hausaufgaben ab — an ruhigeren Tagen <b>" + ein(b) + "</b>.");
    if (z) kandidaten.push(z);

    z = anZusammenhang(werte, "tiktok", "produktiv",
      (a, b) => "An Tagen mit viel <b>TikTok</b> kommen <b>" + formatMinutes(Math.round(a))
        + "</b> Produktivzeit zusammen — sonst <b>" + formatMinutes(Math.round(b)) + "</b>.");
    if (z) kandidaten.push(z);

    const inhalt = kandidaten.length
      ? '<ul class="an-hinweise">' + kandidaten
          .sort((x, y) => y.abstand - x.abstand)
          .map(k => '<li><span class="an-punkt" style="background:var(--violet)"></span><span>' + k.text + '</span></li>')
          .join("") + '</ul>'
      : anLeer("Noch zu wenig Tage für einen belastbaren Vergleich. Ab etwa zwei Wochen Messung stehen hier Sätze wie „an Tagen mit viel Spielzeit schaffst du weniger Habits“.");

    return anBlock("Zusammenhänge", inhalt);
  }

  /* ==========================================================
     WOCHENBERICHT
     Einmal je Woche ein kurzer Vergleich zur Vorwoche. Steht
     dauerhaft im Überblick und meldet sich zusätzlich einmal,
     wenn eine neue Woche begonnen hat.
     ========================================================== */
  /* Montag als Wochenanfang. "tage" begrenzt die Länge — die
     laufende Woche ist noch nicht voll, und eine halbe Woche gegen
     eine ganze zu halten wäre kein Vergleich, sondern ein Fehler. */
  function anWochenSpanne(zurueck, tage) {
    const d = new Date();
    const versatz = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - versatz - 7 * zurueck);
    const anzahl = tage || 7;
    const raus = [];
    for (let i = 0; i < anzahl; i++) {
      const x = new Date(d); x.setDate(d.getDate() + i);
      raus.push(dateKey(x));
    }
    return raus;
  }

  function anWochenBericht() {
    /* Diese Woche bis heute gegen genauso viele Tage der Vorwoche */
    const bisher = ((new Date().getDay() + 6) % 7) + 1;
    const letzte = anWochenSpanne(0, bisher), davor = anWochenSpanne(1, bisher);
    const kL = katUeberSpanne(letzte), kD = katUeberSpanne(davor);
    const hL = anHabitQuote(letzte), hD = anHabitQuote(davor);
    const haL = hausaufgaben.filter(h => letzte.includes(h.fertigAm)).length;
    const haD = hausaufgaben.filter(h => davor.includes(h.fertigAm)).length;

    if (!kL.gesamt && !hL.treffer) return null;

    const zeilen = [
      { titel: "Bildschirmzeit", jetzt: formatMinutes(kL.gesamt), trend: anTrend(kL.gesamt, kD.gesamt, true) },
      { titel: "Produktivzeit",  jetzt: formatMinutes(kL.produktiv), trend: anTrend(kL.produktiv, kD.produktiv, false) },
      { titel: "Habit-Quote",    jetzt: hL.quote + " %", trend: anTrend(hL.quote, hD.quote, false) },
      { titel: "Hausaufgaben",   jetzt: haL + " erledigt", trend: anTrend(haL, haD, false) }
    ];

    const von = letzte[0], bis = letzte[letzte.length - 1];
    return anBlock("Diese Woche: " + fmtDate(von) + " bis " + fmtDate(bis),
      '<div class="balken-tafel">' + zeilen.map(z =>
        '<div class="bt-zeile"><div class="bt-name">' + z.titel + '</div>'
        + '<div class="bt-wert wb-wert">' + z.jetzt + ' ' + z.trend + '</div></div>').join("") + '</div>'
      + '<div class="an-fuss">Verglichen mit den ersten ' + bisher
      + (bisher === 1 ? ' Tag' : ' Tagen') + ' der Vorwoche.</div>');
  }

  /* Einmal je Woche darauf hinweisen, dass es einen neuen Bericht gibt */
  function wochenberichtMelden() {
    const woche = (() => {
      const d = new Date();
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      return dateKey(d);
    })();
    if (store.get("lifeos_bericht_woche", null) === woche) return;
    if (!anWochenBericht()) return;
    store.set("lifeos_bericht_woche", woche);
    setTimeout(() => showToast("Der Wochenbericht steht bereit — unter Analyse."), 2500);
  }

  /* ---------- Reiter: Kalorien ---------- */
  function anBaueKalorien() {
    const spanne = anSpanne(anTage);
    const ziel = settings.calGoal || 0;
    const proTag = spanne.map(tag => {
      const wert = tag === todayStr() ? (kalorien.consumed || 0) : (kalVerlauf && kalVerlauf[tag]) || 0;
      const d = new Date(tag + "T12:00:00");
      return { tag, wert, kurz: d.getDate(),
               titel: fmtDate(tag) + ": " + wert + " kcal" + (ziel ? " von " + ziel : "") };
    });
    const mitWert = proTag.filter(t => t.wert > 0);
    const schnitt = mitWert.length ? Math.round(mitWert.reduce((s, t) => s + t.wert, 0) / mitWert.length) : 0;
    const imZiel = ziel ? mitWert.filter(t => t.wert <= ziel).length : 0;

    /* Über dem Ziel wird markiert */
    proTag.forEach(t => { t.auffaellig = ziel > 0 && t.wert > ziel; });

    const WOCHE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
    const proWoche = WOCHE.map(() => ({ summe: 0, tage: 0 }));
    mitWert.forEach(t => {
      const i = (new Date(t.tag + "T12:00:00").getDay() + 6) % 7;
      proWoche[i].summe += t.wert; proWoche[i].tage++;
    });
    const wochenWerte = proWoche.map((w, i) => ({
      wert: w.tage ? Math.round(w.summe / w.tage) : 0, kurz: WOCHE[i],
      titel: WOCHE[i] + ": Schnitt " + (w.tage ? Math.round(w.summe / w.tage) : 0) + " kcal"
    }));

    $("anKalorien").innerHTML =
      '<div class="block"><div class="kennzahl-reihe">'
      + anKennzahl("Schnitt", schnitt + " kcal", mitWert.length + " Tage erfasst", "")
      + anKennzahl("Tagesziel", ziel ? ziel + " kcal" : "—", ziel ? "" : "in den Einstellungen setzen", "")
      + anKennzahl("Im Ziel", ziel && mitWert.length ? Math.round(imZiel / mitWert.length * 100) + " %" : "—",
          ziel ? imZiel + " von " + mitWert.length + " Tagen" : "", "")
      + anKennzahl("Erfasst", mitWert.length + " / " + anTage, "Tage mit Eintrag", "")
      + '</div></div>'
      + anBlock("Verlauf", mitWert.length
          ? anSaeulen(proTag, anTage <= 31)
            + '<div class="an-fuss">' + (ziel ? "Markiert: über dem Tagesziel von " + ziel + " kcal" : "Kein Tagesziel gesetzt") + '</div>'
          : anLeer("Noch nichts eingetragen."))
      + anBlock("Nach Wochentag", mitWert.length
          ? anSaeulen(wochenWerte, true)
          : anLeer("Noch nichts eingetragen."));
  }

  /* ---------- Steuerung ---------- */
  function anReiterAnwenden() {
    document.querySelectorAll("#anReiter [data-areiter]").forEach(b =>
      b.classList.toggle("active", b.dataset.areiter === anReiter));
    Object.keys(AN_TAFELN).forEach(id =>
      $(AN_TAFELN[id]).classList.toggle("aus", id !== anReiter));
  }

  function nutzungHolen() {
    const von = anSpanne(anTage)[0];
    return fetch("/api/nutzung?von=" + von, { cache: "no-store" })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(r.status)))
      .then(d => { nutzDaten = d.tage || {}; })
      .catch(() => { nutzDaten = nutzDaten || {}; });
  }

  function baueAnalyse() {
    anReiterAnwenden();
    $("analyseSub").textContent = "Zeitraum: die letzten " + anTage + " Tage";

    if (anReiter === "ueberblick") anBaueUeberblick();
    else if (anReiter === "bildschirm") anBaueBildschirm();
    else if (anReiter === "habits") anBaueHabits();
    else if (anReiter === "schule") anBaueSchule();
    else if (anReiter === "kalorien") anBaueKalorien();
    else if (anReiter === "nutzung") {
      anBaueNutzung();
      /* Beim ersten Blick nachladen und danach noch einmal zeichnen */
      if (!nutzDaten) nutzungHolen().then(() => { if (anReiter === "nutzung") anBaueNutzung(); });
    }
  }

  document.querySelectorAll("#anReiter [data-areiter]").forEach(b =>
    b.addEventListener("click", () => { anReiter = b.dataset.areiter; baueAnalyse(); }));

  document.querySelectorAll("#anZeitraum [data-anz]").forEach(b =>
    b.addEventListener("click", () => {
      anTage = Number(b.dataset.anz);
      document.querySelectorAll("#anZeitraum [data-anz]").forEach(x =>
        x.classList.toggle("active", x === b));
      nutzDaten = null;                 // anderer Zeitraum, neu holen
      baueAnalyse();
    }));


  /* ==========================================================
     SLASH-BEFEHLE IN DER SUCHE
     Wie in der Spielkonsole: die Befehle bauen sich Stufe für
     Stufe auf. "/" zeigt nur die Oberbegriffe, "/streaks " dann
     dessen Unterbefehle, "/streaks check " dann die vorhandenen
     Einträge. Tab vervollständigt und schaltet weiter, Pfeile
     wählen aus, Enter führt aus, Escape schließt.
     ========================================================== */
  const slashBox = $("slashBox");
  const sucheFeld = $("captureInput");

  const NAV_SYMBOLE = {};
  document.querySelectorAll(".nav-link[data-seite]").forEach(a => {
    NAV_SYMBOLE[a.dataset.seite] = a.querySelector("svg").outerHTML;
  });

  /* Ein Befehl bekommt sein Zeichen normalerweise von der Seite, die
     er öffnet. Wer keine Seite hat — Papierkorb, Rückblick —, bringt
     eines mit: sonst steht seine Zeile ohne Symbol in der Liste und
     sieht aus wie ein Fehler. */
  const SYM_PAPIERKORB =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" '
    + 'stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M4 6.5h16"/><path d="M9.5 6.5V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7"/>'
    + '<path d="M6.2 6.5 7 19.2a1.6 1.6 0 0 0 1.6 1.5h6.8a1.6 1.6 0 0 0 1.6-1.5l.8-12.7"/>'
    + '<path d="M10.3 10.2v6.6M13.7 10.2v6.6"/></svg>';

  const SYM_RUECKBLICK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" '
    + 'stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M3.6 8.6V4.4"/><path d="M3.6 8.6h4.2"/>'
    + '<path d="M4.2 8.4A8.4 8.4 0 1 1 3.7 14"/>'
    + '<path d="M12 7.6V12l3 1.9"/></svg>';

  /* Eine Stelle für beide Quellen — sonst muss man an sechs Orten
     daran denken. */
  const befehlSymbol = knoten =>
    (knoten && (knoten.symbolSvg || NAV_SYMBOLE[knoten.seite])) || "";

  /* ---------- Unterbefehle, die mehrfach vorkommen ---------- */
  const habitCheck = {
    wort: "check", titel: "Habit abhaken", info: "für heute umschalten", art: "auswahl",
    liste: () => habits.list.slice(0, HABIT_LIMIT).map(h => ({
      wert: h.name, id: h.id,
      zusatz: habitErledigt(h.id, todayStr()) ? "heute erledigt" : "heute offen" })),
    tun: e => {
      toggleHabit(e.id);
      if (aktuelleSeite === "habits") baueHabits();
      showToast(`„${e.wert}" ` + (habitErledigt(e.id, todayStr()) ? "abgehakt" : "zurückgenommen"));
    }
  };
  const habitLoeschen = {
    wort: "löschen", titel: "Habit löschen", info: "entfernt den Habit", art: "auswahl",
    liste: () => habits.list.map(h => ({ wert: h.name, id: h.id })),
    tun: e => {
      habits.list = habits.list.filter(h => h.id !== e.id);
      // Tageseinträge des gelöschten Habits mit aufräumen
      Object.keys(habits.done).forEach(tag => {
        habits.done[tag] = habits.done[tag].filter(id => id !== e.id);
      });
      store.set("lifeos_habits", habits);
      renderHabits();
      if (aktuelleSeite === "habits") baueHabits();
      showToast(`Habit „${e.wert}" gelöscht`);
    }
  };
  const habitNeu = {
    wort: "neu", titel: "Habit anlegen", info: "Name eingeben, dann Enter", art: "frei",
    tun: name => {
      if (habits.list.length >= HABIT_LIMIT) return showToast(`Mehr als ${HABIT_LIMIT} Habits gehen nicht`, "warn");
      habits.list.push({ id: "h" + Date.now(), name });
      store.set("lifeos_habits", habits);
      renderHabits();
      if (aktuelleSeite === "habits") baueHabits();
      showToast(`Habit „${name}" angelegt`);
    }
  };

  const streakNeu = {
    wort: "neu", titel: "Streak anlegen", info: "Name eingeben, dann Enter", art: "frei",
    tun: name => {
      if (streaks.list.length >= STREAK_LIMIT) return showToast(`Mehr als ${STREAK_LIMIT} Streaks gehen nicht`, "warn");
      streaks.list.push({ id: "s" + Date.now(), name, quelle: "manuell" });
      store.set("lifeos_streaks", streaks);
      renderStreaks();
      if (aktuelleSeite === "habits") baueHabits();
      showToast(`Streak „${name}" angelegt`);
    }
  };
  const streakCheck = {
    wort: "check", titel: "Streak abhaken", info: "für heute umschalten", art: "auswahl",
    liste: () => streaks.list.slice(0, STREAK_LIMIT).map(e => ({
      wert: e.name, id: e.id,
      zusatz: streakErledigt(e.id, todayStr()) ? "heute erledigt" : `${streakLaenge(e.id)} Tage` })),
    tun: e => {
      toggleStreak(e.id);
      if (aktuelleSeite === "habits") baueHabits();
      showToast(`„${e.wert}" ` + (streakErledigt(e.id, todayStr()) ? "abgehakt" : "zurückgenommen"));
    }
  };
  const streakLoeschen = {
    wort: "löschen", titel: "Streak löschen", info: "entfernt die Serie", art: "auswahl",
    liste: () => streaks.list.map(e => ({ wert: e.name, id: e.id })),
    tun: e => {
      streaks.list = streaks.list.filter(x => x.id !== e.id);
      Object.keys(streaks.done).forEach(tag => {
        streaks.done[tag] = streaks.done[tag].filter(id => id !== e.id);
      });
      store.set("lifeos_streaks", streaks);
      renderStreaks();
      if (aktuelleSeite === "habits") baueHabits();
      showToast(`Streak „${e.wert}" gelöscht`);
    }
  };

  /* ---------- Der Befehlsbaum ---------- */
  const BAUM = [
    { wort: "/dashboard", titel: "Dashboard", info: "Zur Übersicht", seite: "dashboard" },

    { wort: "/papierkorb", titel: "Papierkorb", info: "Gelöschtes zurückholen",
      symbolSvg: SYM_PAPIERKORB,
      unter: [
        { wort: "öffnen", titel: "Papierkorb öffnen", info: "zeigt, was verschwunden ist", art: "sofort",
          tun: () => openSettings("papierkorb") }
      ] },

    { wort: "/rückblick", titel: "Wochenrückblick", info: "Schreibt die Notiz jetzt",
      symbolSvg: SYM_RUECKBLICK,
      unter: [
        { wort: "woche", titel: "Vergangene Woche", info: "als Notiz ablegen", art: "sofort",
          tun: () => {
            const start = wochenStart(new Date());
            start.setDate(start.getDate() - 7);
            const n = rueckblickSchreiben(start);
            notizOffen = n.id;
            notizenOeffnen(true);
            notizenZeichnen();
            showToast("Rückblick geschrieben.", "success");
          } },
        { wort: "diese", titel: "Laufende Woche", info: "Zwischenstand als Notiz", art: "sofort",
          tun: () => {
            const n = rueckblickSchreiben(wochenStart(new Date()));
            notizOffen = n.id;
            notizenOeffnen(true);
            notizenZeichnen();
            showToast("Zwischenstand geschrieben.", "success");
          } }
      ] },

    { wort: "/kalender", titel: "Kalender & Schule", info: "Termine und Klausuren", seite: "kalender",
      unter: [
        { wort: "neu", titel: "Termin anlegen", info: "Name eingeben, dann Enter",
          art: "entwurf", entwurfArt: "termin" },
        { wort: "löschen", titel: "Termin löschen", info: "entfernt den Termin", art: "auswahl",
          liste: () => termine.map(t => ({ wert: t.title, id: t.id, zusatz: fmtDate(t.date) })),
          tun: e => { loescheEintrag(e.id, "termin");
                      if (aktuelleSeite === "kalender") baueKalender();
                      showToast(`Termin „${e.wert}" gelöscht`); } }
      ] },

    { wort: "/klausuren", titel: "Klausuren", info: "Klausurtermine", seite: "kalender",
      unter: [
        /* Die Faecher schlagen sich beim Anlegen selbst vor — wer eins
           waehlt, bekommt Datum, Stunde und Raum direkt aus dem Plan. */
        { wort: "neu", titel: "Klausur anlegen", info: "Fach wählen oder eigenen Namen tippen",
          art: "entwurf", entwurfArt: "klausur",
          vorschlaege: () => Object.keys(FAECHER).map(id => ({
            id, wert: fachInfo(id).kurz, lang: fachInfo(id).lang })) },
        { wort: "karten", titel: "Karten öffnen", info: "Karteikarten der Klausur",
          art: "auswahl",
          liste: () => klausuren.filter(k => !istTest(k)).map(k => ({
            wert: k.title, id: k.id,
            zusatz: (kartenVon(k.id).length || 0) + " Karten · " + fmtDate(k.date) })),
          tun: e => { seiteZeigen("lernen"); kartenOeffnen(e.id, "liste"); } },
        { wort: "abfragen", titel: "Klausur abfragen", info: "Karten der Reihe nach",
          art: "auswahl",
          liste: () => klausuren.filter(k => !istTest(k) && kartenVon(k.id).length)
            .map(k => ({ wert: k.title, id: k.id,
                         zusatz: kartenVon(k.id).length + " Karten" })),
          tun: e => { seiteZeigen("lernen"); kartenOeffnen(e.id, "abfrage"); } },
        { wort: "löschen", titel: "Klausur löschen", info: "entfernt die Klausur", art: "auswahl",
          liste: () => klausuren.filter(k => !istTest(k))
            .map(k => ({ wert: k.title, id: k.id, zusatz: fmtDate(k.date) })),
          tun: e => { loescheEintrag(e.id, "klausur");
                      if (aktuelleSeite === "kalender") baueKalender();
                      showToast(`Klausur „${e.wert}" gelöscht`); } }
      ] },

    /* Ein Test ist die kurze Schwester der Klausur: dieselben Felder,
       dieselben Karten, 45 statt 135 Minuten. Er bekommt einen
       eigenen Befehl, damit man beim Anlegen nicht erst umstellen
       muss. */
    { wort: "/tests", titel: "Tests", info: "Kurze Prüfungen", seite: "lernen",
      unter: [
        { wort: "neu", titel: "Test anlegen", info: "Fach wählen oder eigenen Namen tippen",
          art: "entwurf", entwurfArt: "test",
          vorschlaege: () => Object.keys(FAECHER).map(id => ({
            id, wert: fachInfo(id).kurz, lang: fachInfo(id).lang })) },
        { wort: "karten", titel: "Karten öffnen", info: "Karteikarten des Tests",
          art: "auswahl",
          liste: () => klausuren.filter(istTest).map(t => ({
            wert: t.title, id: t.id,
            zusatz: (kartenVon(t.id).length || 0) + " Karten · " + fmtDate(t.date) })),
          tun: e => { seiteZeigen("lernen"); kartenOeffnen(e.id, "liste"); } },
        { wort: "abfragen", titel: "Test abfragen", info: "Karten der Reihe nach",
          art: "auswahl",
          liste: () => klausuren.filter(t => istTest(t) && kartenVon(t.id).length)
            .map(t => ({ wert: t.title, id: t.id,
                         zusatz: kartenVon(t.id).length + " Karten" })),
          tun: e => { seiteZeigen("lernen"); kartenOeffnen(e.id, "abfrage"); } },
        { wort: "löschen", titel: "Test löschen", info: "entfernt den Test", art: "auswahl",
          liste: () => klausuren.filter(istTest)
            .map(k => ({ wert: k.title, id: k.id, zusatz: fmtDate(k.date) })),
          tun: e => { loescheEintrag(e.id, "klausur");
                      if (aktuelleSeite === "kalender") baueKalender();
                      showToast(`Test „${e.wert}" gelöscht`); } }
      ] },

    { wort: "/themen", titel: "Eigene Themen", info: "Lernen ohne Klausur", seite: "lernen",
      unter: [
        { wort: "neu", titel: "Thema anlegen", info: "Namen tippen, Termin freiwillig",
          art: "entwurf", entwurfArt: "thema" },
        { wort: "karten", titel: "Karten öffnen", info: "Karteikarten des Themas",
          art: "auswahl",
          liste: () => themenSortiert().map(t => ({
            wert: t.title, id: t.id,
            zusatz: (kartenVon(t.id).length || 0) + " Karten"
                    + (t.date ? " · " + fmtDate(t.date) : "") })),
          tun: e => { seiteZeigen("lernen"); kartenOeffnen(e.id, "liste"); } },
        { wort: "abfragen", titel: "Thema abfragen", info: "Karten der Reihe nach",
          art: "auswahl",
          liste: () => themenSortiert().filter(t => kartenVon(t.id).length)
            .map(t => ({ wert: t.title, id: t.id,
                         zusatz: kartenVon(t.id).length + " Karten" })),
          tun: e => { seiteZeigen("lernen"); kartenOeffnen(e.id, "abfrage"); } },
        { wort: "löschen", titel: "Thema löschen", info: "samt seinen Karten", art: "auswahl",
          liste: () => themen.map(t => ({
            wert: t.title, id: t.id,
            zusatz: t.date ? fmtDate(t.date) : "ohne Termin" })),
          tun: e => { themaLoeschen(e.id);
                      if (aktuelleSeite === "lernen") baueLernen();
                      if (aktuelleSeite === "kalender") baueKalender();
                      renderNaechste();
                      showToast(`Thema „${e.wert}" gelöscht`); } }
      ] },

    { wort: "/hausaufgaben", titel: "Hausaufgaben", info: "Aufgaben je Fach", seite: "lernen",
      unter: [
        /* Wie bei den Klausuren schlagen sich die Faecher selbst vor —
           wer eins waehlt, bekommt die naechste Stunde als Frist. */
        { wort: "neu", titel: "Hausaufgabe anlegen", info: "Fach wählen oder eigenen Namen tippen",
          art: "entwurf", entwurfArt: "hausaufgabe",
          vorschlaege: () => Object.keys(FAECHER).map(id => ({
            id, wert: fachInfo(id).kurz, lang: fachInfo(id).lang })) },
        { wort: "erledigt", titel: "Hausaufgabe abhaken", info: "verschwindet aus Liste und Kalender",
          art: "auswahl",
          liste: () => offeneHausaufgaben().map(h => ({
            wert: h.title, id: h.id, zusatz: hausGrund(h) })),
          tun: e => { hausAbhaken(e.id);
                      if (aktuelleSeite === "lernen") baueLernen();
                      if (aktuelleSeite === "kalender") baueKalender();
                      showToast(`„${e.wert}" abgehakt`, "success"); } },
        { wort: "löschen", titel: "Hausaufgabe löschen", info: "entfernt sie ganz", art: "auswahl",
          liste: () => hausaufgaben.map(h => ({
            wert: h.title, id: h.id, zusatz: fmtDate(h.date) })),
          tun: e => { loescheEintrag(e.id, "hausaufgabe");
                      if (aktuelleSeite === "lernen") baueLernen();
                      if (aktuelleSeite === "kalender") baueKalender();
                      showToast(`Hausaufgabe „${e.wert}" gelöscht`); } }
      ] },

    { wort: "/stundenplan", titel: "Stundenplan", info: "Fächer, Stunden und Räume", seite: "kalender",
      unter: [
        { wort: "jetzt", titel: "Aktuelle Stunde", info: "zeigt, was gerade läuft", art: "sofort",
          tun: () => {
            const { jetzt, naechste } = stundeJetzt();
            if (jetzt) showToast(`Jetzt: ${fachInfo(jetzt.fach).kurz} ${blockName(jetzt.von, jetzt.bis)}`
                                 + ` ${blockZeit(jetzt.von, jetzt.bis)}${jetzt.raum ? " · " + jetzt.raum : ""}`);
            else if (naechste) showToast(`Gleich: ${fachInfo(naechste.fach).kurz} ab ${stundeInfo(naechste.von).von}`
                                 + `${naechste.raum ? " · " + naechste.raum : ""}`);
            else showToast("Heute steht nichts mehr an");
          } },
        { wort: "heute", titel: "Heutige Stunden", info: "alle Stunden von heute", art: "sofort",
          tun: () => {
            const tag = new Date().getDay();
            const l = tag >= 1 && tag <= 5 ? stundenAmTag(tag) : [];
            if (!l.length) return showToast("Heute kein Unterricht");
            showToast(l.map(x => blockName(x.von, x.bis).replace(" Stunde", "") + " " + fachInfo(x.fach).kurz).join(" · "));
          } },
        { wort: "fach", titel: "Ein Fach hervorheben", info: "zeigt nur diesen Kurs im Plan", art: "auswahl",
          liste: () => Object.keys(FAECHER).map(id => ({
            wert: fachInfo(id).kurz, id, zusatz: fachInfo(id).lang })),
          tun: e => {
            planFilter = e.id;
            seiteZeigen("kalender");
            planZeichnen(planFilter);
            showToast(`${fachInfo(e.id).lang} im Plan hervorgehoben`);
          } }
      ] },

    { wort: "/habits", titel: "Habits", info: "Gewohnheiten", seite: "habits",
      unter: [habitNeu, habitCheck, habitLoeschen] },

    { wort: "/streaks", titel: "Streaks", info: "Serien", seite: "habits",
      unter: [streakNeu, streakCheck, streakLoeschen] },

    { wort: "/kalorien", titel: "Kalorien", info: "Heutiger Stand und Verlauf", seite: "kalorien",
      unter: [
        { wort: "setz", titel: "Kalorien eintragen", info: "Zahl eingeben, dann Enter", art: "frei",
          tun: text => {
            const wert = parseInt(text, 10);
            if (!Number.isFinite(wert) || wert < 0) return showToast("Das ist keine Zahl", "warn");
            setCaloriesConsumed(wert);
            kalorienMerken();
            if (aktuelleSeite === "kalorien") baueKalorien();
            showToast(`${wert} kcal eingetragen`);
          } }
      ] },

    { wort: "/bildschirmzeit", titel: "Bildschirmzeit", info: "Handy und PC im Verlauf", seite: "bildschirmzeit" },

    { wort: "/lernen", titel: "Lernen", info: "Kurse und anstehende Klausuren", seite: "lernen" },

    { wort: "/automation", titel: "Automation", info: "Abläufe mit Zeitpunkt", seite: "planung",
      unter: [
        { wort: "neu", titel: "Ablauf anlegen", info: "Name eingeben, dann Enter", art: "frei",
          tun: name => {
            planung.push({ id: "p" + Date.now(), name, datum: todayStr(), schritte: [] });
            store.set("lifeos_planung", planung);
            seiteZeigen("planung");
            showToast("Ablauf „" + name + "\" angelegt");
          } }
      ] },

    { wort: "/projekte", titel: "Projekte", info: "Schritte und Termine", seite: "projekte",
      unter: [
        { wort: "neu", titel: "Projekt anlegen", info: "Name eingeben, dann Enter", art: "frei",
          tun: name => {
            projekte.push({ id: "p" + Date.now(), name, datum: todayStr(), fertig: false });
            store.set("lifeos_projekte", projekte);
            if (aktuelleSeite === "projekte") baueProjekte();
            showToast(`Projekt „${name}" angelegt`);
          } },
        { wort: "fertig", titel: "Projekt abhaken", info: "als erledigt markieren", art: "auswahl",
          liste: () => projekte.map(p => ({ wert: p.name, id: p.id, zusatz: p.fertig ? "erledigt" : "offen" })),
          tun: e => {
            const p = projekte.find(x => x.id === e.id);
            if (!p) return;
            p.fertig = !p.fertig;
            store.set("lifeos_projekte", projekte);
            if (aktuelleSeite === "projekte") baueProjekte();
            showToast(`„${e.wert}" ` + (p.fertig ? "erledigt" : "wieder offen"));
          } },
        { wort: "löschen", titel: "Projekt löschen", info: "entfernt das Projekt", art: "auswahl",
          liste: () => projekte.map(p => ({ wert: p.name, id: p.id })),
          tun: e => {
            projekte = projekte.filter(x => x.id !== e.id);
            store.set("lifeos_projekte", projekte);
            if (aktuelleSeite === "projekte") baueProjekte();
            showToast(`Projekt „${e.wert}" gelöscht`);
          } }
      ] },

    { wort: "/analyse", titel: "Analyse", info: "Zahlen der letzten Wochen", seite: "analyse" }
  ];

  /* ---------- Eingabe in Stufen zerlegen ----------
     Stufe 0: der Oberbegriff wird noch getippt
     Stufe 1: Oberbegriff steht, der Unterbefehl wird getippt
     Stufe 2: beides steht, jetzt kommt das Argument            */
  function pfadLesen(text) {
    const roh = text.trimStart();
    const teile = roh.split(" ");
    const wurzel = BAUM.find(b => b.wort.toLowerCase() === teile[0].toLowerCase());

    if (teile.length === 1 || !wurzel) return { stufe: 0, wort: teile[0], wurzel: null, unter: null, rest: "" };
    if (teile.length === 2) return { stufe: 1, wort: teile[1] || "", wurzel, unter: null, rest: "" };

    const unter = (wurzel.unter || []).find(u => u.wort.toLowerCase() === teile[1].toLowerCase());
    if (!unter) return { stufe: 1, wort: teile[1], wurzel, unter: null, rest: "" };
    return { stufe: 2, wort: "", wurzel, unter, rest: teile.slice(2).join(" ").trim() };
  }

  let slashTreffer = [];
  let slashIndex = 0;
  let slashPfad = null;
  let slashPrefix = "";   // was der Nutzer auf dieser Stufe selbst getippt hat
  let slashLeerGrund = "";   // "keine" | "kein-treffer" | ""

  const slashAktiv = () => sucheFeld.value.trimStart().startsWith("/");

  function eintragZeichnen(s, i, hervor) {
    const teil = hervor && s.text.toLowerCase().startsWith(hervor.toLowerCase()) ? hervor.length : 0;
    return `<div class="slash-eintrag${i === slashIndex ? " gewaehlt" : ""}" data-i="${i}" role="option">
              <span class="slash-icon">${s.symbol || ""}</span>
              <span class="slash-text">
                <span class="slash-befehl"><b>${escapeHTML(s.text.slice(0, teil))}</b>${escapeHTML(s.text.slice(teil))}</span>
                <span class="slash-info${s.warnung ? " warn" : ""}">${escapeHTML(s.info || "")}</span>
              </span>
              ${i === slashIndex ? `<span class="slash-taste">${s.taste || "Tab"}</span>` : ""}
            </div>`;
  }

  /* Die Suche mit einem Befehl vorbelegen und öffnen — so führt das
     Plus auf der Lernseite in genau dieselbe Auswahl wie das Tippen
     von Hand, statt daneben einen zweiten Weg aufzumachen. */
  function sucheMitBefehl(text) {
    seiteZeigen("lernen");
    sucheFeld.value = text;
    sucheFeld.focus();
    slashZeichnen();
  }

  /* ==========================================================
     FUNDSTELLEN
     Tippt man etwas ohne Schrägstrich, wird nicht mehr sofort
     Google aufgemacht: erst wird im eigenen Bestand gesucht.
     Termine, Klausuren, Hausaufgaben, Themen, Notizen, Karteikarten,
     Fächer und Seiten — alles, was das Dashboard führt.

     Die Treffer laufen durch dieselbe Liste wie die Befehle, mit
     denselben Tasten. Zwei Auswahllisten übereinander wären eine zu
     viel.
     ========================================================== */
  let suchModus = false;

  const fundAktiv = () => !slashAktiv() && sucheFeld.value.trim().length >= 2;

  /* 2 = trifft vorne, 1 = kommt irgendwo vor, 0 = nicht */
  function passt(text, q) {
    const t = String(text || "").toLowerCase();
    if (!t) return 0;
    if (t.startsWith(q)) return 2;
    /* Auch der Anfang eines Wortes zählt als "vorne" — "phi" soll
       "Grundkurs Philosophie" finden. */
    if (t.split(/[\s,.;:/-]+/).some(w => w.startsWith(q))) return 2;
    return t.includes(q) ? 1 : 0;
  }

  const kurzText = (text, max) => {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    return t.length > max ? t.slice(0, max - 1) + "…" : t;
  };

  function fundstellen(roh) {
    const q = String(roh || "").trim().toLowerCase();
    if (q.length < 2) return [];
    const treffer = [];
    const nimm = (rang, text, info, symbol, tun) =>
      treffer.push({ rang, text, info, symbol, taste: "Enter", tun });

    /* --- Seiten --- */
    document.querySelectorAll(".nav-link[data-seite]").forEach(a => {
      const name = a.querySelector("span").textContent.trim();
      const r = passt(name, q);
      if (r) nimm(r, name, "Seite öffnen", NAV_SYMBOLE[a.dataset.seite],
                  () => seiteZeigen(a.dataset.seite));
    });

    /* --- Termine --- */
    termine.forEach(t => {
      const r = passt(t.title, q);
      if (!r) return;
      nimm(r, t.title, "Termin · " + fmtDate(t.date) + (t.time ? " · " + t.time : ""),
        NAV_SYMBOLE.kalender, () => {
          monatAnsicht = new Date(t.date + "T00:00:00"); monatAnsicht.setDate(1);
          gewaehlterTag = t.date;
          seiteZeigen("kalender");
          baueKalender();
        });
    });

    /* --- Klausuren --- */
    klausuren.forEach(k => {
      const r = Math.max(passt(k.title, q), k.fach ? passt(fachInfo(k.fach).lang, q) : 0);
      if (!r) return;
      const anzahl = kartenVon(k.id).length;
      nimm(r, k.title, "Klausur · " + fmtDate(k.date)
             + (anzahl ? " · " + anzahl + (anzahl === 1 ? " Karte" : " Karten") : ""),
        NAV_SYMBOLE.lernen, () => lernenZeigen(k.id));
    });

    /* --- Hausaufgaben --- */
    hausaufgaben.forEach(h => {
      const r = Math.max(passt(h.title, q), h.fach ? passt(fachInfo(h.fach).lang, q) : 0);
      if (!r) return;
      nimm(r, h.title, "Hausaufgabe" + (h.fach ? " " + fachInfo(h.fach).kurz : "")
             + (h.date ? " · " + fmtDate(h.date) : ""),
        NAV_SYMBOLE.lernen, () => {
          hausOffen = h.id;
          lernReiter = "hausaufgaben";
          store.set("lifeos_lern_reiter", lernReiter);
          seiteZeigen("lernen");
        });
    });

    /* --- Eigene Themen --- */
    themen.forEach(t => {
      const r = passt(t.title, q);
      if (!r) return;
      const anzahl = kartenVon(t.id).length;
      nimm(r, t.title, "Thema" + (anzahl ? " · " + anzahl + (anzahl === 1 ? " Karte" : " Karten") : ""),
        NAV_SYMBOLE.lernen, () => {
          offenesThema = t.id;
          lernReiter = "themen";
          store.set("lifeos_lern_reiter", lernReiter);
          seiteZeigen("lernen");
        });
    });

    /* --- Notizen --- */
    notizen.forEach(n => {
      const r = Math.max(passt(notizTitel(n), q), passt(n.text, q));
      if (!r) return;
      nimm(r, notizTitel(n), "Notiz · " + kurzText(n.text, 46),
        null, () => {
          notizOffen = n.id;
          notizenOeffnen(true);
          notizenZeichnen();
        });
    });

    /* --- Karteikarten --- */
    Object.entries(lernkarten).forEach(([besitzer, karten]) => {
      if (!Array.isArray(karten)) return;
      const wo = klausuren.find(k => k.id === besitzer) || themen.find(t => t.id === besitzer);
      if (!wo) return;
      karten.forEach(c => {
        const r = Math.max(passt(c.frage, q), passt(c.antwort, q), passt(c.thema, q));
        if (!r) return;
        nimm(r - 0.5, kurzText(c.frage, 52), "Karte in „" + kurzText(wo.title, 26) + "“",
          NAV_SYMBOLE.lernen, () => kartenOeffnen(besitzer, "liste"));
      });
    });

    /* --- Fächer --- */
    Object.keys(FAECHER).forEach(id => {
      const f = fachInfo(id);
      const r = Math.max(passt(f.lang, q), passt(f.kurz, q));
      if (!r) return;
      const stunden = STUNDENPLAN.filter(l => l.fach === id).length;
      nimm(r, f.lang, "Fach · " + stunden + (stunden === 1 ? " Stunde" : " Stunden") + " pro Woche",
        NAV_SYMBOLE.kalender, () => fachUebersicht(id));
    });

    /* Vorne-Treffer zuerst, danach alphabetisch — sonst wechselt die
       Reihenfolge bei gleichem Rang von Tastendruck zu Tastendruck. */
    treffer.sort((a, b) => b.rang - a.rang || a.text.localeCompare(b.text, "de"));
    return treffer.slice(0, 9);
  }

  function fundZeichnen() {
    suchModus = true;
    slashPfad = null;
    const roh = sucheFeld.value.trim();
    slashTreffer = fundstellen(roh);

    /* Google bleibt — aber als letzte Zeile, nicht als erste Antwort */
    slashTreffer.push({
      text: "Bei Google suchen", info: "„" + kurzText(roh, 42) + "“ im Netz",
      taste: "Enter", symbol: null,
      tun: () => window.open("https://www.google.com/search?q=" + encodeURIComponent(roh),
                             "_blank", "noopener,noreferrer")
    });

    if (slashIndex >= slashTreffer.length) slashIndex = 0;
    slashBox.innerHTML = slashTreffer.map((t, i) => eintragZeichnen(t, i, roh)).join("");
    slashBox.classList.add("offen");
    klickeBinden();
  }

  function slashZeichnen() {
    if (!slashAktiv()) {
      if (fundAktiv()) return fundZeichnen();
      return slashSchliessen();
    }
    suchModus = false;
    slashPfad = pfadLesen(sucheFeld.value);
    const p = slashPfad;

    if (p.stufe === 0) {
      const w = p.wort.toLowerCase();
      slashTreffer = BAUM
        .filter(b => b.wort.startsWith(w) || w === "/")
        .map(b => ({ text: b.wort, info: b.info, symbol: befehlSymbol(b), knoten: b }));
    } else if (p.stufe === 1) {
      const w = p.wort.toLowerCase();
      const moeglich = [];
      if (p.wurzel.seite) {
        moeglich.push({ wort: "öffnen", titel: p.wurzel.titel + " öffnen",
                        info: "wechselt zur Seite", art: "seite-oeffnen" });
      }
      moeglich.push(...(p.wurzel.unter || []));
      slashTreffer = moeglich
        .filter(u => u.wort.startsWith(w))
        .map(u => ({ text: u.wort,
                     info: u.art === "seite-oeffnen" ? u.info : u.titel + " — " + u.info,
                     taste: u.art === "seite-oeffnen" || u.art === "sofort" ? "Enter" : "Tab",
                     symbol: befehlSymbol(p.wurzel), knoten: u }));
    } else {
      const u = p.unter;
      if (u.art === "auswahl") {
        const w = p.rest.toLowerCase();
        const alle = u.liste();
        slashLeerGrund = !alle.length ? "keine" : (w ? "kein-treffer" : "");
        slashTreffer = alle
          .filter(e => e.wert.toLowerCase().startsWith(w))
          .map(e => ({ text: e.wert, info: e.zusatz || u.info, taste: "Enter",
                       symbol: befehlSymbol(p.wurzel), knoten: u, nutz: e }));
        if (slashTreffer.length) slashLeerGrund = "";
      } else if (u.art === "entwurf") {
        /* Name und Datum trennen, damit beim Tippen schon steht, was
           hinter dem Komma erkannt wurde. */
        const teil = titelUndDatum(p.rest);
        const suche = teil.titel.toLowerCase();
        /* Der Komma-Teil haengt an jedem Vorschlag, sonst ginge das
           Datum beim Vervollstaendigen mit Tab wieder verloren. */
        const kommaTeil = teil.datum ? p.rest.slice(p.rest.lastIndexOf(",")) : "";
        const amTag = teil.datum ? " am " + fmtDate(teil.datum) : "";

        /* Erst was vorne passt: "Ch" soll Chemie zeigen und nicht auch
           Deutsch und Englisch. Nur wenn nichts vorne passt, wird im
           ganzen Namen gesucht. */
        const alleFaecher = u.vorschlaege ? u.vorschlaege() : [];
        const vorne = alleFaecher.filter(v => v.wert.toLowerCase().startsWith(suche)
                                           || v.lang.toLowerCase().startsWith(suche));
        const faecher = (!suche ? alleFaecher
                        : vorne.length ? vorne
                        : alleFaecher.filter(v => v.lang.toLowerCase().includes(suche)
                                               || v.wert.toLowerCase().includes(suche)))
          .map(v => {
            /* Steht das Datum schon fest, zeigt der Vorschlag gleich die
               Stunde — oder in Rot, dass an dem Tag kein Unterricht ist. */
            const l = teil.datum ? stundenFuerFach(v.id, teil.datum) : [];
            const fehlt = !!teil.datum && !l.length;
            let info;
            if (teil.datum) {
              info = l.length
                ? v.lang + " · " + blockName(l[0].von, l[0].bis) + amTag
                : v.lang + " · kein Unterricht" + amTag;
            } else {
              info = v.lang + " · nächste Stunde " + fmtDate(naechstesDatumFuer(v.id));
            }
            /* Der Name richtet sich danach, was hier angelegt wird.
               Vorher stand hier fest "Klausur" — dadurch hieß eine über
               /hausaufgaben angelegte Mathe-Aufgabe "Klausur Ma". */
            const vorsatz = u.entwurfArt === "hausaufgabe" ? "Hausaufgabe "
                          : u.entwurfArt === "test"        ? "Test "
                          : u.entwurfArt === "klausur"     ? "Klausur "
                          : "";
            return { text: v.wert, einfuegen: v.wert + kommaTeil, info, warnung: fehlt, taste: "Enter",
                     symbol: befehlSymbol(p.wurzel), knoten: u,
                     nutz: { fach: v.id, titel: vorsatz + v.wert, datum: teil.datum } };
          });

        /* Ein eigener Name bleibt immer moeglich — ausser er waere
           Zeichen fuer Zeichen einer der Vorschlaege. */
        const doppelt = faecher.some(f => f.text.toLowerCase() === teil.titel.toLowerCase());
        const frei = p.rest && !doppelt
          ? [{ text: teil.titel, einfuegen: teil.titel + kommaTeil,
               info: u.titel + amTag + (faecher.length ? " — eigener Name" : " — Enter bestätigt"),
               taste: "Enter", symbol: befehlSymbol(p.wurzel), knoten: u, nutz: p.rest }]
          : [];

        slashTreffer = faecher.concat(frei);
      } else if (p.rest) {
        slashTreffer = [{ text: p.rest, info: u.titel + " — Enter bestätigt", taste: "Enter",
                          symbol: befehlSymbol(p.wurzel), knoten: u, nutz: p.rest }];
      } else {
        slashTreffer = [];
      }
    }

    if (slashIndex >= slashTreffer.length) slashIndex = 0;
    if (!slashTreffer.length) {
      let hinweis = "Nichts gefunden";
      if (p.stufe === 2 && p.unter && p.unter.art !== "auswahl") hinweis = p.unter.info;
      else if (slashLeerGrund === "keine") hinweis = "Nichts vorhanden — Escape schließt";
      else if (slashLeerGrund === "kein-treffer") hinweis = `Kein Treffer für „${p.rest}"`;
      slashBox.innerHTML = `<div class="slash-leer">${escapeHTML(hinweis)}</div>`;
    } else {
      const hervor = p.stufe === 2 ? p.rest : p.wort;
      slashBox.innerHTML = slashTreffer.map((s, i) => eintragZeichnen(s, i, hervor)).join("");
    }
    slashBox.classList.add("offen");
    klickeBinden();
  }

  function klickeBinden() {
    slashBox.querySelectorAll(".slash-eintrag").forEach(e => {
      e.addEventListener("mousedown", ev => {
        ev.preventDefault();
        slashIndex = +e.dataset.i;
        slashAusfuehren();
      });
    });
  }

  function slashSchliessen() {
    slashBox.classList.remove("offen");
    slashBox.innerHTML = "";
    slashTreffer = [];
    slashIndex = 0;
    slashPfad = null;
    suchModus = false;
  }

  /* Wie sähe das Feld aus, wenn dieser Vorschlag gesetzt wird?
     Bewusst ohne Leerzeichen am Ende: mit Leerzeichen würde schon das
     bloße Durchblättern eine Stufe tiefer springen und man käme nicht
     mehr zu den anderen Vorschlägen derselben Stufe. */
  function feldText(s) {
    const p = slashPfad;
    if (!p) return sucheFeld.value;
    const wort = s.einfuegen || s.text;
    if (p.stufe === 0) return wort;
    if (p.stufe === 1) return p.wurzel.wort + " " + wort;
    return p.wurzel.wort + " " + p.unter.wort + " " + wort;
  }

  function slashAusfuehren() {
    const gewaehlt = slashTreffer[slashIndex];
    if (!gewaehlt) return;
    nutzAktion("slash");

    /* Ein Fundstück hat keinen Befehlspfad — es hat ein Ziel */
    if (suchModus) {
      sucheFeld.value = "";
      slashSchliessen();
      if (typeof gewaehlt.tun === "function") gewaehlt.tun();
      return;
    }

    const p = slashPfad;

    /* Oberbegriff: Seite öffnen oder eine Stufe tiefer gehen */
    if (p.stufe === 0) {
      const b = gewaehlt.knoten;
      if (b.unter) {
        sucheFeld.value = b.wort + " ";
        slashIndex = 0;
        slashZeichnen();
      } else if (b.seite) {
        sucheFeld.value = "";
        slashSchliessen();
        seiteZeigen(b.seite);
        showToast(b.titel + " geöffnet");
      }
      return;
    }

    /* Unterbefehl gewählt: auf das Argument warten */
    if (p.stufe === 1) {
      if (gewaehlt.knoten.art === "seite-oeffnen") {
        sucheFeld.value = "";
        slashSchliessen();
        seiteZeigen(p.wurzel.seite);
        showToast(p.wurzel.titel + " geöffnet");
        return;
      }
      /* "sofort" braucht kein Argument und laeuft direkt los */
      if (gewaehlt.knoten.art === "sofort") {
        sucheFeld.value = "";
        slashSchliessen();
        gewaehlt.knoten.tun();
        return;
      }
      sucheFeld.value = p.wurzel.wort + " " + gewaehlt.knoten.wort + " ";
      slashIndex = 0;
      slashZeichnen();
      return;
    }

    /* Argument liegt vor */
    const u = gewaehlt.knoten;
    sucheFeld.value = "";
    slashSchliessen();
    if (u.art === "entwurf") {
      /* Ein gewaehltes Fach bringt Titel, Kurs und Datum schon mit */
      if (gewaehlt.nutz && typeof gewaehlt.nutz === "object") {
        entwurfStarten(u.entwurfArt, gewaehlt.nutz.titel, gewaehlt.nutz.fach, gewaehlt.nutz.datum);
      } else {
        const teil = titelUndDatum(gewaehlt.nutz);
        entwurfStarten(u.entwurfArt, teil.titel, null, teil.datum);
      }
    }
    else if (typeof u.tun === "function") u.tun(gewaehlt.nutz);
  }

  /* Nur die Markierung neu setzen — ohne die Liste neu zu filtern */
  function nurHervorheben() {
    if (!slashTreffer.length) return;
    const hervor = suchModus ? sucheFeld.value.trim() : slashPrefix;
    slashBox.innerHTML = slashTreffer.map((s, i) => eintragZeichnen(s, i, hervor)).join("");
    klickeBinden();
    const aktiv = slashBox.querySelector(".gewaehlt");
    if (aktiv) aktiv.scrollIntoView({ block: "nearest" });
  }

  /* Eine Stufe tiefer gehen: Leerzeichen anhängen und neu einlesen.
     Nur sinnvoll, wo es überhaupt eine tiefere Stufe gibt. */
  function stufeTiefer() {
    const p = slashPfad;
    if (!p) return false;
    const gewaehlt = slashTreffer[slashIndex];
    /* Ein Sofort-Befehl hat keine tiefere Stufe - Tab fuehrt ihn aus,
       sonst landete man in einer leeren Liste. */
    if (p.stufe === 1 && gewaehlt && gewaehlt.knoten.art === "sofort") {
      sucheFeld.value = "";
      slashSchliessen();
      gewaehlt.knoten.tun();
      return true;
    }
    if (p.stufe === 0 && gewaehlt && gewaehlt.knoten.unter) {
      sucheFeld.value = gewaehlt.knoten.wort + " ";
    } else if (p.stufe === 1 && gewaehlt && gewaehlt.knoten.art !== "seite-oeffnen") {
      sucheFeld.value = p.wurzel.wort + " " + gewaehlt.knoten.wort + " ";
    } else {
      return false;
    }
    slashIndex = 0;
    const jetzt = pfadLesen(sucheFeld.value);
    slashPrefix = jetzt.stufe === 2 ? jetzt.rest : jetzt.wort;
    slashZeichnen();
    return true;
  }

  /* Tab setzt den gewählten Vorschlag ein. Gibt es mehrere Treffer,
     blättert weiteres Tab durch sie. Bleibt nur einer übrig und steht
     er schon im Feld, geht Tab eine Stufe tiefer — sonst hinge man auf
     dem gerade ausgefüllten Befehl fest. */
  function slashVervollstaendigen(rueckwaerts) {
    if (!slashTreffer.length) return;
    const ziel = feldText(slashTreffer[slashIndex]);
    const schonGesetzt = sucheFeld.value.trim().toLowerCase() === ziel.trim().toLowerCase();

    if (!schonGesetzt) {
      sucheFeld.value = ziel;
      // Bleibt nach dem Einsetzen nur dieser eine Treffer, direkt weiter
      if (slashTreffer.length === 1 && stufeTiefer()) return;
      nurHervorheben();
      return;
    }

    if (slashTreffer.length > 1) {
      slashIndex = (slashIndex + (rueckwaerts ? -1 : 1) + slashTreffer.length) % slashTreffer.length;
      sucheFeld.value = feldText(slashTreffer[slashIndex]);
      nurHervorheben();
      return;
    }

    // Ein einziger Treffer, schon eingesetzt: tiefer gehen
    if (!stufeTiefer()) nurHervorheben();
  }

  sucheFeld.addEventListener("input", () => {
    slashIndex = 0;
    const p = pfadLesen(sucheFeld.value);
    slashPrefix = p.stufe === 2 ? p.rest : p.wort;
    slashZeichnen();
  });
  sucheFeld.addEventListener("blur", () => setTimeout(slashSchliessen, 120));
  sucheFeld.addEventListener("focus", () => {
    if (slashAktiv() || fundAktiv()) slashZeichnen();
  });

  sucheFeld.addEventListener("keydown", e => {
    if (!slashAktiv() && !suchModus) return;
    if (e.key === "Tab") {
      e.preventDefault();
      /* In den Fundstellen gibt es nichts zu vervollständigen —
         dort blättert Tab wie der Pfeil nach unten. */
      if (suchModus) {
        if (!slashTreffer.length) return;
        slashIndex = (slashIndex + (e.shiftKey ? -1 : 1) + slashTreffer.length) % slashTreffer.length;
        nurHervorheben();
        return;
      }
      slashVervollstaendigen(e.shiftKey);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!slashTreffer.length) return;
      e.preventDefault();
      slashIndex = (slashIndex + (e.key === "ArrowDown" ? 1 : -1) + slashTreffer.length) % slashTreffer.length;
      nurHervorheben();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (slashTreffer.length) { slashAusfuehren(); return; }
      // Nichts auszuführen: sagen warum, statt den Befehl stehen zu lassen
      if (slashLeerGrund === "keine") {
        showToast("Dafür gibt es noch keine Einträge", "warn");
        sucheFeld.value = "";
        slashSchliessen();
      } else if (slashLeerGrund === "kein-treffer") {
        showToast("Kein passender Eintrag", "warn");
      }
    } else if (e.key === "Escape") {
      // Escape räumt den Befehl weg — der Weg aus jeder Sackgasse
      sucheFeld.value = "";
      slashSchliessen();
    }
  });


  /* Beim Laden die Seite aus der Adresse übernehmen */
  /* Einmal beim Laden die gemessene PC-Zeit abholen */
  bildschirmzeitHolen()
    .then(() => {
      /* Erst wenn die Messung da ist, lässt sich die Woche vergleichen */
      try { wochenberichtMelden(); } catch (e) { /* nicht so wichtig */ }
      try { rueckblickPruefen(); } catch (e) { /* nicht so wichtig */ }
      /* Wurde die Analyse gezeichnet, bevor die Messung ankam, stünden
         dort Nullen — dann noch einmal zeichnen. */
      if (aktuelleSeite === "analyse") baueAnalyse();
      try { grenzenPruefen(); } catch (e) { /* nicht so wichtig */ }
    })
    .catch(() => { /* ohne Messung eben kein Bericht */ });

  /* Als App vom Startbildschirm gestartet, merkt sich iOS die zuletzt
     offene Adresse — man landet dann auf der Seite, auf der man beim
     letzten Mal aufgehört hat. Vom Symbol aus soll aber immer das
     Dashboard kommen. Im Browsertab bleibt die Adresse maßgeblich,
     sonst wäre ein Lesezeichen auf #/kalender nutzlos. */
  const alsApp = (window.matchMedia && matchMedia("(display-mode: standalone)").matches)
              || window.navigator.standalone === true;

  const startSeite = alsApp ? "" : (location.hash || "").replace(/^#\//, "");
  if (alsApp && location.hash) history.replaceState(null, "", location.pathname + location.search);

  if (startSeite && SEITEN.some(s => s.id === startSeite)) seiteZeigen(startSeite, true);
  else document.body.classList.add("auf-dashboard");

  window.addEventListener("resize", () => {
    if (aktuelleSeite === "bildschirmzeit") baueBildschirmzeit();
  });

  /* ==========================================================
     KALORIEN-SEITE
     Der Verlauf wird mitgeschrieben, damit die Seite mehr als
     nur den heutigen Tag zeigen kann.
     ========================================================== */
  let kalVerlauf = store.get("lifeos_kalorien_verlauf", null);
  if (!kalVerlauf || typeof kalVerlauf !== "object") kalVerlauf = {};

  function kalorienMerken() {
    kalVerlauf[kalorien.date] = kalorien.consumed || 0;
    store.set("lifeos_kalorien_verlauf", kalVerlauf);
  }
  kalorienMerken();

  /* Der Ring auf der Seite benutzt dieselbe Geometrie wie im Widget */
  const pgTicks = [];
  (function baueSeitenRing() {
    const g = $("pgCalTicks");
    if (!g) return;
    for (let i = 0; i < G_TICKS; i++) {
      const a = G_START + (G_SWEEP * i) / (G_TICKS - 1);
      const p1 = polar(G_CX, G_CY, G_R_IN, a);
      const p2 = polar(G_CX, G_CY, G_R_OUT, a);
      const l = document.createElementNS("http://www.w3.org/2000/svg", "line");
      l.setAttribute("class", "cal-tick");
      l.style.setProperty("--i", i);
      l.setAttribute("x1", p1.x.toFixed(2)); l.setAttribute("y1", p1.y.toFixed(2));
      l.setAttribute("x2", p2.x.toFixed(2)); l.setAttribute("y2", p2.y.toFixed(2));
      g.appendChild(l);
      pgTicks.push(l);
    }
  })();

  function baueKalorien() {
    const ziel = settings.calGoal || 0;
    const heute = kalorien.consumed || 0;
    const rest = Math.max(0, ziel - heute);
    $("pgCalWert").textContent = heute;
    $("pgCalZiel").textContent = ziel;
    $("kalorienSub").textContent = ziel
      ? (heute > ziel ? `${heute - ziel} kcal über dem Ziel` : `noch ${rest} kcal bis zum Ziel`)
      : "Kein Ziel gesetzt — in den Einstellungen hinterlegen";

    const anteil = ziel > 0 ? Math.min(1, heute / ziel) : 0;
    const voll = Math.round(anteil * G_TICKS);
    pgTicks.forEach((t, i) => {
      t.classList.toggle("on", i < voll);
      t.classList.toggle("over", ziel > 0 && heute > ziel && i < voll);
    });

    // Schnitt der letzten 14 Tage
    const tage = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = dateKey(d);
      tage.push({ key, tag: WEEKDAYS[d.getDay()], wert: kalVerlauf[key] || 0 });
    }
    const mitWerten = tage.filter(t => t.wert > 0);
    const schnitt = mitWerten.length ? Math.round(mitWerten.reduce((s, t) => s + t.wert, 0) / mitWerten.length) : 0;

    $("pgKalKennzahlen").innerHTML = `
      <div class="kennzahl"><div class="kz-label">Heute</div><div class="kz-wert">${heute}</div>
        <div class="kz-zusatz">von ${ziel || "—"} kcal</div></div>
      <div class="kennzahl"><div class="kz-label">Noch offen</div><div class="kz-wert">${ziel ? rest : "—"}</div>
        <div class="kz-zusatz">${ziel ? Math.round(anteil * 100) + " % erreicht" : "kein Ziel"}</div></div>
      <div class="kennzahl"><div class="kz-label">Schnitt (14 Tage)</div><div class="kz-wert">${schnitt || "—"}</div>
        <div class="kz-zusatz">${mitWerten.length} Tage erfasst</div></div>`;

    const liste = $("pgKalTage");
    liste.innerHTML = "";
    const max = Math.max(1, ziel, ...tage.map(t => t.wert));
    [...tage].reverse().forEach(t => {
      const ueber = ziel > 0 && t.wert > ziel;
      liste.appendChild(zeile(
        `<span class="vz-punkt ${t.wert ? (ueber ? "" : "erledigt") : ""}"></span>
         <div class="vz-haupt">
           <div class="vz-titel">${t.tag}, ${fmtDate(t.key)}</div>
           <div class="vz-sub">${t.wert ? (ziel ? Math.round(t.wert / ziel * 100) + " % vom Ziel" : "erfasst") : "nichts getrackt"}</div>
         </div>
         <div class="bt-spur" style="max-width:200px"><div class="bt-fuellung" style="width:${Math.round(t.wert / max * 100)}%"></div></div>
         <span class="vz-wert">${t.wert || "—"}</span>`, ueber ? "bald" : ""));
    });
  }

  $("kalForm").addEventListener("submit", e => {
    e.preventDefault();
    const wert = parseInt($("kalInput").value, 10);
    if (!Number.isFinite(wert) || wert < 0) return;
    setCaloriesConsumed(wert);
    kalorienMerken();
    $("kalInput").value = "";
    baueKalorien();
    showToast(`${wert} kcal eingetragen`);
  });

  /* ==========================================================
     EINGABEHILFE: "/kalender neu <Name>"
     Sammelt Datum, Start- und Endzeit über kleine Fenster ein.
     ========================================================== */
  const komponist = $("komponist");
  const popDatum = $("popDatum");
  const popZeit = $("popZeit");
  const popListe = $("popListe");
  const kpSchicht = $("kpSchicht");
  let entwurf = null;          // { art, titel, datum, start, ende, fach, block }
  let offenesFeld = null;      // "datum" | "start" | "ende" | "fach" | "stunde"

  const zweistellig = z => String(z).padStart(2, "0");

  /* Liest "9.10", "09.10.2026", "9/10" oder "heute"/"morgen".
     Ohne Jahr gilt das laufende - war der Tag dieses Jahr schon
     vorbei, rutscht er ins naechste. */
  function datumAusText(roh) {
    const t = String(roh || "").trim().toLowerCase();
    if (!t) return null;

    const heute = new Date(); heute.setHours(0, 0, 0, 0);
    const versetzt = tage => { const d = new Date(heute); d.setDate(d.getDate() + tage); return dateKey(d); };
    if (t === "heute") return versetzt(0);
    if (t === "morgen") return versetzt(1);
    if (t === "\u00fcbermorgen" || t === "uebermorgen") return versetzt(2);

    const m = t.match(/^(\d{1,2})\s*[.\/-]\s*(\d{1,2})\s*(?:[.\/-]\s*(\d{2,4}))?\.?$/);
    if (!m) return null;
    const tag = Number(m[1]), monat = Number(m[2]);
    if (tag < 1 || tag > 31 || monat < 1 || monat > 12) return null;

    let jahr;
    if (m[3]) {
      jahr = Number(m[3]);
      if (jahr < 100) jahr += 2000;
    } else {
      jahr = heute.getFullYear();
      if (new Date(jahr, monat - 1, tag) < heute) jahr++;
    }
    const d = new Date(jahr, monat - 1, tag);
    /* Faengt den 31.02. ab: der wuerde sonst auf den 03.03. rutschen */
    if (d.getDate() !== tag || d.getMonth() !== monat - 1) return null;
    return dateKey(d);
  }

  /* "Zahnarzt, 9.10" -> Name und Datum getrennt. Steht hinter dem
     Komma kein lesbares Datum, bleibt alles der Name. */
  function titelUndDatum(roh) {
    const text = String(roh || "");
    const i = text.lastIndexOf(",");
    if (i < 0) return { titel: text.trim(), datum: null };
    const datum = datumAusText(text.slice(i + 1));
    if (!datum) return { titel: text.trim(), datum: null };
    return { titel: text.slice(0, i).trim() || text.trim(), datum };
  }

  function entwurfStarten(art, titel, fach, datum) {
    entwurf = { art, titel, datum: datum || todayStr(), start: null, ende: null,
                fach: fach || null, block: null, ganztags: art === "hausaufgabe",
                wichtig: 1 };
    /* Steht das Fach schon fest und kein Datum getippt, springt es auf
       den naechsten Tag, an dem der Kurs ueberhaupt stattfindet. */
    if (entwurf.fach && !datum) entwurf.datum = naechstesDatumFuer(entwurf.fach);
    stundeAutomatisch();
    kpSchicht.classList.add("open");
    komponist.classList.add("offen");
    /* Hausaufgaben haben ein Fach, aber keine Uhrzeit und keine
       Stunde: wann am Tag man sie macht, sagt nichts aus. */
    /* Der Test bekommt dieselben Felder wie die Klausur: Fach,
       Stunde, Raum. Er ist nur kürzer. */
    komponist.classList.toggle("schule",
      art === "klausur" || art === "test" || art === "hausaufgabe");
    komponist.classList.toggle("hausaufgabe", art === "hausaufgabe");
    /* Ein eigenes Thema braucht kein Datum — der Termin ist ein
       Angebot, keine Bedingung. Die Klasse blendet die Uhrzeit aus
       und lässt das Datum leer beginnen. */
    komponist.classList.toggle("thema", art === "thema");
    if (art === "thema" && !datum) entwurf.datum = "";
    $("kpArt").textContent = art === "test" ? "Test"
                          : art === "klausur" ? "Klausur"
                          : art === "hausaufgabe" ? "Hausaufgabe"
                          : art === "thema" ? "Thema" : "Termin";
    /* Beim Thema kommt der Name nicht aus einer Vorschlagsliste —
       er wird hier getippt. Deshalb ist die Überschrift selbst das
       Eingabefeld: ein zweites Feld daneben wäre eine Zeile mehr
       für dieselbe Sache. */
    const titelFeld = $("kpTitel");
    const frei = art === "thema";
    titelFeld.contentEditable = frei ? "plaintext-only" : "false";
    titelFeld.classList.toggle("tippbar", frei);
    titelFeld.dataset.leer = "Wie heißt das Thema?";
    titelFeld.textContent = frei && titel === "Neues Thema" ? "" : titel;

    entwurfZeichnen();

    if (frei) {
      /* Der Name ist das Erste, was fehlt — also gleich dorthin. */
      setTimeout(() => {
        titelFeld.focus();
        const b = document.createRange();
        b.selectNodeContents(titelFeld);
        b.collapse(false);
        const aus = window.getSelection();
        aus.removeAllRanges();
        aus.addRange(b);
      }, 60);
      titelFeld.oninput = () => {
        entwurf.titel = titelFeld.textContent.trim();
        entwurfZeichnen();          // der Anlegen-Knopf hängt am Namen
      };
      titelFeld.onkeydown = e => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        entwurfAnlegen();
      };
    } else {
      titelFeld.oninput = null;
      titelFeld.onkeydown = null;
    }
  }

  /* Aus Fach und Datum ergibt sich die Stunde von selbst. Gibt es an
     dem Tag mehrere Stunden des Kurses, wird die erste vorgeschlagen
     und der Stundenknopf laesst die andere waehlen. */
  function stundeAutomatisch() {
    if (!entwurf) return;
    if (!entwurf.fach || !entwurf.datum) { entwurf.block = null; return; }
    const treffer = stundenFuerFach(entwurf.fach, entwurf.datum);
    if (!treffer.length) { entwurf.block = null; entwurf.start = null; entwurf.ende = null; return; }
    if (!entwurf.block || !treffer.some(l => l.von === entwurf.block.von)) blockSetzen(treffer[0]);
  }

  function blockSetzen(l) {
    entwurf.block = { von: l.von, bis: l.bis, raum: l.raum || "" };
    entwurf.start = stundeInfo(l.von).von;
    entwurf.ende  = stundeInfo(l.bis).bis;
  }

  function entwurfBeenden() {
    entwurf = null;
    komponist.classList.remove("offen");
    kpSchicht.classList.remove("open");
    popsSchliessen();
  }

  /* Klick auf den dunklen Rand: erst das offene Auswahlfenster zu,
     beim zweiten Mal das ganze Fenster. */
  kpSchicht.addEventListener("mousedown", e => {
    if (e.target !== kpSchicht) return;
    if (offenesFeld) popsSchliessen(); else entwurfBeenden();
  });

  document.addEventListener("keydown", e => {
    if (e.key !== "Escape" || !entwurf) return;
    if (offenesFeld) popsSchliessen(); else entwurfBeenden();
  });

  function entwurfZeichnen() {
    if (!entwurf) return;
    const d = $("kpDatum"), s = $("kpStart"), e = $("kpEnde");
    d.querySelector("span").textContent = entwurf.datum ? fmtDate(entwurf.datum) : "Datum";
    d.classList.toggle("gesetzt", !!entwurf.datum);
    s.querySelector("span").textContent = entwurf.start || "Start";
    s.classList.toggle("gesetzt", !!entwurf.start);
    e.querySelector("span").textContent = entwurf.ende || "Ende";
    e.classList.toggle("gesetzt", !!entwurf.ende);

    komponist.classList.toggle("ganztags", !!entwurf.ganztags);
    $("kpGanztags").classList.toggle("gesetzt", !!entwurf.ganztags);

    const w = $("kpWichtig");
    if (w) {
      w.querySelector("span").textContent = HA_STUFEN[entwurf.wichtig || 1];
      w.className = "kp-knopf nur-ha gesetzt stufe-" + (entwurf.wichtig || 1);
    }

    const f = $("kpFach"), st = $("kpStunde");
    f.querySelector("span").textContent = entwurf.fach ? fachInfo(entwurf.fach).kurz : "Fach";
    f.classList.toggle("gesetzt", !!entwurf.fach);
    st.querySelector("span").textContent = entwurf.block
      ? blockName(entwurf.block.von, entwurf.block.bis) : "Stunde";
    st.classList.toggle("gesetzt", !!entwurf.block);
    st.disabled = !entwurf.datum || !schultag(entwurf.datum);

    /* Ein Hinweis nur dann, wenn Fach und Tag nicht zusammenpassen —
       sonst uebersieht man leicht, dass die Stunde leer geblieben ist. */
    const hin = $("kpHinweis");
    let text = "";
    if ((entwurf.art === "klausur" || entwurf.art === "test") && entwurf.fach) {
      if (!schultag(entwurf.datum)) text = "Wochenende — kein Unterricht";
      else if (!stundenFuerFach(entwurf.fach, entwurf.datum).length)
        text = "Kein " + fachInfo(entwurf.fach).kurz + " am " + TAGE_LANG[schultag(entwurf.datum)];
    }
    hin.textContent = text;
    hin.classList.toggle("da", !!text);

    /* Ein Thema braucht nur einen Namen — das Datum ist freiwillig.
       Alles andere hängt am Tag, an dem es stattfindet. */
    $("kpAnlegen").disabled = entwurf.art === "thema"
      ? !String(entwurf.titel || "").trim()
      : !entwurf.datum;
  }

  /* Das Fenster startet unter seinem Knopf und bleibt immer im Bild:
     zu weit rechts wird es hereingeschoben, zu weit unten klappt es
     ueber den Knopf. Die Schicht liegt bildschirmfest, deshalb sind
     Bildschirm- und Schichtkoordinaten dieselben. */
  const POP_RAND = 12;

  function popPositionieren(pop, knopf) {
    const k = knopf.getBoundingClientRect();
    const breite = pop.offsetWidth, hoehe = pop.offsetHeight;

    let links = Math.min(Math.max(POP_RAND, k.left),
                         Math.max(POP_RAND, window.innerWidth - breite - POP_RAND));

    let oben = k.bottom + 8;
    if (oben + hoehe > window.innerHeight - POP_RAND) {
      const darueber = k.top - hoehe - 8;
      oben = darueber >= POP_RAND ? darueber
                                  : Math.max(POP_RAND, window.innerHeight - hoehe - POP_RAND);
    }

    pop.style.left = Math.round(links) + "px";
    pop.style.top  = Math.round(oben) + "px";
  }

  function popsSchliessen() {
    popDatum.classList.remove("offen");
    popZeit.classList.remove("offen");
    popListe.classList.remove("offen");
    document.querySelectorAll(".kp-knopf, .ps-knopf").forEach(k => k.classList.remove("offen"));
    offenesFeld = null;
    popFremd = null;
  }

  /* ---------- Kalenderblatt ---------- */
  let kalMonat = null;   // erster Tag des angezeigten Monats

  /* Die Fenster für Datum und Uhrzeit gehören eigentlich zum
     Komponisten. Damit auch der Baukasten sie benutzen kann, gibt es
     ein zweites Ziel: steht hier ein Rückruf, geht die Auswahl dorthin
     statt in den Entwurf. */
  let popFremd = null;

  function fremdDatum(knopf, wert, dann) {
    popsSchliessen();
    popFremd = { wert: wert || todayStr(), setz: dann };
    offenesFeld = "fremd";
    knopf.classList.add("offen");
    kalMonat = new Date((wert || todayStr()) + "T00:00:00");
    kalMonat.setDate(1);
    kalenderZeichnen();
    popDatum.classList.add("offen");
    popPositionieren(popDatum, knopf);
  }

  function fremdZeit(knopf, wert, dann) {
    popsSchliessen();
    popFremd = { wert: wert || "", setz: dann, titel: "Uhrzeit" };
    offenesFeld = "fremd";
    knopf.classList.add("offen");
    zeitZeichnen("start");
    popZeit.classList.add("offen");
    popPositionieren(popZeit, knopf);
  }

  function kalenderZeichnen() {
    const jahr = kalMonat.getFullYear(), monat = kalMonat.getMonth();
    const ersterTag = new Date(jahr, monat, 1);
    // Woche beginnt am Montag
    const versatz = (ersterTag.getDay() + 6) % 7;
    const start = new Date(jahr, monat, 1 - versatz);
    const heute = todayStr();

    /* Steht ein Fach fest, treten die Tage ohne diesen Kurs zurueck.
       Anklickbar bleiben sie — eine Nachschreibklausur liegt eben
       nicht immer in der eigenen Stunde. */
    const fach = entwurf && entwurf.fach ? entwurf.fach : null;

    let felder = "";
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const key = dateKey(d);
      const fremd = d.getMonth() !== monat;
      const zumFach = fach ? (stundenFuerFach(fach, key).length ? " hat-fach" : " ohne-fach") : "";
      felder += `<button type="button" class="kal-tag${fremd ? " fremd" : ""}${zumFach}` +
        `${key === heute ? " heute" : ""}${key === (popFremd ? popFremd.wert : entwurf?.datum) ? " gewaehlt" : ""}" ` +
        `data-datum="${key}">${d.getDate()}</button>`;
    }

    /* Kleine Zeile darueber: an welchen Wochentagen liegt der Kurs? */
    let fachZeile = "";
    if (fach) {
      const wochentage = [...new Set(STUNDENPLAN.filter(l => l.fach === fach).map(l => l.tag))]
        .sort().map(t => TAGE_LANG[t].slice(0, 2)).join(", ");
      fachZeile = `<div class="kal-fach ton-${fachInfo(fach).ton}"><i></i>`
                + `${escapeHTML(fachInfo(fach).kurz)} liegt ${wochentage}</div>`;
    }

    popDatum.innerHTML = `
      <div class="kal-kopf">
        <button type="button" class="kal-pfeil" data-schritt="-1" aria-label="Vorheriger Monat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M14.5 5.5 8.5 12l6 6.5"/></svg></button>
        <div class="kal-monat">${MONTHS[monat]} ${jahr}</div>
        <button type="button" class="kal-pfeil" data-schritt="1" aria-label="Nächster Monat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9.5 5.5 15.5 12l-6 6.5"/></svg></button>
      </div>
      ${fachZeile}
      <div class="kal-wochentage"><span>Mo</span><span>Di</span><span>Mi</span><span>Do</span><span>Fr</span><span>Sa</span><span>So</span></div>
      <div class="kal-gitter${fach ? " ton-" + fachInfo(fach).ton : ""}">${felder}</div>`;

    popDatum.querySelectorAll("[data-schritt]").forEach(b => b.addEventListener("click", () => {
      kalMonat.setMonth(kalMonat.getMonth() + Number(b.dataset.schritt));
      kalenderZeichnen();
    }));
    popDatum.querySelectorAll("[data-datum]").forEach(b => b.addEventListener("click", () => {
      if (popFremd) {
        const ziel = popFremd;
        popsSchliessen();
        ziel.setz(b.dataset.datum);
        return;
      }
      if (!entwurf) return popsSchliessen();
      entwurf.datum = b.dataset.datum;
      stundeAutomatisch();
      entwurfZeichnen();
      popsSchliessen();
    }));
  }

  /* ---------- Fachauswahl ----------
     Zeigt zu jedem Kurs, an welchen Tagen er liegt — damit sieht man
     schon beim Waehlen, ob das gesetzte Datum ueberhaupt passt. */
  function fachZeichnen() {
    const eintraege = Object.keys(FAECHER).map(id => {
      const tage = [...new Set(STUNDENPLAN.filter(l => l.fach === id).map(l => l.tag))]
        .sort().map(t => TAGE_LANG[t].slice(0, 2)).join(" ");
      const passt = stundenFuerFach(id, entwurf.datum).length > 0;
      return `<button type="button" class="pl-zeile ton-${FAECHER[id].ton}${entwurf.fach === id ? " aktiv" : ""}"
                data-fach="${id}">
                <i></i>
                <span class="plz-haupt">${escapeHTML(FAECHER[id].kurz)}
                  <small>${escapeHTML(FAECHER[id].lang)}</small></span>
                <span class="plz-rechts${passt ? " passt" : ""}">${tage}</span>
              </button>`;
    }).join("");

    popListe.innerHTML = `<div class="pl-kopf">Fach</div>${eintraege}`
      + (entwurf.fach ? `<button type="button" class="pl-weg" data-fach="">Fach entfernen</button>` : "");

    popListe.querySelectorAll("[data-fach]").forEach(b => b.addEventListener("click", () => {
      entwurf.fach = b.dataset.fach || null;
      if (entwurf.fach && !stundenFuerFach(entwurf.fach, entwurf.datum).length) {
        entwurf.datum = naechstesDatumFuer(entwurf.fach);
      }
      entwurf.block = null;
      stundeAutomatisch();
      entwurfZeichnen();
      popsSchliessen();
    }));
  }

  /* ---------- Stundenauswahl ----------
     Oben die Stunden, in denen der gewaehlte Kurs an diesem Tag
     tatsaechlich liegt, darunter frei alle zehn Stunden. */
  function stundenZeichnen() {
    const tag = schultag(entwurf.datum);
    const ausPlan = entwurf.fach ? stundenFuerFach(entwurf.fach, entwurf.datum) : [];
    const belegt = tag ? stundenAmTag(tag) : [];
    let html = "";

    if (ausPlan.length) {
      html += `<div class="pl-kopf">Aus deinem Plan</div>`;
      html += ausPlan.map(l => `
        <button type="button" class="pl-zeile ton-${fachInfo(l.fach).ton}${
            entwurf.block && entwurf.block.von === l.von ? " aktiv" : ""}"
          data-von="${l.von}" data-bis="${l.bis}" data-raum="${escapeHTML(l.raum)}">
          <i></i>
          <span class="plz-haupt">${blockName(l.von, l.bis)}
            <small>${blockZeit(l.von, l.bis)}${l.raum ? " · " + escapeHTML(l.raum) : ""}</small></span>
          <span class="plz-rechts passt">${escapeHTML(fachInfo(l.fach).kurz)}</span>
        </button>`).join("");
    }

    html += `<div class="pl-kopf">Alle Stunden${tag ? " am " + TAGE_LANG[tag] : ""}</div>`;
    html += STUNDEN.map(st => {
      const kurs = belegt.find(l => st.nr >= l.von && st.nr <= l.bis);
      const gewaehlt = entwurf.block && entwurf.block.von === st.nr && !ausPlan.some(l => l.von === st.nr);
      return `<button type="button" class="pl-zeile schlicht${gewaehlt ? " aktiv" : ""}"
                data-von="${st.nr}" data-bis="${st.nr}" data-raum="${kurs ? escapeHTML(kurs.raum) : ""}">
                <i></i>
                <span class="plz-haupt">${st.nr}. Stunde <small>${st.von}–${st.bis}</small></span>
                <span class="plz-rechts">${kurs ? escapeHTML(fachInfo(kurs.fach).kurz) : "frei"}</span>
              </button>`;
    }).join("");

    if (entwurf.block) html += `<button type="button" class="pl-weg" data-von="">Stunde entfernen</button>`;

    popListe.innerHTML = html;
    popListe.querySelectorAll("[data-von]").forEach(b => b.addEventListener("click", () => {
      if (!b.dataset.von) {
        entwurf.block = null; entwurf.start = null; entwurf.ende = null;
      } else {
        blockSetzen({ von: Number(b.dataset.von), bis: Number(b.dataset.bis), raum: b.dataset.raum });
      }
      entwurfZeichnen();
      popsSchliessen();
    }));
  }

  /* ---------- Uhrzeit: zwei Räder ----------
     Eigene Steuerung statt Scrollen: eine Rastung bewegt genau einen
     Wert, und die Werte laufen endlos um. Dafür steht die Liste viele
     Male hintereinander; wandert die Position an den Rand, wird sie
     unsichtbar in die Mitte zurückgesetzt. */
  const RAD_STUNDEN = Array.from({ length: 24 }, (_, i) => zweistellig(i));
  const RAD_MINUTEN = Array.from({ length: 12 }, (_, i) => zweistellig(i * 5));
  const RAD_HOEHE = 34;      // Höhe eines Wertes in Pixeln
  const RAD_WDH = 21;        // so oft steht die Liste hintereinander

  const modulo = (a, b) => ((a % b) + b) % b;

  function radAufbauen(werte, rolle, gewaehlt) {
    const band = werte.length * RAD_WDH;
    const start = Math.floor(RAD_WDH / 2) * werte.length + Math.max(0, werte.indexOf(gewaehlt));
    const knoepfe = Array.from({ length: band }, (_, i) =>
      `<button type="button" class="rad-wert" data-i="${i}">${werte[modulo(i, werte.length)]}</button>`).join("");
    return `<div class="rad" data-rolle="${rolle}" data-pos="${start}" data-len="${werte.length}" tabindex="0">
              <div class="rad-band">${knoepfe}</div>
            </div>`;
  }

  /* Setzt das Band auf die aktuelle Position und hebt den mittleren Wert hervor */
  function radSetzen(rad, weich) {
    const band = rad.querySelector(".rad-band");
    const pos = Number(rad.dataset.pos);
    const mitte = rad.clientHeight / 2 - RAD_HOEHE / 2;
    band.style.transition = weich ? "transform 0.17s cubic-bezier(0.25, 0.9, 0.3, 1)" : "none";
    band.style.transform = `translateY(${mitte - pos * RAD_HOEHE}px)`;
    band.querySelectorAll(".rad-wert").forEach((b, i) => b.classList.toggle("aktiv", i === pos));
  }

  /* Eine Rastung weiter. Am Rand rückt die Position unsichtbar zurück
     in die Mitte — der Wert bleibt dabei derselbe. */
  function radSchritt(rad, richtung, weich = true) {
    const len = Number(rad.dataset.len);
    let pos = Number(rad.dataset.pos) + richtung;
    const rand = len * 2;
    if (pos < rand || pos > len * RAD_WDH - rand) {
      rad.dataset.pos = pos;
      radSetzen(rad, false);
      pos = Math.floor(RAD_WDH / 2) * len + modulo(pos, len);
      rad.dataset.pos = pos;
      radSetzen(rad, false);
      return;
    }
    rad.dataset.pos = pos;
    radSetzen(rad, weich);
  }

  function radWert(rolle) {
    const rad = popZeit.querySelector(`.rad[data-rolle="${rolle}"]`);
    if (!rad) return "00";
    return rad.querySelector(`.rad-wert[data-i="${rad.dataset.pos}"]`)?.textContent || "00";
  }

  function zeitZeichnen(feld) {
    const vorhanden = ((popFremd ? popFremd.wert : entwurf[feld]) || "").split(":");
    const stunde = vorhanden[0] || zweistellig(new Date().getHours());
    const minute = RAD_MINUTEN.includes(vorhanden[1]) ? vorhanden[1] : "00";

    popZeit.innerHTML = `
      <div class="zeit-kopf">${popFremd ? popFremd.titel : (feld === "start" ? "Beginn" : "Ende")} — Stunde und Minute</div>
      <div class="raeder">
        ${radAufbauen(RAD_STUNDEN, "stunde", stunde)}
        ${radAufbauen(RAD_MINUTEN, "minute", minute)}
      </div>
      <div class="zeit-fuss">
        <button type="button" data-zeit="weg">Leeren</button>
        <button type="button" class="haupt" data-zeit="ok">Übernehmen</button>
      </div>`;

    popZeit.querySelectorAll(".rad").forEach(rad => {
      radSetzen(rad, false);

      /* Mausrad: genau eine Stelle je Rastung, egal wie weit das Rad dreht */
      rad.addEventListener("wheel", e => {
        e.preventDefault();
        if (rad._sperre) return;
        rad._sperre = true;
        setTimeout(() => { rad._sperre = false; }, 90);
        radSchritt(rad, e.deltaY > 0 ? 1 : -1);
      }, { passive: false });

      /* Ziehen mit Maus oder Finger */
      /* Ziehen: gezählt wird, wie viele Rasten schon angewandt sind.
         Über die Position zu rechnen ginge nicht — sie springt beim
         Umlauf unsichtbar in die Mitte zurück. */
      let zieht = false, startY = 0, angewandt = 0;
      rad.addEventListener("pointerdown", e => {
        zieht = true; startY = e.clientY; angewandt = 0;
        try { rad.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
      });
      rad.addEventListener("pointermove", e => {
        if (!zieht) return;
        const soll = Math.round((startY - e.clientY) / RAD_HOEHE);
        while (angewandt !== soll) {
          const richtung = Math.sign(soll - angewandt);
          radSchritt(rad, richtung, false);
          angewandt += richtung;
        }
      });
      const los = () => { zieht = false; };
      rad.addEventListener("pointerup", los);
      rad.addEventListener("pointercancel", los);

      /* Pfeiltasten */
      rad.addEventListener("keydown", e => {
        if (e.key === "ArrowUp") { e.preventDefault(); radSchritt(rad, -1); }
        if (e.key === "ArrowDown") { e.preventDefault(); radSchritt(rad, 1); }
      });

      /* Klick auf einen sichtbaren Wert holt ihn in die Mitte */
      rad.querySelectorAll(".rad-wert").forEach(b => b.addEventListener("click", () => {
        const ziel = Number(b.dataset.i), jetzt = Number(rad.dataset.pos);
        const schritte = ziel - jetzt;
        for (let i = 0; i < Math.abs(schritte); i++) {
          radSchritt(rad, Math.sign(schritte), i === Math.abs(schritte) - 1);
        }
      }));
    });

    popZeit.querySelector('[data-zeit="ok"]').addEventListener("click", () => {
      const wert = radWert("stunde") + ":" + radWert("minute");
      if (popFremd) { const ziel = popFremd; popsSchliessen(); ziel.setz(wert); return; }
      entwurf[feld] = wert;
      entwurfZeichnen();
      popsSchliessen();
    });
    popZeit.querySelector('[data-zeit="weg"]').addEventListener("click", () => {
      if (popFremd) { const ziel = popFremd; popsSchliessen(); ziel.setz(""); return; }
      entwurf[feld] = null;
      entwurfZeichnen();
      popsSchliessen();
    });
  }

  /* ---------- Knöpfe der Eingabehilfe ---------- */
  komponist.addEventListener("click", e => {
    const knopf = e.target.closest(".kp-knopf");
    /* Ohne Entwurf gibt es nichts einzustellen — das kann nur
       vorkommen, wenn das Fenster gar nicht offen ist. */
    if (knopf && !entwurf) return;
    if (knopf) {
      const feld = knopf.dataset.feld;
      /* Ganztaegig ist ein Schalter, kein Fenster: Start und Ende
         fallen dann weg, weil die Uhrzeit nichts mehr aussagt. */
      if (feld === "wichtig") {
        popsSchliessen();
        entwurf.wichtig = (entwurf.wichtig || 1) % 3 + 1;
        entwurfZeichnen();
        return;
      }
      if (feld === "ganztags") {
        popsSchliessen();
        entwurf.ganztags = !entwurf.ganztags;
        if (entwurf.ganztags) { entwurf.start = null; entwurf.ende = null; }
        entwurfZeichnen();
        return;
      }
      const warOffen = offenesFeld === feld;
      popsSchliessen();
      if (warOffen) return;
      offenesFeld = feld;
      knopf.classList.add("offen");
      if (feld === "datum") {
        kalMonat = new Date(entwurf.datum + "T00:00:00");
        kalMonat.setDate(1);
        kalenderZeichnen();
        popDatum.classList.add("offen");
        popPositionieren(popDatum, knopf);
      } else if (feld === "fach" || feld === "stunde") {
        if (feld === "fach") fachZeichnen(); else stundenZeichnen();
        popListe.classList.add("offen");
        popPositionieren(popListe, knopf);
      } else {
        zeitZeichnen(feld);
        popZeit.classList.add("offen");
        popPositionieren(popZeit, knopf);
      }
      return;
    }
    if (e.target.closest("#kpAbbrechen")) { entwurfBeenden(); return; }
    if (e.target.closest("#kpAnlegen")) { entwurfAnlegen(); return; }
  });

  function entwurfAnlegen() {
    if (!entwurf) return;

    /* Ein Thema kommt vor allem anderen: es hat kein Fach, keine
       Stunde und darf ohne Datum bestehen. */
    if (entwurf.art === "thema") {
      const t = themaAnlegen(entwurf.titel, entwurf.datum);
      if (!t) {
        showToast("Das Thema braucht einen Namen", "warn");
        const feld = $("kpTitel");
        if (feld) feld.focus();
        return;
      }
      offenesThema = t.id;
      lernReiter = "themen";
      store.set("lifeos_lern_reiter", lernReiter);
      renderNaechste();
      if (aktuelleSeite === "lernen") baueLernen();
      if (aktuelleSeite === "kalender") baueKalender();
      showToast(`Thema „${t.title}" angelegt`
                + (t.date ? " — " + fmtDate(t.date) : ""), "success");
      entwurfBeenden();
      return;
    }

    if (!entwurf.datum) return;
    const zeit = entwurf.start && entwurf.ende ? `${entwurf.start}–${entwurf.ende}`
               : entwurf.start ? entwurf.start : "";
    const eintrag = { id: "e" + Date.now(), title: entwurf.titel, date: entwurf.datum, time: zeit };
    /* Das Merkmal muss vor zeitenEintragen stehen: daran hängt, ob
       45 Minuten oder die Fachdauer eingetragen werden. */
    if (entwurf.art === "test") eintrag.pruefung = "test";
    if ((entwurf.art === "klausur" || entwurf.art === "test") && entwurf.fach) {
      eintrag.fach = entwurf.fach;
      if (entwurf.block) {
        eintrag.von = entwurf.block.von;
        eintrag.bis = entwurf.block.bis;
        eintrag.raum = entwurf.block.raum;
      }
    }
    /* Die Uhrzeit wandert mit in den Eintrag — der Kalender soll
       nicht raten müssen, und der Abgleich am Server kennt weder
       Stundenplan noch die eingestellten Dauern. */
    zeitenEintragen(eintrag, entwurf.art === "test" ? "klausur" : entwurf.art);

    if (entwurf.art === "hausaufgabe") {
      eintrag.fach = entwurf.fach || null;
      eintrag.wichtig = entwurf.wichtig || 1;
      eintrag.erledigt = false;
      delete eintrag.time;
      zeitenEintragen(eintrag, "hausaufgabe");   // nach dem Fach, das sie braucht
      hausaufgaben.push(eintrag);
      nutzAktion("hausaufgabe");
      store.set("lifeos_hausaufgaben", hausaufgaben);
      googleAnstossen();
    } else if (entwurf.art === "klausur" || entwurf.art === "test") {
      klausuren.push(eintrag);
      nutzAktion("klausur");
      /* Der Reiter springt dorthin, wo der neue Eintrag steht —
         sonst legt man einen Test an und sieht ihn nicht. */
      lernReiter = entwurf.art === "test" ? "tests" : "klausuren";
      store.set("lifeos_lern_reiter", lernReiter);
      klausurenSichern();
    } else {
      termine.push(eintrag);
      nutzAktion("termin");
      store.set("lifeos_termine", termine);
    }
    renderNaechste();
    if (aktuelleSeite === "kalender") baueKalender();
    if (aktuelleSeite === "lernen") baueLernen();
    const wo = entwurf.art === "hausaufgabe"
      ? (entwurf.fach ? fachInfo(entwurf.fach).kurz + " · " + fmtDate(entwurf.datum) : fmtDate(entwurf.datum))
      : klausurZusatz(eintrag);
    showToast(`${entwurf.art === "klausur" ? "Klausur"
               : entwurf.art === "hausaufgabe" ? "Hausaufgabe" : "Termin"} „${entwurf.titel}" angelegt`
              + (wo ? " — " + wo : ""));
    entwurfBeenden();
  }

  /* Fenster schließen, wenn daneben geklickt wird */
  document.addEventListener("mousedown", e => {
    if (!offenesFeld) return;
    if (e.target.closest(".pop") || e.target.closest(".kp-knopf")
        || e.target.closest(".ps-knopf")) return;
    popsSchliessen();
  });


  /* ==========================================================
     NOTIZEN
     Das Fenster schiebt von rechts herein und legt sich über die
     Seite, statt sie umzubauen. Das ist der Punkt: was man
     festhalten will, will man sofort festhalten — ohne die Seite zu
     wechseln und ohne den Zusammenhang zu verlieren, in dem es
     einem eingefallen ist.

     Eine Notiz ist nur Text. Die Überschrift ist ihre erste Zeile;
     ein eigenes Titelfeld wäre eine Hürde vor dem ersten Wort.
     Gespeichert wird beim Tippen, nicht auf Knopfdruck.
     ========================================================== */
  let notizen = store.get("lifeos_notizen", null);
  if (!Array.isArray(notizen)) { notizen = []; }

  let notizOffen = null;        // id der gerade bearbeiteten Notiz
  let notizSuche = "";
  let notizSpeicherTimer = null;

  const notizTitel = n => {
    const erste = String(n.text || "").split("\n").find(z => z.trim());
    return erste ? erste.trim().slice(0, 60) : "Ohne Text";
  };
  const notizRest = n => {
    const zeilen = String(n.text || "").split("\n");
    const ab = zeilen.findIndex(z => z.trim());
    return zeilen.slice(ab + 1).join(" ").trim().slice(0, 90);
  };

  function notizenSichern() {
    clearTimeout(notizSpeicherTimer);
    notizSpeicherTimer = setTimeout(() => {
      store.set("lifeos_notizen", notizen);
    }, 400);
  }

  function notizenGefiltert() {
    const suche = notizSuche.trim().toLowerCase();
    const liste = suche
      ? notizen.filter(n => String(n.text || "").toLowerCase().includes(suche))
      : notizen.slice();
    return liste.sort((a, b) => (b.geaendert || 0) - (a.geaendert || 0));
  }

  function notizenZeichnen() {
    const kasten = $("nzListe");
    if (!kasten) return;
    const liste = notizenGefiltert();
    $("nzZahl").textContent = notizen.length;

    if (!liste.length) {
      kasten.innerHTML = notizSuche
        ? '<div class="nz-leer">Nichts gefunden.</div>'
        : '<div class="nz-leer">Noch nichts notiert.<br><span>Ein Gedanke, eine Buchseite, was du morgen nicht vergessen willst.</span></div>';
      return;
    }

    kasten.innerHTML = liste.map(n => {
      const offen = n.id === notizOffen;
      const bezug = n.klausurId
        ? (klausuren.find(k => k.id === n.klausurId) || {}).title
        : null;
      return `<article class="nz-notiz${offen ? " offen" : ""}" data-notiz="${n.id}">
        ${offen
          ? `<textarea class="nz-feld" data-nzfeld="${n.id}"
               placeholder="Schreib los …">${escapeHTML(n.text || "")}</textarea>
             <div class="nz-fuss">
               <span class="nz-zeit">${notizZeitText(n)}</span>
               ${bezug ? `<span class="nz-bezug">${escapeHTML(bezug)}</span>` : ""}
               <button type="button" class="nz-weg" data-nzweg="${n.id}">Löschen</button>
             </div>`
          : `<button type="button" class="nz-auf" data-nzauf="${n.id}">
               <span class="nz-titel">${escapeHTML(notizTitel(n))}</span>
               ${notizRest(n) ? `<span class="nz-vorschau">${escapeHTML(notizRest(n))}</span>` : ""}
               <span class="nz-zeile">
                 <span class="nz-zeit">${notizZeitText(n)}</span>
                 ${bezug ? `<span class="nz-bezug">${escapeHTML(bezug)}</span>` : ""}
               </span>
             </button>`}
      </article>`;
    }).join("");

    if (notizOffen) {
      const feld = kasten.querySelector(`[data-nzfeld="${notizOffen}"]`);
      if (feld) {
        feld.focus();
        feld.setSelectionRange(feld.value.length, feld.value.length);
        notizHoeheAnpassen(feld);
      }
    }
  }

  /* "heute 14:20" ist beim Suchen brauchbarer als ein volles Datum */
  function notizZeitText(n) {
    const d = new Date(n.geaendert || n.erstellt || Date.now());
    const tag = dateKey(d);
    const uhr = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    if (tag === todayStr()) return "heute " + uhr;
    const gestern = new Date(); gestern.setDate(gestern.getDate() - 1);
    if (tag === dateKey(gestern)) return "gestern " + uhr;
    return fmtDate(tag);
  }

  /* Das Feld wächst mit dem Text, statt zu scrollen */
  function notizHoeheAnpassen(feld) {
    feld.style.height = "auto";
    feld.style.height = Math.min(420, feld.scrollHeight + 2) + "px";
  }

  function notizNeu(vorgabe) {
    const n = {
      id: "n" + Date.now().toString(36),
      text: vorgabe || "",
      erstellt: Date.now(),
      geaendert: Date.now()
    };
    /* Hängt gerade eine Klausur offen, gehört die Notiz dazu */
    if (aktuelleSeite === "lernen" && lernKlausur) n.klausurId = lernKlausur;
    notizen.unshift(n);
    notizOffen = n.id;
    notizSuche = "";
    const suchfeld = $("nzSuche");
    if (suchfeld) suchfeld.value = "";
    store.set("lifeos_notizen", notizen);
    notizenZeichnen();
    nutzAktion("notiz");
  }

  function notizenOeffnen(auf) {
    const schicht = $("notizSchicht");
    if (!schicht) return;
    const zeigen = auf === undefined ? schicht.hidden : auf;
    if (zeigen) {
      schicht.hidden = false;
      /* Ein Umbruch erzwingen, sonst springt die Bewegung nicht an.
         Ein requestAnimationFrame täte es auch — aber nur, solange das
         Fenster im Vordergrund ist. Steht es im Hintergrund, bliebe das
         Fenster im Aufbau stehen und wäre offen, aber unsichtbar. */
      void schicht.offsetWidth;
      schicht.classList.add("offen");
      notizenZeichnen();
    } else {
      schicht.classList.remove("offen");
      notizOffen = null;
      setTimeout(() => { schicht.hidden = true; }, 220);
    }
  }

  /* ---------- Bedienung ---------- */
  const nzBtn = $("notizBtn");
  if (nzBtn) nzBtn.addEventListener("click", () => notizenOeffnen());

  const nzZu = $("nzZu");
  if (nzZu) nzZu.addEventListener("click", () => notizenOeffnen(false));

  const nzNeu = $("nzNeu");
  if (nzNeu) nzNeu.addEventListener("click", () => notizNeu());

  const nzSuche = $("nzSuche");
  if (nzSuche) nzSuche.addEventListener("input", () => {
    notizSuche = nzSuche.value;
    notizOffen = null;
    notizenZeichnen();
  });

  const nzListe = $("nzListe");
  if (nzListe) {
    nzListe.addEventListener("click", e => {
      const auf = e.target.closest("[data-nzauf]");
      if (auf) { notizOffen = auf.dataset.nzauf; notizenZeichnen(); return; }
      const weg = e.target.closest("[data-nzweg]");
      if (weg) {
        notizen = notizen.filter(n => n.id !== weg.dataset.nzweg);
        notizOffen = null;
        store.set("lifeos_notizen", notizen);
        notizenZeichnen();
      }
    });

    nzListe.addEventListener("input", e => {
      const feld = e.target.closest("[data-nzfeld]");
      if (!feld) return;
      const n = notizen.find(x => x.id === feld.dataset.nzfeld);
      if (!n) return;
      n.text = feld.value;
      n.geaendert = Date.now();
      notizHoeheAnpassen(feld);
      notizenSichern();
    });
  }

  /* Neben das Fenster geklickt schließt es — im Fenster selbst nicht */
  const nzSchicht = $("notizSchicht");
  if (nzSchicht) nzSchicht.addEventListener("mousedown", e => {
    if (e.target === nzSchicht) notizenOeffnen(false);
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && nzSchicht && !nzSchicht.hidden) notizenOeffnen(false);
  });


  /* ==========================================================
     TASTATUR
     Für etwas, das man täglich am Rechner öffnet, ist Klicken durch
     die Seitenleiste der langsamste Weg. "g" leitet einen Sprung
     ein, der nächste Buchstabe sagt wohin — wie in vielen Werkzeugen
     für Leute, die den ganzen Tag darin sind.

     Bewusst kein Kürzel auf einzelnen Buchstaben allein außer "n"
     und "/": alles andere käme sonst beim Tippen in einem Feld in
     die Quere.
     ========================================================== */
  const SPRUNG = {
    d: "dashboard", k: "kalender", h: "habits", c: "kalorien",
    b: "bildschirmzeit", l: "lernen", p: "planung", j: "projekte", a: "analyse",
    /* "l" gehört Lernen, deshalb steht Licht auf dem w von WLED */
    w: "licht"
  };
  let sprungBereit = 0;        // Zeitpunkt, an dem "g" gedrückt wurde

  function tipptGerade() {
    const e = document.activeElement;
    if (!e) return false;
    return e.tagName === "INPUT" || e.tagName === "TEXTAREA"
        || e.tagName === "SELECT" || e.isContentEditable;
  }

  document.addEventListener("keydown", e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (tipptGerade()) return;

    /* Zweiter Anschlag eines Sprungs — nur kurz nach dem "g" */
    if (sprungBereit && Date.now() - sprungBereit < 1200) {
      const ziel = SPRUNG[e.key.toLowerCase()];
      sprungBereit = 0;
      if (ziel) { e.preventDefault(); seiteZeigen(ziel); return; }
    }

    const taste = e.key.toLowerCase();
    if (taste === "g") { sprungBereit = Date.now(); return; }

    if (taste === "n") { e.preventDefault(); notizenOeffnen(true); notizNeu(); return; }

    /* Das Fragezeichen ist die übliche Stelle für „was kann ich hier
       eigentlich drücken" */
    if (e.key === "?") { e.preventDefault(); tastenZeigen(); return; }

    /* Wie in den meisten Werkzeugen: Schrägstrich springt in die Suche */
    if (e.key === "/") {
      const feld = $("captureInput");
      if (feld) { e.preventDefault(); feld.focus(); feld.select(); }
    }
  });

  /* ==========================================================
     PAPIERKORB
     Der Server hebt je Schlüssel die letzten Fassungen auf. Was
     zwischen einer alten Fassung und heute fehlt, war einmal da und
     ist es nicht mehr — das ist der Papierkorb, ohne dass je etwas
     „in den Papierkorb gelegt" werden musste.

     Zurückgeholt wird der einzelne Eintrag, nicht die ganze Fassung:
     wer einen Termin von gestern sucht, will nicht auch die drei
     Änderungen von heute rückgängig machen.
     ========================================================== */
  const PAPIERKORB = [
    { schluessel: "lifeos_termine", art: "Termin",
      liste: () => termine,
      titel: e => e.title,
      wann:  e => e.date ? fmtDate(e.date) : "",
      zurueck: e => { termine = termine.concat(e); store.set("lifeos_termine", termine);
                      renderNaechste(); kalenderAuffrischen(); } },

    { schluessel: "lifeos_klausuren", art: "Klausur",
      liste: () => klausuren,
      titel: e => e.title,
      wann:  e => e.date ? fmtDate(e.date) : "",
      /* klausurenSichern stößt auch den Google-Abgleich an — die
         Klausur soll ja wieder im Kalender stehen. */
      zurueck: e => { klausuren = klausuren.concat(e); klausurenSichern();
                      renderNaechste(); renderTabLists(); kalenderAuffrischen(); baueLernen(); } },

    { schluessel: "lifeos_hausaufgaben", art: "Hausaufgabe",
      liste: () => hausaufgaben,
      titel: e => e.title,
      wann:  e => e.date ? fmtDate(e.date) : "",
      zurueck: e => { hausaufgaben = hausaufgaben.concat(e); store.set("lifeos_hausaufgaben", hausaufgaben);
                      renderNaechste(); kalenderAuffrischen(); baueLernen(); } },

    { schluessel: "lifeos_themen", art: "Thema",
      liste: () => themen,
      titel: e => e.title,
      wann:  e => e.date ? fmtDate(e.date) : "",
      zurueck: e => { themen = themen.concat(e); store.set("lifeos_themen", themen);
                      renderNaechste(); baueLernen(); } },

    { schluessel: "lifeos_notizen", art: "Notiz",
      liste: () => notizen,
      titel: e => notizTitel(e),
      wann:  e => e.erstellt ? fmtDate(dateKey(new Date(e.erstellt))) : "",
      zurueck: e => { notizen = [e].concat(notizen); store.set("lifeos_notizen", notizen);
                      notizenZeichnen(); } },

    { schluessel: "lifeos_projekte", art: "Projekt",
      liste: () => projekte,
      titel: e => e.title || e.name,
      wann:  () => "",
      zurueck: e => { projekte = projekte.concat(e); store.set("lifeos_projekte", projekte);
                      bereichZeichnen(BEREICHE.projekt); } },

    { schluessel: "lifeos_planung", art: "Ablauf",
      liste: () => planung,
      titel: e => e.title || e.name,
      wann:  () => "",
      zurueck: e => { planung = planung.concat(e); store.set("lifeos_planung", planung);
                      bereichZeichnen(BEREICHE.planung); } }
  ];

  const vorZeit = stand => {
    const min = Math.round((Date.now() - stand) / 60000);
    if (min < 2) return "gerade eben";
    if (min < 60) return "vor " + min + " Minuten";
    const std = Math.round(min / 60);
    if (std < 24) return "vor " + std + (std === 1 ? " Stunde" : " Stunden");
    const tage = Math.round(std / 24);
    return "vor " + tage + (tage === 1 ? " Tag" : " Tagen");
  };

  /* Was war in einer früheren Fassung da und ist es heute nicht mehr? */
  async function verschwundene(quelle) {
    let fassungen = [];
    try {
      const d = await fetch("/api/bestand/frueher?schluessel=" + encodeURIComponent(quelle.schluessel))
        .then(a => a.json());
      if (!d.ok) return [];
      fassungen = d.fassungen || [];
    } catch (fehler) { return []; }

    const jetzt = quelle.liste() || [];
    const daIds = new Set(jetzt.filter(e => e && e.id != null).map(e => e.id));
    const gesehen = new Set();
    const raus = [];

    /* Von der neuesten Fassung nach hinten: der erste Fund nennt den
       Zeitpunkt, zu dem der Eintrag zuletzt noch da war. */
    fassungen.forEach(f => {
      if (!Array.isArray(f.wert)) return;
      f.wert.forEach(e => {
        if (!e || e.id == null) return;
        if (daIds.has(e.id) || gesehen.has(e.id)) return;
        gesehen.add(e.id);
        raus.push({ quelle, eintrag: e, stand: f.stand });
      });
    });
    return raus;
  }

  async function papierkorbZeichnen() {
    const kasten = $("pkListe");
    if (!kasten) return;
    kasten.innerHTML = '<div class="gk-lade">Wird geprüft …</div>';

    let alle = [];
    for (const q of PAPIERKORB) {
      alle = alle.concat(await verschwundene(q));
    }
    /* Zuletzt Verschwundenes zuerst — danach sucht man */
    alle.sort((a, b) => (b.stand || 0) - (a.stand || 0));

    if (!alle.length) {
      kasten.innerHTML =
        `<div class="pk-leer">Nichts vermisst.
           <span>Gelöschtes taucht hier auf, solange der Server die alte Fassung noch hat.</span></div>`;
      return;
    }

    kasten.innerHTML = alle.map((x, i) => {
      const wann = x.quelle.wann(x.eintrag);
      return `<div class="pk-zeile" data-i="${i}">
        <div class="pk-text">
          <div class="pk-titel">${escapeHTML(x.quelle.titel(x.eintrag) || "Ohne Titel")}</div>
          <div class="pk-sub">${escapeHTML(x.quelle.art)}${wann ? " · " + escapeHTML(wann) : ""}
            · weg ${escapeHTML(vorZeit(x.stand || Date.now()))}</div>
        </div>
        <button type="button" class="kop-klein" data-pk="${i}">Zurückholen</button>
      </div>`;
    }).join("");

    kasten.querySelectorAll("[data-pk]").forEach(knopf => {
      knopf.addEventListener("click", () => {
        const x = alle[+knopf.dataset.pk];
        if (!x) return;
        /* Zweimal drücken darf nicht doppelt anlegen */
        if ((x.quelle.liste() || []).some(e => e && e.id === x.eintrag.id)) {
          return showToast("Ist schon wieder da.", "warn");
        }
        x.quelle.zurueck(x.eintrag);
        showToast(x.quelle.art + " zurückgeholt: " + (x.quelle.titel(x.eintrag) || ""), "success");
        papierkorbZeichnen();
      });
    });
  }

  /* ==========================================================
     WOCHENRÜCKBLICK
     Sonntagabend liegt eine Notiz bereit: Bildschirmzeit gegen das
     Ziel, wie viele Habits standen, welche Serie am längsten hielt,
     und was in der nächsten Woche ansteht.

     Geschrieben wird sie einmal je Woche und nur, wenn die Woche
     auch vorbei ist — Sonntag ab 18 Uhr, oder eben nachträglich,
     wenn man erst am Dienstag wieder hereinschaut.
     ========================================================== */

  /* Montag der Woche, in der dieses Datum liegt */
  function wochenStart(d) {
    const x = new Date(d); x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }

  /* Kalenderwoche nach ISO — die Zahl, die auch im Kalender steht */
  function kalenderWoche(d) {
    const x = new Date(d); x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() + 3 - ((x.getDay() + 6) % 7));   // Donnerstag der Woche
    const jan4 = new Date(x.getFullYear(), 0, 4);
    const versatz = (jan4.getDay() + 6) % 7;
    return { jahr: x.getFullYear(),
             kw: 1 + Math.round((x - jan4 + versatz * 86400000) / (7 * 86400000)) };
  }

  const stundenText = minuten => {
    const m = Math.max(0, Math.round(minuten));
    return Math.floor(m / 60) + " h " + String(m % 60).padStart(2, "0") + " min";
  };

  /* Der Text selbst. "start" ist der Montag der Woche, um die es
     geht — so lässt sich derselbe Rückblick auch für die Woche davor
     schreiben, ohne die Funktion zu ändern. */
  function rueckblickText(start) {
    const tage = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      tage.push(dateKey(d));
    }
    const woche = kalenderWoche(start);
    const bis = new Date(start); bis.setDate(start.getDate() + 6);

    const zeilen = [];
    zeilen.push("Rückblick KW " + woche.kw + " · " + fmtDate(tage[0]) + " – " + fmtDate(dateKey(bis)));
    zeilen.push("");

    /* --- Bildschirmzeit --- */
    const erfasst = tage.map(t => getDayEntry(t)).map(e => (e.phone || 0) + (e.pc || 0));
    const mitWert = erfasst.filter(m => m > 0);
    if (mitWert.length) {
      const schnitt = Math.round(mitWert.reduce((a, b) => a + b, 0) / mitWert.length);
      const grenze = (ziele && ziele.bildschirm) || 0;
      const drueber = grenze ? mitWert.filter(m => m > grenze).length : 0;
      zeilen.push("Bildschirmzeit: " + stundenText(schnitt) + " am Tag"
        + (grenze ? " (Ziel " + stundenText(grenze) + ")" : "")
        + " · erfasst an " + mitWert.length + " von 7 Tagen");
      if (grenze) {
        zeilen.push(drueber
          ? "  An " + drueber + (drueber === 1 ? " Tag" : " Tagen") + " über dem Ziel."
          : "  Kein Tag über dem Ziel.");
      }
    } else {
      zeilen.push("Bildschirmzeit: diese Woche nichts erfasst.");
    }

    /* --- Habits --- */
    const sichtbar = habits.list.slice(0, HABIT_LIMIT);
    if (sichtbar.length) {
      const moeglich = sichtbar.length * 7;
      const geschafft = tage.reduce((summe, t) =>
        summe + sichtbar.filter(h => habitErledigt(h.id, t)).length, 0);
      const quote = Math.round(geschafft / moeglich * 100);
      zeilen.push("Habits: " + geschafft + " von " + moeglich + " Haken (" + quote + " %)");

      /* Was gut lief und was liegen blieb — je einer reicht */
      const proHabit = sichtbar.map(h => ({
        name: h.name,
        zahl: tage.filter(t => habitErledigt(h.id, t)).length
      })).sort((a, b) => b.zahl - a.zahl);
      if (proHabit.length) {
        zeilen.push("  Am besten: " + proHabit[0].name + " (" + proHabit[0].zahl + "×)");
        const letzter = proHabit[proHabit.length - 1];
        if (letzter.zahl < proHabit[0].zahl) {
          zeilen.push("  Liegen geblieben: " + letzter.name + " (" + letzter.zahl + "×)");
        }
      }
    }

    /* --- Streaks --- */
    const laengste = streaks.list
      .map(e => ({ name: e.name, tage: streakLaenge(e.id) }))
      .sort((a, b) => b.tage - a.tage)[0];
    if (laengste && laengste.tage > 0) {
      zeilen.push("Längste Serie: " + laengste.name + " · " + laengste.tage + " Tage");
    }

    /* --- Was ansteht --- */
    zeilen.push("");
    zeilen.push("Nächste Woche:");
    const heute = todayStr();
    const inSicht = d => d >= heute && daysUntil(d) <= 7;

    const kommend = [];
    klausuren.filter(k => inSicht(k.date))
      .forEach(k => kommend.push("Klausur " + k.title + " · " + fmtDate(k.date)));
    hausaufgaben.filter(h => !h.erledigt && h.date && inSicht(h.date))
      .forEach(h => kommend.push("Hausaufgabe " + h.title + " · " + fmtDate(h.date)));
    termine.filter(t => inSicht(t.date))
      .forEach(t => kommend.push(t.title + " · " + fmtDate(t.date) + (t.time ? " " + t.time : "")));

    if (kommend.length) kommend.slice(0, 8).forEach(z => zeilen.push("  " + z));
    else zeilen.push("  Nichts eingetragen.");

    const karten = faelligZahl();
    if (karten) zeilen.push("  " + karten + (karten === 1 ? " Karteikarte" : " Karteikarten") + " sind fällig.");

    return zeilen.join("\n");
  }

  /* Schreibt den Rückblick als Notiz und gibt sie zurück */
  function rueckblickSchreiben(start) {
    const text = rueckblickText(start);
    const n = {
      id: "n" + Date.now().toString(36),
      text,
      erstellt: Date.now(),
      geaendert: Date.now(),
      art: "rueckblick"
    };
    notizen.unshift(n);
    store.set("lifeos_notizen", notizen);
    return n;
  }

  /* Einmal je Woche, und nur wenn die Woche vorbei ist */
  function rueckblickPruefen() {
    const jetzt = new Date();
    const sonntag = jetzt.getDay() === 0;
    /* Sonntag erst abends — vorher ist die Woche noch im Gange */
    if (sonntag && jetzt.getHours() < 18) return;

    /* Um welche Woche geht es? Sonntagabend um die laufende, an
       jedem anderen Tag um die vergangene. */
    const start = wochenStart(jetzt);
    if (!sonntag) start.setDate(start.getDate() - 7);
    const marke = dateKey(start);

    const stand = store.get("lifeos_rueckblick", {}) || {};
    if (stand.letzte === marke) return;

    rueckblickSchreiben(start);
    store.set("lifeos_rueckblick", { letzte: marke, geschrieben: Date.now() });
    const kw = kalenderWoche(start).kw;
    setTimeout(() => showToast("Rückblick auf KW " + kw + " liegt in den Notizen.", "success"), 2200);
  }

  /* ==========================================================
     WIE VIELE KARTEN SIND HEUTE DRAN
     Die Zahl steht an drei Stellen: im Menü, auf der Lernseite und
     im Dashboard-Reiter „Schule". Sie kommt von hier, damit keine
     davon zurückbleibt.
     ========================================================== */
  function faelligAuffrischen() {
    const zahl = faelligZahl();

    /* Menü */
    const link = document.querySelector('.nav-link[data-seite="lernen"]');
    if (link) {
      let marke = link.querySelector(".nav-zahl");
      if (!zahl) { if (marke) marke.remove(); }
      else {
        if (!marke) {
          marke = document.createElement("span");
          marke.className = "nav-zahl";
          link.appendChild(marke);
        }
        marke.textContent = zahl;
        marke.title = zahl + (zahl === 1 ? " Karte ist heute dran" : " Karten sind heute dran");
      }
    }

    /* Lernseite */
    const streifen = $("lernFaellig");
    if (streifen) {
      streifen.hidden = !zahl;
      if (zahl) {
        streifen.innerHTML =
          `<div class="lf-text">
             <b>${zahl} ${zahl === 1 ? "Karte" : "Karten"} heute fällig</b>
             <span>Aus allen Stapeln zusammen — gewusst heißt später wieder, nicht gewusst morgen.</span>
           </div>
           <button type="button" class="lf-knopf" id="lernFaelligStart">Abfrage starten</button>`;
        $("lernFaelligStart").addEventListener("click", () => kartenOeffnen(PORTION, "abfrage"));
      }
    }

    /* Dashboard-Reiter „Schule" */
    const liste = $("schuleList");
    if (liste) {
      const alte = liste.querySelector(".entry-karten");
      if (alte) alte.remove();
      if (zahl) {
        const li = document.createElement("li");
        li.className = "entry-item entry-karten klickbar";
        li.innerHTML =
          `<span class="entry-accent"></span>
           <div class="entry-main">
             <div class="entry-title">${zahl} ${zahl === 1 ? "Karte" : "Karten"} abfragen</div>
             <div class="entry-sub">Lernkarten · heute dran</div>
           </div>
           <span class="entry-badge">HEUTE</span>`;
        li.addEventListener("click", () => kartenOeffnen(PORTION, "abfrage"));
        liste.insertBefore(li, liste.firstChild);
      }
    }
  }

  /* ==========================================================
     TASTENKÜRZEL — DIE ÜBERSICHT
     Die Tasten gab es von Anfang an, nur stand nirgends welche.
     Die Liste steht hier neben dem Handler, damit sie nicht
     auseinanderläuft: wer oben eine Taste ergänzt, sieht hier, dass
     sie auch erklärt werden will.
     ========================================================== */
  const TASTEN = [
    { gruppe: "Springen", zeilen: [
      ["g d", "Dashboard"], ["g k", "Kalender & Schule"], ["g h", "Habits & Streaks"],
      ["g c", "Kalorien"],  ["g b", "Bildschirmzeit"],    ["g l", "Lernen"],
      ["g p", "Automation"],["g j", "Projekte"],          ["g w", "Licht"],
      ["g a", "Analyse"]
    ]},
    { gruppe: "Überall", zeilen: [
      ["/", "In die Suche springen"],
      ["n", "Neue Notiz"],
      ["?", "Diese Übersicht"],
      ["Esc", "Fenster schließen"]
    ]},
    { gruppe: "In der Suche", zeilen: [
      ["/", "Befehle anzeigen"],
      ["Tab", "Befehl vervollständigen"],
      ["\u2191 \u2193", "Auswählen"],
      ["Enter", "Ausführen"]
    ]},
    { gruppe: "Beim Abfragen", zeilen: [
      ["Leer", "Karte umdrehen"],
      ["Enter", "Karte umdrehen"],
      ["Esc", "Abfrage beenden"]
    ]}
  ];

  const tastenSchicht = $("tastenSchicht");

  function tastenZeigen() {
    /* Die Tasten einzeln setzen, damit "g d" als zwei Anschläge
       lesbar ist — so drückt man sie ja auch. */
    $("tastenRaster").innerHTML = TASTEN.map(g => `
      <div class="ts-gruppe">
        <div class="ts-kopf">${escapeHTML(g.gruppe)}</div>
        ${g.zeilen.map(([taste, was]) => `
          <div class="ts-zeile">
            <span class="ts-tasten">${taste.split(" ")
              .map(t => `<kbd>${escapeHTML(t)}</kbd>`).join("")}</span>
            <span class="ts-was">${escapeHTML(was)}</span>
          </div>`).join("")}
      </div>`).join("");
    tastenSchicht.classList.add("open");
  }

  const tastenSchliessen = () => tastenSchicht.classList.remove("open");
  $("tastenZu").addEventListener("click", tastenSchliessen);
  tastenSchicht.addEventListener("click", e => {
    if (e.target === tastenSchicht) tastenSchliessen();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") tastenSchliessen();
  });

  /* ==========================================================
     GRENZWERTE, DIE SICH MELDEN
     Ein Grenzwert, den man erst abends in der Auswertung sieht, ist
     eine Statistik — keine Grenze. Wird einer gerissen, sagt das
     Dashboard es beim nächsten Blick, aber höchstens einmal je Tag
     und Grenze: eine Meldung, die sich wiederholt, wird ignoriert.
     ========================================================== */
  function grenzenPruefen() {
    const gerissen = zieleGerissen();
    if (!gerissen.length) return;

    const gemeldet = store.get("lifeos_grenzen_gemeldet", {}) || {};
    const heute = todayStr();
    let neu = false;

    gerissen.forEach(z => {
      if (gemeldet[z.id] === heute) return;
      gemeldet[z.id] = heute;
      neu = true;
      const drueber = z.wert - z.grenze;
      setTimeout(() => showToast(
        z.titel + ": " + formatMinutes(z.wert) + " heute — "
        + formatMinutes(drueber) + " über deiner Grenze.", "warn"), 1200);
    });

    /* Nur die heutigen Marken behalten, sonst wächst der Eintrag ewig */
    if (neu) {
      Object.keys(gemeldet).forEach(k => { if (gemeldet[k] !== heute) delete gemeldet[k]; });
      store.set("lifeos_grenzen_gemeldet", gemeldet);
    }
  }


  /* ==========================================================
     GOOGLE KALENDER — BEDIENUNG
     Der Kasten zeigt genau den nächsten Schritt und sonst nichts:
     nicht eingerichtet → was zu tun ist; eingerichtet → verbinden;
     verbunden → welcher Kalender, wann zuletzt, abgleichen.

     Die Anmeldung selbst läuft über localhost. Google lässt als
     Rückadresse nur https oder localhost zu, und ein selbst
     ausgestelltes Zertifikat kennt Google nicht — vom iPad aus ist
     das Verbinden deshalb nicht möglich, danach gilt es aber für
     alle Geräte, weil der Abgleich am Server hängt.
     ========================================================== */
  let gkStand = null;

  /* Googles Fehlermeldungen enthalten oft genau die Adresse, auf der
     sich das Problem beheben lässt — als Text nützt sie wenig. */
  function fehlerMitLink(text) {
    return escapeHTML(text).replace(/https?:\/\/[^\s]+/g, treffer => {
      const sauber = treffer.replace(/[.,)]+$/, "");
      const rest = treffer.slice(sauber.length);
      return `<a href="${sauber}" target="_blank" rel="noopener noreferrer">${sauber}</a>${rest}`;
    });
  }

  function gkZeichnen() {
    const kasten = $("gkKasten");
    if (!kasten) return;
    const s = gkStand;

    if (!s) { kasten.innerHTML = '<div class="gk-lade">Wird geprüft …</div>'; return; }

    if (!s.eingerichtet) {
      kasten.innerHTML =
        `<div class="gk-zeile"><span class="gk-punkt aus"></span>
           <b>Noch nicht eingerichtet</b></div>
         <p class="gk-text">Einmalig nötig, weil Google für den Zugriff eigene
           Zugangsdaten verlangt:</p>
         <ol class="gk-schritte">
           <li>Auf <a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com"
               target="_blank" rel="noopener noreferrer">console.cloud.google.com</a> ein Projekt
               anlegen und die <b>Google Calendar API</b> aktivieren</li>
           <li>Unter <b>APIs &amp; Dienste → OAuth-Zustimmungsbildschirm</b> die Zielgruppe
               <b>Extern</b> wählen und dich selbst als <b>Testnutzer</b> eintragen —
               ohne das lässt Google keine Client-ID zu</li>
           <li>Unter <b>Anmeldedaten</b> eine OAuth-Client-ID vom Typ
               <b>Webanwendung</b> erstellen</li>
           <li>Als autorisierte Weiterleitungs-URI eintragen:
               <code class="gk-code">${escapeHTML(s.rueckAdresse || "")}</code></li>
           <li>Client-ID und Secret unten eintragen</li>
         </ol>
         <form class="gk-form" id="gkForm" autocomplete="off">
           <label class="gk-feld">
             <span>Client-ID</span>
             <input type="text" id="gkId" spellcheck="false" autocomplete="off"
                    placeholder="…….apps.googleusercontent.com">
           </label>
           <label class="gk-feld">
             <span>Client-Secret</span>
             <input type="password" id="gkGeheim" spellcheck="false" autocomplete="off"
                    placeholder="GOCSPX-…">
           </label>
           <button type="submit" class="gk-knopf stark">Zugangsdaten speichern</button>
         </form>
         <p class="gk-text gk-leise">Die Zugangsdaten bleiben auf deinem Rechner: sie landen
           in <code class="gk-code">data/google-zugang.json</code> und gehen an niemanden
           außer an Google beim Anmelden.</p>`;

      const form = $("gkForm");
      if (form) form.addEventListener("submit", e => {
        e.preventDefault();
        const knopf = form.querySelector("button");
        knopf.disabled = true; knopf.textContent = "Wird gespeichert …";
        fetch("/api/google/zugang", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: $("gkId").value,
            client_secret: $("gkGeheim").value
          })
        })
          .then(a => a.json())
          .then(d => {
            if (!d.ok) throw new Error(d.fehler || "Hat nicht geklappt");
            showToast("Zugangsdaten gespeichert", "success");
            gkStandHolen();
          })
          .catch(f => {
            showToast(f.message, "warn");
            knopf.disabled = false; knopf.textContent = "Zugangsdaten speichern";
          });
      });
      return;
    }

    if (!s.verbunden) {
      kasten.innerHTML =
        `<div class="gk-zeile"><span class="gk-punkt bereit"></span>
           <b>Eingerichtet, noch nicht verbunden</b></div>
         <p class="gk-text">Beim Verbinden fragt Google einmal um Erlaubnis.
           Das muss am Rechner passieren, nicht am iPad — danach gilt es für alle Geräte.</p>
         <a class="gk-knopf stark" href="/api/google/start">Mit Google verbinden</a>`;
      return;
    }

    const wann = s.letzterLauf
      ? new Date(s.letzterLauf).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
      : null;

    kasten.innerHTML =
      `<div class="gk-zeile"><span class="gk-punkt an"></span>
         <b>Verbunden</b>
         <span class="gk-leise" id="gkWann">${wann ? "zuletzt " + wann : "noch nicht abgeglichen"}</span></div>
       <p class="gk-text">Termine kommen von Google hierher, Klausuren wandern dorthin.
         Von selbst alle 15 Minuten.</p>
       <div class="gk-kalender" id="gkListe"><div class="gk-lade">Kalender werden geladen …</div></div>
       <label class="gk-feld gk-weg">
         <span>Nicht anzeigen</span>
         <textarea id="gkAusblenden" rows="3" spellcheck="false"
                   placeholder="Ein Begriff pro Zeile">${
           escapeHTML((s.ausblenden || []).join("\n"))}</textarea>
         <em>Termine, deren Titel einen dieser Begriffe enthält, kommen gar nicht
             erst an. Groß- und Kleinschreibung egal.</em>
       </label>
       <div id="gkMeldung">${
         s.letzterFehler ? `<p class="gk-fehler">${fehlerMitLink(s.letzterFehler)}</p>` : ""}</div>
       <div class="gk-knoepfe">
         <button type="button" class="gk-knopf stark" id="gkJetzt">Jetzt abgleichen</button>
         <button type="button" class="gk-knopf" id="gkTrennen">Trennen</button>
       </div>`;

    /* Die Kalenderliste kommt nach — sie braucht einen Netzabruf */
    fetch("/api/google/kalender").then(a => a.json()).then(d => {
      const feld = $("gkListe");
      if (!feld) return;
      if (!d.ok || !d.kalender || !d.kalender.length) {
        feld.innerHTML = `<div class="gk-lade">Keine Kalender gefunden</div>`;
        return;
      }
      gkListeZeichnen(feld, d.kalender, s);
    }).catch(() => {
      const feld = $("gkListe");
      if (feld) feld.innerHTML = `<div class="gk-lade">Kalender nicht erreichbar</div>`;
    });

    /* Erst beim Verlassen des Feldes sichern — sonst liefe bei jedem
       Tastendruck ein Abgleich. */
    const weg = $("gkAusblenden");
    if (weg) {
      let zuletzt = weg.value;
      weg.addEventListener("blur", () => {
        if (weg.value === zuletzt) return;
        zuletzt = weg.value;
        fetch("/api/google/ausblenden", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ liste: weg.value.split("\n").map(z => z.trim()).filter(Boolean) })
        }).then(() => gkAbgleichen(null, true));
      });
    }

    const jetzt = $("gkJetzt");
    if (jetzt) jetzt.addEventListener("click", () => gkAbgleichen(jetzt));
    const trennen = $("gkTrennen");
    if (trennen) trennen.addEventListener("click", () => {
      fetch("/api/google/trennen", { method: "POST" })
        .then(() => { showToast("Google-Kalender getrennt"); gkStandHolen(); });
    });
  }

  /* Zwei Spalten, weil es zwei verschiedene Fragen sind: aus welchen
     Kalendern Termine kommen (mehrere möglich) und in welchen
     Klausuren geschrieben werden (genau einer). Kalender, die nur
     geteilt sind — der Familienkalender —, lassen sich lesen, aber
     nicht als Ziel wählen. */
  function gkListeZeichnen(feld, kalender, s) {
    const liest = new Set(s.lesen && s.lesen.length ? s.lesen : [s.kalender]);
    const schreibt = s.schreiben || s.kalender;

    const schreibbar = kalender.filter(k => k.schreibbar);
    const ziele = s.ziele || {};
    const wahl = (art, vorgabe) =>
      `<select data-ziel="${art}">${schreibbar.map(k =>
        `<option value="${escapeHTML(k.id)}"${
          (ziele[art] || vorgabe) === k.id ? " selected" : ""}>${escapeHTML(k.name)}</option>`
      ).join("")}</select>`;

    feld.innerHTML =
      `<div class="gk-kopf"><span>Kalender</span><span>Lesen</span><span>Eintragen</span></div>` +
      kalender.map(k => {
        const id = escapeHTML(k.id);
        return `<div class="gk-reihe">
            <span class="gk-name" title="${id}">${escapeHTML(k.name)}${
              k.haupt ? ' <em>Haupt</em>' : ""}</span>
            <label class="gk-haken">
              <input type="checkbox" data-lesen="${id}"${liest.has(k.id) ? " checked" : ""}>
            </label>
            <label class="gk-haken">
              ${k.schreibbar
                ? `<input type="radio" name="gkZiel" data-schreiben="${id}"${
                    k.id === schreibt ? " checked" : ""}>`
                : `<span class="gk-nur-lesen" title="Nur geteilt — hier lässt sich nichts eintragen">–</span>`}
            </label>
          </div>`;
      }).join("") +
      `<div class="gk-zuordnung">
         <div class="gk-zu-kopf">Und wohin genau?</div>
         <label class="gk-zu-zeile"><span>Klausuren</span>${wahl("klausur", schreibt)}</label>
         <label class="gk-zu-zeile"><span>Hausaufgaben</span>${wahl("hausaufgabe", schreibt)}</label>
         <label class="gk-zu-zeile"><span>Fahrschule</span>${wahl("fahrschule", schreibt)}</label>
         <p class="gk-text gk-leise">Ein Termin gilt als Fahrschule, wenn im Namen
           Fahrstunde, Fahrschule, Führerschein oder Ähnliches steht. Alles darüber
           Angehakte wird nur gelesen; geteilte Kalender bleiben unberührt.</p>
       </div>`;

    const sichern = () => {
      const lesen = [...feld.querySelectorAll("[data-lesen]:checked")]
        .map(e => e.getAttribute("data-lesen"));
      const ziel = feld.querySelector("[data-schreiben]:checked");
      return fetch("/api/google/kalender", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lesen, schreiben: ziel ? ziel.getAttribute("data-schreiben") : "" })
      }).then(() => gkAbgleichen(null, true));   // leise: die Liste bleibt stehen
    };

    feld.querySelectorAll("input").forEach(e => e.addEventListener("change", sichern));

    /* Die Zuordnung wird getrennt gespeichert — sie sagt nicht, ob
       ein Kalender benutzt wird, sondern wofür. */
    const zieleSichern = () => {
      const zuordnung = {};
      feld.querySelectorAll("[data-ziel]").forEach(w => { zuordnung[w.dataset.ziel] = w.value; });
      return fetch("/api/google/ziele", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ziele: zuordnung })
      }).then(() => gkAbgleichen(null, true));
    };
    feld.querySelectorAll("[data-ziel]").forEach(w =>
      w.addEventListener("change", zieleSichern));
  }

  /* `leise` heißt: Statuszeile und Fehler auffrischen, aber die
     Kalenderliste stehen lassen. Sonst reißt ein Neuaufbau dem
     Finger die Häkchen unter der Hand weg, sobald man zwei davon
     hintereinander setzen will. */
  function gkAbgleichen(knopf, leise) {
    if (knopf) { knopf.disabled = true; knopf.textContent = "Läuft …"; }
    /* Die Fachnamen kennt nur der Browser — sie wandern mit, damit
       sie in der Beschreibung des Termins stehen können. */
    const faecher = {};
    Object.keys(FAECHER || {}).forEach(id => { faecher[id] = fachInfo(id).lang; });

    fetch("/api/google/abgleich", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ faecher, dauern: klausurDauer })
    })
      .then(a => a.json())
      .then(d => {
        if (!d.ok) throw new Error(d.fehler || "Abgleich fehlgeschlagen");
        showToast(d.geholt + (d.geholt === 1 ? " Termin geholt · " : " Termine geholt · ")
                + d.geschrieben + (d.geschrieben === 1 ? " Klausur geschrieben" : " Klausuren geschrieben")
                + (d.geloescht ? " · " + d.geloescht + " gelöscht" : "")
                + (d.ausgeblendet ? " · " + d.ausgeblendet + " ausgeblendet" : ""),
                "success");
        leise ? gkStandAuffrischen() : gkStandHolen();
        /* Der Server hat in den Bestand geschrieben — die Leitung
           bringt es gleich her, aber einmal nachfassen schadet nicht. */
        if (window.lifeosBestand) window.lifeosBestand.nachschauen(true);
      })
      .catch(f => {
        showToast(f.message, "warn");
        leise ? gkStandAuffrischen() : gkStandHolen();
      });
  }

  /* Nur die beiden Stellen, die sich wirklich ändern können */
  function gkStandAuffrischen() {
    return fetch("/api/google/status", { cache: "no-store" })
      .then(a => a.json())
      .then(d => {
        gkStand = d;
        const wann = $("gkWann");
        if (wann) {
          wann.textContent = d.letzterLauf
            ? "zuletzt " + new Date(d.letzterLauf).toLocaleTimeString("de-DE",
                { hour: "2-digit", minute: "2-digit" })
            : "noch nicht abgeglichen";
        }
        const meldung = $("gkMeldung");
        if (meldung) {
          meldung.innerHTML = d.letzterFehler
            ? `<p class="gk-fehler">${fehlerMitLink(d.letzterFehler)}</p>` : "";
        }
      })
      .catch(() => { /* dann bleibt stehen, was da steht */ });
  }

  function gkStandHolen() {
    return fetch("/api/google/status", { cache: "no-store" })
      .then(a => a.json())
      .then(d => { gkStand = d; gkZeichnen(); })
      .catch(() => { gkStand = null; gkZeichnen(); });
  }

  /* Geholt wird erst, wenn der Bereich im Kontopanel geöffnet wird —
     siehe kpBereichZeigen. */

  /* ==========================================================
     VERBINDUNGSANZEIGE
     Der Punkt in der Kopfzeile leuchtet grün, solange der Rechner
     antwortet, und gelb, wenn nicht. Gelb heißt nicht "kaputt":
     das Dashboard arbeitet auf iPad und Telefon ganz normal
     weiter, nur wandern die Änderungen erst hoch, sobald der
     Server wieder da ist. Genau das steht auch im Tooltip.
     ========================================================== */
  function verbindungAnzeigen(verbunden) {
    const punkt = document.querySelector(".chip-pulse");
    const chip = $("heroChip");
    /* null heißt: noch nicht entschieden — dann bleibt es grün */
    const aus = verbunden === false;
    document.body.classList.toggle("nicht-verbunden", aus);
    if (punkt) punkt.classList.toggle("aus", aus);
    if (chip) {
      const wartend = window.lifeosBestand && window.lifeosBestand.offeneAenderungen
        ? window.lifeosBestand.offeneAenderungen() : 0;
      chip.title = aus
        ? "Kein Abgleich — der Rechner ist aus."
          + (wartend ? " " + wartend + (wartend === 1 ? " Änderung wartet." : " Änderungen warten.") : "")
          + " Alles bleibt gespeichert und wird nachgetragen."
        : "Mit dem Rechner verbunden — Änderungen werden sofort abgeglichen.";
    }
  }

  /* Beim Start kann der Zustand schon feststehen: die Brücke prüft
     den Server, bevor sie dieses Skript überhaupt nachlädt. */
  verbindungAnzeigen(window.lifeosBestand ? window.lifeosBestand.verbunden : null);
  document.addEventListener("lifeos-verbindung", e => verbindungAnzeigen(e.detail.verbunden));

  /* ==========================================================
     OFFLINE-BETRIEB: EINRICHTUNG UND ZUSTAND
     Ein Service Worker — und damit der Offline-Betrieb — gibt es
     nur in einem "sicheren Kontext": HTTPS oder localhost. Wird
     die Seite über die Netzadresse ohne Verschlüsselung geöffnet,
     stellt Safari die Funktion gar nicht bereit. Das lässt sich
     nicht umgehen, nur einrichten — und die Schritte dafür stehen
     besser hier als in einer Anleitung, die man nicht dabei hat.
     ========================================================== */
  function offlineMoeglich() {
    return "serviceWorker" in navigator && window.isSecureContext;
  }

  function einrichtungPruefen() {
    const kasten = $("einricht");
    if (!kasten) return;

    /* Schon sicher unterwegs, oder für diese Sitzung weggeklickt */
    if (offlineMoeglich() || sessionStorage.getItem("lifeos_einricht_weg")) return;
    /* Am Rechner über localhost ist alles in Ordnung */
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return;

    fetch("/api/health", { cache: "no-store" })
      .then(a => a.ok ? a.json() : Promise.reject(new Error(a.status)))
      .then(d => {
        if (!d.https || !d.https.an) return;      // ohne HTTPS gibt es nichts einzurichten
        const host = location.hostname;
        $("einrichtJetzt").textContent = location.protocol.replace(":", "");
        $("einrichtZert").href = location.origin + "/life-os-wurzel.crt";
        $("einrichtHttps").href = "https://" + host + ":" + d.https.port + "/";
        $("einrichtHttps").textContent = "https://" + host + ":" + d.https.port;
        kasten.hidden = false;
      })
      .catch(() => { /* kein Server erreichbar: dann später */ });
  }

  const einrichtZu = $("einrichtZu");
  if (einrichtZu) einrichtZu.addEventListener("click", () => {
    sessionStorage.setItem("lifeos_einricht_weg", "1");
    $("einricht").hidden = true;
  });

  einrichtungPruefen();

  /* ==========================================================
     OFFLINE-BETRIEB: WAS GERADE GILT
     Drei Dinge müssen zusammenkommen, damit die App ohne den
     Rechner startet: eine sichere Adresse, ein eingerichteter
     Zwischenspeicher und eine Kopie darin. Fehlt eines, merkt man
     es sonst erst unterwegs — deshalb steht hier, was davon steht
     und was nicht.
     ========================================================== */
  async function offZeichnen() {
    const kasten = $("offKasten");
    if (!kasten) return;

    const sicher = window.isSecureContext;
    const hatSW = "serviceWorker" in navigator;
    let aktiv = false, dateien = 0;

    if (hatSW && sicher) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        aktiv = !!(reg && reg.active);
        if (window.caches) {
          const namen = await caches.keys();
          for (const n of namen) dateien += (await (await caches.open(n)).keys()).length;
        }
      } catch (fehler) { /* dann bleibt es bei "nicht bereit" */ }
    }

    const bereit = sicher && hatSW && aktiv && dateien > 0;
    const alsApp = window.matchMedia("(display-mode: standalone)").matches
                || window.navigator.standalone === true;

    const zeile = (gut, text) =>
      `<div class="off-zeile"><span class="off-punkt ${gut ? "an" : "aus"}"></span>${text}</div>`;

    kasten.innerHTML =
      `<div class="gk-zeile"><span class="gk-punkt ${bereit ? "an" : "aus"}"></span>
         <b>${bereit ? "Startet auch ohne den Rechner" : "Startet nur mit laufendem Rechner"}</b></div>
       ${zeile(sicher, `Adresse: <code class="gk-code">${escapeHTML(location.origin)}</code>`)}
       ${zeile(hatSW && aktiv, aktiv ? "Zwischenspeicher eingerichtet"
                : hatSW ? "Zwischenspeicher noch nicht eingerichtet"
                        : "Safari stellt hier keinen Zwischenspeicher bereit")}
       ${zeile(dateien > 0, dateien > 0 ? dateien + " Dateien gespeichert" : "Noch keine Kopie abgelegt")}
       ${zeile(alsApp, alsApp ? "Läuft als App vom Home-Bildschirm" : "Läuft im Browser, nicht als App")}
       <div id="offRat"></div>
       ${hatSW ? `<button type="button" class="ko-knopf off-erneuern" id="offErneuern">
            Kopie erneuern</button>
          <p class="gk-text gk-leise">Holt alle Dateien neu vom Rechner. Nötig, wenn das Gerät
            eine ältere Fassung der App festhält. Deine Daten bleiben, die Anmeldung auch.</p>` : ""}`;

    const erneuern = $("offErneuern");
    if (erneuern) erneuern.addEventListener("click", async () => {
      erneuern.disabled = true;
      erneuern.textContent = "Wird erneuert …";
      try {
        /* Erst den Worker weg, dann die Lager — in dieser Reihenfolge,
           sonst legt der noch laufende Worker gleich wieder etwas an. */
        for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
        if (window.caches) {
          for (const name of await caches.keys()) await caches.delete(name);
        }
        showToast("Kopie geleert — die Seite lädt neu.", "success");
        setTimeout(() => location.reload(true), 700);
      } catch (fehler) {
        erneuern.disabled = false;
        erneuern.textContent = "Kopie erneuern";
        showToast("Ging nicht: " + fehler.message, "error");
      }
    });

    const rat = $("offRat");
    if (bereit && alsApp) {
      rat.innerHTML = `<p class="gk-text gk-leise">Alles beisammen. Der Rechner darf aus sein —
        Änderungen werden nachgeschickt, sobald er wieder antwortet.</p>`;
      return;
    }
    if (!sicher) {
      /* Der häufigste Fall: die App liegt auf der unverschlüsselten
         Adresse. Dann gibt es keinen Zwischenspeicher, und es hilft
         nur, sie unter der sicheren Adresse neu abzulegen. */
      const host = location.hostname;
      try {
        const d = await fetch("/api/health", { cache: "no-store" }).then(a => a.json());
        if (d.https && d.https.an) {
          const ziel = "https://" + host + ":" + d.https.port + "/";
          rat.innerHTML =
            `<p class="gk-text">Über <b>${escapeHTML(location.protocol.replace(":", ""))}</b> gibt
               Safari keinen Zwischenspeicher heraus — deshalb ist nichts gespeichert und die App
               bleibt leer, sobald der Rechner aus ist.</p>
             <ol class="gk-schritte">
               <li><a href="${escapeHTML(location.origin)}/life-os-wurzel.crt">Zertifikat laden</a>
                   und im Profil bestätigen</li>
               <li>Einstellungen → Allgemein → Info →
                   <b>Zertifikatsvertrauens&shy;einstellungen</b> → „Life OS Lokal“ einschalten</li>
               <li><a href="${escapeHTML(ziel)}">${escapeHTML(ziel)}</a> öffnen</li>
               <li>Dort <b>Zum Home-Bildschirm</b> — das alte Symbol kann weg</li>
             </ol>`;
          return;
        }
      } catch (fehler) { /* ohne Server bleibt der kurze Satz unten */ }
      rat.innerHTML = `<p class="gk-text gk-leise">Diese Adresse ist unverschlüsselt — darüber
        gibt es keinen Zwischenspeicher.</p>`;
      return;
    }
    if (!alsApp) {
      rat.innerHTML = `<p class="gk-text gk-leise">Im Browser reicht das. Damit die App auch
        vom Home-Bildschirm ohne Rechner startet, dort einmal
        <b>Zum Home-Bildschirm</b> hinzufügen.</p>`;
      return;
    }
    rat.innerHTML = `<p class="gk-text gk-leise">Der Zwischenspeicher richtet sich beim ersten
      Laden ein. Einmal neu laden, solange der Rechner läuft.</p>`;
  }

  /* Wie beim Google-Kasten: geholt wird beim Öffnen des Bereichs */

  /* Einmal bestätigen, wenn der Offline-Betrieb wirklich steht —
     sonst weiß man nie, ob die Einrichtung geklappt hat. */
  if (offlineMoeglich()) {
    navigator.serviceWorker.ready.then(() => {
      if (store.get("lifeos_offline_gemeldet", false)) return;
      store.set("lifeos_offline_gemeldet", true);
      setTimeout(() => showToast("Offline bereit — die App läuft jetzt auch ohne den Rechner.", "success"), 1800);
    }).catch(() => { /* dann eben nicht */ });
  }

  /* ==========================================================
     KONTO
     Wer angemeldet ist, wie man das Passwort wechselt und wie man
     wieder herauskommt — alles im Bereich „Mein Konto".

     Weitere Konten legt nur das erste an. Das ist keine Hierarchie,
     sondern die einfachste Antwort auf die Frage, wer im Heimnetz
     ein Konto anlegen darf.
     ========================================================== */
  function kontoZeichnen() {
    const kasten = $("kontoKasten");
    if (!kasten) return;

    fetch("/api/anmeldung/stand", { cache: "no-store" })
      .then(a => a.json())
      .then(d => {
        const konten = $("kopKontenAbschnitt");

        if (!d.angemeldet) {
          kasten.innerHTML = `<div class="gk-zeile"><span class="gk-punkt aus"></span>
            <b>Nicht angemeldet</b></div>
            <p class="gk-text gk-leise">Die Sitzung ist abgelaufen. Beim nächsten Laden
              fragt die Seite wieder nach dem Passwort.</p>`;
          if (konten) konten.hidden = true;
          return;
        }

        /* Der Name des Kontos kann sich geändert haben — Karte und
           Leiste ziehen mit. */
        window.lifeosNutzer = d.nutzer;
        kpKopfZeichnen();

        kasten.innerHTML =
          `<div class="gk-zeile"><span class="gk-punkt an"></span>
             <b>Angemeldet als ${escapeHTML(d.nutzer.name)}</b>
             ${d.nutzer.verwalter ? '<span class="gk-leise">Erstes Konto</span>' : ""}</div>
           <p class="gk-text gk-leise">Die Anmeldung hält 90 Tage auf diesem Gerät.
             Abmelden räumt sie weg — danach kommst du auch ohne laufenden
             Rechner nicht mehr an die App.</p>`;

        if (konten) konten.hidden = !d.nutzer.verwalter;
        if (d.nutzer.verwalter) nutzerListeZeichnen();
      })
      .catch(() => {
        kasten.innerHTML = `<div class="gk-zeile"><span class="gk-punkt aus"></span>
          <b>Kein Server erreichbar</b></div>
          <p class="gk-text gk-leise">Das Konto lässt sich nur ändern, solange der Rechner läuft.</p>`;
        const konten = $("kopKontenAbschnitt");
        if (konten) konten.hidden = true;
      });
  }

  /* Beim Wechsel wird das alte Passwort verlangt — sonst könnte ein
     offen liegendes Gerät das Konto übernehmen. */
  function passwortFormular() {
    const fach = $("kopPasswortFach");
    if (!fach) return;
    if (fach.querySelector(".ko-form")) { fach.innerHTML = ""; return; }

    fach.innerHTML =
      `<form class="ko-form" id="koForm" autocomplete="off">
         <input type="password" id="koAlt" placeholder="Bisheriges Passwort" autocomplete="current-password">
         <input type="password" id="koNeu" placeholder="Neues Passwort" autocomplete="new-password">
         <input type="password" id="koNeu2" placeholder="Neues Passwort wiederholen" autocomplete="new-password">
         <button type="submit" class="ko-knopf ko-haupt">Passwort ändern</button>
       </form>`;

    $("koForm").addEventListener("submit", async e => {
      e.preventDefault();
      const alt = $("koAlt").value, neu = $("koNeu").value;
      if (neu !== $("koNeu2").value) return showToast("Die beiden neuen Passwörter sind nicht gleich.", "error");
      try {
        const antwort = await fetch("/api/anmeldung/passwort", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ alt, neu })
        });
        const daten = await antwort.json();
        if (!daten.ok) throw new Error(daten.fehler || "Hat nicht geklappt");
        fach.innerHTML = "";
        showToast("Passwort geändert.", "success");
      } catch (fehler) {
        showToast(fehler.message, "error");
      }
    });
    $("koAlt").focus();
  }

  $("kopPasswort").addEventListener("click", passwortFormular);

  /* Nur für das erste Konto: die übrigen Konten im Haus */
  async function nutzerListeZeichnen() {
    const fach = $("kopKonten");
    if (!fach) return;
    let liste = [];
    try {
      const d = await fetch("/api/anmeldung/nutzer").then(a => a.json());
      if (!d.ok) return;
      liste = d.nutzer || [];
    } catch (fehler) { return; }

    const zeilen = liste.map(n =>
      `<div class="ko-zeile">
         <span>${escapeHTML(n.name)}${n.verwalter ? " · erstes Konto" : ""}</span>
         ${n.verwalter ? "" : `<button type="button" class="ko-loeschen" data-id="${escapeHTML(n.id)}"
              aria-label="Konto löschen">Löschen</button>`}
       </div>`).join("");

    fach.innerHTML = zeilen +
      `<form class="ko-form ko-neu" id="koNeuForm" autocomplete="off">
         <input type="text" id="koNeuName" placeholder="Name des neuen Kontos">
         <input type="password" id="koNeuPasswort" placeholder="Passwort für dieses Konto" autocomplete="new-password">
         <button type="submit" class="ko-knopf">Konto anlegen</button>
       </form>`;

    fach.querySelectorAll(".ko-loeschen").forEach(knopf => {
      knopf.addEventListener("click", async () => {
        /* Mit dem Konto gehen dessen Daten. Deshalb die Rückfrage —
           rückgängig macht das hier niemand. */
        if (!confirm("Dieses Konto und alle seine Daten löschen?")) return;
        try {
          const d = await fetch("/api/anmeldung/nutzer/" + encodeURIComponent(knopf.dataset.id),
                                { method: "DELETE" }).then(a => a.json());
          if (!d.ok) throw new Error(d.fehler || "Hat nicht geklappt");
          showToast("Konto gelöscht.", "success");
          nutzerListeZeichnen();
        } catch (fehler) { showToast(fehler.message, "error"); }
      });
    });

    $("koNeuForm").addEventListener("submit", async e => {
      e.preventDefault();
      try {
        const d = await fetch("/api/anmeldung/nutzer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: $("koNeuName").value.trim(), passwort: $("koNeuPasswort").value })
        }).then(a => a.json());
        if (!d.ok) throw new Error(d.fehler || "Hat nicht geklappt");
        showToast("Konto „" + d.nutzer.name + "“ angelegt.", "success");
        nutzerListeZeichnen();
      } catch (fehler) { showToast(fehler.message, "error"); }
    });
  }

  /* Wie die anderen Kästen: geholt wird beim Öffnen des Bereichs */

  /* ==========================================================
     ÄNDERUNG VOM ANDEREN GERÄT ÜBERNEHMEN
     Hakst du am iPad einen Habit ab, schickt der Server das sofort
     hierher. Bisher lud die Seite daraufhin neu — gründlich, aber
     grob: Scrollstand, geöffnete Fenster und halb getippte Eingaben
     waren danach weg.

     Stattdessen wird hier nur nachgezogen, was sich wirklich
     geändert hat: der Wert im Speicher und die Widgets, die ihn
     zeigen. Die Einlaufanimationen bleiben aus, weil die nur
     während "body.aufbau" laufen — es sieht also aus, als hätte
     sich schlicht eine Zahl geändert.
     ========================================================== */
  /* Das Monatsgitter allein reicht nicht: darunter stehen die
     Listen, und die blieben bei einer Änderung von außen auf dem
     alten Stand stehen. Liegt die Kalenderseite offen, wird sie
     ganz neu gebaut — sonst genügt das Gitter. */
  function kalenderAuffrischen() {
    if (aktuelleSeite === "kalender") baueKalender();
    else monatZeichnen();
  }

  const UEBERNAHME = {
    lifeos_habits:       w => { habits = w;     renderHabits(); renderVorschlag(true); },
    lifeos_streaks:      w => { streaks = w;    renderStreaks(); },
    lifeos_termine:      w => { termine = w;    renderNaechste(); renderTabLists(); kalenderAuffrischen(); },
    lifeos_ferien:       w => { ferien = Array.isArray(w) ? w : [];
                                renderNaechste(); kalenderAuffrischen(); },
    lifeos_klausuren:    w => { klausuren = w;  renderNaechste(); renderTabLists(); kalenderAuffrischen(); lernPanelZeichnen(); },
    lifeos_hausaufgaben: w => { hausaufgaben = w; renderNaechste(); kalenderAuffrischen(); hausPanelZeichnen(); },
    lifeos_lernkarten:   w => { lernkarten = w; kartenZeichnen(); faelligAuffrischen(); },
    lifeos_karten_plan:  w => { kartenPlan = (w && typeof w === "object") ? w : {};
                                faelligAuffrischen(); },
    lifeos_farbpaletten: w => { farbpaletten = Array.isArray(w) ? w : [];
                                if (aktuelleSeite === "licht") lichtZeichnen(); },
    lifeos_licht_eigen:  w => { lichtEigen = (w && typeof w === "object") ? w : {};
                                if (aktuelleSeite === "licht") lichtZeichnen(); },
    lifeos_klausurdauer: w => { klausurDauer = (w && typeof w === "object") ? w : {};
                                if (aktuelleSeite === "lernen" && lernReiter === "klausuren") {
                                  baueLernKlausuren();
                                } },
    lifeos_themen:       w => { themen = Array.isArray(w) ? w : [];
                                renderNaechste();
                                if (aktuelleSeite === "lernen" && lernReiter === "themen") {
                                  themaPanelZeichnen(); baueThemen();
                                } },
    lifeos_kalorien:     w => { kalorien = w;   renderCalories(); renderVorschlag(true); },
    lifeos_kalorien_verlauf: w => { kalVerlauf = w; },
    lifeos_screentime:   w => { screentime = w; renderScreenTime(); },
    lifeos_projekte:     w => { projekte = w;   bereichZeichnen(BEREICHE.projekt); },
    lifeos_planung:      w => { planung = w;    bereichZeichnen(BEREICHE.planung); },
    lifeos_quicklinks:   w => { quickLinks = w; renderQuickLinks(); },
    lifeos_notizen:      w => { notizen = Array.isArray(w) ? w : []; notizenZeichnen(); },
    /* Ziele wirken auf die Analyse — die wird nur neu gezeichnet,
       wenn sie gerade offen ist. */
    lifeos_ziele:        w => { ziele = w; if (aktuelleSeite === "analyse") baueAnalyse(); },
    lifeos_settings:     w => { settings = { ...DEFAULT_SETTINGS, ...w };
                                updateAvatar(); renderWeather(); renderCalories(); }
  };

  /* Reine Anzeigesachen dieses Geräts — welcher Reiter offen ist,
     welcher Zeitraum gewählt wurde. Der Wert wandert mit, aber es
     wäre störend, wenn ein Reiterwechsel am iPad hier die Ansicht
     umspringen ließe. */
  const NUR_MERKEN = new Set([
    "lifeos_st_seite", "lifeos_st_range", "lifeos_habit_ansicht",
    "lifeos_card_tab", "lifeos_wetter_ansicht", "lifeos_lern_reiter", "lifeos_streak_stufen"
  ]);

  /* Gibt true zurück, wenn übernommen wurde. Bei false lädt die
     Brücke die Seite neu — lieber grob als veraltet. */
  window.lifeosUebernehmen = (schluessel, wert) => {
    if (NUR_MERKEN.has(schluessel)) return true;
    const tun = UEBERNAHME[schluessel];
    if (!tun) return false;
    try {
      tun(wert);
    } catch (fehler) {
      console.warn("[Bestand] konnte nicht übernehmen:", schluessel, fehler);
      return false;
    }
    return true;
  };

})();
