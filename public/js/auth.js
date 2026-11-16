// Anmeldung im Online-Betrieb. Es gibt genau ein Konto: Wer sich zuerst registriert, besitzt die Lernapp.
import { esc } from './util.js';
import { signIn, signUp } from './backend.js';

export function loginView(el, onDone) {
  document.body.classList.add('auth-mode');
  let mode = 'login';
  const render = (error = '', values = {}) => {
    el.innerHTML = `
    <section class="auth" aria-labelledby="auth-title">
      <div class="auth-intro">
        <p class="hero-date">Deine Lernapp für die KV-Lehre</p>
        <h1 class="hero-title" id="auth-title">${mode === 'login' ? 'Willkommen zurück.' : 'Konto einrichten.'}</h1>
        <p class="hero-meta">${mode === 'login'
          ? 'Melde dich an, um deine Unterlagen, Karteikarten und deinen Lernplan auf jedem Gerät zu sehen.'
          : 'Einmalig: Lege dein Konto an. Danach ist die Registrierung geschlossen, und nur du hast Zugriff auf deine Daten.'}</p>
      </div>
      <form class="auth-form card" id="auth-form" novalidate>
        <div class="field"><label for="auth-email">E-Mail-Adresse</label><input type="email" id="auth-email" autocomplete="email" inputmode="email" value="${esc(values.email || '')}" required></div>
        <div class="field"><label for="auth-pw">Passwort</label><input type="password" id="auth-pw" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" minlength="8" required>
          ${mode === 'signup' ? '<p class="hint">Mindestens 8 Zeichen.</p>' : ''}</div>
        ${error ? `<div class="notice notice-bad" role="alert">${esc(error)}</div>` : ''}
        <button class="btn btn-primary btn-block" id="auth-submit">${mode === 'login' ? 'Anmelden' : 'Konto erstellen'}</button>
        <p class="small muted" style="margin:14px 0 0">${mode === 'login'
          ? 'Noch kein Konto? <button type="button" class="btn-link" id="auth-switch">Konto einrichten</button>'
          : 'Schon ein Konto? <button type="button" class="btn-link" id="auth-switch">Anmelden</button>'}</p>
      </form>
    </section>`;
    const form = el.querySelector('#auth-form');
    el.querySelector('#auth-switch').addEventListener('click', () => { mode = mode === 'login' ? 'signup' : 'login'; render('', { email: form.querySelector('#auth-email').value }); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = form.querySelector('#auth-email').value.trim();
      const pw = form.querySelector('#auth-pw').value;
      if (!/^\S+@\S+\.\S+$/.test(email)) return render('Bitte eine gültige E-Mail-Adresse eingeben.', { email });
      if (pw.length < 8) return render('Das Passwort muss mindestens 8 Zeichen lang sein.', { email });
      const btn = form.querySelector('#auth-submit');
      btn.disabled = true; btn.textContent = mode === 'login' ? 'Anmelden …' : 'Konto wird erstellt …';
      try {
        if (mode === 'login') await signIn(email, pw); else await signUp(email, pw);
        document.body.classList.remove('auth-mode');
        await onDone();
      } catch (err) {
        render(err.message, { email });
      }
    });
    (values.email ? form.querySelector('#auth-pw') : form.querySelector('#auth-email')).focus();
  };
  render();
}
