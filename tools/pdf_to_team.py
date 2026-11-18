"""Converts a Statis Pro team PDF (one team, one season) into the web app's team JSON.

Usage: python tools/pdf_to_team.py Patriots1984.PDF public/cards/teams/1984/patriots.json
The team's abbreviation and full name come from TEAMS below; everything else comes from the cards.
"""
import json, re, sys
from pdf_cells import cards

# file stem -> (abbreviation, full name). The cards sometimes shorten names ("L.A.Raiders").
TEAMS = {
    '49ers': ('SF', 'San Francisco 49ers'), 'Bears': ('CHI', 'Chicago Bears'), 'Bengals': ('CIN', 'Cincinnati Bengals'),
    'Bills': ('BUF', 'Buffalo Bills'), 'Broncos': ('DEN', 'Denver Broncos'), 'Browns': ('CLE', 'Cleveland Browns'),
    'Buccaneers': ('TB', 'Tampa Bay Buccaneers'), 'Cardinals': ('STL', 'St. Louis Cardinals'), 'Chargers': ('SD', 'San Diego Chargers'),
    'Chiefs': ('KC', 'Kansas City Chiefs'), 'Colts': ('IND', 'Indianapolis Colts'), 'Cowboys': ('DAL', 'Dallas Cowboys'),
    'Dolphins': ('MIA', 'Miami Dolphins'), 'Eagles': ('PHI', 'Philadelphia Eagles'), 'Falcons': ('ATL', 'Atlanta Falcons'),
    'Giants': ('NYG', 'New York Giants'), 'Jets': ('NYJ', 'New York Jets'), 'Lions': ('DET', 'Detroit Lions'),
    'Oilers': ('HOU', 'Houston Oilers'), 'Packers': ('GB', 'Green Bay Packers'), 'Patriots': ('NE', 'New England Patriots'),
    'Raiders': ('RAI', 'Los Angeles Raiders'), 'Rams': ('RAM', 'Los Angeles Rams'), 'Redskins': ('WAS', 'Washington Redskins'),
    'Saints': ('NO', 'New Orleans Saints'), 'Seahawks': ('SEA', 'Seattle Seahawks'), 'Steelers': ('PIT', 'Pittsburgh Steelers'),
    'Vikings': ('MIN', 'Minnesota Vikings'),
}

# NFL divisions 1970-2001. Some title cards carry a template slip ("AFC West" on the Bills, Eagles, Vikings ...),
# so the division comes from here and any card that disagrees gets a data note.
DIVISIONS = {
    'AFC East': ['Bills', 'Colts', 'Dolphins', 'Jets', 'Patriots'],
    'AFC Central': ['Bengals', 'Browns', 'Oilers', 'Steelers'],
    'AFC West': ['Broncos', 'Chargers', 'Chiefs', 'Raiders', 'Seahawks'],
    'NFC East': ['Cardinals', 'Cowboys', 'Eagles', 'Giants', 'Redskins'],
    'NFC Central': ['Bears', 'Buccaneers', 'Lions', 'Packers', 'Vikings'],
    'NFC West': ['49ers', 'Falcons', 'Rams', 'Saints'],
}
DIVISION_OF = {team: d for d, teams in DIVISIONS.items() for team in teams}

# Text the PDF splits inside words.
FIXES = [('I nc', 'Inc'), ('Penalt y', 'Penalty'), ('P enalty', 'Penalty'), ('Aval on', 'Avalon')]

def clean(s):
    for a, b in FIXES:
        s = s.replace(a, b)
    return s

def slug(s):
    s = s.replace('’', '').replace("'", '')
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')

def rng(s):
    s = (s or '').strip().rstrip('!?')
    if not s:
        return None
    m = re.fullmatch(r'(\d+)\s*-\s*(\d+)', s)
    if m:
        return {'from': int(m[1]), 'to': int(m[2])}
    if re.fullmatch(r'\d+', s):
        return {'from': int(s), 'to': int(s)}
    raise ValueError(f'not a range: {s!r}')

def cell(v):
    v = v.strip()
    if v in ('', '-'):
        return None
    low = v.lower()
    # Some cards abbreviate incomplete as 'i' and say so in a legend ("I = inc").
    return {'sg': 'SG', 'lg': 'LG', 'inc': 'INC', 'i': 'INC', 'td': 'TD'}.get(low) or int(v)

def plusminus(s):
    m = re.search(r'(Plus|Minus)\s*(\d+)', s)
    if not m:
        raise ValueError(f'no Plus/Minus value in {s[:40]!r}')
    return int(m[2]) * (1 if m[1] == 'Plus' else -1)

