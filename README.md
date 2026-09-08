# Family Tree

Stammbaum-Viewer für den Browser. Importiert GEDCOM-Dateien (`.ged`) und zeigt
alle darin enthaltenen Personen auf einmal als Baum-Diagramm an – Eltern,
Geschwister, Ehepartner, Tanten/Onkel, Cousinen/Cousins usw. sind direkt
sichtbar und per Klick erkundbar. Alternativ gibt es eine vollständige,
durchsuchbare Tabellenansicht aller Einträge.

Läuft komplett im Browser: Die GEDCOM-Datei wird lokal geparst, nichts wird
an einen Server geschickt. Der zuletzt importierte Datensatz wird per
IndexedDB im Browser gespeichert, damit er beim nächsten Öffnen erhalten
bleibt.

## Entwicklung

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Tech-Stack

- React + TypeScript + Vite
- Eigener GEDCOM-Parser (`src/gedcom/parser.ts`)
- Generationen-Layout via `d3-force` (`src/gedcom/layout.ts`)
- Lokale Persistenz via `idb-keyval` (IndexedDB)
