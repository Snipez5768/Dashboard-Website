/* ==========================================================
   LIFE OS // ANMELDUNG
   Läuft vor allem anderen. Solange niemand angemeldet ist, liegt
   die Anmeldeschicht über dem Dashboard und das übrige Programm
   wird gar nicht erst gestartet.

   Die Schicht ist nicht der Schutz — der sitzt am Server, der ohne
   gültige Sitzung keine Daten herausgibt. Sie hält nur den Blick
   fern und führt zur Anmeldung.

   OFFLINE
   Ohne Server kann niemand nachfragen, ob das Passwort stimmt —
   also legt das Gerät beim Anmelden einen Schlüssel an: eine
   Prüfsumme des Passworts mit eigenem Salz. Offline wird dagegen
   geprüft. Er gilt 30 Tage und verlängert sich bei jedem Besuch
   mit Server; beim Abmelden wird er gelöscht.

   Er verschlüsselt die Daten nicht — die liegen weiter offen im
   Browserspeicher. Er hält den Bildschirm zu, mehr nicht. Sobald
   der Server wieder antwortet, entscheidet der.
   ========================================================== */
(function () {
  "use strict";

  const $ = id => document.getElementById(id);

  const schicht = $("anmeldung");
  const form = $("anForm");
  const feldName = $("anName");
  const feldPasswort = $("anPasswort");
  const feldZweites = $("anZweitesFeld");
  const feldPasswort2 = $("anPasswort2");
  const knopf = $("anKnopf");
  const fehlerZeile = $("anFehler");

  /* Merkt sich, wer zuletzt angemeldet war — nur für den Fall ohne
     Server. Es steht kein Passwort darin, nur ein Name. */
  const LETZTER = "lifeos_zuletzt_angemeldet";

  /* Wer zuletzt an diesem Gerät angemeldet war. Danach richtet sich,
     ob der lokale Speicher noch dem gehört, der gerade hereinkommt. */
  const KONTO = "lifeos_konto";

  /* Nur wer sich angemeldet und nicht wieder abgemeldet hat, darf
     ohne Server hinein. Nach einem ausdrücklichen Abmelden steht hier
     nichts mehr, und dann bleibt die Tür auch offline zu. */
  const OFFLINE_ERLAUBT = "lifeos_offline_erlaubt";

  /* Ob dieses Konto das erste im Haus ist */
  const VERWALTER = "lifeos_konto_verwalter";

  /* ----------------------------------------------------------
     DER SCHLÜSSEL FÜR DEN BETRIEB OHNE SERVER
     ---------------------------------------------------------- */
  const SCHLUESSEL = "lifeos_offline_schluessel";
  const SCHLUESSEL_TAGE = 30;
  const RUNDEN = 200000;

  const alsBase64 = puffer =>
    btoa(String.fromCharCode(...new Uint8Array(puffer)));

  /* PBKDF2 gibt es nur im sicheren Kontext. Über die unverschlüsselte
     Netzadresse fehlt crypto.subtle — dort gibt es aber ohnehin
     keinen Service Worker und damit keinen Offline-Betrieb. */
  const kannRechnen = () =>
    !!(window.crypto && window.crypto.subtle && window.isSecureContext);

  async function pruefsumme(passwort, salzB64) {
    const roh = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(passwort), "PBKDF2", false, ["deriveBits"]);
    const salz = Uint8Array.from(atob(salzB64), z => z.charCodeAt(0));
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: salz, iterations: RUNDEN, hash: "SHA-256" }, roh, 256);
    return alsBase64(bits);
  }

  function schluesselLesen() {
    try { return JSON.parse(localStorage.getItem(SCHLUESSEL) || "null"); }
    catch (f) { return null; }
  }

  const schluesselGilt = k =>
    !!k && !!k.pruefsumme && !!k.salz && Number(k.ablauf) > Date.now();

  /* Nach dem Anmelden mit Server: Schlüssel anlegen oder erneuern.
     Nur hier liegt das Passwort im Klartext vor. */
  async function schluesselSchreiben(konto, passwort) {
    if (!kannRechnen() || !passwort) return;
    try {
      const salz = alsBase64(crypto.getRandomValues(new Uint8Array(16)));
      localStorage.setItem(SCHLUESSEL, JSON.stringify({
        nutzer: { id: konto.id, name: konto.name, verwalter: !!konto.verwalter },
        salz,
        pruefsumme: await pruefsumme(passwort, salz),
        ablauf: Date.now() + SCHLUESSEL_TAGE * 86400000
      }));
    } catch (f) { /* dann eben ohne Schlüssel */ }
  }

  /* Jeder Besuch mit Server schiebt den Ablauf nach hinten — wer die
     App benutzt, soll nicht plötzlich ausgesperrt sein. */
  function schluesselVerlaengern(konto) {
    const k = schluesselLesen();
    if (!k || !k.pruefsumme) return;
    k.ablauf = Date.now() + SCHLUESSEL_TAGE * 86400000;
    if (konto) k.nutzer = { id: konto.id, name: konto.name, verwalter: !!konto.verwalter };
    try { localStorage.setItem(SCHLUESSEL, JSON.stringify(k)); } catch (f) { /* egal */ }
  }

  const schluesselWeg = () => {
    try { localStorage.removeItem(SCHLUESSEL); } catch (f) { /* egal */ }
  };

  /* Liegen überhaupt Daten dieses Dashboards auf dem Gerät? Danach
     richtet sich, ob ein Einlass ohne Schlüssel etwas verbirgt oder
     nur die eigene App unbrauchbar macht. */
  function datenDa() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("lifeos_") && k !== LETZTER && k !== KONTO
            && k !== OFFLINE_ERLAUBT && k !== VERWALTER && k !== SCHLUESSEL) return true;
      }
    } catch (f) { /* egal */ }
    return false;
  }

  let einrichten = false;
  /* Wenn ohne Server geprüft wird, steht hier der Schlüssel */
  let offlineSchluessel = null;

  /* ----------------------------------------------------------
     KONTOWECHSEL
     Der Browserspeicher hängt am Gerät, nicht am Konto. Meldet sich
     jemand anderes an, lägen Termine, Noten und Notizen des
     Vorgängers noch da — und gingen beim ersten Abgleich sogar in
     dessen Bestand hoch, weil der Server sie nicht kennt.

     Deshalb: erkennt das Gerät ein anderes Konto als beim letzten
     Mal, wird alles Lokale weggeräumt. Verloren geht dabei nichts,
     es liegt beim Server.
     ---------------------------------------------------------- */
  function speicherLeeren() {
    const weg = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("lifeos_") && k !== LETZTER) weg.push(k);   // Konto und Erlaubnis werden gleich neu gesetzt
    }
    weg.forEach(k => { try { localStorage.removeItem(k); } catch (f) { /* egal */ } });
  }

  function kontoMerken(konto) {
    let vorher = null;
    try { vorher = localStorage.getItem(KONTO); } catch (f) { /* egal */ }
    /* Beim allerersten Mal steht hier nichts: dann sind die lokalen
       Daten die eigenen und bleiben liegen. */
    if (vorher && vorher !== konto.id) speicherLeeren();
    try {
      localStorage.setItem(KONTO, konto.id);
      localStorage.setItem(OFFLINE_ERLAUBT, "1");
      /* Am ersten Konto hängt der bisherige Stundenplan — das muss
         das Dashboard auch ohne Server wissen. */
      localStorage.setItem(VERWALTER, konto.verwalter ? "1" : "");
    } catch (f) { /* egal */ }
    window.lifeosNutzer = konto;
  }

  function fehler(text) {
    fehlerZeile.textContent = text || "";
    fehlerZeile.hidden = !text;
  }

  function alsEinrichtung() {
    einrichten = true;
    $("anTitel").textContent = "Willkommen";
    $("anText").textContent =
      "Noch kein Konto. Leg deines an — Name und Passwort bestimmst du, "
      + "sie stehen nirgends im Programm. Deine bisherigen Daten werden übernommen.";
    feldZweites.hidden = false;
    feldPasswort.setAttribute("autocomplete", "new-password");
    knopf.textContent = "Konto anlegen";
    $("anFuss").textContent = "Das Passwort lässt sich später in den Einstellungen ändern.";
  }

  function alsAnmeldung() {
    einrichten = false;
    $("anTitel").textContent = "Anmelden";
    $("anText").textContent = "Deine Daten liegen hinter diesem Konto.";
    feldZweites.hidden = true;
    feldPasswort.setAttribute("autocomplete", "current-password");
    knopf.textContent = "Anmelden";
    $("anFuss").textContent = "";
    const zuletzt = localStorage.getItem(LETZTER);
    if (zuletzt) feldName.value = zuletzt;
  }

  /* Ohne Server: derselbe Kasten, andere Ansage. Der Name steht
     fest — offline lässt sich nur das Konto öffnen, das hier schon
     einmal angemeldet war. */
  function alsOhneServer(schluessel) {
    einrichten = false;
    offlineSchluessel = schluessel;
    $("anTitel").textContent = "Ohne Verbindung";
    $("anText").textContent =
      "Der Rechner antwortet nicht. Mit deinem Passwort kommst du trotzdem an das, "
      + "was auf diesem Gerät liegt.";
    feldZweites.hidden = true;
    feldPasswort.setAttribute("autocomplete", "current-password");
    knopf.textContent = "Öffnen";
    $("anFuss").textContent = "Sobald der Rechner wieder läuft, gilt wieder er.";
    feldName.value = (schluessel.nutzer && schluessel.nutzer.name) || "";
    feldName.readOnly = true;
  }

  function zeigen() {
    schicht.hidden = false;
    document.body.classList.add("gesperrt");
    setTimeout(() => (feldName.value ? feldPasswort : feldName).focus(), 80);
  }

  function verstecken() {
    schicht.hidden = true;
    document.body.classList.remove("gesperrt");
  }

  /* Das Dashboard wird erst gestartet, wenn jemand angemeldet ist.
     Sonst liefe sein Programm im Hintergrund, obwohl es keine Daten
     bekommt — und würde bei jedem Abruf über Fehler stolpern. */
  function dashboardStarten() {
    if (window.lifeosGestartet) return;
    window.lifeosGestartet = true;
    /* Nur die Brücke laden — sie holt den Bestand und lädt script.js
       danach selbst nach. Beide hier zu laden hieße, das Dashboard
       zweimal zu starten. */
    const s = document.createElement("script");
    s.src = "bestand.js";
    document.body.appendChild(s);
  }

  window.lifeosAbmelden = function () {
    /* Ohne diese Zeile käme man nach dem Abmelden offline weiter
       herein — die Erlaubnis liegt ja am Gerät. */
    try { localStorage.removeItem(OFFLINE_ERLAUBT); } catch (f) { /* egal */ }
    schluesselWeg();
    fetch("/api/anmeldung/aus", { method: "POST" })
      .catch(() => { /* auch ohne Server abmelden */ })
      .finally(() => location.reload());
  };

  async function absenden(e) {
    e.preventDefault();
    fehler("");

    const name = feldName.value.trim();
    const passwort = feldPasswort.value;

    /* Ohne Server wird gegen den Schlüssel geprüft, nicht gegen das
       Konto — der Server ist ja nicht da, um gefragt zu werden. */
    if (offlineSchluessel) return offlineOeffnen(passwort);

    if (einrichten && passwort !== feldPasswort2.value) {
      return fehler("Die beiden Passwörter sind nicht gleich");
    }

    knopf.disabled = true;
    knopf.textContent = einrichten ? "Wird angelegt …" : "Wird geprüft …";

    try {
      const antwort = await fetch(
        einrichten ? "/api/anmeldung/einrichten" : "/api/anmeldung/an",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, passwort })
        });
      const daten = await antwort.json();
      if (!daten.ok) throw new Error(daten.fehler || "Hat nicht geklappt");

      kontoMerken(daten.nutzer);
      try { localStorage.setItem(LETZTER, daten.nutzer.name); } catch (f) { /* egal */ }
      /* Jetzt — und nur jetzt — liegt das Passwort im Klartext vor.
         Der Schlüssel für später wird hier angelegt. */
      await schluesselSchreiben(daten.nutzer, passwort);
      verstecken();
      dashboardStarten();
    } catch (f) {
      fehler(f.message);
      knopf.disabled = false;
      knopf.textContent = einrichten ? "Konto anlegen" : "Anmelden";
      feldPasswort.value = "";
      feldPasswort.focus();
    }
  }

  async function offlineOeffnen(passwort) {
    knopf.disabled = true;
    knopf.textContent = "Wird geprüft …";
    try {
      const summe = await pruefsumme(passwort, offlineSchluessel.salz);
      if (summe !== offlineSchluessel.pruefsumme) throw new Error("Das Passwort stimmt nicht");
      window.lifeosNutzer = offlineSchluessel.nutzer || null;
      verstecken();
      dashboardStarten();
    } catch (f) {
      fehler(f.message);
      knopf.disabled = false;
      knopf.textContent = "Öffnen";
      feldPasswort.value = "";
      feldPasswort.focus();
    }
  }

  form.addEventListener("submit", absenden);

  /* ---------- Beim Start: wo stehen wir? ---------- */
  fetch("/api/anmeldung/stand", { cache: "no-store" })
    .then(a => a.json())
    .then(d => {
      if (d.angemeldet) {
        kontoMerken(d.nutzer);
        try { localStorage.setItem(LETZTER, d.nutzer.name); } catch (f) { /* egal */ }
        schluesselVerlaengern(d.nutzer);
        verstecken();
        return dashboardStarten();
      }
      if (!d.eingerichtet) alsEinrichtung(); else alsAnmeldung();
      zeigen();
    })
    .catch(() => {
      /* Kein Server erreichbar. Wer hier zuletzt angemeldet war,
         kommt an seine bereits geladenen Daten — alles andere wäre
         eine App, die unterwegs nichts mehr zeigt. */
      const k = schluesselLesen();

      /* Der übliche Fall: es gibt einen gültigen Schlüssel. Dann
         nach dem Passwort fragen und lokal prüfen. */
      if (schluesselGilt(k) && kannRechnen()) {
        alsOhneServer(k);
        zeigen();
        return;
      }

      /* Ein Schlüssel, der abgelaufen ist, soll das auch sagen —
         sonst rätselt man, warum das richtige Passwort nicht geht. */
      if (k && k.pruefsumme && !schluesselGilt(k)) {
        alsAnmeldung();
        zeigen();
        fehler("Dieses Gerät war über 30 Tage nicht am Server. "
             + "Einmal mit laufendem Rechner anmelden, dann geht es wieder ohne.");
        return;
      }

      /* Kein Schlüssel — etwa weil dieses Gerät sich zuletzt vor
         seiner Einführung angemeldet hat. Liegen Daten hier, wäre
         Aussperren sinnlos: sie stehen ohnehin im Browserspeicher,
         und die App wäre unterwegs unbrauchbar. Also herein, mit
         einem Hinweis. */
      if (localStorage.getItem(OFFLINE_ERLAUBT) || datenDa()) {
        window.lifeosNutzer = {
          id: localStorage.getItem(KONTO),
          name: localStorage.getItem(LETZTER),
          verwalter: localStorage.getItem(VERWALTER) === "1"
        };
        verstecken();
        dashboardStarten();
        window.lifeosOhneSchluessel = true;
        return;
      }

      alsAnmeldung();
      zeigen();
      fehler("Kein Server erreichbar — und auf diesem Gerät liegen keine Daten.");
    });

  /* Antwortet der Server später mit „nicht angemeldet", ist die
     Sitzung abgelaufen. Dann zurück zum Anmelden, statt still
     nichts mehr zu laden. */
  window.lifeosSitzungWeg = function () {
    /* Die Sitzung ist abgelaufen, nicht der Schlüssel — der bleibt,
       damit man unterwegs weiter an seine Daten kommt. */
    try { localStorage.removeItem(OFFLINE_ERLAUBT); } catch (f) { /* egal */ }
    if (!schicht.hidden) return;
    alsAnmeldung();
    zeigen();
    fehler("Die Anmeldung ist abgelaufen. Bitte melde dich neu an.");
  };
})();
