# E-Mail-Vorlagen für Supabase Auth

Bei Supabase unter **Authentication → Emails → Templates** pro Vorlage den Betreff eintragen und den Inhalt der HTML-Datei vollständig einfügen.
Erzeugt mit `node scripts/build-emails.mjs` (Design-Änderungen dort machen, nicht in den HTML-Dateien).

| Vorlage bei Supabase | Betreff | Datei |
|---|---|---|
| Confirm signup | Bestätige dein KV-Learn-Konto | `konto-bestaetigen.html` |
| Invite user | Du bist zu KV-Learn eingeladen | `einladung.html` |
| Magic Link | Dein Anmeldelink für KV-Learn | `anmeldelink.html` |
| Change Email Address | Bestätige deine neue E-Mail-Adresse | `email-aendern.html` |
| Reset Password | Neues Passwort für KV-Learn | `passwort-zuruecksetzen.html` |
| Reauthentication | Dein Bestätigungscode für KV-Learn | `bestaetigungscode.html` |

Absender (SMTP Settings): KV-Learn <info@kv-learn.app>, Host smtp.resend.com, Port 465, Benutzer `resend`.