def rows(text, keys):
    found = {}
    for line in text.split('\n'):
        m = re.match(r'^\s*(\d{1,2})\s*:\s*(.*)$', line)
        if m and 1 <= int(m[1]) <= 12:
            found[int(m[1])] = [x for x in m[2].strip().split('/')] if m[2].strip() else []
    if not any(found.values()):
        return None
    out = []
    for i in range(1, 13):
        vals = found.get(i, []) + [''] * 3
        out.append({k: cell(vals[j]) for j, k in enumerate(keys)})
    return out

def value_after(full, label):
    lines = [l.strip() for l in full.split('\n')]
    for k, l in enumerate(lines):
        if l.upper().replace(' ', '').startswith(label.replace(' ', '')):
            rest = l.split(':', 1)[1].strip() if ':' in l else ''
            return rest if rest else lines[k + 1]
    raise KeyError(label)

SKILL = {'Wide Receiver': 'WR', 'Tight End': 'TE', 'Running Back': 'RB'}
LINE = {'Tackle': 'OT', 'Guard': 'OG', 'Center': 'C'}
DLINE = {'Defense End': 'DE', 'Defensive End': 'DE', 'Defense Tackle': 'DT', 'Defensive Tackle': 'DT'}

def convert(path, stem):
    abbr, full_name = TEAMS[stem]
    cs = cards(path)
    for c in cs:
        for k in c:
            c[k] = clean(c[k])
    warnings = []
    title = [l.strip() for l in cs[0]['full'].split('\n')]
    year = int(title[0][:4])
    prefix = f'{abbr.lower()}{str(year)[2:]}'
    tfull = cs[0]['full']
    team = {
        'id': f'{year}-{slug(full_name.split()[-1])}', 'year': year, 'name': full_name, 'shortName': full_name.split()[-1],
        'abbreviation': abbr, 'division': DIVISION_OF[stem], '_cardDivision': title[2], 'coach': title[title.index('Coach') + 1], 'record': title[title.index('Record') + 1],
        'bigPlays': {'home': int(re.search(r'Home:\s*(\d+)', tfull)[1]), 'road': int(re.search(r'Road:\s*(\d+)', tfull)[1])},
        'fumblesLost': rng(re.search(r'Fumbles Lost:\s*([\d-]+)', tfull)[1]),
        'players': [],
    }
    if 'Champions' in title[0]:
        team['note'] = title[0][5:].strip()
    lineup = [l.strip() for l in cs[1]['full'].split('\n')]
    d_head = next(i for i, l in enumerate(lineup) if l.endswith('Defense'))
    listed = {}
    for l in lineup[2:]:
        if ':' in l:
            pos, names = l.split(':', 1)
            listed.setdefault(pos.strip(), []).append(names.strip())

    P = team['players']
    for c in cs[2:]:
        try:
            parse_card(c, P, listed, prefix, warnings, stem)
        except Exception as e:
            head = ' | '.join(c['full'].split('\n')[:3])
            raise ValueError(f'{stem}: card "{head}": {e}') from None

    return finish(team, cs, P, lineup, d_head, listed, warnings, stem)

# Typing slips found on the original 1984 cards: (pattern, replacement, what it means).
SLIPS = [
    (r'(?<=/)L(?=/)', 'Lg', '"L" read as "Lg"'),          # Earnest Byner: Lg/L/26
    (r'(?<=\d)\.(?=/|$)', '', 'stray full stop dropped'),  # Chuck Muncie: -2/8./11
    (r'(?<=\d)i\b', '/i', 'missing slash before "i"'),     # Anthony Hancock: 9/17i
    (r'^(\s*-?\d)(\d{2})(/\d+)$', r'\1/\2\3', 'missing slash in a three-digit value'),  # Tony Hutchison: 410/10
]

SLIP_NOTES = []

