#!/usr/bin/env python3
"""
A whole season from Pro Football Reference's league-wide tables (passing, rushing, receiving, defense, kicking,
punting, returns, team offense and defense) plus each team's roster and starters, with the card formulas of
pfr_to_team.py. Who gets a card:

  * full cards: QB 30 pass attempts, RB 20 carries, WR/TE 20 catches, K 10 kicks, P 10 punts, OL/DL/LB/DB 4 games,
    all for that team; starters always;
  * minimums per team: QB 2, RB 3, WR 4, TE 2, OL 7, DL 5, LB 5, DB 6, K 1, P 1. A team still short gets the next
    players at that position by usage (with at least one catch, carry or attempt for the team), who come out as
    seldom-used cards through the small-sample rules;
  * returners from the return table, with or without a card.

Names, divisions, coaches, records and big plays come from the season's current team files.

    python3 tools/pfr_season.py "PFR data/1984" 1984 public/cards/teams/1984 out-folder
"""
import collections, csv, json, os, re, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import pfr_to_team as conv

THRESHOLD = {'QB': ('att', 30), 'RB': ('car', 20), 'WR': ('rec', 20), 'TE': ('rec', 20), 'K': ('kicks', 10), 'P': ('punts', 10)}
GAMES = 4
MINIMUM = {'QB': 2, 'RB': 3, 'WR': 4, 'TE': 2, 'OL': 7, 'DL': 5, 'LB': 5, 'DB': 6, 'K': 1, 'P': 1}
# Big plays (the write-up's "Big Play Ratings"): teams with 9 or more wins, ranked by wins (ties by SRS, the strength
# rating), home and road from this table; at most 12 teams. The Super Bowl teams get 4 and 4.
BIG_PLAYS = [(4, 4), (4, 3), (3, 3), (3, 2), (2, 2), (2, 1), (1, 1), (1, 1), (1, 1), (1, 0), (1, 0), (1, 0)]
SUPER_BOWL = {1984: ['San Francisco 49ers', 'Miami Dolphins']}

def big_plays(standings, year):
    rows = [(r['Tm'].rstrip('*+'), int(num(r['W'])), num(r.get('SRS'))) for r in standings if r.get('Tm') and num(r.get('W')) >= 9]
    ranked = sorted(rows, key=lambda x: (-x[1], -x[2]))
    out = {name: {'home': h, 'road': r} for (name, _, _), (h, r) in zip(ranked, BIG_PLAYS)}
    for name in SUPER_BOWL.get(year, []):
        out[name] = {'home': 4, 'road': 4}
    return out, [n for n, _, _ in ranked]

GROUP = {'QB': 'QB', 'RB': 'RB', 'HB': 'RB', 'FB': 'RB', 'WR': 'WR', 'TE': 'TE', 'K': 'K', 'P': 'P',
         'T': 'OL', 'OT': 'OL', 'LT': 'OL', 'RT': 'OL', 'G': 'OL', 'OG': 'OL', 'LG': 'OL', 'RG': 'OL', 'C': 'OL', 'OL': 'OL',
         'DE': 'DL', 'LDE': 'DL', 'RDE': 'DL', 'DT': 'DL', 'NT': 'DL', 'LDT': 'DL', 'RDT': 'DL', 'DL': 'DL',
         'LB': 'LB', 'OLB': 'LB', 'ILB': 'LB', 'MLB': 'LB', 'LOLB': 'LB', 'ROLB': 'LB', 'LILB': 'LB', 'RILB': 'LB', 'LLB': 'LB', 'RLB': 'LB',
         'CB': 'DB', 'LCB': 'DB', 'RCB': 'DB', 'S': 'DB', 'SS': 'DB', 'FS': 'DB', 'DB': 'DB'}

def group(pos):
    for part in re.split(r'[/,-]', (pos or '').upper()):
        if GROUP.get(part.strip()):
            return GROUP[part.strip()]
    return None

