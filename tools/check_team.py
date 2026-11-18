"""Sanity checks for a team JSON file: flags values that break the patterns real cards follow.

Not everything flagged is wrong (real cards have quirks), but each one is worth comparing against the printed card.
Usage: python tools/check_team.py public/cards/teams/1984/dolphins.json
"""
import json, sys

def ranges_ok(parts):
    parts = [p for p in parts if p]
    return parts and parts[0]['from'] == 1 and parts[-1]['to'] == 48 and all(a['to'] + 1 == b['from'] for a, b in zip(parts, parts[1:]))

def column_issues(values):
    """Yards should not go up as the run number grows (rows 2-12; row 1 may hold Sg/Lg). Flags rises and lone repeats."""
    out = []
    nums = [(i + 1, v) for i, v in enumerate(values) if isinstance(v, int)]
    for (r1, a), (r2, b) in zip(nums, nums[1:]):
        if r1 == 1:
            continue
        if b > a:
            out.append(f'row {r2} ({b}) is higher than row {r1} ({a})')
    # A repeat followed by a two-yard drop, in a column that otherwise steps down one yard at a time,
    # is how a mistyped value usually looks (16, 15, 14, 13, 13, 11). 0, 0, -2 near the bottom is normal on real cards.
    seq = [v for r, v in nums if r > 1]
    diffs = [a - b for a, b in zip(seq, seq[1:])]
    if diffs and sum(d == 1 for d in diffs) / len(diffs) >= 0.6:
        rows = [r for r, v in nums if r > 1]
        for k in range(len(diffs) - 1):
            if diffs[k] == 0 and diffs[k + 1] == 2 and seq[k + 1] != 0:
                out.append(f'row {rows[k + 1]} ({seq[k + 1]}) repeats row {rows[k]} where the column steps down by one (expected {seq[k + 1] - 1}?)')
    return out

def check(team):
    issues = []
    name = lambda p: f"{p['firstName']} {p['lastName']}"
    cols = {}
    for p in team['players']:
        if p['position'] == 'QB':
            for k, t in p['passing'].items():
                if not ranges_ok([t['com'], t['inc'], t['int']]):
                    issues.append(f"{name(p)}: {k} passing ranges don't cover 1-48 cleanly")
            if not ranges_ok(list(p['passRush'].values())):
                issues.append(f"{name(p)}: pass rush ranges don't cover 1-48 cleanly")
            for c in ('n', 'sg', 'lg'):
                for msg in column_issues([r[c] for r in p['rushing'] or []]):
                    issues.append(f"{name(p)}: rushing {c.upper()} {msg}")
        if p['position'] in ('RB', 'WR', 'TE'):
            for table, keys in (('rushing', ('n', 'sg', 'lg')), ('passGain', ('q', 's', 'l'))):
                for c in keys:
                    values = [r[c] for r in p[table] or []]
                    if any(v is not None for v in values):
                        cols.setdefault(tuple(values), []).append(f"{name(p)} {table} {c.upper()}")
                    for msg in column_issues(values):
                        issues.append(f"{name(p)}: {table} {c.upper()} {msg}")
    for values, owners in cols.items():
        if len(owners) > 1 and sum(isinstance(v, int) for v in values) >= 8:
            issues.append(f"identical columns (copy-paste?): {', '.join(owners)}")
    for unit in ('kickReturn', 'puntReturn'):
        u = team.get(unit)
        if not u:
            issues.append(f'no {unit} unit')
            continue
        for col in u['table'][0]:
            vals = [row[col]['yards'] if row[col] else None for row in u['table']]
            for msg in column_issues(vals):
                issues.append(f'{unit} {col}: {msg}')
    for p in team['players']:
        if p['position'] == 'P':
            for msg in column_issues([None] + [x['yards'] for x in p['punts']]):
                issues.append(f"{name(p)}: punt {msg}")
    return issues

if __name__ == '__main__':
    for path in sys.argv[1:]:
        team = json.load(open(path))
        issues = check(team)
        print(f"{team['name']}: {len(issues)} to check")
        for i in issues:
            print('  -', i)
