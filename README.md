# Family Tree

Stammbaum-Viewer für den Browser. Importiert GEDCOM-Dateien (`.ged`) und zeigt
alle darin enthaltenen Personen auf einmal als Kachel-Diagramm an – ein
Zeilenraster nach Generation, mit rechtwinkligen Eltern-Kind- und
Ehepartner-Verbindungen. Alternativ gibt es eine vollständige, durchsuchbare
Tabellenansicht aller Einträge.

Einzelne Personen (oder eine Mehrfachauswahl) lassen sich löschen, und der
aktuelle (bearbeitete) Datensatz kann jederzeit wieder als GEDCOM-Datei
exportiert werden. Über `Als PDF speichern` lässt sich der ganze Baum
zusätzlich als einseitiges Vektor-PDF sichern – also beliebig skalierbar und
druckfähig, statt als Screenshot.

Über das Zahnrad rechts oben lässt sich die Darstellung einstellen: Nachname
auf einer eigenen Zeile, fette Namen, automatische Kachelbreite (mit Min-/
Max-Grenze), Schriftgröße sowie Hintergrund- und Textfarbe für männliche und
weibliche Einträge. Die Einstellungen bleiben lokal gespeichert.

Läuft komplett im Browser: Die GEDCOM-Datei wird lokal geparst, nichts wird
an einen Server geschickt. Der zuletzt importierte (und ggf. bearbeitete)
Datensatz wird per IndexedDB im Browser gespeichert, damit er beim nächsten
Öffnen erhalten bleibt.

**Hinweis zum Export:** Es werden nur die Felder gespeichert, die die App
selbst einliest (Name, Geschlecht, Geburts-/Sterbedatum + Ort,
Heiratsdatum + Ort, Familienbezüge). Andere GEDCOM-Felder aus der
Originaldatei (z.B. Beruf, Notizen, Quellenangaben) werden beim Import
nicht übernommen und tauchen entsprechend auch im Export nicht auf.

## Entwicklung

```bash
npm install
npm run dev
```

Der Befehl startet nur den Server (`http://localhost:5173/` per Default) –
die Adresse danach selbst im Browser öffnen. Zum Beenden Strg+C im Terminal.

## Build

```bash
npm run build
```

## Tech-Stack

- React + TypeScript + Vite
- Eigener GEDCOM-Parser (`src/gedcom/parser.ts`) und -Exporter
  (`src/gedcom/exportGedcom.ts`)
- Generationen-Zuordnung anhand Geburtsjahr, Grid-Layout mit rekursiver
  Eltern-über-Kind-Zentrierung (`src/gedcom/relations.ts`,
  `src/gedcom/gridLayout.ts`)
- Lokale Persistenz via `idb-keyval` (IndexedDB)
- Darstellungs-Einstellungen (Farben, Schriftgröße, Kachelform) via
  `localStorage`, Textvermessung über Canvas (`src/tree/`)
- PDF-Export als Vektorgrafik mit jsPDF + svg2pdf.js, erst beim ersten Klick
  nachgeladen (`src/export/pdf.ts`)
