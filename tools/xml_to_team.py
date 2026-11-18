"""Converts a WPF-era team XML file (patriots.xml etc.) into the web app's team JSON format.

Usage: python tools/xml_to_team.py patriots.xml public/cards/teams/1984/patriots.json [--meta key=value ...]
"""
import json, re, sys
import xml.etree.ElementTree as ET

def txt(e, tag):
    v = e.findtext(tag)
    return v.strip() if v and v.strip() else None

def num(e, tag):
    v = txt(e, tag)
    return int(v) if v is not None else None

def rng(e, a, b):
    f, t = num(e, a), num(e, b)
    if f is None and t is None:
        return None
    return {'from': f, 'to': t if t is not None else f}

def cell(v):
    if v is None:
        return None
    v = v.strip()
    if v in ('', '-'):
        return None
    low = v.lower()
    if low == 'sg': return 'SG'
    if low == 'lg': return 'LG'
    if low == 'inc': return 'INC'
    if low == 'td': return 'TD'
    return int(v)

def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')

def rush_rows(e):
    rows = [{'n': cell(e.findtext(f'R{i:02d}_01')), 'sg': cell(e.findtext(f'R{i:02d}_02')), 'lg': cell(e.findtext(f'R{i:02d}_03'))} for i in range(1, 13)]
    return rows if any(v is not None for r in rows for v in r.values()) else None

def pass_rows(e):
    rows = [{'q': cell(e.findtext(f'PG{i:02d}Q')), 's': cell(e.findtext(f'PG{i:02d}S')), 'l': cell(e.findtext(f'PG{i:02d}L'))} for i in range(1, 13)]
    return rows if any(v is not None for r in rows for v in r.values()) else None

FORMATIONS = {  # WPF user-control names -> web formation ids
    'ucRun3rb2te': 'run-3rb-2te', 'ucRun3rbTeLeft': 'run-3rb-te-left', 'ucRun3rbTeRight': 'run-3rb-te-right',
    'ucPass3WrTeLeft': 'pass-3wr-te-left', 'ucPass3WrTeRight': 'pass-3wr-te-right', 'ucPass2Wr2Te': 'pass-2wr-2te',
    'ucPass4Wr': 'pass-4wr', 'uc2Rb2WrTeLeft': '2rb-2wr-te-left', 'uc2Rb2WrTeRight': '2rb-2wr-te-right',
    'uc2Rb2TeFlLeft': '2rb-2te-fl-left', 'uc2Rb2TeFlRight': '2rb-2te-fl-right',
}

