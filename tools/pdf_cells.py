"""Cuts a Statis Pro team PDF into its cards (5 columns x 4 rows per page) and returns each card's text.

Each card comes back as {'full': text, 'left': left-half text, 'right': right-half text}; two-column cards
(quarterbacks, backs and receivers) are read from the halves so their tables don't run into each other.
"""
import pdfplumber

COLUMN_EDGES = [20, 130, 238, 346, 454, 570]

def cards(path):
    out = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            words = page.extract_words()
            tops = sorted({round(w['top']) for w in words if w['text'].isdigit() and len(w['text']) == 4})
            rows = []
            for t in tops:
                if not rows or t - rows[-1] > 20:
                    rows.append(t)
            rows = [r - 8 for r in rows]
            for ri, top in enumerate(rows):
                bottom = rows[ri + 1] if ri + 1 < len(rows) else min(page.height, top + 185)
                for ci in range(5):
                    left, right = COLUMN_EDGES[ci], COLUMN_EDGES[ci + 1]
                    full = page.crop((left, top, right, bottom)).extract_text() or ''
                    if not full.strip():
                        continue
                    out.append({
                        'full': full,
                        'left': page.crop((left, top, left + 57, bottom)).extract_text() or '',
                        'right': page.crop((left + 57, top, right, bottom)).extract_text() or '',
                    })
    return out
