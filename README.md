# KV-Learn

KV-Learn (kv-learn.app) ist eine Lern-App für die KV-Lehre: Unterlagen pro Fach und Thema sammeln, mit Merkblatt, Karteikarten, Quiz und Probeprüfung üben und einen realistischen Lernplan bis zur Prüfung erstellen. Die App läuft online oder lokal auf deinem Computer. In beiden Fällen braucht jede Person ein eigenes Konto.

## Online nutzen (empfohlen)

**Passwort vergessen:** funktioniert nur mit eigenem E-Mail-Versand. In Supabase unter Authentication → Emails → SMTP Settings einen SMTP-Dienst eintragen (der eingebaute Versand erreicht nur Mitglieder des Supabase-Teams) und unter Authentication → URL Configuration die Site URL `https://kv-learn.app` sowie die Redirect URLs `https://kv-learn.app/**` und `https://kv-lernapp.vercel.app/**` setzen. Neue Passwörter werden über «Have I Been Pwned» auf bekannte Datenlecks geprüft (k-Anonymität: nur 5 Zeichen einer Prüfsumme werden übertragen).

Adresse: **https://kv-learn.app** (die alte Adresse https://kv-lernapp.vercel.app funktioniert weiterhin).

KV-Learn läuft online auf Vercel. Die Daten liegen in Supabase (Rechenzentrum Zürich). Du meldest dich mit E-Mail und Passwort an und kannst die App auf Handy und Computer als App installieren:

- **iPhone (Safari):** Teilen-Symbol, dann «Zum Home-Bildschirm».
- **Android (Chrome):** Menü ⋮, dann «App installieren».
- **Computer (Chrome/Edge):** Installieren-Symbol in der Adresszeile.

Über «Konto einrichten» kann sich jede Person ein eigenes Konto anlegen. Jedes Konto sieht nur die eigenen Unterlagen und den eigenen Lernstand (Row Level Security in der Datenbank).

Technik: `public/config.json` enthält die öffentliche Supabase-Adresse und den publishable Key (dieser Schlüssel ist für den Browser gedacht; geschützt wird über Anmeldung und Row Level Security). `vercel.json` und `scripts/build-vercel.mjs` steuern das Hosting, `api/` enthält die Vercel-Funktionen. Für den optionalen KI-Dienst gibt es online zwei Wege: **Guthaben** (über Stripe aufgeladen, siehe unten) oder ein **eigener Schlüssel** der jeweiligen Person.

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
- Lernfortschritt wird sofort gespeichert: jede Kartenbewertung, jede beantwortete Quizfrage, Antworten in der Probeprüfung (laufend als Entwurf), Ergebnisse und abgehakte Einheiten. Ein abgebrochenes Quiz lässt sich fortsetzen.
- Fehlt die Verbindung (z. B. im Zug), hält der Browser den Fortschritt fest und speichert ihn automatisch nach, sobald die Verbindung wieder besteht – auch nach einem Neuladen. Oben steht dann «Offline – wird nachgeholt».
- Unter **Einstellungen** kannst du eine Sicherung herunterladen, eine Sicherung einspielen, Beispieldaten laden und Beispieldaten wieder entfernen.

## Importwege

| Herkunft | So geht's |
|---|---|
| PDF-Handout | Mehrere PDFs hochladen. Der Text wird seitenweise übernommen. Gescannte Seiten werden erkannt; die Texterkennung (OCR) läuft lokal. Alternativ trägst du den Text von Hand ein. |
| myKV | Heruntergeladene Datei (PDF, Word .docx oder TXT) importieren oder kopierte Lernziele, Aufgaben und Notizen einfügen. Ein myKV-Link lässt sich als Quellenverweis speichern. Es gibt keine Anmeldung und keinen Zugriff auf myKV. |
| Quizlet | Exportierte oder kopierte Paare einfügen (Tabulator zwischen Begriff und Definition, eine Karte pro Zeile). In der Vorschau korrigierst du falsch getrennte Zeilen. |
| OneNote | Seiteninhalt kopieren und einfügen; Überschriften, Listen und Tabellen bleiben erhalten. Oder die Seite als PDF oder Word-Datei (.docx) exportieren und hochladen. |

## KI-Dienst (optional)

Lernplan, Import, Karteikarten sowie Merkblatt, Quiz und Probeprüfung funktionieren **ohne KI**: Die App erstellt sie lokal aus deinen Unterlagen. Optional verbessert ein KI-Dienst die Inhalte. Zur Wahl stehen **Claude** (Anthropic) und **ChatGPT** (OpenAI). **Jede Person nutzt ihren eigenen Zugang** und bezahlt nur ihre eigene Nutzung; es gibt keinen gemeinsamen Schlüssel.

1. Einen API-Schlüssel erstellen und Guthaben aufladen: für Claude auf console.anthropic.com, für ChatGPT auf platform.openai.com. Die Nutzung kostet pro Erstellung und ist weder im Claude- noch im ChatGPT-Abo enthalten.
2. In der App unter **Einstellungen** Claude oder ChatGPT wählen, den Schlüssel eintragen und den Dienst bewusst aktivieren.
3. Der Schlüssel bleibt nur im eigenen Browser (pro Konto, wahlweise nur bis zum Schliessen des Browsers). Er wird weder in den Lerndaten, in der Datenbank noch auf dem Server gespeichert, sondern nur bei einer bestätigten Erstellung an den Anbieter weitergereicht. Auf einem weiteren Gerät wird er dort erneut eingetragen.

