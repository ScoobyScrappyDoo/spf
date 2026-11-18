#!/usr/bin/env python3
"""
Listed positions for defensive backs from a Pro Football Reference roster: CB, LCB or RCB is a cornerback, S, FS or SS a
safety; anything else (plain "DB") stays a defensive back. Only backs without a listed position on their card get one,
so the official cards' starters keep theirs. Names are matched loosely ("Ray" finds "Raymond").

    python3 tools/roles_from_pfr.py public/cards/teams/1984/patriots.json "PFR data/1984/patriots/roster.csv"
"""
import csv, difflib, json, re, sys
from pathlib import Path

CORNER = {'CB', 'LCB', 'RCB'}
SAFETY = {'S', 'FS', 'SS'}

def roster_positions(path: Path) -> dict:
    rows = list(csv.reader(open(path, encoding='utf-8-sig')))
    head, body = (rows[1], rows[2:]) if rows[0] and rows[0][0] == '' else (rows[0], rows[1:])
    name, pos = head.index('Player'), head.index('Pos')
    return {re.sub(r'[*+]', '', r[name]).strip(): r[pos].upper() for r in body if len(r) > pos and r[name]}

def role_of(pos: str):
    for part in re.split(r'[/,-]', pos):
        part = part.strip()
        if part in CORNER: return 'CB'
        if part in SAFETY: return 'S'
    return None

def apply(team_path: Path, roster_path: Path) -> list:
    team = json.loads(team_path.read_text())
    positions = roster_positions(roster_path)
    done = []
    for p in team['players']:
        if p['position'] != 'DB' or p.get('role'):
            continue
        name = f"{p['firstName']} {p['lastName']}"
        match = difflib.get_close_matches(name, list(positions), n=1, cutoff=0.75)
        role = role_of(positions[match[0]]) if match else None
        if role:
            p['role'] = role
            done.append(f"{name} ({positions[match[0]]})")
    if done:
        team.setdefault('dataNotes', []).append(
            'Listed positions from the Pro Football Reference roster for backs the cards leave unlisted: ' + ', '.join(done) + '.')
        team_path.write_text(json.dumps(team, indent=2) + '\n')
    return done

if __name__ == '__main__':
    done = apply(Path(sys.argv[1]), Path(sys.argv[2]))
    print(f'{len(done)} backs got a listed position: ' + (', '.join(done) or 'none'))
