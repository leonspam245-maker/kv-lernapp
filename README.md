# KV-Lernapp

Persönliche Lernapp für die KV-Lehre: Unterlagen pro Fach und Thema sammeln, mit Merkblatt, Karteikarten, Quiz und Probeprüfung üben und einen realistischen Lernplan bis zur Prüfung erstellen. Die App läuft lokal auf deinem Computer und kann auch auf dem Handy im selben WLAN genutzt werden.

## Starten

Voraussetzung: [Node.js](https://nodejs.org) ab Version 20.

```bash
cd kv-lernapp
```

```bash
npm install
```

```bash
npm start
```

Danach im Browser **http://localhost:5173** öffnen.

### Auf dem Handy nutzen

Computer und Handy müssen im selben (privaten) WLAN sein.

```bash
npm run handy
```

Das Terminal zeigt eine Adresse wie `http://192.168.1.23:5173`. Diese auf dem Handy öffnen und über «Zum Home-Bildschirm» als App ablegen. Im Handy-Modus ist die App für alle Geräte im selben Netzwerk erreichbar. Nutze ihn deshalb nur zu Hause, nicht in einem öffentlichen WLAN.

Computer und Handy greifen auf dieselben Daten zu. Speichern beide Geräte kurz nacheinander, führt die App die Änderungen zusammen, statt sie zu überschreiben. Kehrst du zum Fenster zurück, lädt die App automatisch den neuesten Stand. Laufende Übungen und offene Formulare werden dabei nicht unterbrochen.

## Daten

- Alle Daten liegen in `data/lernapp.json`. Bei jedem Speichern legt die App automatisch `data/lernapp.backup.json` an.
- Material und Lernfortschritt bleiben nach einem Neustart erhalten.
- Unter **Einstellungen** kannst du eine Sicherung herunterladen, eine Sicherung einspielen, Beispieldaten laden und Beispieldaten wieder entfernen.

## Importwege

| Herkunft | So geht's |
|---|---|
| PDF-Handout | Mehrere PDFs hochladen. Der Text wird seitenweise übernommen. Gescannte Seiten werden erkannt; die Texterkennung (OCR) läuft lokal. Alternativ trägst du den Text von Hand ein. |
| myKV | Heruntergeladene Datei (PDF, Word .docx oder TXT) importieren oder kopierte Lernziele, Aufgaben und Notizen einfügen. Ein myKV-Link lässt sich als Quellenverweis speichern. Es gibt keine Anmeldung und keinen Zugriff auf myKV. |
| Quizlet | Exportierte oder kopierte Paare einfügen (Tabulator zwischen Begriff und Definition, eine Karte pro Zeile). In der Vorschau korrigierst du falsch getrennte Zeilen. |
| OneNote | Seiteninhalt kopieren und einfügen; Überschriften, Listen und Tabellen bleiben erhalten. Oder die Seite als PDF oder Word-Datei (.docx) exportieren und hochladen. |

## KI-Dienst (optional)

Lernplan, Import, Karteikarten sowie Merkblatt, Quiz und Probeprüfung funktionieren **ohne KI**: Die App erstellt sie lokal aus deinen Unterlagen. Optional verbessert Claude (Anthropic) die Inhalte:

1. Auf console.anthropic.com einen API-Schlüssel erstellen und Guthaben aufladen. Die Nutzung kostet pro Erstellung und ist nicht im Claude-Abo enthalten.
2. `.env.example` zu `.env` kopieren und `ANTHROPIC_API_KEY=` ausfüllen. `.env` ist in `.gitignore` eingetragen und kommt nicht ins Projektarchiv.
3. `npm start` neu ausführen und unter **Einstellungen** den Dienst bewusst aktivieren.

Übertragen werden nur die ausgewählten Unterlagen, und erst nach einer Bestätigung pro Erstellung.

## Tests

```bash
npm test
```

```bash
npm run e2e
```

`npm test` prüft die Lernplan-, Wiederholungs- und Generatorlogik. `npm run e2e` braucht Playwright mit Chromium. Der Test spielt alle vier Importwege (inklusive Word-Datei), Merkblatt, Quiz, Probeprüfung, Lernplan, Karteikarten, einen Neustart, zwei gleichzeitig genutzte Geräte und die Handy-Ansicht mit den Beispieldateien aus `samples/` durch. Er verwendet einen eigenen Datenordner (`test-data/`) und legt Screenshots in `screenshots/` ab.

## Aufbau

- `server.js`: lokaler Server ohne Framework (Dateien, Speicherung, KI-Weiterleitung)
- `server/ai.js`: optionale Claude-Anbindung; der Schlüssel bleibt auf dem Server
- `public/js/planner.js`: Lernplan-Berechnung
- `public/js/gen.js`: lokaler Generator für Merkblatt, Karten, Quiz und Prüfung mit Quellenverweisen
- `public/js/srs.js`: Karteikarten-Wiederholung (Leitner-System) und Statistik
- `public/js/docx.js`: Word-Dateien ohne Zusatzbibliothek lesen
- `public/js/import.js`, `practice.js`, `plan.js`, `settings.js`, `app.js`: Oberfläche
- `samples/`: gekennzeichnete Beispieldateien zum Ausprobieren der Importe
