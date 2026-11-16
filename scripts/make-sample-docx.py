"""Erzeugt samples/beispiel-mykv-aufgaben.docx (gekennzeichnete Beispieldaten) ohne Zusatzbibliothek.
Enthält Überschriften, eine Aufzählung und eine Tabelle.
Aufruf: python3 scripts/make-sample-docx.py
"""
import os
import zipfile
from xml.sax.saxutils import escape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'samples', 'beispiel-mykv-aufgaben.docx')


def p(text, style=None, numbered=False):
    ppr = ''
    if style or numbered:
        ppr = '<w:pPr>' + (f'<w:pStyle w:val="{style}"/>' if style else '') + ('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' if numbered else '') + '</w:pPr>'
    return f'<w:p>{ppr}<w:r><w:t xml:space="preserve">{escape(text)}</w:t></w:r></w:p>'


def table(rows):
    cells = ''.join('<w:tr>' + ''.join(f'<w:tc>{p(c)}</w:tc>' for c in r) + '</w:tr>' for r in rows)
    return f'<w:tbl>{cells}</w:tbl>'


body = ''.join([
    p('Aufgaben Vertragsentstehung (Beispiel)', 'Heading1'),
    p('Bearbeite die Aufgaben bis zur nächsten Lektion.'),
    p('Begriffe', 'Heading2'),
    p('Antrag: Verbindliches Angebot, einen bestimmten Vertrag abzuschliessen.', numbered=True),
    p('Annahme: Zustimmung zum Antrag innert der Annahmefrist.', numbered=True),
    p('Fallbeispiel', 'Heading2'),
    p('Ein Gast reserviert per Telefon eine Wanderung auf der viaSpluga. Ist der Vertrag zustande gekommen?'),
    table([['Form', 'Beispiel'], ['Formfreiheit', 'Reservation per Telefon'], ['Öffentliche Beurkundung', 'Grundstückkauf']]),
])

DOCUMENT = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{body}</w:body></w:document>'''
CONTENT_TYPES = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'''
RELS = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'''

with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', CONTENT_TYPES)
    z.writestr('_rels/.rels', RELS)
    z.writestr('word/document.xml', DOCUMENT)
print('geschrieben:', OUT)