def parse_card(c, P, listed, prefix, warnings, stem):
        for side in ('left', 'right'):
            lines = c[side].split('\n')
            for k, line in enumerate(lines):
                m = re.match(r'^(\s*\d{1,2}\s*:)(.*)$', line)
                if not m:
                    continue
                fixed = m[2]
                for pat, repl, what in SLIPS:
                    new = re.sub(pat, repl, fixed, flags=re.M)
                    if new != fixed:
                        head = c['full'].split('\n')[2].strip()
                        warnings.append(f'{head}: row "{line.strip()}": {what}')
                        SLIP_NOTES.append(f'{head}: row "{line.strip()}": {what}')
                        fixed = new
                lines[k] = m[1] + fixed
            c[side] = '\n'.join(lines)
        full = c['full']
        L = [l.strip() for l in full.split('\n')]
        kind, name = L[1], L[2] if len(L) > 2 else ''
        unit = 'Return Unit' in kind
        if unit:
            return
        m = re.fullmatch(r'(Wide Receiver|Tight End|Running Back)\s*-\s*(\d)', kind)
        known = m or kind in ('Quarterback', 'Linebacker', 'Defense Back', 'Place-Kicker', 'Punter') or kind in LINE or kind in DLINE
        if not known:
            # Template slip on the original card: the position line holds the real name, the name line is a leftover.
            stats = full.upper()
            guessed = None
            if 'PASS BLOCK' in stats:
                guessed = next((LINE_POS for LINE_POS, labels in (('OT', ['OT']), ('OG', ['OG']), ('C', ['OC'])) if any(kind.split()[-1] in n for lab in labels for n in listed.get(lab, []))), 'OG')
            elif 'TACKLES' in stats and 'PASS DEF' not in stats:
                guessed = next((pos for pos in ('DE', 'DT') if any(kind.split()[-1] in n for n in listed.get(pos, []))), 'DT')
            if not guessed:
                raise ValueError(f'{stem}: unknown card kind {kind!r}')
            warnings.append(f'card "{kind}" / "{name}" has a name where the position belongs; imported as {kind}, {guessed}')
            SLIP_NOTES.append(f'card shows "{kind}" in the position line and "{name}" as the name; imported as {kind}, {guessed}')
            name, kind = kind, {'OT': 'Tackle', 'OG': 'Guard', 'C': 'Center', 'DE': 'Defense End', 'DT': 'Defense Tackle'}[guessed]
        if ' ' not in name and '.' in name:  # "L.E.Madison"
            name = name[: name.rindex('.') + 1] + ' ' + name[name.rindex('.') + 1 :]
        first, last = name.split(' ', 1)
        pid = f'{prefix}-{slug(name)}'
        if any(p['id'] == pid for p in P):  # one man, two cards (Danny White: QB and punter)
            pid = f'{pid}-{slug(kind)}'
        base = {'id': pid, 'firstName': first, 'lastName': last}
        if kind == 'Quarterback':
            left = c['left']
            def grab(section):
                seg = left.split(section, 1)[1]
                g = lambda k: re.search(k + r':\s*([\d-]*)', seg)[1]
                return {'com': rng(g('Com')), 'inc': rng(g('Inc')), 'int': rng(g('Int'))}
            pr = left.split('Pass Rush', 1)[1]
            g = lambda k: rng(re.search(k + r':\s*([\d-]*)', pr)[1])
            P.append({**base, 'position': 'QB', 'endurance': re.search(r'Endurance:\s*([ABC])', full)[1],
                      'passing': {'quick': grab('Quick'), 'short': grab('Short'), 'long': grab('Long')},
                      'passRush': {'sack': g('Sack'), 'runs': g('Runs'), 'com': g('Com'), 'inc': g('Inc')},
                      'rushing': rows(c['right'], ['n', 'sg', 'lg'])})
        elif m:
            left = c['left']
            P.append({**base, 'position': SKILL[m[1]], 'playDirection': int(m[2]),
                      'blocks': plusminus(left.split('Blocks:')[1]),
                      'rushing': rows(left.split('Blocks:')[0], ['n', 'sg', 'lg']), 'passGain': rows(c['right'], ['q', 's', 'l'])})
        elif kind in LINE:
            P.append({**base, 'position': LINE[kind], 'runBlock': plusminus(value_after(full, 'BLOCKS')), 'passBlock': int(value_after(full, 'PASS BLOCK'))})
        elif kind in DLINE:
            P.append({**base, 'position': DLINE[kind], 'tackle': plusminus(value_after(full, 'TACKLES')), 'passRush': int(value_after(full, 'PASS RUSH'))})
        elif kind == 'Linebacker':
            P.append({**base, 'position': 'LB', 'tackle': plusminus(value_after(full, 'TACKLES')), 'passRush': int(value_after(full, 'PASS RUSH')),
                      'passDefense': plusminus(value_after(full, 'PASS DEF')), 'intercept': rng(value_after(full, 'INTERCEPTS'))})
        elif kind == 'Defense Back':
            P.append({**base, 'position': 'DB', 'passDefense': plusminus(value_after(full, 'PASS DEF')), 'passRush': int(value_after(full, 'PASS RUSH')),
                      'intercept': rng(value_after(full, 'INTERCEPTS'))})
        elif kind == 'Place-Kicker':
            fg = [{'minYards': int(x[0]), 'maxYards': int(x[1]), 'good': rng(x[2])} for x in re.findall(r'(\d+)-(\d+) yds\s+([\d-]+)', full)]
            over = re.search(r'Over 50 yds \*?\s*([\d-]+)', full)
            if over:
                fg.append({'minYards': 51, 'maxYards': 60, 'good': rng(over[1])})
            P.append({**base, 'position': 'K', 'fieldGoals': fg, 'extraPoint': rng(re.search(r'Good:\s*([\d-]+)', full)[1])})
        elif kind == 'Punter':
            punts = [{'yards': int(x[2]), 'returner': x[3].replace('-', '')} for x in re.finditer(r'(\d+):\s*(\d+) yds to (PR-\d|FC)', full)]
            if len(punts) != 11:
                warnings.append(f'punter {name}: {len(punts)} punt rows')
            special = []
            for x in re.finditer(r'(\d+(?:-\d+)?):\s*(.+)', full.split('Special Results')[1] if 'Special Results' in full else ''):
                res = x[2].strip()
                mm = re.match(r'(\d+) yds, no return', res)
                kind_ = {'type': 'NO_RETURN', 'yards': int(mm[1])} if mm else {'type': 'PENALTY'} if res.startswith('Penalty') else {'type': 'BLOCKED'} if res.lower().startswith('block') else None
                if kind_ is None:
                    warnings.append(f'punter {name}: unknown special result {res!r}')
                    continue
                special.append({'runNumber': rng(x[1]), 'result': kind_})
            P.append({**base, 'position': 'P', 'punts': punts, 'special': special})


