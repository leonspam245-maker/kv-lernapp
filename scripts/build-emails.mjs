// Erzeugt alle E-Mail-Vorlagen für Supabase Auth im Design von KV-Learn (branding/emails/*.html).
// Aufruf: node scripts/build-emails.mjs
// Inhalt jeder Vorlage bei Supabase unter Authentication → Emails → Templates einfügen, Betreff siehe README.md im Ordner.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'branding', 'emails');
const C = { red: '#E8442C', ink: '#1D1B1A', paper: '#FBF6F1', soft: '#4A4542', link: '#B5301B', line: '#D9D2CB' };
const F = 'Arial,Helvetica,sans-serif';
const GREETING = 'Hallo{{ if .Data.firstName }} {{ .Data.firstName }}{{ end }}';

const button = (label, href = '{{ .ConfirmationURL }}') => `
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
                <tr>
                  <td align="center" bgcolor="${C.ink}" style="border-radius:999px;">
                    <a href="${href}" style="display:inline-block;padding:15px 30px;font-family:${F};font-size:16px;font-weight:bold;color:${C.paper};text-decoration:none;border-radius:999px;">${label}</a>
                  </td>
                </tr>
              </table>`;
const fallback = `
              <p style="margin:0 0 24px;font-size:14px;line-height:1.55;color:${C.soft};">Funktioniert der Knopf nicht? Kopiere diese Adresse in deinen Browser:<br>
                <a href="{{ .ConfirmationURL }}" style="color:${C.link};word-break:break-all;">{{ .ConfirmationURL }}</a></p>`;
const small = (html) => `
              <p style="margin:0 0 8px;font-size:14px;line-height:1.55;color:${C.soft};">${html}</p>`;
const p = (html) => `
              <p style="margin:0 0 24px;font-size:16px;line-height:1.55;">${html}</p>`;
const code = `
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
                <tr>
                  <td style="background-color:${C.ink};border-radius:16px;padding:16px 26px;font-family:'Courier New',Courier,monospace;font-size:32px;font-weight:bold;letter-spacing:8px;color:${C.paper};">{{ .Token }}</td>
                </tr>
              </table>`;

