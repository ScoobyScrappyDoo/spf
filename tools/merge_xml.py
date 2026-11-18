"""Adds what only the old WPF XML has (jersey numbers, default formations) to a team converted from the PDF,
and settles card values where the two sources disagree: the value that fits its column wins
(yards never rise further down a column); if both fit, the PDF stays and the disagreement is noted.

Usage: python tools/merge_xml.py team-from-pdf.json team-from-xml.json [--extras-only]
--extras-only copies jersey numbers and formations but leaves every card value as the PDF has it.
"""
import difflib, json, sys

def fits(col, i, v):
    prev = next((col[j] for j in range(i - 1, 0, -1) if isinstance(col[j], int)), None)
    nxt = next((col[j] for j in range(i + 1, len(col)) if isinstance(col[j], int)), None)
    return (prev is None or i == 1 or v <= prev) and (nxt is None or v >= nxt)

def merge(pdf, xml, extras_only=False):
    notes = pdf.setdefault('dataNotes', [])
    X = {f"{p['firstName']} {p['lastName']}|{p['position']}": p for p in xml['players']}
    for p in pdf['players']:
        k = f"{p['firstName']} {p['lastName']}|{p['position']}"
        if k not in X:
            close = difflib.get_close_matches(k, list(X), n=1, cutoff=0.85)
            k = close[0] if close else None
        if not k:
            continue
        x = X[k]
        if 'jersey' in x:
            p['jersey'] = x['jersey']
        who = f"{p['firstName']} {p['lastName']}"
        if extras_only:
            continue
        for table, keys in (('rushing', ('n', 'sg', 'lg')), ('passGain', ('q', 's', 'l'))):
            if not p.get(table) or not x.get(table):
                continue
            for c in keys:
                col = [r[c] for r in p[table]]
                for i, (a, b) in enumerate(zip(col, [r[c] for r in x[table]])):
                    if a == b or not (isinstance(a, int) and isinstance(b, int)):
                        continue
                    if fits(col, i, b) and not fits(col, i, a):
                        p[table][i][c] = b
                        notes.append(f'{who} {table} {c.upper()} row {i + 1}: PDF {a}, XML {b}; using {b}, which fits the column')
                    elif fits(col, i, a) and not fits(col, i, b):
                        pass  # the PDF is right, the XML had a typo
                    else:
                        notes.append(f'{who} {table} {c.upper()} row {i + 1}: PDF {a}, XML {b}; both fit, keeping the PDF (check the card)')
        for f in ('blocks', 'extraPoint'):
            if f in p and f in x and p[f] != x[f]:
                notes.append(f'{who} {f}: PDF {json.dumps(p[f])}, XML {json.dumps(x[f])}; keeping the PDF (check the card)')
    if xml.get('defaultFormations'):
        pdf['defaultFormations'] = xml['defaultFormations']
    keys = ['id', 'firstName', 'lastName', 'jersey', 'position', 'role']
    pdf['players'] = [{**{k: p[k] for k in keys if k in p}, **{k: v for k, v in p.items() if k not in keys}} for p in pdf['players']]
    return pdf

if __name__ == '__main__':
    pdf_path, xml_path = sys.argv[1:3]
    team = merge(json.load(open(pdf_path)), json.load(open(xml_path)), '--extras-only' in sys.argv)
    json.dump(team, open(pdf_path, 'w'), indent=2, ensure_ascii=False)
    print(f"{team['name']}: {sum('jersey' in p for p in team['players'])} jersey numbers, {len(team['dataNotes'])} data notes")
