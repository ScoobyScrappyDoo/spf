#!/usr/bin/env python3
"""
A side-by-side comparison of two card sets for a season, one A4 page per team, as HTML for printing to PDF:
every player's key card values, differences in red ("old → new"), players only in one set marked.

    python3 tools/compare_cards.py old-folder new-folder 1984 out.html
"""
import difflib, glob, html, json, os, sys
from pathlib import Path

GROUPS = [('Quarterbacks', ['QB']), ('Running backs', ['RB']), ('Wide receivers', ['WR']), ('Tight ends', ['TE']),
          ('Offensive line', ['OT', 'OG', 'C']), ('Defensive line', ['DE', 'DT']), ('Linebackers', ['LB']),
          ('Defensive backs', ['DB']), ('Kickers', ['K']), ('Punters', ['P'])]

def r(x):
    return '–' if not x else (str(x['from']) if x['from'] == x['to'] else f"{x['from']}-{x['to']}")

def signed(v):
    return f'+{v}' if v > 0 else str(v)

def avg(vals):
    nums = [v for v in vals if isinstance(v, (int, float))]
    return f'{sum(nums) / len(nums):.1f}' if nums else '–'

def values(p):
    """The card values that matter most, as (label, text) pairs."""
    pos = p['position']
    if pos == 'QB':
        q, s, l = (p['passing'][k] for k in ('quick', 'short', 'long'))
        return [('End', p.get('endurance', '')), ('Q com', r(q['com'])), ('S com', r(s['com'])), ('L com', r(l['com'])),
                ('Int Q/S/L', f"{r(q['int'])}/{r(s['int'])}/{r(l['int'])}"), ('Sack', r(p['passRush']['sack']))]
    if pos in ('RB', 'WR', 'TE'):
        out = [('Dir', str(p.get('playDirection', ''))), ('Blk', signed(p.get('blocks', 0)))]
        if p.get('rushing'):
            out += [('N avg', avg([x['n'] for x in p['rushing']])), ('SG avg', avg([x['sg'] for x in p['rushing']])), ('LG1', str(p['rushing'][0]['lg']))]
        if p.get('passGain'):
            out += [('Q avg', avg([x['q'] for x in p['passGain']])), ('S avg', avg([x['s'] for x in p['passGain']])), ('L1', str(p['passGain'][0]['l']))]
        return out
    if pos in ('OT', 'OG', 'C'):
        return [('Run', signed(p['runBlock'])), ('Pass', str(p['passBlock']))]
    if pos in ('DE', 'DT'):
        return [('Tkl', signed(p['tackle'])), ('Rush', str(p['passRush']))]
    if pos == 'LB':
        return [('Tkl', signed(p['tackle'])), ('Rush', str(p['passRush'])), ('PD', signed(p['passDefense'])), ('Int', r(p['intercept']) + ('?' if p.get('interceptMaybe') else ''))]
    if pos == 'DB':
        return [('Role', p.get('role') or '–'), ('PD', signed(p['passDefense'])), ('Rush', str(p['passRush'])), ('Int', r(p['intercept']) + ('?' if p.get('interceptMaybe') else ''))]
    if pos == 'K':
        return [(f"{b['minYards']}-{b['maxYards']}", r(b['good'])) for b in p['fieldGoals']] + [('XP', r(p.get('extraPoint')))]
    if pos == 'P':
        yards = [x['yards'] for x in p['punts'][:11]]
        return [('Avg', f'{sum(yards) / len(yards):.0f}'), ('RN1', str(yards[0])), ('RN11', str(yards[-1]))]
    return []

def name(p):
    return f"{p['firstName']} {p['lastName']}"

