# LIFE OS // Dashboard

Ein persönliches Dashboard – Frontend + kleiner Node.js/Express-Server,
damit die Seite sich künftig groß erweitern lässt (eigene API-Routen,
später z. B. echte Kalender-Anbindung oder Sync).

## Starten

Doppelklick auf **`dev-server.bat`**.

Das Skript:
1. installiert beim allerersten Mal automatisch die node_modules (`npm install`),
2. startet den Server mit Live-Reload (`nodemon`),
3. öffnet automatisch `http://localhost:3000` im Browser.

Beim Speichern von `public/index.html`, `public/style.css` oder `public/script.js`
lädt die Seite sich automatisch neu. Bei Änderungen an `server.js` / `routes/`
startet der Server automatisch neu.

Voraussetzung: [Node.js](https://nodejs.org) muss installiert sein (LTS-Version reicht).

### Alternative (Terminal)

```bash
npm install   # nur beim ersten Mal
npm run dev   # Dev-Server mit Live-Reload
npm start     # Produktions-Start, ohne Live-Reload
```

## Projektstruktur

```
Dashboard/
├─ dev-server.bat     ← Doppelklick-Start
├─ server.js          ← Express-Server (liefert public/ aus, mountet /api)
├─ routes/
│  └─ api.js          ← Backend-Routen (heute: /api/health, hier wächst später mehr rein)
├─ public/            ← die eigentliche Website
│  ├─ index.html
│  ├─ style.css
│  └─ script.js
├─ package.json
└─ nodemon.json
```

## Aufbau & Design

Dunkles Navy-Dashboard mit weich gerundeten Glass-Karten (18px Radius,
Backdrop-Blur) auf einem sanften Farbverlauf-Hintergrund:

- **Sidebar links** – nach Bereichen gruppiert (Übersicht / Tracking / Planung /
  Tools), oben Logo + Profil, unten Einstellungen. Über den runden Pfeil-Button
  auf Icon-Breite einklappbar; auf dem Handy wird sie zur unteren Leiste.
  Erster Eintrag „Dashboard" (Haus-Icon) springt an den Seitenanfang.
- **Hero** – große zweifarbige Begrüßung mit Farbverlauf im Namen, Live-Zeit-Chip
  rechts, darunter eine Pill-Suchleiste.
- **Hauptraster** – Zeit & Wetter · Kalorien · Bildschirmzeit (breiter).
- **Zweites Raster** – Habits (Platzhalter) sowie Termine/Klausuren, die sich
  automatisch ein- und ausblenden und den Platz neu verteilen.
- **Schnellzugriff** ganz unten, kompakt.
- **Diagramme**: Kalorien als Halbring aus einzelnen Strichen (Tick-Gauge) mit
  Grün→Blau-Verlauf; Bildschirmzeit als abgerundete Pill-Balken mit
  hervorgehobenem heutigem Tag inkl. Wert-Label darüber.
- **Toasts** oben rechts für kurze Bestätigungen, **Modal** nur für die
  Einstellungen.

## Was ist im Dashboard drin

Immer sichtbar: Session (Begrüßung + Smart-Suche), Uhrzeit, Wetter, Kalorien,
Bildschirmzeit, Schnellzugriff. Termine/Klausuren blenden sich nur ein,
wenn wirklich etwas Dringendes ansteht.

- **Uhrzeit** – groß, live; die Sekunden sind ausgeblendet und erscheinen
  nur beim Hover (leicht transparent), Datum darunter
- **Wetter** – Standard: Berlin, änderbar in den Einstellungen; große Temperaturanzeige
- **Kalorien heute** – 3/4-Ring-Gauge (Öffnung unten, Zahl in der Mitte), **nicht im
  Widget editierbar**. Ziel & heutiger Verbrauch werden vorerst in den Einstellungen
  gesetzt (später automatisch aus einer Kalorien-Tracker-App). Ist kein Ziel gesetzt
  (0), erscheint das Widget unscharf mit „Noch nichts getrackt"
- **Bildschirmzeit** – getrennt nach Handy/PC, ebenfalls nur über die Einstellungen
  gesetzt (vorerst, später per API). Umschaltbar zwischen **24H** und **Woche**;
  eine Legende zeigt beide Werte an – beim Hover über „Handy"/„PC" wird der
  jeweilige Balken hervorgehoben. Ein kleines Icon oben rechts wechselt zwischen
  gestapelter Säule (Standard, zeigt die Gesamtzeit) und nebeneinander stehenden
  Balken. Demo-Daten der letzten 7 Tage sind beim ersten Start vorbefüllt
- **Wichtige Termine / Klausurtermine** – reine Anzeige (kein Formular im Widget,
  das kommt später separat); zeigt nur Einträge, die innerhalb von 14 Tagen
  anstehen, mit Countdown. Ist nur eine der beiden Karten sichtbar, nimmt sie
  die volle Kartenbreite ein. Einträge lassen sich per ✕ entfernen
- **Schnellzugriff** – Gmail, Spotify, YouTube, TikTok, Bolle (Vertretungsplan),
  steht immer ganz unten; weitere Links über „+ Hinzufügen" in den Einstellungen
- **Smart-Suchfeld** – erkennt automatisch:
  - `Klausur Mathe 12.09` → Klausurtermine
  - `Termin Zahnarzt 03.09 14:00` → Wichtige Termine
  - alles andere → Google-Suche in neuem Tab

## Daten & Privatsphäre

Alle Eingaben (Termine, Klausuren, Kalorien, Bildschirmzeit, Einstellungen,
Schnellzugriff-Links) werden weiterhin **nur lokal im `localStorage` des
Browsers** gespeichert – der Node-Server liefert aktuell nur die Seite aus
und speichert selbst nichts. Es gibt also (noch) keinen Server-seitigen
Abgleich zwischen Geräten.

## Erweitern

Der Server ist bewusst schlank gehalten, aber so aufgebaut, dass echte
Backend-Funktionen sauber reinpassen:

- Neue Endpunkte einfach in `routes/api.js` (oder weitere Dateien im
  `routes/`-Ordner) ergänzen – erreichbar unter `/api/...`.
- Ideen für später:
  - Weitere Sektionen im gleichen Look (Finanzen, Habits, Ziele, To-Dos …)
  - Echte Anbindung an Google Kalender für Termine/Klausuren (braucht Backend
    für den OAuth-Login – jetzt vorhanden)
  - Geräteübergreifender Sync über eine kleine Datenbank
  - Mehr Logik im Smart-Suchfeld
