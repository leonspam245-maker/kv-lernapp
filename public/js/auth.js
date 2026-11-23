// Anmeldung und Registrierung (online über Supabase, lokal über den eigenen Server).
// Beliebig viele Konten; jedes Konto sieht nur die eigenen Daten.
import { esc } from './util.js';
import { signIn, signUp, isCloud } from './backend.js';

const LEHRJAHRE = ['1. Lehrjahr', '2. Lehrjahr', '3. Lehrjahr'];

export function loginView(el, onDone) {
  document.body.classList.add('auth-mode');
  let mode = 'login';
  const render = (error = '', v = {}) => {
    const signup = mode === 'signup';
    el.innerHTML = `
    <section class="auth" aria-labelledby="auth-title">
      <div class="auth-intro">
        <p class="hero-date">Deine Lernapp für die KV-Lehre</p>
        <h1 class="hero-title" id="auth-title">${signup ? 'Konto einrichten.' : 'Willkommen zurück.'}</h1>
        <p class="hero-meta">${signup
          ? 'Lege dein persönliches Konto an. Deine Unterlagen und dein Lernstand sind nur für dich sichtbar.'
          : 'Melde dich an, um deine Unterlagen, Karteikarten und deinen Lernplan auf jedem Gerät zu sehen.'}</p>
      </div>
      <form class="auth-form card" id="auth-form" novalidate>
        ${signup ? `
        <div class="grid grid-2" style="gap:0 14px">
          <div class="field"><label for="auth-name">Vorname</label><input type="text" id="auth-name" autocomplete="given-name" value="${esc(v.name || '')}" required></div>
          <div class="field"><label for="auth-year">Lehrjahr</label><select id="auth-year">${LEHRJAHRE.map((l, i) => `<option value="${i + 1}" ${String(v.year || 1) === String(i + 1) ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label for="auth-school">Berufsfachschule</label><input type="text" id="auth-school" autocomplete="organization" value="${esc(v.school ?? 'Wirtschaftsschule KV Chur')}"></div>` : ''}
        <div class="field"><label for="auth-email">E-Mail-Adresse</label><input type="email" id="auth-email" autocomplete="email" inputmode="email" value="${esc(v.email || '')}" required></div>
        <div class="field"><label for="auth-pw">Passwort</label><input type="password" id="auth-pw" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="8" required>
          ${signup ? '<p class="hint">Mindestens 8 Zeichen, davon mindestens eine Zahl.</p>' : ''}</div>
        ${signup ? '<div class="field"><label for="auth-pw2">Passwort wiederholen</label><input type="password" id="auth-pw2" autocomplete="new-password" minlength="8" required></div>' : ''}
        <label class="check" style="padding-top:0"><input type="checkbox" id="auth-show"> Passwort anzeigen</label>
        ${signup ? `<label class="check"><input type="checkbox" id="auth-consent" ${v.consent ? 'checked' : ''}> <span>Ich bin einverstanden, dass meine Unterlagen und mein Lernfortschritt in meinem Konto gespeichert werden (${isCloud() ? 'Supabase, Rechenzentrum Zürich' : 'nur auf diesem Computer'}). Ich kann das Konto jederzeit löschen lassen.</span></label>` : ''}
        ${error ? `<div class="notice notice-bad" role="alert">${esc(error)}</div>` : ''}
        <button class="btn btn-primary btn-block" id="auth-submit">${signup ? 'Konto erstellen' : 'Anmelden'}</button>
        <p class="small muted" style="margin:16px 0 0">${signup
          ? 'Schon ein Konto? <button type="button" class="btn-link" id="auth-switch">Anmelden</button>'
          : 'Noch kein Konto? <button type="button" class="btn-link" id="auth-switch">Konto einrichten</button>'}</p>
      </form>
    </section>`;
    const form = el.querySelector('#auth-form');
    const val = (id) => form.querySelector(id)?.value ?? '';
    const values = () => ({ email: val('#auth-email').trim(), name: val('#auth-name').trim(), year: val('#auth-year'), school: signup ? val('#auth-school').trim() : undefined, consent: form.querySelector('#auth-consent')?.checked, pw: val('#auth-pw'), pw2: val('#auth-pw2') });
    form.querySelector('#auth-show').addEventListener('change', (e) => {
      form.querySelectorAll('input[type=password], input[data-pw]').forEach((i) => { i.dataset.pw = '1'; i.type = e.target.checked ? 'text' : 'password'; });
    });
    el.querySelector('#auth-switch').addEventListener('click', () => { mode = signup ? 'login' : 'signup'; render('', values()); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v2 = values();
      const pw = val('#auth-pw');
      if (signup && !v2.name) return render('Bitte deinen Vornamen eingeben.', v2);
      if (!/^\S+@\S+\.\S+$/.test(v2.email)) return render('Bitte eine gültige E-Mail-Adresse eingeben.', v2);
      if (pw.length < 8) return render('Das Passwort muss mindestens 8 Zeichen lang sein.', v2);
      if (signup && !/\d/.test(pw)) return render('Das Passwort muss mindestens eine Zahl enthalten.', v2);
      if (signup && pw !== val('#auth-pw2')) return render('Die beiden Passwörter stimmen nicht überein.', v2);
      if (signup && !v2.consent) return render('Bitte bestätige, dass deine Daten in deinem Konto gespeichert werden dürfen.', v2);
      const btn = form.querySelector('#auth-submit');
      btn.disabled = true; btn.textContent = signup ? 'Konto wird erstellt …' : 'Anmelden …';
      try {
        if (signup) await signUp(v2.email, pw, { firstName: v2.name, apprenticeshipYear: Number(v2.year), school: v2.school, consentAt: new Date().toISOString() });
        else await signIn(v2.email, pw);
        document.body.classList.remove('auth-mode');
        await onDone();
      } catch (err) {
        render(err.message, v2);
      }
    });
    // Passwörter nach einer Fehlermeldung nicht verlieren (nur im Speicher, nie im HTML)
    if (v.pw) form.querySelector('#auth-pw').value = v.pw;
    if (v.pw2 && form.querySelector('#auth-pw2')) form.querySelector('#auth-pw2').value = v.pw2;
    const first = signup ? (v.name ? form.querySelector('#auth-pw') : form.querySelector('#auth-name')) : (v.email ? form.querySelector('#auth-pw') : form.querySelector('#auth-email'));
    first?.focus();
  };
  render();
}