def convert(path, meta):
    root = ET.parse(path).getroot()
    info = root.find('Info')
    year = num(info, 'Year')
    name = txt(info, 'Name')
    short = name.split()[-1]
    abbr = txt(info, 'NameShort') or meta.get('abbreviation')
    prefix = f"{(abbr or short[:3]).lower()}{str(year)[2:]}"
    players, warnings = [], []
    starters = {'offense': [], 'defense': []}

    def base(e, position):
        first, last = txt(e, 'Name'), txt(e, 'Surname')
        p = {'id': f'{prefix}-{slug(first + " " + last)}', 'firstName': first, 'lastName': last, 'position': position}
        if num(e, 'Jersey') is not None:
            p['jersey'] = num(e, 'Jersey')
        return p

    def starter(e, side, listed, p):
        if txt(e, 'IsStarter') == 'true':
            starters[side].append({'listed': listed, 'playerId': p['id']})

    for e in root.findall('qb'):
        p = base(e, 'QB')
        p.update({
            'endurance': txt(e, 'Endurance'),
            'passing': {k: {'com': rng(e, f'Pass{K}ComFrom', f'Pass{K}ComTo'), 'inc': rng(e, f'Pass{K}IncFrom', f'Pass{K}IncTo'), 'int': rng(e, f'Pass{K}IntFrom', f'Pass{K}IntTo')}
                        for k, K in (('quick', 'Quick'), ('short', 'Short'), ('long', 'Long'))},
            'passRush': {'sack': rng(e, 'SackFrom', 'SackTo'), 'runs': rng(e, 'RunsFrom', 'RunsTo'), 'com': rng(e, 'ComFrom', 'ComTo'), 'inc': rng(e, 'IncFrom', 'IncTo')},
            'rushing': rush_rows(e),
        })
        players.append(p); starter(e, 'offense', 'QB', p)
    for tag, pos in (('wr', 'WR'), ('te', 'TE'), ('rb', 'RB')):
        for e in root.findall(tag):
            p = base(e, pos)
            p.update({'playDirection': num(e, 'CanPlayEvery') or 0, 'blocks': num(e, 'BlockRun') or 0, 'rushing': rush_rows(e), 'passGain': pass_rows(e)})
            players.append(p); starter(e, 'offense', pos, p)
    for e in root.findall('ol'):
        pos = {'OT': 'OT', 'OG': 'OG', 'OC': 'C'}[txt(e, 'Preferred')]
        p = base(e, pos)
        p.update({'runBlock': num(e, 'BlockRun') or 0, 'passBlock': num(e, 'BlockPass') or 0})
        players.append(p); starter(e, 'offense', 'OC' if pos == 'C' else pos, p)
    for e in root.findall('dl'):
        p = base(e, txt(e, 'Preferred'))
        p.update({'tackle': num(e, 'Tackles') or 0, 'passRush': num(e, 'PassRush') or 0})
        players.append(p); starter(e, 'defense', p['position'], p)
    for e in root.findall('lb'):
        p = base(e, 'LB')
        p.update({'tackle': num(e, 'Tackles') or 0, 'passRush': num(e, 'PassRush') or 0, 'passDefense': num(e, 'PassDefense') or 0, 'intercept': rng(e, 'IntFrom', 'IntTo')})
        players.append(p); starter(e, 'defense', 'LB', p)
    for e in root.findall('db'):
        p = base(e, 'DB')
        role = txt(e, 'Preferred')  # CB, S or DB
        if role in ('CB', 'S'):
            p['role'] = role
        p.update({'passDefense': num(e, 'PassDefense') or 0, 'passRush': num(e, 'PassRush') or 0, 'intercept': rng(e, 'IntFrom', 'IntTo')})
        players.append(p); starter(e, 'defense', role or 'DB', p)
    for e in root.findall('k'):
        p = base(e, 'K')
        bands = [(18, 25, 'FG18_25'), (26, 35, 'FG26_35'), (36, 45, 'FG36_45'), (46, 50, 'FG46_50'), (51, 60, 'FG50Plus')]
        p.update({'fieldGoals': [{'minYards': a, 'maxYards': b, 'good': rng(e, t + 'From', t + 'To')} for a, b, t in bands],
                  'extraPoint': rng(e, 'PATFrom', 'PATTo')})
        players.append(p)
    for e in root.findall('p'):
        p = base(e, 'P')
        punts, special = [], []
        for row in sorted(e.findall('Punt'), key=lambda r: int(r.findtext('Row'))):
            if txt(row, 'IsPenalty') == 'true':
                continue
            punts.append({'yards': num(row, 'Yards'), 'returner': txt(row, 'Target')})
        if not punts:  # older XML layout: <Punt01>63</Punt01><Punt01Target>PR1</Punt01Target> ...
            for i in range(1, 12):
                if num(e, f'Punt{i:02d}') is not None:
                    punts.append({'yards': num(e, f'Punt{i:02d}'), 'returner': txt(e, f'Punt{i:02d}Target')})
        if len(punts) != 11:
            warnings.append(f"punter {p['lastName']}: {len(punts)} punt rows instead of 11")
        # The XML only says row 12 is a penalty; it has no 'special results' table.
        p.update({'punts': punts, 'special': [{'runNumber': {'from': 1, 'to': 12}, 'result': {'type': 'PENALTY'}}]})
        players.append(p)

    # Offensive line in lineup-card order: OT, OG, OC, OG, OT.
    off = starters['offense']
    line = {k: [s for s in off if s['listed'] == k] for k in ('OT', 'OG', 'OC')}
    if [len(line['OT']), len(line['OG']), len(line['OC'])] != [2, 2, 1]:
        warnings.append(f"starting line is {len(line['OT'])} OT / {len(line['OG'])} OG / {len(line['OC'])} C")
    ordered_line = [x for x in (line['OT'][:1] + line['OG'][:1] + line['OC'][:1] + line['OG'][1:2] + line['OT'][1:2])]
    offense = [s for s in off if s['listed'] not in ('OT', 'OG', 'OC')] + ordered_line

    def unit(tag, child, prefix_):
        u = root.find(tag)
        if u is None:
            warnings.append(f'no {tag} (return unit) in the XML')
            return None
        returners, table = {}, [dict() for _ in range(12)]
        by_id = {f"{pl['firstName']} {pl['lastName']}": pl['id'] for pl in players}
        for r in u.findall('Returner'):
            n = f"{txt(r, 'Name')} {txt(r, 'Surname')}"
            slots = sorted(int(s.text) for s in r.find('Slots'))
            first = f'{prefix_}{slots[0]}'
            returners[first] = {'name': n, 'playerId': by_id.get(n)}
            for s in slots[1:]:
                returners[f'{prefix_}{s}'] = {'sameAs': first}
            rows = {int(x.findtext('Row')): x for x in r.findall(child)}
            for i in range(12):
                x = rows.get(i + 1)
                yards = num(x, 'Yards') if x is not None else None
                table[i][first] = None if yards is None else {'yards': yards, 'fumble': txt(x, 'IsFumble') == 'true', 'breakaway': False}
            for s in slots[1:]:
                for i in range(12):
                    table[i][f'{prefix_}{s}'] = None
        cols = [f'{prefix_}{i}' for i in range(1, 5)]
        for c in cols:
            if c not in returners:
                warnings.append(f'{tag}: column {c} has no returner')
        table = [{c: row.get(c) for c in cols} for row in table]
        return {'returners': returners, 'table': table, 'breakaway': {c: None for c in cols}}

    team = {
        'id': f'{year}-{slug(short)}', 'year': year, 'name': name, 'shortName': short, 'abbreviation': abbr,
        'division': meta.get('division', ''), 'coach': meta.get('coach', ''), 'record': meta.get('record', ''),
        'bigPlays': {'home': num(info, 'BigPlayHome') or 0, 'road': num(info, 'BigPlayAway') or 0},
        'fumblesLost': rng(info, 'FumbleLostFrom', 'FumbleLostTo'),
        'defaultFormations': {'offense': FORMATIONS.get(txt(info, 'OffenseFormation'), txt(info, 'OffenseFormation')), 'defense': txt(info, 'DefenseFormation')},
        'players': players,
        'startingLineup': {'offense': offense, 'defenseFormation': txt(info, 'DefenseFormation'), 'defense': starters['defense']},
        'kickReturn': unit('krUnit', 'KickReturn', 'KR'),
        'puntReturn': unit('prUnit', 'PuntReturn', 'PR'),
    }
    if not abbr:
        warnings.append('no NameShort (abbreviation) in the XML')
    return team, warnings

if __name__ == '__main__':
    src, dst, *rest = sys.argv[1:]
    meta = dict(a.split('=', 1) for a in rest)
    team, warnings = convert(src, meta)
    with open(dst, 'w') as f:
        json.dump(team, f, indent=2, ensure_ascii=False)
    print(f"{team['name']}: {len(team['players'])} players")
    for w in warnings:
        print('  WARNING', w)