function page({ title, preheader, heading, body, notYou }) {
  return `<!doctype html>
<html lang="de-CH">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:${C.red};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.red};">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.red};">
    <tr>
      <td align="center" style="padding:32px 16px 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
          <tr>
            <td style="padding:0 4px 20px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="vertical-align:middle;padding-right:12px;"><img src="https://kv-learn.app/icon-hell.png" width="44" height="44" alt="KV-Learn" style="display:block;border:0;border-radius:10px;"></td>
                  <td style="vertical-align:middle;font-family:${F};font-size:22px;font-weight:bold;letter-spacing:0.5px;color:${C.ink};">KV-LEARN</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background-color:${C.paper};border:2px solid ${C.ink};border-radius:24px;padding:36px 32px;font-family:${F};color:${C.ink};">
              <h1 style="margin:0 0 16px;font-family:${F};font-size:30px;line-height:1.1;font-weight:900;text-transform:uppercase;letter-spacing:-0.5px;color:${C.ink};">${heading}</h1>
              <p style="margin:0 0 14px;font-size:16px;line-height:1.55;">${GREETING}</p>${body}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid ${C.line};font-size:0;line-height:0;">&nbsp;</td></tr></table>
              <p style="margin:20px 0 0;font-size:14px;line-height:1.55;color:${C.soft};"><strong style="color:${C.ink};">${notYou[0]}</strong> ${notYou[1]}</p>
              <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:${C.soft};">
                KV-Learn · Lern-App für die KV-Lehre · <a href="https://kv-learn.app" style="color:${C.link};font-weight:bold;">kv-learn.app</a><br>
                Fragen? <a href="mailto:lernapp@outlook.com" style="color:${C.link};font-weight:bold;">lernapp@outlook.com</a> · <a href="https://kv-learn.app/rechtliches.html" style="color:${C.link};">Impressum und Datenschutz</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

const LINK_NOTE = small('Der Link ist nur kurze Zeit gültig und funktioniert nur einmal. Öffne ihn am besten auf dem Gerät, auf dem du KV-Learn nutzt.');
const TEMPLATES = [
  { file: 'konto-bestaetigen.html', supabase: 'Confirm signup', subject: 'Bestätige dein KV-Learn-Konto',
    preheader: 'Noch ein Klick, dann kannst du mit KV-Learn lernen.', heading: 'Willkommen.',
    body: p('Schön, dass du dabei bist. Bestätige deine E-Mail-Adresse, dann ist dein Konto bereit.') + button('Konto bestätigen') + LINK_NOTE + fallback,
    notYou: ['Kein Konto erstellt?', 'Dann kannst du diese E-Mail ignorieren. Ohne Bestätigung wird kein Konto aktiv.'] },
  { file: 'einladung.html', supabase: 'Invite user', subject: 'Du bist zu KV-Learn eingeladen',
    preheader: 'Lerne für die KV-Lehre mit Karteikarten, Quiz und Lernplan.', heading: 'Du bist eingeladen.',
    body: p('Du wurdest zu KV-Learn eingeladen, der Lern-App für die KV-Lehre: Unterlagen, Karteikarten, Quiz, Probeprüfungen und Lernplan an einem Ort.') + button('Einladung annehmen') + LINK_NOTE + fallback,
    notYou: ['Kein Interesse?', 'Dann kannst du diese E-Mail ignorieren. Es wird kein Konto angelegt.'] },
  { file: 'anmeldelink.html', supabase: 'Magic Link', subject: 'Dein Anmeldelink für KV-Learn',
    preheader: 'Melde dich mit einem Klick bei KV-Learn an.', heading: 'Anmelden.',
    body: p('Mit diesem Knopf meldest du dich ohne Passwort bei KV-Learn an.') + button('Jetzt anmelden') + LINK_NOTE + fallback,
    notYou: ['Nicht von dir angefordert?', 'Dann kannst du diese E-Mail ignorieren. Ohne Klick passiert nichts.'] },
  { file: 'email-aendern.html', supabase: 'Change Email Address', subject: 'Bestätige deine neue E-Mail-Adresse',
    preheader: 'Bestätige die neue E-Mail-Adresse für dein KV-Learn-Konto.', heading: 'Neue E-Mail.',
    body: p('Du möchtest die E-Mail-Adresse deines KV-Learn-Kontos von <strong>{{ .Email }}</strong> auf <strong>{{ .NewEmail }}</strong> ändern. Bestätige die Änderung mit dem Knopf.') + button('Neue Adresse bestätigen') + LINK_NOTE + fallback,
    notYou: ['Nicht von dir angefordert?', 'Dann ignoriere diese E-Mail und ändere zur Sicherheit dein Passwort. Deine Adresse bleibt unverändert.'] },
  { file: 'passwort-zuruecksetzen.html', supabase: 'Reset Password', subject: 'Neues Passwort für KV-Learn',
    preheader: 'Lege mit diesem Link ein neues Passwort für dein KV-Learn-Konto fest.', heading: 'Neues Passwort.',
    body: p('Du hast ein neues Passwort für dein KV-Learn-Konto angefordert. Klicke auf den Knopf und lege es fest. Danach bist du direkt angemeldet.') + button('Neues Passwort festlegen') + LINK_NOTE + fallback,
    notYou: ['Nicht von dir angefordert?', 'Dann kannst du diese E-Mail ignorieren. Dein Passwort bleibt unverändert.'] },
  { file: 'bestaetigungscode.html', supabase: 'Reauthentication', subject: 'Dein Bestätigungscode für KV-Learn',
    preheader: 'Dein Code zur Bestätigung bei KV-Learn.', heading: 'Dein Code.',
    body: p('Gib diesen Code in KV-Learn ein, um die Änderung an deinem Konto zu bestätigen.') + code + small('Der Code ist nur kurze Zeit gültig. Gib ihn niemandem weiter.').replace('margin:0 0 8px', 'margin:0 0 24px'),
    notYou: ['Nicht von dir angefordert?', 'Dann ignoriere diese E-Mail und ändere zur Sicherheit dein Passwort.'] },
];

fs.mkdirSync(OUT, { recursive: true });
for (const t of TEMPLATES) fs.writeFileSync(path.join(OUT, t.file), page({ title: t.subject, ...t }));
fs.writeFileSync(path.join(OUT, 'README.md'), `# E-Mail-Vorlagen für Supabase Auth

Bei Supabase unter **Authentication → Emails → Templates** pro Vorlage den Betreff eintragen und den Inhalt der HTML-Datei vollständig einfügen.
Erzeugt mit \`node scripts/build-emails.mjs\` (Design-Änderungen dort machen, nicht in den HTML-Dateien).

| Vorlage bei Supabase | Betreff | Datei |
|---|---|---|
${TEMPLATES.map((t) => `| ${t.supabase} | ${t.subject} | \`${t.file}\` |`).join('\n')}

Absender (SMTP Settings): KV-Learn <info@kv-learn.app>, Host smtp.resend.com, Port 465, Benutzer \`resend\`.
`);
console.log(TEMPLATES.length, 'Vorlagen erzeugt in', OUT);