def finish(team, cs, P, lineup, d_head, listed, warnings, stem):
    # Starting lineup, matched to cards by full name, then surname (lineup cards use short forms like "McMahon/Fuller").
    by_full = {}
    for p in P:
        by_full.setdefault(f"{p['firstName']} {p['lastName']}", []).append(p)
    same_position = {'OC': 'C', 'CB': 'DB', 'DS': 'DB', 'S': 'DB', 'NT': 'DT'}

    def find(n, listed_as, allowed):
        """Matches a lineup name to a card, preferring a card whose position matches the lineup's."""
        n = n.split('/')[0].strip()
        want = same_position.get(listed_as, listed_as)
        last = n.split()[-1]
        exact = [p for p in by_full.get(n, []) if p['position'] == want]
        if exact:
            return exact[0]['id']
        by_last = [p for p in P if p['lastName'].split()[-1] == last and p['position'] == want]
        if len(by_last) == 1:
            p = by_last[0]
            other = by_full.get(n)
            if other:
                note = f"lineup lists {listed_as}: {n}, whose card is a {other[0]['position']}; matched {p['position']} {p['firstName']} {p['lastName']}"
                warnings.append(note); team.setdefault('dataNotes', []).append(note)
            elif ' ' in n:
                warnings.append(f"lineup name '{n}' matched to card '{p['firstName']} {p['lastName']}'")
            return p['id']
        loose = [p for p in by_full.get(n, []) if p['position'] in allowed]
        if loose:
            return loose[0]['id']
        cand = [p for p in P if p['lastName'].split()[-1] == last and p['position'] in allowed]
        if len(cand) == 1:
            if ' ' in n:
                warnings.append(f"lineup name '{n}' matched to card '{cand[0]['firstName']} {cand[0]['lastName']}'")
            return cand[0]['id']
        import difflib
        pool = {f"{p['firstName']} {p['lastName']}": p for p in P if p['position'] in allowed}
        close = difflib.get_close_matches(n, list(pool), n=1, cutoff=0.75)
        if close:
            warnings.append(f"lineup name '{n}' matched to card '{close[0]}' (closest spelling)")
            return pool[close[0]]['id']
        warnings.append(f"lineup name '{n}' not found among the cards")
        return None
    allowed = {'QB': ['QB'], 'WR': ['WR', 'TE', 'RB'], 'TE': ['TE', 'WR'], 'RB': ['RB'], 'OT': ['OT', 'OG'], 'OG': ['OG', 'OT', 'C'], 'OC': ['C', 'OG'],
               'DE': ['DE', 'DT'], 'DT': ['DT', 'DE'], 'NT': ['DT', 'DE'], 'LB': ['LB'], 'CB': ['DB'], 'DS': ['DB'], 'S': ['DB']}
    off, de = [], []
    for i, l in enumerate(lineup):
        if ':' not in l or i < 2:
            continue
        pos, n = [x.strip() for x in l.split(':', 1)]
        pid = find(n, pos, allowed.get(pos, [pos]))
        if pid:
            (off if i < d_head else de).append({'listed': pos, 'playerId': pid})
    # Defensive backs get their role from the lineup card where it names them.
    for e in de:
        if e['listed'] in ('CB', 'DS'):
            p = next(p for p in P if p['id'] == e['playerId'])
            p['role'] = 'CB' if e['listed'] == 'CB' else 'S'
    team['startingLineup'] = {'offense': off, 'defenseFormation': lineup[d_head].replace(' Defense', ''), 'defense': de}

    def unit(card, prefix_):
        text = card['full']
        names = {}
        for x in re.finditer(prefix_ + r'(\d): (.+)', text):
            v = x[2].strip()
            sm = re.match(r'[Ss]ame as ' + prefix_ + r'\s*-?\s*(\d)', v)
            names[prefix_ + x[1]] = {'sameAs': prefix_ + sm[1]} if sm else {'name': v, 'playerId': by_full[v][0]['id'] if v in by_full else None}
        table = []
        for x in re.finditer(r'^(\d{1,2}):\s+(.+)$', text, re.M):
            vals = x[2].split()
            def rv(v):
                if v == '-':
                    return None
                mm = re.fullmatch(r'(-?\d+)(f?)(\*?)', v)
                if not mm:
                    raise ValueError(f'{stem} {prefix_} value {v!r}')
                return {'yards': int(mm[1]), 'fumble': bool(mm[2]), 'breakaway': bool(mm[3])}
            table.append({prefix_ + str(i + 1): rv(v) for i, v in enumerate(vals[:4])})
        if len(table) != 12:
            warnings.append(f'{prefix_} table has {len(table)} rows')
        br = re.search(r'Breakaway Return\s*\n\*?\s*(.+)', text)
        vals = br[1].split() if br else []
        breakaway = {prefix_ + str(i + 1): (int(v) if re.fullmatch(r'-?\d+', v) else None) for i, v in enumerate((vals + ['-'] * 4)[:4])}
        return {'returners': names, 'table': table, 'breakaway': breakaway}
    kr = next(c for c in cs if 'Kick Return Unit' in c['full'])
    pr = next(c for c in cs if 'Punt Return Unit' in c['full'])
    team['kickReturn'] = unit(kr, 'KR')
    team['puntReturn'] = unit(pr, 'PR')
    team['dataNotes'] = list(SLIP_NOTES) + team.get('dataNotes', [])
    card_division = team.pop('_cardDivision')
    if card_division != team['division']:
        team['dataNotes'].insert(0, f"title card says {card_division}; the {team['year']} {team['shortName']} played in the {team['division']}")
    repair_ranges(team, warnings)
    ids = [p['id'] for p in P]
    for d in {i for i in ids if ids.count(i) > 1}:
        warnings.append(f'two cards share the id {d}')
    return team, warnings

