"""Erzeugt samples/beispiel-handout-vertragsrecht.pdf (gekennzeichnete Beispieldaten).
Seiten 1–2 enthalten echten Text, Seite 3 ist ein Bild (simulierter Scan ohne Textebene).
Aufruf: python3 scripts/make-sample-pdf.py
"""
import io, os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'samples', 'beispiel-handout-vertragsrecht.pdf')

PAGES = [
    [
        ('B', 16, 'Handout Vertragsrecht (Beispieldaten)'),
        ('R', 10, 'W&G, 1. Lehrjahr - Beispielunterlage für die Lernapp'),
        ('B', 13, 'Vertragsentstehung'),
        ('R', 11, 'Ein Vertrag entsteht durch übereinstimmende gegenseitige Willensäusserung der Parteien (Art. 1 OR).'),
        ('R', 11, 'Antrag: Verbindliches Angebot einer Partei, einen bestimmten Vertrag abzuschliessen.'),
        ('R', 11, 'Annahme: Zustimmung der anderen Partei zum Antrag innert der Annahmefrist.'),
        ('R', 11, 'Unter Anwesenden muss ein Antrag ohne Fristansetzung sofort angenommen werden (Art. 4 OR).'),
        ('R', 11, 'Unter Abwesenden bleibt der Antrag bis zu dem Zeitpunkt verbindlich, in dem eine Antwort'),
        ('R', 11, 'bei ordnungsgemässer Absendung erwartet werden darf (Art. 5 OR).'),
        ('R', 11, 'Zum Beispiel: Ein Gast bestellt per E-Mail eine Führung in der Viamala-Schlucht; das'),
        ('R', 11, 'Tourismusbüro bestätigt am gleichen Tag. Damit ist der Vertrag zustande gekommen.'),
    ],
    [
        ('B', 13, 'Formvorschriften'),
        ('R', 11, 'Formfreiheit: Verträge sind grundsätzlich an keine Form gebunden (Art. 11 OR).'),
        ('R', 11, 'Einfache Schriftlichkeit: Der Vertrag muss schriftlich abgefasst und von den Parteien'),
        ('R', 11, 'unterzeichnet werden, zum Beispiel bei der Abtretung einer Forderung.'),
        ('R', 11, 'Öffentliche Beurkundung: Eine Urkundsperson (Notar) beurkundet den Vertrag,'),
        ('R', 11, 'zum Beispiel beim Kauf eines Grundstücks.'),
        ('B', 13, 'Vertragsarten im Überblick'),
        ('R', 11, 'Kaufvertrag: Übergabe einer Sache und Verschaffung des Eigentums gegen Bezahlung des Kaufpreises.'),
        ('R', 11, 'Mietvertrag: Überlassung einer Sache zum Gebrauch gegen Mietzins.'),
        ('R', 11, 'Werkvertrag: Herstellung eines Werkes gegen Vergütung; geschuldet ist ein Erfolg.'),
        ('R', 11, 'Im Gegensatz zum Werkvertrag schuldet der Beauftragte beim einfachen Auftrag nur sorgfältiges Tätigwerden.'),
    ],
]
SCAN_LINES = [
    'Vertragsfähigkeit (eingescannte Seite)',
    'Handlungsfähigkeit: Fähigkeit, durch eigenes Handeln',
    'Rechte und Pflichten zu begründen (Art. 12 ZGB).',
    'Handlungsfähig ist, wer volljährig und urteilsfähig ist.',
]

def fix(s):
    return s

def pdf_str(s):
    b = s.encode('cp1252')
    return b.replace(b'\\', b'\\\\').replace(b'(', b'\\(').replace(b')', b'\\)')

def text_stream(lines):
    out = io.BytesIO()
    y = 780
    for style, size, text in lines:
        font = '/F2' if style == 'B' else '/F1'
        if style == 'B':
            y -= 10
        out.write(b'BT ' + font.encode() + b' %d Tf 56 %d Td (' % (size, y) + pdf_str(fix(text)) + b') Tj ET\n')
        y -= int(size * 1.7)
    return out.getvalue()

def scan_jpeg():
    w, h = 1240, 600
    img = Image.new('L', (w, h), 248)
    d = ImageDraw.Draw(img)
    big = ImageFont.truetype('/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf', 46)
    reg = ImageFont.truetype('/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf', 38)
    y = 50
    for i, line in enumerate(SCAN_LINES):
        d.text((60, y), line, fill=20, font=big if i == 0 else reg)
        y += 100 if i == 0 else 70
    buf = io.BytesIO()
    img.save(buf, 'JPEG', quality=90)
    return w, h, buf.getvalue()

objs = []
def add(data):
    objs.append(data)
    return len(objs)

font1 = add(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
font2 = add(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
pages_id = len(objs) + 1
objs.append(None)  # Platzhalter Pages
page_ids = []
for lines in PAGES:
    s = text_stream(lines)
    c = add(b'<< /Length %d >>\nstream\n' % len(s) + s + b'\nendstream')
    page_ids.append(add(b'<< /Type /Page /Parent %d 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 %d 0 R /F2 %d 0 R >> >> /Contents %d 0 R >>' % (pages_id, font1, font2, c)))
w, h, jpg = scan_jpeg()
im = add(b'<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n' % (w, h, len(jpg)) + jpg + b'\nendstream')
s = b'q 500 0 0 242 48 560 cm /Im1 Do Q\n'
c = add(b'<< /Length %d >>\nstream\n' % len(s) + s + b'\nendstream')
page_ids.append(add(b'<< /Type /Page /Parent %d 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 %d 0 R >> >> /Contents %d 0 R >>' % (pages_id, im, c)))
objs[pages_id - 1] = b'<< /Type /Pages /Kids [' + b' '.join(b'%d 0 R' % p for p in page_ids) + b'] /Count %d >>' % len(page_ids)
catalog = add(b'<< /Type /Catalog /Pages %d 0 R >>' % pages_id)

out = io.BytesIO()
out.write(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
offsets = []
for i, o in enumerate(objs, 1):
    offsets.append(out.tell())
    out.write(b'%d 0 obj\n' % i + o + b'\nendobj\n')
xref = out.tell()
out.write(b'xref\n0 %d\n0000000000 65535 f \n' % (len(objs) + 1))
for off in offsets:
    out.write(b'%010d 00000 n \n' % off)
out.write(b'trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (len(objs) + 1, catalog, xref))
with open(OUT, 'wb') as f:
    f.write(out.getvalue())
print('geschrieben:', OUT)