### KI-Guthaben über Stripe (nur online)

Statt eines eigenen Schlüssels können Personen Guthaben per Karte aufladen (CHF 5, 10 oder 20). Jede KI-Erstellung läuft dann über den Schlüssel des Betreibers und wird nach tatsächlichem Verbrauch abgerechnet: **Anbieterkosten × 3**, umgerechnet mit 0.85 CHF pro USD. Vor jeder Erstellung wird ein Höchstbetrag reserviert (bei Claude rund CHF 1.80); der nicht verbrauchte Teil kommt sofort zurück, eine fehlgeschlagene Erstellung kostet nichts. Guthaben und Buchungen liegen in Supabase (`ai_credit`, `ai_ledger`); Konten können sie nur lesen, ändern können sie nur die Server-Funktionen mit dem Server-Kennwort.

Einrichtung bei Vercel (Settings → Environment Variables, Typ «Sensitive», danach Redeploy):

| Variable | Inhalt |
|---|---|
| `ANTHROPIC_API_KEY` und/oder `OPENAI_API_KEY` | Schlüssel des Betreibers für Claude bzw. ChatGPT |
| `STRIPE_SECRET_KEY` | Geheimer Stripe-Schlüssel (`sk_test_…` zum Testen, später `sk_live_…`) |
| `STRIPE_WEBHOOK_SECRET` | Signatur-Secret des Webhooks (`whsec_…`) |
| `CREDITS_SERVER_SECRET` | bereits eingerichtet (Hash in Supabase) |
| optional `AI_MARKUP`, `USD_CHF`, `CLAUDE_PRICE_IN/OUT`, `OPENAI_PRICE_IN/OUT` | Faktor (Standard 3), Kurs (0.85) und Anbieterpreise in USD pro Million Tokens |

Bei Stripe unter Developers → Webhooks einen Endpunkt `https://kv-learn.app/api/stripe/webhook` mit den Ereignissen `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`, `charge.dispute.created` und `charge.dispute.closed` anlegen. Rückerstattungen und angefochtene Zahlungen werden damit automatisch vom Guthaben abgezogen (gewonnene Anfechtungen zurückgebucht). Erst wenn alle drei Stripe-/Kennwort-Variablen gesetzt sind, zeigt die App das Guthaben an.

### Offene Antworten mit KI bewerten

Ist der KI-Dienst aktiviert, bewertet er offene Antworten in Quiz und Probeprüfung: Punkte in halben Schritten und eine kurze Begründung. Übertragen werden nur Frage, Musterlösung, Schlüsselbegriffe und die Antwort. In der Probeprüfung lassen sich die Punkte anpassen. Ausschalten unter Einstellungen; ohne KI gilt die Bewertung über Schlüsselbegriffe mit Selbsteinschätzung.

Übertragen werden nur die ausgewählten Unterlagen, und erst nach einer Bestätigung pro Erstellung.

## Tests

```bash
npm test
```

```bash
npm run e2e
```

`npm run e2e:cloud` prüft den Online-Betrieb (Anmeldung, Cloud-Speicher, Konflikte, Installierbarkeit) mit einem nachgebauten Supabase.

`npm test` prüft die Lernplan-, Wiederholungs- und Generatorlogik sowie die Abrechnung über Guthaben (Preis, Reservation, Stripe-Signatur, keine doppelte Gutschrift). `npm run e2e` braucht Playwright mit Chromium. Der Test spielt alle vier Importwege (inklusive Word-Datei), Merkblatt, Quiz, Probeprüfung, Lernplan, Karteikarten, Registrierung und Anmeldung mit zwei Konten, einen Neustart, zwei gleichzeitig genutzte Geräte und die Handy-Ansicht mit den Beispieldateien aus `samples/` durch. Er verwendet einen eigenen Datenordner (`test-data/`) und legt Screenshots in `screenshots/` ab.

## Aufbau

- `server.js`: lokaler Server ohne Framework (Dateien, Speicherung, KI-Weiterleitung)
- `server/ai.js`: optionale Anbindung an Claude oder ChatGPT (eigener Schlüssel oder Guthaben)
- `server/credits.js`: Preisberechnung für das KI-Guthaben
- `api/credits/checkout.js`, `api/stripe/webhook.js`: Aufladen über Stripe und Gutschrift
- `public/js/aikeys.js`: persönlicher KI-Schlüssel im Browser
- `server/local-auth.js`: lokale Konten und Anmeldung
- `public/js/planner.js`: Lernplan-Berechnung
- `public/js/gen.js`: lokaler Generator für Merkblatt, Karten, Quiz und Prüfung mit Quellenverweisen
- `public/js/srs.js`: Karteikarten-Wiederholung (Leitner-System) und Statistik
- `public/js/docx.js`: Word-Dateien ohne Zusatzbibliothek lesen
- `public/js/import.js`, `practice.js`, `plan.js`, `settings.js`, `app.js`: Oberfläche
- `samples/`: gekennzeichnete Beispieldateien zum Ausprobieren der Importe