def repair_ranges(team, warnings):
    """A QB's ranges must cover 1-48 exactly once. Some printed cards overlap or leave a gap; repair and record it.
    Gap: the range before it is extended. Overlap: the later range starts after the earlier one ends."""
    notes = team.setdefault('dataNotes', [])
    for p in team['players']:
        if p['position'] != 'QB':
            continue
        tables = [(f'{k} pass', p['passing'][k], ['com', 'inc', 'int']) for k in ('quick', 'short', 'long')]
        tables.append(('pass rush', p['passRush'], ['sack', 'runs', 'com', 'inc']))
        for label, t, order in tables:
            keys = [k for k in order if t.get(k)]
            before = ', '.join(f"{k} {t[k]['from']}-{t[k]['to']}" for k in keys)
            changed = False
            for a, b in zip(keys, keys[1:]):
                if t[b]['from'] > t[a]['to'] + 1:
                    t[a] = {**t[a], 'to': t[b]['from'] - 1}; changed = True
                elif t[b]['from'] <= t[a]['to']:
                    t[b] = {**t[b], 'from': t[a]['to'] + 1}; changed = True
            if keys and t[keys[-1]]['to'] < 48:
                t[keys[-1]] = {**t[keys[-1]], 'to': 48}; changed = True
            if changed:
                after = ', '.join(f"{k} {t[k]['from']}-{t[k]['to']}" for k in keys)
                note = f"{p['firstName']} {p['lastName']} {label}: card reads {before}; repaired to {after}"
                notes.append(note); warnings.append(note)

if __name__ == '__main__':
    src, dst = sys.argv[1:3]
    stem = re.match(r'(.+?)\d{4}', src.split('/')[-1])[1]
    team, warnings = convert(src, stem)
    json.dump(team, open(dst, 'w'), indent=2, ensure_ascii=False)
    print(f"{team['name']}: {len(team['players'])} players")
    for w in warnings:
        print('  WARNING', w)
