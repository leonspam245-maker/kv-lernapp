// Prüft, ob ein Passwort aus bekannten Datenlecks stammt (Dienst «Have I Been Pwned», Verfahren k-Anonymität).
// Übertragen werden nur die ersten 5 Zeichen der SHA-1-Prüfsumme; das Passwort selbst verlässt den Browser nie.
// Ist der Dienst nicht erreichbar, wird die Anmeldung nicht blockiert.
export async function leakCount(password) {
  try {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password)));
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${hex.slice(0, 5)}`, { headers: { 'Add-Padding': 'true' }, signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return 0;
    const suffix = hex.slice(5);
    for (const line of (await res.text()).split('\n')) {
      const [s, n] = line.trim().split(':');
      if (s === suffix) return Number(n) || 0;
    }
    return 0;
  } catch { return 0; }
}
export const leakMessage = (n) => `Dieses Passwort kommt in bekannten Datenlecks vor (${n.toLocaleString('de-CH')}-mal) und ist darum unsicher. Bitte wähle ein anderes.`;
