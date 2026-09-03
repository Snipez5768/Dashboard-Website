/* ==========================================================
   LIFE OS // Bildschirmzeit aus erkanntem Text lesen

   Apple gibt die Bildschirmzeit an kein Skript heraus — auch nicht
   an die eigene Schnittstelle, die zeigt sie nur in einer
   abgeschotteten Ansicht. Der einzige Weg ohne Abtippen: ein
   Screenshot, den die Kurzbefehle-App per Texterkennung liest.
   Diese Datei macht aus dem erkannten Text wieder Zahlen.

   Die Texterkennung liefert Zeilen wie:
     Bildschirmzeit
     Heute
     5 Std. 32 Min.
     TikTok
     1 Std. 12 Min.
   Reihenfolge und Schreibweise wechseln je nach Sprache und
   Ansicht, darum wird nichts an einer festen Position erwartet.
   ========================================================== */

/* Deutsch und Englisch, mit und ohne Punkt, mit und ohne Leerzeichen */
const STUNDE = String.raw`(?:std\.?|stdn\.?|stunden?|hrs?\.?|hours?|h)`;
const MINUTE = String.raw`(?:min\.?|minuten?|mins?\.?|minutes?|m)`;

const MIT_STUNDE = new RegExp(
  String.raw`(\d{1,2})\s*` + STUNDE + String.raw`(?:\s*(\d{1,2})\s*` + MINUTE + `)?`, "i");
const NUR_MINUTE = new RegExp(
  String.raw`^\D*(\d{1,3})\s*` + MINUTE + String.raw`\b`, "i");

/* Zeilen, die nie ein App-Name sind */
const KEIN_NAME = new RegExp(String.raw`^(?:` + [
  "bildschirmzeit", String.raw`screen\s*time`,
  String.raw`täglicher\s+durchschnitt`, String.raw`daily\s+average`,
  "heute", "today", "gestern", "yesterday",
  String.raw`letzte\s+woche`, String.raw`last\s+week`,
  String.raw`diese\s+woche`, String.raw`this\s+week`,
  String.raw`alle\s+geräte`, String.raw`all\s+devices`,
  String.raw`gerät`, "device", "limits?", "auszeit", "downtime",
  String.raw`mehr\s+anzeigen`, String.raw`show\s+more`,
  "kategorien", "categories", "apps?", "websites?",
  String.raw`am\s+häufigsten\s+verwendet`, String.raw`most\s+used`,
  "mo", "di", "mi", "do", "fr", "sa", "so",
  "mon", "tue", "wed", "thu", "fri", "sat", "sun",
  String.raw`\d{1,2}(?::\d{2})?`
].join("|") + String.raw`)\b`, "i");

/* Eine Zeile in Minuten umrechnen — oder null, wenn keine Dauer drinsteht */
function dauerAusZeile(zeile) {
  const text = String(zeile).trim();
  if (!text) return null;

  const mitStd = text.match(MIT_STUNDE);
  if (mitStd) return Number(mitStd[1]) * 60 + Number(mitStd[2] || 0);

  const nurMin = text.match(NUR_MINUTE);
  if (nurMin) {
    const m = Number(nurMin[1]);
    return m <= 600 ? m : null;      // "1440 m" waere keine Minutenangabe
  }
  return null;
}

const istName = zeile => {
  const t = String(zeile).trim();
  return t.length >= 2 && t.length <= 40 && !KEIN_NAME.test(t) && dauerAusZeile(t) === null;
};

/* ----------------------------------------------------------
   Aus dem ganzen erkannten Text lesen.
   ---------------------------------------------------------- */
function ausText(roh) {
  const zeilen = String(roh || "")
    .split(/[\r\n]+/)
    .map(z => z.trim())
    .filter(Boolean);

  const dauern = [];
  zeilen.forEach((z, i) => {
    const min = dauerAusZeile(z);
    if (min !== null) dauern.push({ index: i, minuten: min, zeile: z });
  });

  if (!dauern.length) {
    return { gesamt: null, apps: {}, dauern: [], quelle: null,
             grund: "keine Zeitangabe gefunden" };
  }

  /* Gesamtzeit in dieser Reihenfolge:
       1. die Dauer direkt nach "Heute" — das ist der gesuchte Wert
       2. sonst die erste nach der Ueberschrift "Bildschirmzeit"
       3. sonst schlicht die erste im Text
     Ohne Schritt 1 wuerde bei sichtbarem Tagesdurchschnitt dessen
     Wert genommen, und der ist meist hoeher als der heutige. */
  const nachZeile = muster => {
    const i = zeilen.findIndex(z => muster.test(z));
    return i >= 0 ? dauern.find(d => d.index > i) : null;
  };

  const treffer = nachZeile(/^(?:heute|today)\b/i)
               || nachZeile(/^(?:bildschirmzeit|screen\s*time)\b/i)
               || dauern[0];
  const gesamt = treffer.minuten;

  /* Apps: der Name steht direkt ueber der Dauer. Die Gesamtzeile
     faellt raus, sonst gaelte die Ueberschrift als App. */
  const apps = {};
  dauern.forEach(d => {
    if (d.index === treffer.index) return;
    const davor = zeilen[d.index - 1];
    if (davor && istName(davor)) {
      apps[davor] = (apps[davor] || 0) + d.minuten;
    }
  });

  return {
    gesamt,
    apps,
    quelle: treffer.zeile,        // welche Zeile als Gesamtzeit gilt
    dauern: dauern.map(d => ({ zeile: d.zeile, minuten: d.minuten })),
    grund: null
  };
}

module.exports = { ausText, dauerAusZeile };