def team_page(old, new):
    rows_html, both, only_old, only_new, changed = [], 0, 0, 0, 0
    for title, positions in GROUPS:
        a = [p for p in old['players'] if p['position'] in positions]
        b = [p for p in new['players'] if p['position'] in positions]
        if not a and not b:
            continue
        rows_html.append(f'<tr class="g"><th colspan="2">{title}</th></tr>')
        matched = set()
        for p in a:
            m = difflib.get_close_matches(name(p), [name(x) for x in b if x['id'] not in matched], n=1, cutoff=0.82)
            q = next((x for x in b if name(x) == m[0] and x['id'] not in matched), None) if m else None
            if q:
                matched.add(q['id']); both += 1
                va, vb = dict(values(p)), values(q)
                cells, diff = [], False
                for label, v in vb:
                    w = va.get(label)
                    if w is not None and w != v:
                        cells.append(f'<span class="d">{label} {html.escape(w)}→{html.escape(v)}</span>'); diff = True
                    else:
                        cells.append(f'{label} {html.escape(v)}')
                changed += diff
                pos = f" <i>{p['position']}</i>" if len(positions) > 1 else ''
                rows_html.append(f'<tr><td class="n">{html.escape(name(p))}{pos}</td><td>{" · ".join(cells)}</td></tr>')
            else:
                only_old += 1
                rows_html.append(f'<tr class="old"><td class="n">{html.escape(name(p))}</td><td>official only · ' + ' · '.join(f'{l} {html.escape(v)}' for l, v in values(p)) + '</td></tr>')
        for q in b:
            if q['id'] in matched:
                continue
            only_new += 1
            rows_html.append(f'<tr class="new"><td class="n">{html.escape(name(q))}</td><td>new · ' + ' · '.join(f'{l} {html.escape(v)}' for l, v in values(q)) + '</td></tr>')
    head = (f"<header><h1>{html.escape(old['year'] and str(old['year']))} {html.escape(old['shortName'])}</h1>"
            f"<p>Official (Avalon Hill PDF): <b>{len(old['players'])}</b> cards · Pro Football Reference: <b>{len(new['players'])}</b> cards · "
            f"in both: {both}, of which <span class='d'>{changed} differ</span> · official only: {only_old} · <span class='d'>new: {only_new}</span> · "
            f"fumbles lost {r(old.get('fumblesLost'))} → {r(new.get('fumblesLost'))}</p></header>")
    return f'<section class="page">{head}<table>{"".join(rows_html)}</table></section>'

def build(old_dir, new_dir, year):
    pages = []
    for f in sorted(glob.glob(f'{new_dir}/*.json')):
        new = json.load(open(f))
        old_path = Path(old_dir) / Path(f).name
        if not old_path.exists():
            continue
        pages.append(team_page(json.load(open(old_path)), new))
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>{year} cards: official against Pro Football Reference</title>
<style>
  @page {{ size: A4; margin: 9mm 9mm 11mm; @bottom-center {{ content: "{year} cards: official (Avalon Hill PDF) against Pro Football Reference · page " counter(page) " of " counter(pages); font: 6.5pt Arial, sans-serif; color: #6b7280; }} }}
  body {{ font: 6.3pt/1.18 'Arial Narrow', Arial, sans-serif; color: #111827; -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
  .page {{ break-after: page; }}
  header h1 {{ margin: 0 0 .6mm; font-size: 13pt; letter-spacing: .04em; text-transform: uppercase; color: #24573a; }}
  header p {{ margin: 0 0 1.8mm; font-size: 7.4pt; }}
  table {{ width: 100%; border-collapse: collapse; column-count: 2; }}
  tr.g th {{ text-align: left; background: #24573a; color: white; font-size: 6.6pt; padding: .4mm 1mm; letter-spacing: .06em; text-transform: uppercase; }}
  td {{ padding: .1mm 1mm; border-bottom: .2mm solid #e5e7eb; vertical-align: top; }}
  td.n {{ width: 25%; font-weight: 700; white-space: nowrap; }}
  td.n i {{ font-weight: 400; color: #6b7280; font-style: normal; }}
  .d {{ color: #c1121f; font-weight: 700; }}
  tr.old td {{ color: #9ca3af; font-style: italic; }}
  tr.new td {{ color: #c1121f; }}
</style></head><body>{''.join(pages)}</body></html>"""

if __name__ == '__main__':
    old, new, year, out = sys.argv[1:5]
    Path(out).write_text(build(old, new, year))
    print('written', out)
