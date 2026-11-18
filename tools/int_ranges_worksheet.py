#!/usr/bin/env python3
"""
One interception rule for every season (a decision for this game): the Avalon Hill worksheet table, which the
1987-1991 cards follow. The official 1984 cards gave one number per interception (48 minus the interceptions); this
rewrites a 1984-style set to the worksheet table: 0-1 interceptions "48?", 2 "48", 3 "47-48" ... 12 "38-48", more
"37-48". The interceptions are read back from each card (48 minus the first number of its range).

    python3 tools/int_ranges_worksheet.py public/cards/teams/1984
"""
import json, sys
from pathlib import Path

WORKSHEET = {2: 48, 3: 47, 4: 46, 5: 45, 6: 44, 7: 43, 8: 42, 9: 41, 10: 40, 11: 39, 12: 38}
NOTE = ('Interception ranges follow the Avalon Hill worksheet table, one rule for every season (the official 1984 cards '
        'gave one number per interception): 0-1 interceptions "48?", 2 "48", 3 "47-48" and so on.')

def convert(path: Path) -> int:
    team = json.loads(path.read_text())
    if NOTE in team.get('dataNotes', []):
        return 0  # done already
    changed = 0
    for p in team['players']:
        r = p.get('intercept')
        if p['position'] not in ('LB', 'DB') or not r or r['to'] != 48:
            continue
        interceptions = 48 - r['from']
        if interceptions <= 1:
            p['intercept'] = {'from': 48, 'to': 48}
            p['interceptMaybe'] = True
        else:
            p['intercept'] = {'from': WORKSHEET.get(interceptions, 37), 'to': 48}
            p.pop('interceptMaybe', None)
        changed += 1
    team.setdefault('dataNotes', []).append(NOTE)
    path.write_text(json.dumps(team, indent=2) + '\n')
    return changed

if __name__ == '__main__':
    folder = Path(sys.argv[1])
    total = 0
    for f in sorted(folder.glob('*.json')):
        n = convert(f)
        total += n
        print(f'{f.name}: {n} ranges')
    print(f'{total} interception ranges now follow the worksheet table')