def raw(path):
    rows = list(csv.reader(open(path, encoding='utf-8-sig')))
    grouped = rows and rows[0] and rows[0][0] == ''
    head, body = (rows[1], rows[2:]) if grouped else (rows[0], rows[1:])
    names = [(f'{rows[0][i]}:{h}' if grouped and i < len(rows[0]) and rows[0][i] and not rows[0][i].startswith('-') else h) for i, h in enumerate(head)]
    out = []
    for r in body:
        if not r or len(r) < 3:
            continue
        d = {}
        for k, v in zip(names, r):
            d.setdefault(k, v)
        out.append(d)
    return out

num = lambda v: float(v) if str(v).replace('.', '', 1).lstrip('-').isdigit() else 0.0
pid = lambda r: r.get('-9999') or r.get('Player-additional') or ''

def find(folder: Path, *names):
    for n in names:
        for f in folder.iterdir():
            if f.name.lower() == n.lower():
                return f
    return None

def write(path: Path, groups, head, rows):
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        if groups:
            w.writerow(groups)
        w.writerow(head)
        w.writerows(rows)

def season(src: Path, year: int, current: Path, out: Path):
    lg = {k: raw(find(src, f + '.txt', f + '.csv')) for k, f in [
        ('pass', 'passing'), ('rush', 'rushing'), ('rec', 'receiving'), ('def', 'defense'), ('kick', 'kicking'),
        ('punt', 'punting'), ('ret', 'kickpuntreturns')]}
    toff = {r['Tm']: r for r in raw(find(src, 'team offense.txt', 'team_offense.csv'))}
    tdef = {r['Tm']: r for r in raw(find(src, 'team defense.txt', 'team_defense.csv'))}
    folders = sorted(d for d in os.listdir(src) if (src / d).is_dir())
    standings_file = find(src, 'standings.txt', 'standings.csv')
    standings = raw(standings_file) if standings_file else []
    bigs, ranking = big_plays(standings, year) if standings_file else (None, [])
    records = {r['Tm'].rstrip('*+'): f"{int(num(r['W']))}-{int(num(r['L']))}" + (f"-{int(num(r['T']))}" if num(r.get('T')) else '') for r in standings if r.get('Tm')}
    catalog = json.load(open(current.parent / 'index.json'))
    summary = []
    for folder in folders:
        roster = [r for r in raw(find(src / folder, 'roster.txt', 'roster.csv')) if r.get('Player') and r['Player'] != 'Team Total']
        starters_rows = raw(find(src / folder, 'starters.txt', 'starters.csv'))
        starters = {r['Player-additional'] for r in starters_rows if r.get('Pos')}
        ids = {r['Player-additional'] for r in roster}
        votes = collections.Counter(r['Team'] for rows in lg.values() for r in rows if pid(r) in ids and not r['Team'].endswith('TM'))
        code = votes.most_common(1)[0][0]
        team_file = current / f'{folder}.json'
        old = json.load(open(team_file))
        mine = lambda k: [r for r in lg[k] if r['Team'] == code]
        stat = collections.defaultdict(float)
        for r in mine('pass'): stat[(pid(r), 'att')] += num(r.get('Att'))
        for r in mine('rush'): stat[(pid(r), 'car')] += num(r.get('Rushing:Att'))
        for r in mine('rec'): stat[(pid(r), 'rec')] += num(r.get('Receiving:Rec'))
        for r in mine('kick'): stat[(pid(r), 'kicks')] += num(r.get('Scoring:FGA')) + num(r.get('Scoring:XPA'))
        for r in mine('punt'): stat[(pid(r), 'punts')] += num(r.get('Punting:Pnt'))

        # ---- who gets a card ----
        def usage(r, g):
            i = r['Player-additional']
            return {'QB': stat[(i, 'att')], 'RB': stat[(i, 'car')] + stat[(i, 'rec')], 'WR': stat[(i, 'rec')], 'TE': stat[(i, 'rec')],
                    'K': stat[(i, 'kicks')], 'P': stat[(i, 'punts')]}.get(g, num(r['G']))
        def full(r, g):
            if r['Player-additional'] in starters:
                return True
            if g in THRESHOLD:
                what, bar = THRESHOLD[g]
                return stat[(r['Player-additional'], what)] >= bar
            return num(r['G']) >= GAMES
        kept, rest = [], []
        for r in roster:
            g = group(r['Pos'])
            (kept if g and full(r, g) else rest).append((r, g))
        have = collections.Counter(g for _, g in kept)
        filled = []
        for g, n in MINIMUM.items():
            pool = sorted([x for x in rest if x[1] == g and usage(x[0], g) > 0], key=lambda x: -usage(x[0], g))
            for x in pool[:max(0, n - have[g])]:
                rest.remove(x); filled.append(x); have[g] += 1
        chosen = {r['Player-additional'] for r, _ in kept + filled}
        # Kicking and punting cards follow the same bars: listed as a kicker (punter), or 10 kicks (punts) for the team.
        listed = {r['Player-additional']: group(r['Pos']) for r in roster}
        kicker = lambda r: pid(r) in chosen and (listed.get(pid(r)) == 'K' or stat[(pid(r), 'kicks')] >= THRESHOLD['K'][1])
        punter = lambda r: pid(r) in chosen and (listed.get(pid(r)) == 'P' or stat[(pid(r), 'punts')] >= THRESHOLD['P'][1])
        clean = lambda n: re.sub(r'[*+]', '', n or '').strip()
        keep = lambda r: pid(r) in chosen

        # ---- the team page, as pfr_to_team reads it ----
        with tempfile.TemporaryDirectory() as tmp:
            t = Path(tmp)
            write(t / 'roster.csv', None, list(roster[0].keys()), [list(r.values()) for r in roster if r['Player-additional'] in chosen])
            write(t / 'starters.csv', None, ['Pos', 'Player', 'Player-additional'], [[r['Pos'], r['Player'], r['Player-additional']] for r in starters_rows if r.get('Pos')])
            ps = [r for r in mine('pass') if keep(r)]
            write(t / 'passing.csv', None, ['Player', 'Pos', 'G', 'GS', 'QBrec', 'Cmp', 'Att', 'Yds', 'TD', 'Int', 'Sk', 'Awards'],
                  [[r['Player'], r['Pos'], r['G'], r['GS'], r.get('QBrec', ''), r['Cmp'], r['Att'], r['Yds'], r['TD'], r['Int'], r['Sk'], r.get('Awards', '')] for r in ps]
                  + [['Team Totals', '', '16', '', '', '', sum(num(r['Att']) for r in mine('pass')), '', '', '', sum(num(r['Sk']) for r in mine('pass')), '']])
            people = {}
            for r in mine('rush'):
                if keep(r): people.setdefault(pid(r), {'Player': r['Player'], 'Pos': r['Pos'], 'Awards': r.get('Awards', '')}).update({'ra': r['Rushing:Att'], 'ry': r['Rushing:Yds'], 'rl': r['Rushing:Lng']})
            for r in mine('rec'):
                if keep(r): people.setdefault(pid(r), {'Player': r['Player'], 'Pos': r['Pos'], 'Awards': r.get('Awards', '')}).update({'cr': r['Receiving:Rec'], 'cy': r['Receiving:Yds'], 'cl': r['Receiving:Lng']})
            write(t / 'rushing_receiving.csv', ['', '', 'Rushing', 'Rushing', 'Rushing', 'Receiving', 'Receiving', 'Receiving', ''],
                  ['Player', 'Pos', 'Att', 'Yds', 'Lng', 'Rec', 'Yds', 'Lng', 'Awards'],
                  [[p['Player'], p['Pos'], p.get('ra', 0), p.get('ry', 0), p.get('rl', 0), p.get('cr', 0), p.get('cy', 0), p.get('cl', 0), p['Awards']] for p in people.values()])
            write(t / 'defense_fumbles.csv', ['', '', 'Def Interceptions', '', ''], ['Player', 'Pos', 'Int', 'Sk', 'Awards'],
                  [[r['Player'], r['Pos'], r.get('Def Interceptions:Int', 0), r.get('Sk', 0), r.get('Awards', '')] for r in mine('def') if keep(r)])
            write(t / 'kicking.csv', ['', '', 'Scoring', 'Scoring', 'Scoring', 'Scoring', 'Scoring'], ['Player', 'Pos', 'FGA', 'FGM', 'Lng', 'XPA', 'XPM'],
                  [[r['Player'], r['Pos'], r['Scoring:FGA'], r['Scoring:FGM'], r['Scoring:Lng'], r['Scoring:XPA'], r['Scoring:XPM']] for r in mine('kick') if kicker(r)])
            write(t / 'punting.csv', ['', '', 'Punting', 'Punting', 'Punting', 'Punting'], ['Player', 'Pos', 'Pnt', 'Y/P', 'Lng', 'Blck'],
                  [[r['Player'], r['Pos'], r['Punting:Pnt'], r['Punting:Y/P'], r['Punting:Lng'], r['Punting:Blck']] for r in mine('punt') if punter(r)])
            write(t / 'kick_punt_returns.csv', ['', '', 'Kick Returns', 'Kick Returns', 'Kick Returns', 'Punt Returns', 'Punt Returns', 'Punt Returns'],
                  ['Player', 'Pos', 'Ret', 'Y/Ret', 'Lng', 'Ret', 'Y/Ret', 'Lng'],
                  [[r['Player'], r['Pos'], r['Kick Returns:Ret'], r['Kick Returns:Y/Ret'], r['Kick Returns:Lng'], r['Punt Returns:Ret'], r['Punt Returns:Y/Ret'], r['Punt Returns:Lng']] for r in mine('ret')])
            o, d = toff[old['name']], tdef[old['name']]
            write(t / 'team_stats_and_rankings.csv', ['', 'Rushing', 'Passing', 'Passing', 'Tot Yds & TO'], ['Player', 'Yds', 'Yds', 'Att', 'FL'],
                  [['Team Stats', o['Rushing:Yds'], o['Passing:Yds'], o['Passing:Att'], o['OFL']],
                   ['Opp. Stats', d['Rushing:Yds'], d['Passing:Yds'], d['Passing:Att'], d['OFL']]])
            meta = {'id': old['id'], 'name': old['name'], 'city': old.get('city') or old.get('shortName'), 'abbreviation': old['abbreviation'],
                    'division': old['division'], 'coach': old.get('coach', '')}
            team = conv.build(t, year, folder, '', meta)
        team.pop('city', None) if not old.get('city') else None
        team['shortName'] = old.get('shortName', team.get('shortName'))
        team['record'] = records.get(old['name']) or old.get('record') or team.get('record')
        if bigs is not None:
            team['bigPlays'] = bigs.get(old['name'], {'home': 0, 'road': 0})
            rank = ranking.index(old['name']) + 1 if old['name'] in ranking else None
            big_note = (f"Big plays {team['bigPlays']['home']} at home, {team['bigPlays']['road']} on the road: "
                        + (f"No. {rank} of the {len(ranking)} teams with 9 or more wins" if rank else 'fewer than 9 wins')
                        + (', a Super Bowl team (4 and 4)' if old['name'] in SUPER_BOWL.get(year, []) else '')
                        + (' (only 12 teams are rated)' if rank and rank > len(BIG_PLAYS) else '') + '.')
        else:
            team['bigPlays'] = old.get('bigPlays', team['bigPlays'])
            big_note = 'Big plays from the official cards (no standings in the export).'
        team['dataNotes'] = [f'Built from Pro Football Reference {year} league tables and the team roster (tools/pfr_season.py): full cards '
                             f'for QB 30 attempts, RB 20 carries, WR/TE 20 catches, K/P 10 kicks or punts, others 4 games; starters always; '
                             f'minimums QB 2, RB 3, WR 4, TE 2, OL 7, DL 5, LB 5, DB 6, K 1, P 1 filled with the next players by usage.',
                             ('Record from the standings; coach from the official cards.' if records else 'Record and coach from the official cards.'), big_note] + team['dataNotes'][1:]
        out.mkdir(parents=True, exist_ok=True)
        (out / f'{folder}.json').write_text(json.dumps(team, indent=2) + '\n')
        summary.append((folder, code, len(team['players']), len(filled), [clean(r['Player']) + f' ({g})' for r, g in filled]))
    return summary

if __name__ == '__main__':
    for folder, code, n, f, names in season(Path(sys.argv[1]), int(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4])):
        print(f'{folder:11} {code} {n:3} cards ({f} filled in)')
