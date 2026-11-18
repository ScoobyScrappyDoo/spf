"""Rebuilds public/cards/teams/index.json from every team file under public/cards/teams/<year>/.

Run it after adding or converting teams: python tools/build_catalog.py
"""
import glob, json, os

ROOT = os.path.join(os.path.dirname(__file__), '..', 'public', 'cards', 'teams')
DIVISION_ORDER = ['AFC East', 'AFC Central', 'AFC West', 'NFC East', 'NFC Central', 'NFC West']

entries = []
for path in glob.glob(os.path.join(ROOT, '*', '*.json')):
    team = json.load(open(path))
    rel = os.path.relpath(path, os.path.join(ROOT, '..', '..')).replace(os.sep, '/')
    entry = {'id': team['id'], 'year': team['year'], 'name': team['name'], 'conference': team['division'].split()[0],
             'division': team['division'], 'path': rel}
    missing = [k for k in ('kickReturn', 'puntReturn') if not team.get(k)]
    if missing:
        entry['incomplete'] = 'no ' + ' or '.join(m.replace('Return', ' return') for m in missing) + ' cards yet'
    entries.append(entry)
order = lambda d: DIVISION_ORDER.index(d) if d in DIVISION_ORDER else len(DIVISION_ORDER)
entries.sort(key=lambda e: (-e['year'], order(e['division']), e['name']))
json.dump(entries, open(os.path.join(ROOT, 'index.json'), 'w'), indent=2, ensure_ascii=False)
years = sorted({e['year'] for e in entries})
print(f'{len(entries)} teams in {len(years)} season(s): {years}')
