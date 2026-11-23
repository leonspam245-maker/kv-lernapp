// Einstellungen: KI-Dienst (bewusste Aktivierung), Datensicherung, Beispieldaten.
import { store, commit } from './store.js';
import { esc, fmtDateTime, todayISO, plural } from './util.js';
import { toast, confirmDialog } from './ui.js';
import { rerender } from './app.js';
import { buildDemoData } from './demo.js';
import { isCloud, signOut } from './backend.js';
import { getAiKey, setAiKey, removeAiKey, isRemembered, maskKey } from './aikeys.js';

export function settingsView(el) {
  const db = store.db;
  const ai = store.server.ai || {};
  const provider = db.settings.aiProvider === 'chatgpt' ? 'chatgpt' : 'claude';
  const consent = db.settings.aiConsent;
  const PROVIDERS = {
    claude: { name: 'Claude', company: 'Anthropic', model: ai.providers?.claude?.model || ai.model || 'claude-opus-5-5',
      price: 'USD 4 pro Million Eingabe-Tokens, USD 20 pro Million Ausgabe-Tokens, Stand 03.11.2026', estimate: 'USD 0.10–0.30',
      subscription: 'ein Claude-Abo (Pro/Max)', privacy: 'https://www.anthropic.com/legal/privacy', pricing: 'https://www.anthropic.com/pricing', pricingLabel: 'anthropic.com/pricing',
      console: 'https://console.anthropic.com', consoleLabel: 'console.anthropic.com' },
    chatgpt: { name: 'ChatGPT', company: 'OpenAI', model: ai.providers?.chatgpt?.model || 'gpt-6.1-sol',
      price: 'gemäss Preisübersichten USD 2 pro Million Eingabe-Tokens, USD 10 pro Million Ausgabe-Tokens, Stand 23.11.2026, nicht direkt bei OpenAI geprüft', estimate: 'USD 0.05–0.15',
      subscription: 'ein ChatGPT-Abo (Plus/Pro)', privacy: 'https://openai.com/policies/privacy-policy', pricing: 'https://openai.com/api/pricing', pricingLabel: 'openai.com/api/pricing',
      console: 'https://platform.openai.com', consoleLabel: 'platform.openai.com' },
  };
  const P = PROVIDERS[provider];
  const myKey = getAiKey(provider);
  const configured = Boolean(myKey);
  const demoCount = db.subjects.filter((s) => s.demo).length;
  const pr = db.settings.profile || {};
  el.innerHTML = `<div class="page-head"><div><h1>Einstellungen</h1></div></div>
  <section class="card">
    <h2 style="margin-top:0">Profil</h2>
    <form id="profile" class="grid grid-3" style="align-items:end" novalidate>
      <div class="field"><label for="pf-name">Vorname</label><input type="text" id="pf-name" value="${esc(pr.firstName || '')}" autocomplete="given-name"></div>
      <div class="field"><label for="pf-year">Lehrjahr</label><select id="pf-year">${[1, 2, 3].map((y) => `<option value="${y}" ${Number(pr.apprenticeshipYear || 1) === y ? 'selected' : ''}>${y}. Lehrjahr</option>`).join('')}</select></div>
      <div class="field"><label for="pf-school">Berufsfachschule</label><input type="text" id="pf-school" value="${esc(pr.school ?? '')}" autocomplete="organization"></div>
      <div><button class="btn btn-primary" id="pf-save">Profil speichern</button></div>
    </form>
    <p class="small muted" style="margin:6px 0 0">Angemeldet als ${esc(store.user?.email || '')} · <button type="button" class="btn-link" id="logout2">Abmelden</button></p>
  </section>
  <section class="card">
    <h2 style="margin-top:0">KI-Dienst für Lerninhalte (optional)</h2>
    <p>Die App funktioniert vollständig ohne KI: Import, Lernplan, Karteikarten sowie Merkblatt, Quiz und Probeprüfung aus deinen Unterlagen werden lokal erstellt. Optional formuliert ein KI-Dienst verständlichere Merkblätter, abwechslungsreichere Fragen und gekennzeichnete eigene Beispiele.</p>
    <div class="field"><span class="eyebrow">Anbieter</span>
      <div class="tabs" role="radiogroup" aria-label="KI-Anbieter">${Object.entries(PROVIDERS).map(([k, p]) => `<button type="button" role="radio" data-provider="${k}" aria-selected="${provider === k}" aria-checked="${provider === k}">${p.name}</button>`).join('')}</div></div>
    <h3>Was wird übertragen?</h3>
    <ul>
      <li>Nur beim Klick auf «Erstellen» mit der Option «Mit KI» und nach einer Bestätigung.</li>
      <li>Nur der Text der ausgewählten Unterlagen, deren Titel sowie Fach- und Themennamen.</li>
      <li>Nicht übertragen werden: Lernfortschritt, Quizergebnisse, Lernplan, andere Unterlagen, dein Name.</li>
      <li>Die Daten gehen an ${P.name} von ${P.company} (USA). Details: <a href="${P.privacy}" target="_blank" rel="noopener">Datenschutz von ${P.company}</a>.</li>
    </ul>
    <h3>Entstehen Kosten?</h3>
    <p>Ja, sobald du den Dienst nutzt. Die API von ${P.company} wird pro Nutzung abgerechnet und braucht ein eigenes Konto mit Guthaben; ${P.subscription} deckt die API nicht ab. Mit dem eingestellten Modell <code>${esc(P.model)}</code> (Listenpreis ${P.price}) kostet ein Merkblatt aus rund 10 Seiten ungefähr ${P.estimate}. Den genauen Preis zeigt <a href="${P.pricing}" target="_blank" rel="noopener">${P.pricingLabel}</a>; Beträge in CHF sind ungefähr.</p>
    <h3>Dein eigener Schlüssel</h3>
    <p>Jede Person nutzt ihren eigenen KI-Zugang und bezahlt nur ihre eigene Nutzung. Es gibt keinen gemeinsamen Schlüssel.</p>
    <ol>
      <li>Auf <a href="${P.console}" target="_blank" rel="noopener">${P.consoleLabel}</a> ein Konto erstellen, Guthaben aufladen und einen API-Schlüssel anlegen.</li>
      <li>Den Schlüssel hier eintragen. Er bleibt <strong>nur in diesem Browser</strong> (für dein Konto) und wird weder in deinen Lerndaten noch auf dem Server gespeichert. Er wird nur bei einer bestätigten KI-Erstellung über ${isCloud() ? 'den Lernapp-Server' : 'deinen Lernapp-Server'} an ${P.company} weitergereicht.</li>
      <li>Auf einem anderen Gerät trägst du den Schlüssel dort erneut ein. An einem fremden oder gemeinsam genutzten Computer «Auf diesem Gerät merken» ausschalten.</li>
    </ol>
    ${configured
      ? `<div class="row" style="align-items:center"><span>Hinterlegt: <code>${esc(maskKey(myKey))}</code> · ${isRemembered(provider) ? 'auf diesem Gerät gemerkt' : 'nur bis der Browser geschlossen wird'}</span><button type="button" class="btn btn-small btn-danger" id="key-del">Schlüssel entfernen</button></div>`
      : `<form id="key-form" class="row" style="align-items:end" novalidate autocomplete="off">
          <div class="field" style="flex:1;min-width:220px;margin:0"><label for="key-input">API-Schlüssel für ${P.name}</label><input type="password" id="key-input" autocomplete="off" spellcheck="false" placeholder="${provider === 'claude' ? 'sk-ant-…' : 'sk-…'}"></div>
          <button class="btn btn-primary" id="key-save">Schlüssel speichern</button>
          <label class="check" style="flex-basis:100%;padding-top:0"><input type="checkbox" id="key-remember" checked> Auf diesem Gerät merken</label>
        </form>`}
    <div class="notice ${configured ? 'notice-ok' : 'notice-warn'}">Status: ${configured ? `Dein Schlüssel für ${P.name} ist hinterlegt.` : `Kein eigener Schlüssel für ${P.name} hinterlegt – KI-Funktionen sind nicht verfügbar.`} ${consent ? `KI-Dienst (${P.name}) aktiviert am ${fmtDateTime(db.settings.aiConsentAt)}.` : 'KI-Dienst nicht aktiviert.'}</div>
    ${consent
      ? '<button class="btn btn-danger" id="ai-off">KI-Dienst deaktivieren</button>'
      : `<label class="check"><input type="checkbox" id="ai-ack"> Ich habe verstanden, welche Inhalte an ${P.name} übertragen werden und dass Kosten entstehen.</label>
         <button class="btn btn-primary" id="ai-on" ${configured ? '' : 'disabled'}>KI-Dienst aktivieren</button>`}
  </section>

  <section class="card">
    <h2 style="margin-top:0">Daten und Sicherung</h2>
    ${isCloud()
      ? '<p>Alle Unterlagen und dein Lernfortschritt sind online in deinem Konto gespeichert (Supabase, Rechenzentrum Zürich). Nur du hast nach der Anmeldung Zugriff. Du kannst die App auf jedem Gerät öffnen.</p>'
      : '<p>Alle Unterlagen und dein Lernfortschritt werden in deinem lokalen Konto auf dem Computer gespeichert, auf dem die App läuft (Ordner <code>data/</code>, mit automatischer Sicherungskopie). Jedes Konto hat eine eigene Datei. Die Daten bleiben nach einem Neustart erhalten.</p>'}
    <p class="small muted">Daten aus der lokalen Version übernimmst du so: dort «Sicherung herunterladen», hier «Sicherung einspielen».</p>
    <p class="small muted">${plural(db.subjects.length, 'Fach', 'Fächer')} · ${plural(db.topics.length, 'Thema', 'Themen')} · ${plural(db.sources.length, 'Unterlage', 'Unterlagen')} · ${plural(db.cards.length, 'Karte', 'Karten')} · ${plural(db.attempts.length, 'Übungsdurchgang', 'Übungsdurchgänge')}</p>
    <div class="row"><button class="btn" id="export">Sicherung herunterladen</button>
      <label class="btn">Sicherung einspielen<input type="file" id="import" accept=".json,application/json" hidden></label></div>
  </section>

  ${isCloud() ? `<section class="card">
    <h2 style="margin-top:0">Als App installieren</h2>
    <ul>
      <li><strong>iPhone (Safari):</strong> Teilen-Symbol, dann «Zum Home-Bildschirm».</li>
      <li><strong>Android (Chrome):</strong> Menü ⋮, dann «App installieren» bzw. «Zum Startbildschirm hinzufügen».</li>
      <li><strong>Computer (Chrome oder Edge):</strong> In der Adresszeile auf das Installieren-Symbol klicken oder im Menü «App installieren» wählen.</li>
    </ul>
    <button class="btn" id="logout">Abmelden</button>
  </section>` : ''}

  <section class="card">
    <h2 style="margin-top:0">Beispieldaten</h2>
    <p>Zum Ausprobieren: ein Fach «W&G (Beispiel)» mit gekennzeichneten Beispielunterlagen, Karteikarten und einem Lernplan. Beispieldaten tragen die Markierung <span class="badge badge-demo">Beispiel</span> und lassen sich vollständig entfernen.</p>
    <div class="row">${demoCount ? '<button class="btn btn-danger" id="demo-del">Beispieldaten entfernen</button>' : '<button class="btn" id="demo-add">Beispieldaten laden</button>'}</div>
  </section>`;

  el.querySelector('#profile').addEventListener('submit', async (e) => {
    e.preventDefault();
    const firstName = el.querySelector('#pf-name').value.trim();
    if (!firstName) return toast('Bitte einen Vornamen eingeben.', 'error');
    try {
      await commit((d) => { d.settings.profile = { firstName, apprenticeshipYear: Number(el.querySelector('#pf-year').value), school: el.querySelector('#pf-school').value.trim() }; });
      toast('Profil gespeichert.');
    } catch (err) { toast(err.message, 'error'); }
  });
  el.querySelector('#logout2')?.addEventListener('click', async () => {
    try { await signOut(); location.reload(); } catch (e) { toast(e.message, 'error'); }
  });
  el.querySelector('#logout')?.addEventListener('click', async () => {
    try { await signOut(); location.reload(); } catch (e) { toast(e.message, 'error'); }
  });
  el.querySelectorAll('[data-provider]').forEach((b) => b.addEventListener('click', async () => {
    const next = b.dataset.provider;
    if (next === provider) return;
    try {
      // Anbieterwechsel: Zustimmung gilt nur für den bisherigen Anbieter und wird zurückgesetzt
      await commit((d) => { d.settings.aiProvider = next; d.settings.aiConsent = false; d.settings.aiConsentAt = null; });
      toast(`${PROVIDERS[next].name} gewählt. Aktiviere den Dienst, um ihn zu nutzen.`, 'info'); rerender();
    } catch (e) { toast(e.message, 'error'); }
  }));
  el.querySelector('#key-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = el.querySelector('#key-input');
    try {
      setAiKey(provider, input.value, el.querySelector('#key-remember').checked);
      input.value = '';
      toast(`Schlüssel für ${P.name} gespeichert (nur in diesem Browser).`); rerender();
    } catch (err) { toast(err.message, 'error'); }
  });
  el.querySelector('#key-del')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Schlüssel für ${P.name} aus diesem Browser entfernen? Bei ${P.company} bleibt er gültig; dort kannst du ihn bei Bedarf löschen.`, { ok: 'Entfernen', danger: true }))) return;
    removeAiKey(provider); toast('Schlüssel entfernt.'); rerender();
  });
  el.querySelector('#ai-on')?.addEventListener('click', async () => {
    if (!el.querySelector('#ai-ack').checked) return toast('Bitte zuerst bestätigen, dass du die Hinweise gelesen hast.', 'error');
    try { await commit((d) => { d.settings.aiConsent = true; d.settings.aiConsentAt = new Date().toISOString(); }); toast('KI-Dienst aktiviert. Unterlagen werden nur nach deiner Bestätigung übertragen.'); rerender(); } catch (e) { toast(e.message, 'error'); }
  });
  el.querySelector('#ai-off')?.addEventListener('click', async () => {
    try { await commit((d) => { d.settings.aiConsent = false; d.settings.aiConsentAt = null; }); toast('KI-Dienst deaktiviert. Es werden keine Unterlagen mehr übertragen.'); rerender(); } catch (e) { toast(e.message, 'error'); }
  });
  el.querySelector('#export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ app: 'kv-lernapp', exportedAt: new Date().toISOString(), data: store.db }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `lernapp-sicherung-${todayISO()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Sicherung heruntergeladen.');
  });
  el.querySelector('#import').addEventListener('change', async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const data = parsed.data || parsed;
      if (!Array.isArray(data.subjects) || !Array.isArray(data.sources)) throw new Error('Die Datei ist keine Sicherung der Lernapp.');
      if (!(await confirmDialog('Sicherung einspielen? Alle aktuellen Daten werden durch die Sicherung ersetzt.', { ok: 'Ersetzen', danger: true }))) return;
      await commit((d) => { for (const k of Object.keys(d)) delete d[k]; Object.assign(d, data); for (const k of ['topics', 'cards', 'contents', 'attempts', 'exams']) d[k] ||= []; d.settings ||= { aiConsent: false }; });
      toast('Sicherung eingespielt.'); rerender();
    } catch (err) { toast(`Sicherung nicht eingespielt: ${err.message}`, 'error'); }
  });
  el.querySelector('#demo-add')?.addEventListener('click', async () => {
    try { const demo = buildDemoData(todayISO()); await commit((d) => { for (const k of Object.keys(demo)) d[k].push(...demo[k]); }); toast('Beispieldaten geladen.'); location.hash = '#/'; } catch (e) { toast(e.message, 'error'); }
  });
  el.querySelector('#demo-del')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Alle als «Beispiel» markierten Fächer, Themen, Unterlagen, Karten, Ergebnisse und Prüfungen entfernen?', { ok: 'Entfernen', danger: true }))) return;
    try {
      await commit((d) => {
        const subj = new Set(d.subjects.filter((s) => s.demo).map((s) => s.id));
        const topics = new Set(d.topics.filter((t) => subj.has(t.subjectId)).map((t) => t.id));
        d.subjects = d.subjects.filter((s) => !subj.has(s.id));
        d.topics = d.topics.filter((t) => !topics.has(t.id));
        d.sources = d.sources.filter((s) => !subj.has(s.subjectId));
        d.cards = d.cards.filter((c) => !topics.has(c.topicId));
        const contents = new Set(d.contents.filter((c) => c.topicIds.some((t) => topics.has(t))).map((c) => c.id));
        d.contents = d.contents.filter((c) => !contents.has(c.id));
        d.attempts = d.attempts.filter((a) => !contents.has(a.contentId) && !a.demo);
        d.exams = d.exams.filter((e) => !subj.has(e.subjectId));
      });
      toast('Beispieldaten entfernt.'); rerender();
    } catch (e) { toast(e.message, 'error'); }
  });
}
