// Lesbarkeitsprüfung für die automatischen Tests: findet Text mit zu wenig Kontrast zum Hintergrund
// (z. B. weisse Schrift auf weissem Hintergrund). Grenzwerte nach WCAG 2.2 (AA):
// 4.5 : 1 für normalen Text, 3 : 1 für grossen Text (ab 24 px oder ab 18.66 px fett).
// Deaktivierte Bedienelemente und als dekorativ markierte Elemente (aria-hidden) sind ausgenommen.

/** Liefert alle Textstellen der aktuellen Seite mit zu wenig Kontrast. */
export async function contrastProblems(page) {
  // Einblend-Animationen abschliessen, damit nicht halb durchsichtiger Text gemessen wird
  await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch { /* endlos */ } }));
  await page.mouse.move(0, 0);
  return page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    // Beliebige CSS-Farbe (auch color-mix, oklab …) in RGBA umrechnen
    const rgba = (css) => {
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data; return [r, g, b, a / 255];
    };
    const over = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1); };
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

    // Alle Farbangaben in einem Verlauf finden (auch verschachtelte wie color-mix(…))
    const colorsIn = (str) => {
      const out = []; const re = /(rgba?|color-mix|color|oklab|oklch|lab|lch|hsla?)\(/g; let m;
      while ((m = re.exec(str))) {
        let depth = 0; let i = m.index + m[0].length - 1;
        for (; i < str.length; i++) { if (str[i] === '(') depth++; else if (str[i] === ')' && --depth === 0) break; }
        out.push(str.slice(m.index, i + 1)); re.lastIndex = i + 1;
      }
      return out;
    };
    // Effektiver Hintergrund: Hintergrundfarben aller Vorfahren übereinanderlegen
    const background = (el) => {
      const layers = [];
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        const cs = getComputedStyle(n);
        let c = rgba(cs.backgroundColor);
        // Verlauf ohne Grundfarbe (z. B. Seitenhintergrund): Mittelwert der Verlaufsfarben verwenden
        if (c[3] === 0 && cs.backgroundImage.includes('gradient')) {
          const cols = colorsIn(cs.backgroundImage).map(rgba).filter((x) => x[3] > 0);
          if (cols.length) c = [0, 1, 2].map((i) => cols.reduce((s2, x) => s2 + x[i], 0) / cols.length).concat(1);
        }
        if (c[3] > 0) layers.push(c);
        if (c[3] >= 1) break;
      }
      return layers.reverse().reduce((acc, c) => over(c, acc), [255, 255, 255, 1]);
    };
    const skip = (el) => el.closest('[aria-hidden="true"], :disabled, .sr-only, .skip, [hidden], dialog:not([open])');
    const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const opacity = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; };

    const out = []; const seen = new Set();
    const check = (el, text) => {
      if (seen.has(el) || skip(el) || !visible(el)) return; seen.add(el);
      const cs = getComputedStyle(el);
      const bg = background(el);
      const fg = rgba(cs.color); fg[3] *= opacity(el);
      const r = ratio(over(fg, bg), bg);
      const size = parseFloat(cs.fontSize); const bold = Number(cs.fontWeight) >= 700;
      const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
      if (r < need) out.push({ text: text.trim().slice(0, 60), ratio: Math.round(r * 100) / 100, need, color: cs.color, bg: `rgb(${bg.slice(0, 3).map(Math.round).join(',')})`, tag: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '') });
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) if (t.textContent.trim() && t.parentElement) check(t.parentElement, t.textContent);
    for (const el of document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select')) if (el.value) check(el, el.value);
    return out;
  });
}

/** Prüft die Seite und meldet einen Fehler mit allen Fundstellen. */
export async function assertReadable(page, where) {
  const problems = await contrastProblems(page);
  if (problems.length) {
    const list = problems.slice(0, 8).map((p) => `«${p.text}» (${p.tag}) ${p.ratio}:1 statt ${p.need}:1, Schrift ${p.color} auf ${p.bg}`).join('\n      ');
    throw new Error(`${where}: ${problems.length} schlecht lesbare Textstelle(n)\n      ${list}`);
  }
}
