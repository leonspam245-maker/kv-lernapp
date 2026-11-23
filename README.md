# KV-Lernapp

Persönliche Lernapp für die KV-Lehre: Unterlagen pro Fach und Thema sammeln, mit Merkblatt, Karteikarten, Quiz und Probeprüfung üben und einen realistischen Lernplan bis zur Prüfung erstellen. Die App läuft online oder lokal auf deinem Computer. In beiden Fällen braucht jede Person ein eigenes Konto.

## Online nutzen (empfohlen)

Die Lernapp läuft online auf Vercel. Die Daten liegen in Supabase (Rechenzentrum Zürich). Du meldest dich mit E-Mail und Passwort an und kannst die App auf Handy und Computer als App installieren:

- **iPhone (Safari):** Teilen-Symbol, dann «Zum Home-Bildschirm».
- **Android (Chrome):** Menü ⋮, dann «App installieren».
- **Computer (Chrome/Edge):** Installieren-Symbol in der Adresszeile.

Über «Konto einrichten» kann sich jede Person ein eigenes Konto anlegen. Jedes Konto sieht nur die eigenen Unterlagen und den eigenen Lernstand (Row Level Security in der Datenbank).

Technik: `public/config.json` enthält die öffentliche Supabase-Adresse und den publishable Key (dieser Schlüssel ist für den Browser gedacht; geschützt wird über Anmeldung und Row Level Security). `vercel.json` und `scripts/build-vercel.mjs` steuern das Hosting, `api/` enthält die Vercel-Funktionen. Für den optionalen KI-Dienst wird `ANTHROPIC_API_KEY` (Claude) und/oder `OPENAI_API_KEY` (ChatGPT) als Umgebungsvariable bei Vercel hinterlegt; danach ein Redeploy auslösen.

## Lokal starten (ohne Internet, mit lokalem Konto)

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

Danach im Browser **http://localhost:5173** öffnen und beim ersten Mal über «Konto einrichten» ein Konto anlegen. Die Konten gelten nur für diesen Computer und sind unabhängig vom Online-Konto. Die Anmeldung bleibt 30 Tage gespeichert.

**Windows, am einfachsten:** Im Projektordner doppelt auf **«Lernapp starten.cmd»** klicken. Beim ersten Mal werden die benötigten Teile installiert, danach öffnet sich die App automatisch im Browser. Das schwarze Fenster offen lassen, solange du lernst.

### Auf dem Handy nutzen

Computer und Handy müssen im selben (privaten) WLAN sein.

```bash
npm run handy
```

Unter Windows in PowerShell `npm.cmd` statt `npm` schreiben (also `npm.cmd install`, `npm.cmd start`, `npm.cmd run handy`), falls PowerShell die Ausführung von Skripten blockiert. Beim ersten Start im Handy-Modus fragt die Windows-Firewall eventuell nach; erlaube den Zugriff für «Private Netzwerke».

Das Terminal zeigt eine Adresse wie `http://192.168.1.23:5173`. Diese auf dem Handy öffnen und über «Zum Home-Bildschirm» als App ablegen. Im Handy-Modus ist die App für alle Geräte im selben Netzwerk erreichbar. Nutze ihn deshalb nur zu Hause, nicht in einem öffentlichen WLAN.

Computer und Handy greifen auf dieselben Daten zu. Speichern beide Geräte kurz nacheinander, führt die App die Änderungen zusammen, statt sie zu überschreiben. Kehrst du zum Fenster zurück, lädt die App automatisch den neuesten Stand. Laufende Übungen und offene Formulare werden dabei nicht unterbrochen.

## Daten

- Jedes lokale Konto hat eine eigene Datei in `data/users/`. Bei jedem Speichern legt die App automatisch eine `.backup.json`-Kopie an.
- Konten stehen in `data/users.json`. Passwörter sind nur als scrypt-Hash gespeichert, nie im Klartext.
- Daten aus der Zeit vor den Konten (`data/lernapp.json`) übernimmt automatisch das erste eingerichtete Konto. Die alte Datei bleibt als `data/lernapp.uebernommen.json` erhalten.
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

Lernplan, Import, Karteikarten sowie Merkblatt, Quiz und Probeprüfung funktionieren **ohne KI**: Die App erstellt sie lokal aus deinen Unterlagen. Optional verbessert ein KI-Dienst die Inhalte. Zur Wahl stehen **Claude** (Anthropic) und **ChatGPT** (OpenAI):

1. Einen API-Schlüssel erstellen und Guthaben aufladen: für Claude auf console.anthropic.com, für ChatGPT auf platform.openai.com. Die Nutzung kostet pro Erstellung und ist weder im Claude- noch im ChatGPT-Abo enthalten.
2. `.env.example` zu `.env` kopieren und `ANTHROPIC_API_KEY=` bzw. `OPENAI_API_KEY=` ausfüllen. `.env` ist in `.gitignore` eingetragen und kommt nicht ins Projektarchiv.
3. `npm start` neu ausführen, unter **Einstellungen** Claude oder ChatGPT wählen und den Dienst bewusst aktivieren. Beim Wechsel des Dienstes muss er erneut aktiviert werden.

Übertragen werden nur die ausgewählten Unterlagen, und erst nach einer Bestätigung pro Erstellung.

## Tests

```bash
npm test
```

```bash
npm run e2e
```

`npm run e2e:cloud` prüft den Online-Betrieb (Anmeldung, Cloud-Speicher, Konflikte, Installierbarkeit) mit einem nachgebauten Supabase.

`npm test` prüft die Lernplan-, Wiederholungs- und Generatorlogik. `npm run e2e` braucht Playwright mit Chromium. Der Test spielt alle vier Importwege (inklusive Word-Datei), Merkblatt, Quiz, Probeprüfung, Lernplan, Karteikarten, Registrierung und Anmeldung mit zwei Konten, einen Neustart, zwei gleichzeitig genutzte Geräte und die Handy-Ansicht mit den Beispieldateien aus `samples/` durch. Er verwendet einen eigenen Datenordner (`test-data/`) und legt Screenshots in `screenshots/` ab.

## Aufbau

- `server.js`: lokaler Server ohne Framework (Dateien, Speicherung, KI-Weiterleitung)
- `server/ai.js`: optionale Anbindung an Claude oder ChatGPT; der Schlüssel bleibt auf dem Server
- `server/local-auth.js`: lokale Konten und Anmeldung
- `public/js/planner.js`: Lernplan-Berechnung
- `public/js/gen.js`: lokaler Generator für Merkblatt, Karten, Quiz und Prüfung mit Quellenverweisen
- `public/js/srs.js`: Karteikarten-Wiederholung (Leitner-System) und Statistik
- `public/js/docx.js`: Word-Dateien ohne Zusatzbibliothek lesen
- `public/js/import.js`, `practice.js`, `plan.js`, `settings.js`, `app.js`: Oberfläche
- `samples/`: gekennzeichnete Beispieldateien zum Ausprobieren der Importe
