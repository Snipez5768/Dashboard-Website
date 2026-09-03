/* ==========================================================
   LIFE OS // ANMELDUNG
   Läuft vor allem anderen. Solange niemand angemeldet ist, liegt
   die Anmeldeschicht über dem Dashboard und das übrige Programm
   wird gar nicht erst gestartet.

   Die Schicht ist nicht der Schutz — der sitzt am Server, der ohne
   gültige Sitzung keine Daten herausgibt. Sie hält nur den Blick
   fern und führt zur Anmeldung.

   OFFLINE
   Ohne Server lässt sich nichts prüfen. Wer zuletzt angemeldet war,
   darf die App dann trotzdem öffnen: die Daten liegen ohnehin schon
   auf dem Gerät, und ein Sperrbildschirm, der niemanden hereinlässt,
   würde die App unterwegs unbrauchbar machen. Sobald der Server
   wieder antwortet, entscheidet er.
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

  let einrichten = false;

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
    fetch("/api/anmeldung/aus", { method: "POST" })
      .catch(() => { /* auch ohne Server abmelden */ })
      .finally(() => location.reload());
  };

  async function absenden(e) {
    e.preventDefault();
    fehler("");

    const name = feldName.value.trim();
    const passwort = feldPasswort.value;

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

  form.addEventListener("submit", absenden);

  /* ---------- Beim Start: wo stehen wir? ---------- */
  fetch("/api/anmeldung/stand", { cache: "no-store" })
    .then(a => a.json())
    .then(d => {
      if (d.angemeldet) {
        kontoMerken(d.nutzer);
        try { localStorage.setItem(LETZTER, d.nutzer.name); } catch (f) { /* egal */ }
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
      if (localStorage.getItem(OFFLINE_ERLAUBT)) {
        window.lifeosNutzer = {
          id: localStorage.getItem(KONTO),
          name: localStorage.getItem(LETZTER),
          verwalter: localStorage.getItem(VERWALTER) === "1"
        };
        verstecken();
        return dashboardStarten();
      }
      alsAnmeldung();
      zeigen();
      fehler("Kein Server erreichbar — und auf diesem Gerät ist niemand angemeldet.");
    });

  /* Antwortet der Server später mit „nicht angemeldet", ist die
     Sitzung abgelaufen. Dann zurück zum Anmelden, statt still
     nichts mehr zu laden. */
  window.lifeosSitzungWeg = function () {
    try { localStorage.removeItem(OFFLINE_ERLAUBT); } catch (f) { /* egal */ }
    if (!schicht.hidden) return;
    alsAnmeldung();
    zeigen();
    fehler("Die Anmeldung ist abgelaufen. Bitte melde dich neu an.");
  };
})();
