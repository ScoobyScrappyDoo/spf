#!/usr/bin/env python3
"""
Build a team from Pro Football Reference season tables with the official Avalon Hill card formulas
("Creating Custom Cards :: Official Avalon Hill Rules", Lee Harris's write-up of the 5th/6th edition method).

    python3 tools/pfr_to_team.py "PFR data/1984/patriots" 1984 patriots --suffix AH > public/cards/teams/1984/patriots-ah.json

Input: the CSV exports of one team page (passing, rushing_receiving, defense_fumbles, kicking, punting,
kick_punt_returns, team_stats_and_rankings) plus its roster and starters tables.

Where the write-up leaves something to the card maker's judgement, a stated default is used and listed in the
team's dataNotes, so every assumption is visible. Two corrections come from comparing with the official cards:
the sack range uses sacks / attempts (the cards fit that, not sacks / (sacks + attempts)), and the interception
percentage is rounded to the nearest row.
"""
import csv, json, math, re, sys, unicodedata
from pathlib import Path

# ----------------------------------------------------------------------------------------------------------------
# Reading the CSV exports (two-row headings become "Group:Column")
# ----------------------------------------------------------------------------------------------------------------

def read(folder: Path, name: str):
    path = folder / f'{name}.csv'
    if not path.exists():
        return []
    rows = list(csv.reader(open(path, encoding='utf-8-sig')))
    if not rows:
        return []
    if rows[0] and rows[0][0] == '' and len(rows) > 1 and ('Player' in rows[1] or 'Rk' in rows[1]):
        groups, head, body = rows[0], rows[1], rows[2:]
        names, last = [], ''
        for g, h in zip(groups + [''] * len(head), head):
            names.append(f'{g}:{h}' if g and not g.startswith('-') else h)
    else:
        names, body = rows[0], rows[1:]
    out = []
    for r in body:
        if not r or all(not c for c in r):
            continue
        d = {}
        for k, v in zip(names, r):
            d.setdefault(k, v)  # first wins for repeated names
        out.append(d)
    return out

def num(v, default=0.0):
    try:
        return float(str(v).replace('%', '').strip())
    except (ValueError, TypeError):
        return default

def clean(name: str):
    return re.sub(r'[*+]', '', name or '').strip()

def marks(name: str):
    return ''.join(re.findall(r'[*+]', name or ''))

def slug(s: str):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')

def rng(a, b):
    return {'from': a, 'to': b} if a is not None and b is not None and a <= b else None

# ----------------------------------------------------------------------------------------------------------------
# The formula tables, as printed in the write-up
# ----------------------------------------------------------------------------------------------------------------

COMPLETION = [  # completion % -> quick, short, long com upper bounds
    (14, 15, 7, 4), (16, 16, 8, 5), (19, 18, 9, 6), (22, 19, 11, 7), (25, 20, 12, 8), (28, 21, 13, 10), (31, 23, 15, 10),
    (34, 24, 16, 11), (37, 26, 18, 12), (40, 27, 19, 13), (43, 30, 21, 14), (46, 31, 23, 15), (49, 32, 24, 16),
    (52, 33, 25, 17), (55, 34, 26, 18), (57, 35, 27, 19), (60, 36, 28, 20), (62, 37, 29, 21), (63, 38, 30, 22),
    (64, 39, 31, 22), (66, 40, 32, 23), (999, 41, 33, 23)]
INTERCEPTION = {  # rounded int % -> quick, short, long int ranges (from, to) or None
    0: (None, None, (48, 48)), 1: (None, None, (48, 48)), 2: (None, (48, 48), (47, 48)), 3: (None, (48, 48), (46, 48)),
    4: (None, (48, 48), (46, 48)), 5: ((48, 48), (47, 48), (45, 48)), 6: ((48, 48), (47, 48), (45, 48)),
    7: ((48, 48), (46, 48), (44, 48)), 8: ((48, 48), (46, 48), (44, 48)), 9: ((48, 48), (46, 48), (43, 48)),
    10: ((47, 48), (45, 48), (42, 48)), 11: ((47, 48), (45, 48), (41, 48)), 12: ((47, 48), (44, 48), (40, 48)),
    13: ((47, 48), (44, 48), (39, 48)), 14: ((46, 48), (43, 48), (38, 48)), 15: ((46, 48), (42, 48), (37, 48)),
    16: ((45, 48), (42, 48), (36, 48))}
PASS_RUSH_COM = [(43, 38), (44, 39), (48, 40), (53, 41), (58, 42), (63, 43), (67, 44)]  # completion % -> com to (from 31)

RUSHING = {  # yards per carry -> (N column after "Sg", SG column, LG base)
    1.0: ('6 5 3 2 1 0 -1 -1 -2 -3 -5', '10 9 8 7 6 6 6 6 6 6 6 6', 10),
    1.1: ('6 5 3 2 1 0 0 -1 -2 -3 -4', '10 10 9 8 7 6 6 6 6 6 6 6', 11),
    1.2: ('6 5 4 2 1 0 0 -1 -2 -3 -4', '10 10 9 8 8 7 7 6 6 6 6 6', 12),
    1.3: ('6 5 4 3 1 0 0 -1 -2 -3 -4', '10 10 9 9 8 8 7 6 6 6 6 6', 13),
    1.4: ('6 5 4 3 2 0 0 -1 -2 -3 -4', '10 10 9 9 8 8 7 7 6 6 6 6', 14),
    1.5: ('6 5 4 3 2 1 0 -1 -2 -3 -4', '10 10 9 9 8 8 7 7 6 6 6 6', 14),
    1.6: ('6 5 4 3 2 1 0 -1 -1 -3 -4', '10 10 9 9 8 8 7 7 6 6 6 6', 15),
    1.7: ('6 5 4 3 2 1 0 -1 -1 -3 -3', '10 10 9 9 8 8 7 7 6 6 6 6', 15),
    1.8: ('7 5 4 3 2 1 0 -1 -1 -3 -3', '10 10 9 9 8 8 7 7 6 6 6 6', 16),
    1.9: ('7 6 4 3 2 1 0 0 -1 -3 -3', '10 10 9 9 8 8 7 7 6 6 6 6', 17),
    2.0: ('7 6 5 3 2 1 0 0 -1 -3 -3', '10 10 9 9 8 8 7 7 6 6 6 6', 17),
    2.1: ('7 6 5 4 2 1 0 0 -1 -3 -3', '10 10 9 9 8 8 7 7 6 6 6 6', 17),
    2.2: ('7 6 5 4 3 1 0 0 -1 -3 -3', '10 10 9 9 8 8 7 7 6 6 6 6', 17),
    2.3: ('7 6 5 4 3 2 0 0 -1 -3 -3', '10 10 9 9 8 8 7 7 6 6 6 6', 17),
    2.4: ('7 6 5 4 3 2 1 0 -1 -2 -2', '10 10 9 9 8 8 7 7 6 6 6 6', 17),
    2.5: ('7 6 5 4 3 2 1 0 -1 -2 -3', '10 10 9 9 8 8 7 7 7 6 6 6', 17),
    2.6: ('7 6 5 4 3 2 1 0 -1 -2 -2', '11 10 10 9 9 8 8 7 7 7 7 6', 18),
    2.7: ('7 6 5 4 3 2 1 0 -1 -1 -2', '12 11 10 10 9 9 8 8 8 7 7 7', 18),
    2.8: ('7 6 5 4 3 2 1 0 0 -1 -2', '12 11 11 10 9 9 9 9 8 8 8 8', 18),
    2.9: ('7 6 5 4 3 2 1 1 0 -1 -2', '12 11 11 11 10 10 9 9 8 8 8 8', 19),
    3.0: ('7 6 5 4 3 2 1 1 0 -1 -2', '12 11 11 11 10 10 10 10 9 9 9 9', 19),
    3.1: ('8 6 5 4 3 2 1 1 0 -1 -1', '12 11 11 11 10 10 10 10 9 9 9 9', 20),
    3.2: ('8 7 5 4 3 2 1 1 0 -1 -1', '12 11 11 11 10 10 10 10 9 9 9 9', 20),
    3.3: ('8 7 6 4 3 2 1 1 0 -1 -1', '12 11 11 11 10 10 10 10 9 9 9 9', 20),
    3.4: ('8 7 6 5 3 2 1 1 0 -1 -1', '12 11 11 11 10 10 10 10 9 9 9 9', 20),
    3.5: ('8 7 6 5 4 2 1 1 0 -1 -1', '12 11 11 11 10 10 10 10 9 9 9 9', 21),
    3.6: ('8 7 6 5 4 3 2 1 0 -1 -1', '12 11 11 11 10 10 10 10 9 9 9 9', 21),
    3.7: ('8 7 6 5 4 3 2 1 0 0 -1', '12 11 11 11 10 10 10 10 9 9 9 9', 21),
    3.8: ('8 7 6 5 4 3 2 1 0 0 -1', '13 12 11 11 11 11 11 10 10 10 10 10', 22),
    3.9: ('9 7 6 5 4 3 2 1 0 0 -1', '13 12 11 11 11 11 11 10 10 10 10 10', 23),
    4.0: ('9 8 6 5 4 3 2 1 0 0 -1', '13 12 11 11 11 11 11 10 10 10 10 10', 23),
    4.1: ('9 8 7 6 4 3 2 1 0 0 -1', '13 12 11 11 11 11 11 10 10 10 10 10', 23),
    4.2: ('9 8 7 6 5 3 2 1 0 0 -1', '13 12 11 11 11 11 11 10 10 10 10 10', 23),
    4.3: ('9 8 7 6 5 4 2 1 0 0 -1', '13 12 11 11 11 11 11 10 10 10 10 10', 23),
    4.4: ('9 8 7 6 5 4 3 1 0 0 -1', '13 12 11 11 11 11 11 10 10 10 10 10', 23),
    4.5: ('9 8 7 6 5 4 3 2 1 0 -1', '13 12 11 11 11 11 11 10 10 10 10 10', 24),
    4.6: ('9 8 7 6 5 4 3 2 1 0 -1', '14 14 13 13 12 12 11 11 10 10 10 10', 25),
    4.7: ('9 8 7 6 5 4 3 2 1 0 -1', '14 14 14 13 13 13 12 12 11 11 11 11', 26),
    4.8: ('10 9 7 6 5 4 3 2 1 0 -1', '14 14 14 13 13 13 12 12 11 11 11 11', 27),
    4.9: ('10 9 7 6 5 4 3 2 1 0 -1', '16 16 15 15 14 14 13 13 12 12 11 11', 28),
    5.0: ('10 9 8 6 5 4 3 2 1 0 -1', '17 16 15 15 14 14 13 13 12 12 11 11', 29),
    5.1: ('10 9 8 7 5 4 3 2 1 0 -1', '18 17 16 15 14 14 13 13 12 12 11 11', 30),
    5.2: ('10 9 8 7 6 4 3 2 1 0 -1', '19 18 17 16 15 14 13 13 12 12 11 11', 31),
    5.3: ('10 9 8 7 6 5 3 2 1 0 -1', '20 19 18 17 16 15 14 13 12 12 11 11', 32),
    5.4: ('10 9 8 7 6 5 4 2 1 0 -1', '20 19 18 17 16 15 14 13 12 12 11 11', 32),
    5.5: ('10 9 8 7 6 5 4 2 1 0 -1', '21 20 19 18 17 16 15 14 13 12 11 11', 33),
    5.6: ('10 9 8 7 6 5 4 2 1 0 -1', '22 21 20 19 18 17 16 15 14 13 12 11', 34),
    5.7: ('10 9 8 7 6 5 4 2 1 0 -1', '23 22 21 20 19 18 17 16 15 14 13 12', 35),
    5.8: ('11 10 8 7 6 5 4 2 1 0 -1', '23 22 21 20 19 18 17 16 15 14 13 12', 36),
    5.9: ('11 10 9 7 6 5 4 2 1 0 -1', '23 22 21 20 19 18 17 16 15 14 13 12', 38),
    6.0: ('11 10 9 8 6 5 4 2 1 0 -1', '23 22 21 20 19 18 17 16 15 14 13 12', 40),
    6.1: ('11 10 9 8 7 5 4 2 1 0 -1', '23 22 21 20 19 18 17 16 15 14 13 12', 42),
    6.2: ('11 10 9 8 7 6 4 2 1 0 -1', '23 22 21 20 19 18 17 16 15 14 13 12', 44),
    6.3: ('11 10 9 8 7 6 5 2 1 0 -1', '23 22 21 20 19 18 17 16 15 14 13 12', 46),
    6.4: ('11 10 9 8 7 6 4 3 2 1 -1', '23 22 21 20 19 18 17 16 15 14 13 12', 48),
    6.5: ('11 10 9 8 7 6 4 3 2 1 0', '23 22 21 20 19 18 17 16 15 14 13 12', 50),
    6.6: ('11 10 9 8 7 6 4 3 2 1 0', '24 23 22 21 20 19 18 17 16 15 14 13', 54),
    6.7: ('12 10 9 8 7 6 4 3 2 1 0', '24 23 22 21 20 19 18 17 16 15 14 13', 56),
    6.8: ('12 11 10 8 7 6 4 3 2 1 0', '24 23 22 21 20 19 18 17 16 15 14 13', 60),
    6.9: ('12 11 10 9 7 6 4 3 2 1 0', '24 23 22 21 20 19 18 17 16 15 14 13', 64),
    7.0: ('12 11 10 9 8 6 4 3 2 1 0', '24 23 22 21 20 19 18 17 16 15 14 13', 68),
    8.0: ('14 13 12 11 10 8 4 3 2 1 0', '24 23 22 21 20 19 18 17 16 15 15 15', 75),
    9.0: ('14 13 12 11 10 9 8 6 4 2 1', '24 23 22 21 20 19 18 17 16 15 15 15', 75),
    10.0: ('14 13 12 11 10 10 9 7 6 5 4', '24 23 22 21 20 19 18 17 17 16 16 16', 75)}

RECEIVING = {  # yards per catch -> quick column, short column ("L": long gain); 3-6 have no short column
    3: ('8 7 6 5 4 3 2 1 0 -1 -2 -3', None), 4: ('9 8 7 6 5 4 3 2 1 0 -1 -2', None),
    5: ('10 9 8 7 6 5 4 3 2 1 0 -1', None), 6: ('11 10 9 8 7 6 5 4 3 2 1 0', None),
    7: ('6 5 5 4 4 3 3 2 2 1 0 0', '12 11 10 9 8 7 6 5 5 5 5 5'),
    8: ('L 10 5 4 4 3 3 2 2 1 0 0', 'L 12 11 9 8 7 6 5 5 5 5 5'),
    9: ('L 10 6 5 5 4 4 3 3 2 2 1', 'L 13 12 11 10 9 8 7 6 5 5 5'),
    10: ('L 10 6 6 5 5 4 4 3 3 2 2', 'L 14 13 12 11 10 9 8 7 6 5 5'),
    11: ('L 10 7 6 6 5 5 4 4 3 3 2', 'L 15 14 13 12 11 10 9 8 7 6 5'),
    12: ('L 12 7 7 6 6 5 5 4 4 3 3', 'L 16 15 14 13 12 11 10 9 8 7 6'),
    13: ('L 13 8 7 7 6 6 5 5 4 4 3', 'L 17 16 15 14 13 12 11 10 9 8 7'),
    14: ('L 14 8 8 7 7 6 6 5 5 4 4', 'L 18 17 16 15 14 13 12 11 10 9 8'),
    15: ('L 15 9 9 8 8 7 7 6 6 5 5', 'L 19 18 17 16 15 14 13 12 11 10 9'),
    16: ('L 16 9 9 8 8 7 7 6 6 5 5', 'L 20 19 18 17 16 15 14 13 12 11 10'),
    17: ('L 17 12 9 9 8 8 7 7 6 6 5', 'L 21 20 19 18 17 16 15 14 13 12 11'),
    18: ('L 18 12 10 9 9 8 8 7 7 6 6', 'L 21 20 19 18 17 16 15 14 13 12 11'),
    19: ('L 19 12 10 10 9 9 8 8 7 7 6', 'L 23 22 21 20 19 18 17 16 15 14 13'),
    20: ('L 19 12 11 10 10 9 9 8 8 7 7', 'L 24 23 22 21 20 19 18 17 16 15 14'),
    21: ('L 19 12 11 11 11 10 10 9 9 8 8', 'L 24 23 22 21 20 19 18 17 16 15 14'),
    22: ('L 19 12 12 11 11 11 10 10 9 9 8', 'L 25 24 23 22 21 20 19 18 17 16 15'),
    23: ('L 19 13 12 12 11 11 11 10 10 9 9', 'L 26 25 24 23 22 21 20 19 18 17 16'),
    24: ('L 19 13 13 12 12 11 11 11 10 10 9', 'L 27 26 25 24 23 22 21 20 19 18 17'),
    25: ('L 19 14 13 13 12 12 11 11 11 10 10', 'L 28 27 26 25 24 23 22 21 20 19 18'),
    26: ('L 19 14 14 13 13 12 12 11 11 11 10', 'L 29 28 27 26 25 24 23 22 21 20 19'),
    27: ('L 19 15 14 14 13 13 12 12 11 11 11', 'L 30 29 28 27 26 25 24 23 22 21 20'),
    28: ('L 19 15 15 14 14 13 13 12 12 11 11', 'L 31 30 29 28 27 26 25 24 23 22 21')}

OL_RUN = [(150, [4, 4, 3, 3, 3, 2, 1, 1]), (140, [4, 4, 3, 3, 2, 2, 1, 1]), (130, [4, 3, 3, 3, 2, 1, 1, 1]),
          (120, [4, 3, 3, 2, 2, 1, 1, 0]), (110, [4, 3, 3, 2, 1, 1, 1, 0]), (105, [3, 3, 3, 2, 1, 1, 1, 0]),
          (100, [3, 3, 2, 2, 1, 1, 1, 0]), (95, [3, 2, 2, 2, 1, 1, 0, -1]), (90, [3, 2, 2, 1, 1, 1, 0, -1]),
          (80, [2, 2, 2, 1, 1, 1, 0, -1]), (0, [2, 2, 1, 1, 0, 0, -1, -1])]  # rushing yards a game, from the top
OL_PASS = [(15, [3, 3, 2, 2, 1, 1, 0, 0]), (22, [3, 3, 2, 2, 1, 0, 0, 0]), (29, [3, 3, 1, 1, 1, 0, 0, 0]),
           (35, [3, 2, 1, 1, 1, 0, 0, 0]), (42, [3, 2, 1, 1, 1, 0, 0, 0]), (49, [3, 2, 1, 1, 0, 0, 0, 0]),
           (55, [2, 2, 1, 1, 0, 0, 0, 0]), (62, [2, 2, 1, 0, 0, 0, 0, 0]), (69, [2, 1, 1, 0, 0, 0, 0, 0]),
           (75, [2, 1, 0, 0, 0, 0, 0, 0]), (999, [1, 1, 0, 0, 0, 0, 0, 0])]  # sacks allowed, up to
DL_TACKLE = [(85, [-4, -3, -3, -2, -2, -2]), (92, [-4, -3, -3, -2, -2, -1]), (99, [-4, -3, -3, -2, -1, -1]),
             (105, [-4, -2, -2, -2, -1, -1]), (112, [-3, -2, -2, -2, -1, -1]), (119, [-3, -2, -2, -1, -1, -1]),
             (125, [-3, -2, -1, -1, 0, 0]), (132, [-3, -2, -1, 0, 0, 1]), (139, [-2, -2, -1, 0, 1, 1]),
             (145, [-2, -1, -1, 0, 1, 2]), (152, [-2, -1, 0, 0, 1, 2]), (159, [-1, -1, 0, 1, 1, 2]),
             (165, [-1, -1, 0, 1, 2, 3]), (172, [-1, 0, 0, 1, 2, 3]), (179, [0, 0, 1, 2, 2, 3]), (999, [1, 1, 2, 2, 3, 3])]
LB_TACKLE = [(85, [-5, -4, -3, -2, -1, 0, 1, 2]), (92, [-5, -4, -3, -2, -1, 1, 1, 2]), (99, [-5, -4, -3, -2, 0, 1, 1, 2]),
             (105, [-5, -4, -3, -2, 0, 1, 2, 2]), (112, [-4, -4, -3, -2, 0, 1, 2, 2]), (119, [-4, -4, -2, -2, 0, 1, 2, 3]),
             (125, [-4, -3, -2, -1, 0, 1, 2, 3]), (132, [-4, -3, -2, 0, 1, 1, 2, 3]), (139, [-3, -3, -1, 0, 1, 1, 2, 3]),
             (145, [-3, -2, -1, 0, 1, 0, 2, 3]), (152, [-3, -2, -1, 0, 2, 1, 2, 3]), (159, [-3, -2, -1, 1, 2, 2, 3, 4]),
             (165, [-2, -2, 0, 1, 2, 3, 3, 4]), (172, [-2, -1, 1, 2, 2, 3, 4, 4]), (179, [-2, -1, 1, 2, 3, 3, 4, 4]),
             (999, [-1, 0, 1, 2, 3, 4, 4, 4])]  # rushing yards allowed a game, up to
LB_PASS = [[-3, -2, -2, -1, 1, 0, 1, 2], [-3, -2, -1, -1, 1, 1, 1, 2], [-3, -1, -1, -1, 1, 1, 1, 2], [-3, -1, -1, 0, 1, 1, 2, 3],
           [-2, -1, -1, 0, 1, 1, 2, 3], [-2, -1, -1, 1, 2, 1, 2, 3], [-2, -1, 0, 1, 2, 1, 2, 3], [-2, 0, 0, 1, 2, 1, 2, 3],
           [-1, 0, 0, 1, 2, 1, 2, 3], [-1, 0, 0, 2, 3, 0, 2, 3], [-1, 0, 1, 2, 3, 1, 2, 3], [-1, 0, 2, 2, 3, 2, 3, 4],
           [0, 0, 2, 2, 3, 3, 3, 4], [0, 0, 2, 2, 3, 3, 4, 4], [0, 0, 2, 2, 3, 3, 4, 4], [0, 0, 2, 3, 4, 4, 4, 4]]
DB_PASS = [[-4, -3, -2, -1, 1, 1, 1], [-4, -3, -1, -1, 1, 1, 1], [-4, -2, -1, -1, 1, 1, 1], [-4, -2, -1, 0, 1, 1, 2],
           [-3, -2, -1, 0, 1, 1, 2], [-3, -2, -1, 1, 2, 2, 2], [-3, -2, 0, 1, 2, 2, 2], [-3, -1, 0, 1, 2, 2, 2],
           [-2, -1, 0, 1, 2, 2, 2], [-2, -1, 0, 2, 3, 3, 3], [-2, -1, 1, 2, 3, 3, 3], [-2, -1, 2, 2, 3, 3, 3],
           [-1, -1, 2, 2, 3, 3, 3], [-1, 0, 2, 2, 3, 3, 4], [-1, 0, 2, 2, 3, 4, 4], [-1, 0, 2, 3, 4, 4, 4]]
INT_RANGE = {0: 48, 1: 48, 2: 48, 3: 47, 4: 46, 5: 45, 6: 44, 7: 43, 8: 42, 9: 41, 10: 40, 11: 39, 12: 38}  # ints -> from (to 48)
FG = {p: r for p, r in [(45, (27, 22, 12, 2)), (47, (28, 23, 13, 3)), (49, (29, 24, 14, 4)), (52, (30, 25, 15, 5)),
      (54, (31, 26, 16, 6)), (56, (32, 27, 17, 7)), (58, (33, 28, 18, 8)), (60, (34, 29, 19, 9)), (62, (35, 30, 20, 10)),
      (64, (36, 31, 21, 11)), (66, (37, 32, 22, 12)), (68, (38, 33, 23, 13)), (70, (39, 34, 24, 14)), (72, (40, 35, 25, 15)),
      (74, (41, 36, 26, 16)), (77, (42, 37, 27, 17)), (79, (43, 38, 28, 18))]}
FG_OVER_50 = {51: 1, 52: 1, 53: 2, 54: 2, 55: 3, 56: 4, 57: 5, 58: 6, 59: 7, 60: 8, 61: 9, 62: 10, 63: 11, 64: 12}
XP = [(100, 48), (98, 47), (96, 46), (94, 45), (92, 44), (90, 43), (88, 42), (85, 41), (83, 40), (81, 39), (79, 38), (0, 37)]
PUNT_OFFSETS = [19, 9, 6, 5, 3, -1, -3, -4, -5, -10, -20]  # punter average + these, RN 1-11 (12 is special)
FAIR_CATCH = [(75, 9), (67, 8), (58, 7), (50, 6), (42, 5), (0, 4)]  # % returned -> first fair-catch number (to 11)
KICK_RETURN = {
    8: '16 13 12 11 9 8 7 6 5 4 3 2', 9: '17 14 13 12 10 9 8 7 6 5 4 3', 10: '18 15 14 13 11 10 9 8 7 6 5 4',
    11: '19 16 15 14 12 11 10 9 8 7 6 5', 12: '21 18 16 15 13 12 11 10 9 8 6 5', 13: '22 19 17 16 14 13 12 11 9 8 7 6',
    14: '24 21 18 17 15 14 13 12 10 9 8 7', 15: '25 22 20 18 16 15 14 13 11 10 8 7', 16: '26 23 21 19 17 16 15 14 12 11 9 8',
    17: '28 25 22 21 18 17 16 15 13 11 10 8', 18: '29 26 23 22 19 18 17 16 13 12 10 9', 19: '31 28 24 23 20 19 18 17 14 13 11 10',
    20: '32 29 25 24 21 20 19 18 15 14 12 10', 21: '33 30 26 25 22 21 20 19 16 14 12 11', 22: '35 32 27 26 23 22 21 20 17 15 13 12',
    23: '36 33 29 27 25 24 23 21 17 16 14 12', 24: '38 35 30 28 26 25 24 22 18 17 15 13', 25: '39 36 31 29 27 26 25 23 19 17 15 14',
    26: '40 37 32 30 28 27 26 24 20 18 16 14', 27: '42 39 33 31 29 28 27 25 21 19 17 15', 28: '43 40 34 32 30 29 28 26 21 20 17 16',
    29: '45 42 35 34 31 30 29 27 22 20 18 16', 30: '46 43 36 35 32 31 30 28 23 21 19 17', 31: '47 44 38 36 33 32 31 29 24 22 19 17',
    32: '49 46 39 37 34 33 32 30 25 23 20 18', 33: '50 47 40 38 35 34 33 31 25 23 21 19', 34: '52 49 41 39 36 35 34 32 26 24 21 19',
    35: '53 50 42 40 37 36 35 33 27 25 22 20'}
PUNT_RETURN_OFFSETS = [8, 5, 4, 3, 1, 0, -1, -2, -3, -4, -5, -6]  # punt return average + these (12 is a fumble)

def ints(s):
    return [x if x == 'L' else int(x) for x in s.split()]

def row_by(table, value):
    """First row whose threshold the value reaches, for tables listed from the top down."""
    for threshold, vals in table:
        if value >= threshold:
            return vals
    return table[-1][1]

def row_upto(table, value):
    for limit, vals in table:
        if value <= limit:
            return vals
    return table[-1][1]

def ypa_row(ypa):
    return max(0, min(15, math.floor((round(ypa, 1) - 5.1) / 0.2 + 1e-9)))

def pass_rush_from_sacks(sacks):
    return 3 if sacks >= 6 else 2 if sacks >= 4 else 1 if sacks >= 2 else 0

# ----------------------------------------------------------------------------------------------------------------
# Building the team
# ----------------------------------------------------------------------------------------------------------------

POSITION = {'QB': 'QB', 'RB': 'RB', 'HB': 'RB', 'FB': 'RB', 'WR': 'WR', 'TE': 'TE',
            'T': 'OT', 'OT': 'OT', 'LT': 'OT', 'RT': 'OT', 'G': 'OG', 'OG': 'OG', 'LG': 'OG', 'RG': 'OG', 'C': 'C', 'OL': 'OG',
            'DE': 'DE', 'LDE': 'DE', 'RDE': 'DE', 'DT': 'DT', 'NT': 'DT', 'LDT': 'DT', 'RDT': 'DT', 'DL': 'DT',
            'LB': 'LB', 'OLB': 'LB', 'ILB': 'LB', 'MLB': 'LB', 'LOLB': 'LB', 'ROLB': 'LB', 'LILB': 'LB', 'RILB': 'LB', 'RLB': 'LB', 'LLB': 'LB',
            'CB': 'DB', 'LCB': 'DB', 'RCB': 'DB', 'S': 'DB', 'SS': 'DB', 'FS': 'DB', 'DB': 'DB', 'K': 'K', 'P': 'P'}
ROLE = {'CB': 'CB', 'LCB': 'CB', 'RCB': 'CB', 'S': 'S', 'SS': 'S', 'FS': 'S'}
# Every player who played gets a card. These dials decide how much a small sample can show (as the 1984 cards do):
SPARE_MAX_CARRIES = 5     # 5 carries or fewer: the standard spare back's card
FULL_CARD_CARRIES = 20    # 6-19 carries: own N column (average without his longest run), SG down from his longest, LG flat at it
SPARE_MAX_CATCHES = 5     # 5 catches or fewer: a Q column only (short and long passes to him are incomplete)
FULL_CARD_CATCHES = 20    # 6-19 catches: Q and S without his longest catch, L six rows from his longest, then "inc"
SELDOM_L_ROWS = 6
SPARE_BACK = ('SG 4 3 2 1 0 0 -1 -2 -3 -4 -5', 10, 10)  # the official cards' card for a back who barely played
QB_FULL_CARD_ATTEMPTS = 30  # fewer attempts: capped at the 34% completion row, and the team's sack rate

def build(folder: Path, year: int, team_key: str, suffix: str, meta: dict):
    notes = []
    roster = {clean(r['Player']): r for r in read(folder, 'roster')}
    starters_rows = [r for r in read(folder, 'starters') if r.get('Pos') and r.get('Player')]
    starters = {clean(r['Player']): (r['Pos'], marks(r['Player'])) for r in starters_rows}
    awards = {}
    for t in ('passing', 'rushing_receiving', 'defense_fumbles', 'kicking', 'punting', 'kick_punt_returns'):
        for r in read(folder, t):
            a = r.get('Awards', '')
            if a:
                awards[clean(r.get('Player', ''))] = a
    def honours(n):
        m = starters.get(n, ('', ''))[1]
        a = awards.get(n, '')
        return ('+' in m or 'AP-1' in a, '*' in m or 'PB' in a)
    passing = {clean(r['Player']): r for r in read(folder, 'passing') if r.get('Player') and r['Player'] != 'Team Totals'}
    rr = {clean(r['Player']): r for r in read(folder, 'rushing_receiving') if r.get('Player') and r['Player'] != 'Team Totals'}
    defense = {clean(r['Player']): r for r in read(folder, 'defense_fumbles') if r.get('Player') and r['Player'] != 'Team Totals'}
    kicking = [r for r in read(folder, 'kicking') if r.get('Player') and r['Player'] != 'Team Totals']
    punting = [r for r in read(folder, 'punting') if r.get('Player') and r['Player'] != 'Team Totals']
    returns = [r for r in read(folder, 'kick_punt_returns') if r.get('Player') and r['Player'] != 'Team Totals']
    team = {r.get('Player'): r for r in read(folder, 'team_stats_and_rankings')}
    own, opp = team.get('Team Stats', {}), team.get('Opp. Stats', {})
    games = max((num(r.get('G')) for r in passing.values()), default=16) or 16
    pass_totals = next((r for r in read(folder, 'passing') if r.get('Player') == 'Team Totals'), {})
    pfx = f"{meta['abbreviation'].lower()}{str(year)[2:]}{slug(suffix) if suffix else ''}"
    ids = {}
    def pid(n):
        return ids.setdefault(n, f'{pfx}-{slug(n)}')
    used_ids = set()
    def person(n, pos):
        parts = n.split(' ', 1)
        # One player with two jobs (Danny White, quarterback and punter) gets a card for each, the second with its own id.
        pid_ = pid(n)
        if pid_ in used_ids:
            pid_ = f'{pid_}-{pos.lower()}'
        used_ids.add(pid_)
        jersey = int(num(roster.get(n, {}).get('No.'), 0)) or None
        return {'id': pid_, 'firstName': parts[0], 'lastName': parts[1] if len(parts) > 1 else '', 'jersey': jersey, 'position': pos}
    def pos_of(n):
        p = roster.get(n, {}).get('Pos') or starters.get(n, ('', ''))[0]
        for r in (rr.get(n), defense.get(n), passing.get(n)):
            if not p and r:
                p = r.get('Pos', '')
        # Some rows list two positions ("LOLB/RILB"): the first one known counts.
        for part in re.split(r'[/,-]', (p or '').upper()):
            if POSITION.get(part.strip()):
                return POSITION[part.strip()]
        return ''
    def rank_key(n):
        ap, pb = honours(n)
        r = roster.get(n, {})
        return (n in starters, num(r.get('AV')) + (3 if ap else 2 if pb else 0), num(r.get('GS')))
    players = []

    # ---- Quarterbacks: completion and interception % to the tables; sacks / attempts for the pass rush ----
    qbs = sorted([n for n, r in passing.items() if (pos_of(n) == 'QB' or r.get('Pos') == 'QB') and num(r.get('Att')) > 0],
                 key=lambda n: (-num(passing[n].get('GS')), -num(passing[n].get('Att'))))
    # Endurance (rule 4.5.1): A the starter, B the backup, C the one in the wings, by games started. Two quarterbacks who
    # really shared the job (6 or more starts each) are both A, as the write-up allows.
    letters = []
    for i, n in enumerate(qbs):
        gs = num(passing[n].get('GS'))
        letters.append('A' if i == 0 or (gs >= 6 and letters[-1] == 'A') else 'B' if 'B' not in letters else 'C')
    for i, n in enumerate(qbs):
        r = passing[n]
        att, cmp_, ints_ = num(r.get('Att')), num(r.get('Cmp')), num(r.get('Int'))
        pct = 100 * cmp_ / att if att else 0
        if att < QB_FULL_CARD_ATTEMPTS:
            # A handful of throws says little: like Avalon Hill's own backups, cap him at the 34% row.
            notes.append(f'{n}: only {att:.0f} attempts, so his completion % is capped at the 34% row (a backup\'s card).')
            pct = min(pct, 34)
        row = COMPLETION[0]  # the highest row the completion % reaches
        for v in COMPLETION:
            if pct >= v[0] or v is COMPLETION[0]:
                row = v
        q, s, l = row[1:]
        ipct = round(100 * ints_ / att) if att else 0
        iq, is_, il = INTERCEPTION[min(16, ipct)]
        def ranges(com_to, intr):
            int_r = rng(*intr) if intr else None
            inc_to = (int_r['from'] - 1) if int_r else 48
            return {'com': rng(1, com_to), 'inc': rng(com_to + 1, inc_to), 'int': int_r}
        sacks = num(r.get('Sk'))
        sack_pct = math.floor(100 * sacks / att) if att else 0
        if att < QB_FULL_CARD_ATTEMPTS:
            # Few snaps say nothing about his protection: like the official cards, use the team's sack rate.
            team_att = num(pass_totals.get('Att')) or att
            sack_pct = math.floor(100 * num(pass_totals.get('Sk')) / team_att) if team_att else sack_pct
        sack_to = 4 + max(1, min(20, sack_pct))
        rush_com_to = 38 if pct < 43 else row_by(sorted([(t, v) for t, v in PASS_RUSH_COM], reverse=True), pct)
        rushing = rush_column(rr.get(n), n, notes, qb=True)
        players.append({**person(n, 'QB'), 'endurance': letters[i],
                        'passing': {'quick': ranges(q, iq), 'short': ranges(s, is_), 'long': ranges(l, il)},
                        'passRush': {'sack': rng(1, sack_to), 'runs': rng(sack_to + 1, 30), 'com': rng(31, rush_com_to), 'inc': rng(rush_com_to + 1, 48)},
                        'rushing': rushing})
        notes.append(f'{n}: {pct:.1f}% complete, {ipct}% intercepted, {sacks:.0f} sacks in {att:.0f} attempts ({sack_pct}%), '
                     f'endurance {letters[i]} ({num(r.get("GS")):.0f} games started).')

    # ---- Backs and receivers ----
    def touches(n):
        r = rr.get(n, {})
        return num(r.get('Rushing:Att')) + num(r.get('Receiving:Rec'))
    groups = {'RB': [], 'WR': [], 'TE': []}
    for n in list(rr) + [n for n, r in roster.items() if num(r.get('G')) > 0 and n not in rr]:
        p = pos_of(n)
        if p in groups and n not in groups[p]:
            groups[p].append(n)
    for p in groups:
        key = touches if p == 'RB' else (lambda n: num(rr.get(n, {}).get('Receiving:Rec')))
        groups[p] = sorted(groups[p], key=key, reverse=True)
    for p, names in groups.items():
        for n in names:
            r = rr.get(n, {})
            rec = num(r.get('Receiving:Rec'))
            t = touches(n) if p == 'RB' else rec
            scale = [290, 125, 55, 32] if p == 'RB' else [80, 55, 30, 20]
            direction = next((i for i, v in enumerate(scale) if t >= v), 4)
            ap, pb = honours(n)
            starter = n in starters
            if p == 'TE':
                blocks = 4 if (ap or pb) else 3 if starter else 2
            elif p == 'WR':
                blocks = 0 if starter else -1
            else:
                blocks = 2 if (roster.get(n, {}).get('Pos') == 'FB') else 0
            rushing = rush_column(r, n, notes) if (p == 'RB' or num(r.get('Rushing:Att')) > 0) else None
            players.append({**person(n, p), 'playDirection': direction, 'blocks': blocks, 'rushing': rushing,
                            'passGain': catch_column(r, n, notes)})
    notes.append('Blocking for backs and receivers is a judgement call in the write-up; defaults used: TE 4 with Pro Bowl/All-Pro, 3 starting, '
                 '2 otherwise; WR 0 starting, -1 otherwise; FB +2, RB 0.')

    # ---- Offensive line: ranked, then the slot values for the team's rushing yards and sacks allowed ----
    played = lambda n: num(roster.get(n, {}).get('G')) > 0
    line = sorted([n for n in roster if pos_of(n) in ('OT', 'OG', 'C') and played(n)], key=rank_key, reverse=True)
    slot = lambda vals, i: vals[min(i, len(vals) - 1)]  # beyond the table's slots: the last backup's value
    rush_pg = num(own.get('Rushing:Yds')) / games
    sacks_allowed = num(pass_totals.get('Sk'))
    run_vals, pass_vals = row_by(OL_RUN, rush_pg), row_upto(OL_PASS, sacks_allowed)
    for i, n in enumerate(line):
        players.append({**person(n, pos_of(n)), 'runBlock': slot(run_vals, i), 'passBlock': slot(pass_vals, i)})
    notes.append(f'Offensive line ranked by starting, then AV (+2 Pro Bowl, +3 All-Pro), then games started: {", ".join(line)}. '
                 f'{rush_pg:.1f} rushing yards a game and {sacks_allowed:.0f} sacks allowed.')

    # ---- Defense ----
    opp_rush_pg = num(opp.get('Rushing:Yds')) / games
    ypa = num(opp.get('Passing:Yds')) / num(opp.get('Passing:Att'), 1)
    def sacks_of(n):
        return math.floor(num(defense.get(n, {}).get('Sk')))
    def int_range(n):
        k = int(num(defense.get(n, {}).get('Def Interceptions:Int')))
        # One rule for every season: the worksheet table (2 is 48, 3 is 47-48; 0-1 is "48?", see maybe_48 below).
        return rng(INT_RANGE.get(k, 37), 48)
    def maybe_48(n):
        return {'interceptMaybe': True} if int(num(defense.get(n, {}).get('Def Interceptions:Int'))) <= 1 else {}
    dl = sorted([n for n in roster if pos_of(n) in ('DE', 'DT') and played(n)], key=rank_key, reverse=True)
    tackles = row_upto(DL_TACKLE, opp_rush_pg)
    for i, n in enumerate(dl):
        players.append({**person(n, pos_of(n)), 'tackle': slot(tackles, i), 'passRush': pass_rush_from_sacks(sacks_of(n))})
    lbs = sorted([n for n in roster if pos_of(n) == 'LB' and played(n)], key=rank_key, reverse=True)
    lt, lp = row_upto(LB_TACKLE, opp_rush_pg), LB_PASS[ypa_row(ypa)]
    for i, n in enumerate(lbs):
        players.append({**person(n, 'LB'), 'tackle': slot(lt, i), 'passRush': pass_rush_from_sacks(sacks_of(n)), 'passDefense': slot(lp, i), 'intercept': int_range(n), **maybe_48(n)})
    dbs = sorted([n for n in roster if pos_of(n) == 'DB' and played(n)], key=rank_key, reverse=True)
    dp = DB_PASS[ypa_row(ypa)]
    for i, n in enumerate(dbs):
        role = ROLE.get(re.split(r'[/,-]', (roster.get(n, {}).get('Pos') or starters.get(n, ('', ''))[0]).upper())[0].strip())
        card = {**person(n, 'DB'), 'passDefense': slot(dp, i), 'passRush': pass_rush_from_sacks(sacks_of(n)), 'intercept': int_range(n), **maybe_48(n)}
        if role:
            card['role'] = role
        players.append(card)
    notes.append(f'Defense: {opp_rush_pg:.1f} rushing yards a game allowed, {ypa:.2f} yards a pass attempt allowed; '
                 'each group ranked like the offensive line. Pass rush from the player\'s sacks; interception ranges from his interceptions.')

    # ---- Kickers and punters ----
    for r in kicking:
        n = clean(r['Player'])
        fga, fgm = num(r.get('Scoring:FGA')), num(r.get('Scoring:FGM'))
        if fga < 1 and num(r.get('Scoring:XPA')) < 1:
            continue
        pct = 100 * fgm / fga if fga else 0
        key = max([p for p in FG if p <= max(45, round(pct))], default=45)
        bands = FG[key]
        longest = int(num(r.get('Scoring:Lng')))
        fgs = [{'minYards': a, 'maxYards': b, 'good': rng(1, bands[i]) if (i < 3 or longest >= 46) else None}
               for i, (a, b) in enumerate([(18, 25), (26, 35), (36, 45), (46, 50)])]
        fgs.append({'minYards': 51, 'maxYards': 60, 'good': rng(1, FG_OVER_50.get(min(64, longest), 0)) if longest > 50 else None})
        xpa, xpm = num(r.get('Scoring:XPA')), num(r.get('Scoring:XPM'))
        xpct = 100 * xpm / xpa if xpa else 0
        xp_to = next(v for t, v in XP if xpct >= t)
        players.append({**person(n, 'K'), 'fieldGoals': fgs, 'extraPoint': rng(1, xp_to)})
        notes.append(f'{n}: {fgm:.0f} of {fga:.0f} field goals ({pct:.1f}%, the {key}% row), long {longest}; extra points {xpct:.0f}%.')
    for r in punting:
        n = clean(r['Player'])
        pnt = num(r.get('Punting:Pnt'))
        if pnt < 1:
            continue
        avg = max(31, min(50, round(num(r.get('Punting:Y/P')))))
        returned_pct = 50  # not in the export: fair catches aren't listed
        first_fc = next(v for t, v in FAIR_CATCH if returned_pct >= t)
        punts = []
        for i, off in enumerate(PUNT_OFFSETS):
            rn = i + 1
            returner = 'FC' if first_fc <= rn <= 11 else f'PR{(rn - 1) % 4 + 1}'
            punts.append({'yards': avg + off, 'returner': returner})
        longest = int(num(r.get('Punting:Lng')))
        blocked = int(num(r.get('Punting:Blck')))
        special, next_rn = [], 1
        if longest > punts[0]['yards']:
            special.append({'runNumber': rng(1, 1), 'result': {'type': 'NO_RETURN', 'yards': longest}})
            next_rn = 2
        if blocked:
            special.append({'runNumber': rng(next_rn, next_rn + min(4, blocked) - 1), 'result': {'type': 'BLOCKED'}})
            next_rn += min(4, blocked)
        if next_rn <= 12:
            special.append({'runNumber': rng(next_rn, 12), 'result': {'type': 'PENALTY'}})
        players.append({**person(n, 'P'), 'punts': punts, 'special': special})
        notes.append(f'{n}: {avg}-yard average row, long {longest}, {blocked} blocked. Fair catches assumed on 50% of punts '
                     '(RN 6-11): the export has no fair-catch count.')

    # ---- Return units ----
    def unit(kind):
        key = 'Kick Returns' if kind == 'K' else 'Punt Returns'
        rows = sorted([r for r in returns if num(r.get(f'{key}:Ret')) > 0], key=lambda r: -num(r.get(f'{key}:Ret')))
        if not rows:
            return None
        total = sum(num(r.get(f'{key}:Ret')) for r in rows)
        cols = [f'{kind}R{i}' for i in range(1, 5)]
        people = [rows[0]]
        if num(rows[0].get(f'{key}:Ret')) / total >= 0.75:
            people.append(None)  # KR2/PR2 the same as #1
        people += rows[1:]
        returners, table, breakaway = {}, [{c: None for c in cols} for _ in range(12)], {c: None for c in cols}
        for ci, c in enumerate(cols):
            who = people[ci] if ci < len(people) else None
            if who is None:
                returners[c] = {'sameAs': cols[0]}
                continue
            n = clean(who['Player'])
            carded = any(p['id'] == ids.get(n) for p in players)
            returners[c] = {'name': n, 'playerId': ids.get(n) if carded else None}
            avg = num(who.get(f'{key}:Y/Ret'))
            if kind == 'K':
                vals = ints(KICK_RETURN[max(8, min(35, round(avg)))])
            else:
                a = max(4, min(24, round(avg)))
                vals = [a + o for o in PUNT_RETURN_OFFSETS]
            longest = int(num(who.get(f'{key}:Lng')))
            for i, v in enumerate(vals):
                table[i][c] = {'yards': v, 'fumble': i == 11, 'breakaway': i == 0 and longest > v}
            if longest > vals[0]:
                breakaway[c] = 100 if longest >= 80 else longest
        return {'returners': returners, 'table': table, 'breakaway': breakaway}

    # ---- Team card and starting lineup ----
    fl = int(num(own.get('Tot Yds & TO:FL') or own.get('FL')))
    fumbles_lost = rng(1, 11 + max(5, min(32, fl)))
    offense_listed = {'QB': 'QB', 'RB': 'RB', 'FB': 'RB', 'WR': 'WR', 'TE': 'TE', 'LT': 'OT', 'RT': 'OT', 'T': 'OT', 'LG': 'OG', 'RG': 'OG', 'G': 'OG', 'C': 'OC'}
    defense_listed = {'LDE': 'DE', 'RDE': 'DE', 'DE': 'DE', 'NT': 'DT', 'LDT': 'DT', 'RDT': 'DT', 'DT': 'DT', 'LOLB': 'LB', 'ROLB': 'LB', 'LILB': 'LB',
                      'RILB': 'LB', 'MLB': 'LB', 'LLB': 'LB', 'RLB': 'LB', 'OLB': 'LB', 'ILB': 'LB', 'LB': 'LB', 'LCB': 'CB', 'RCB': 'CB', 'CB': 'CB',
                      'SS': 'DS', 'FS': 'DS', 'S': 'DS'}
    carded = {p['id'] for p in players}
    lineup_off, lineup_def = [], []
    for r in starters_rows:
        n, pos = clean(r['Player']), r['Pos'].upper()
        if ids.get(n) not in carded:
            continue
        if pos in offense_listed:
            lineup_off.append({'listed': offense_listed[pos], 'playerId': ids[n]})
        elif pos in defense_listed:
            lineup_def.append({'listed': defense_listed[pos], 'playerId': ids[n]})
    front = sum(1 for e in lineup_def if e['listed'] in ('DE', 'DT'))
    record = (pass_totals.get('QBrec') or '').rsplit('-0', 1)[0] if pass_totals.get('QBrec', '').endswith('-0') else pass_totals.get('QBrec', '')
    notes.append(f'Fumbles lost {fl} (the 1-{fumbles_lost["to"] if fumbles_lost else "?"} row). Big plays left at 0: a judgement '
                 'rating for the top teams only.')
    return {
        'id': meta['id'], 'year': year, 'name': meta['name'], 'city': meta['city'], 'shortName': meta['city'],
        'abbreviation': meta['abbreviation'], 'division': meta['division'], 'coach': meta.get('coach', ''), 'record': record,
        'bigPlays': {'home': 0, 'road': 0}, 'fumblesLost': fumbles_lost, 'players': players,
        'startingLineup': {'offense': lineup_off, 'defenseFormation': '3-4' if front == 3 else '4-3', 'defense': lineup_def},
        'kickReturn': unit('K'), 'puntReturn': unit('P'),
        'dataNotes': ['Built from Pro Football Reference season tables with the official Avalon Hill formulas (tools/pfr_to_team.py).'] + notes,
    }

def rush_column(r, n, notes, qb=False):
    """Rushing columns. Small samples follow the official cards: a spare card, or a capped long game."""
    if not r:
        r = {}
    att, yds = num(r.get('Rushing:Att')), num(r.get('Rushing:Yds'))
    longest = int(num(r.get('Rushing:Lng')))
    if att <= SPARE_MAX_CARRIES and not qb:
        n_col, sg, lg = SPARE_BACK
        ncol = ['SG'] + ints(n_col.split(' ', 1)[1])
        if att:
            notes.append(f'{n}: {att:.0f} carries, the spare back\'s card.')
        return [{'n': ncol[i], 'sg': sg, 'lg': lg} for i in range(12)]
    seldom = att < FULL_CARD_CARRIES
    # The longest run lives at LG #1; with few carries it mustn't also inflate the average.
    avg = ((yds - longest) / (att - 1) if seldom and att > 1 else yds / att) if att else 1.0
    key = max([k for k in sorted(RUSHING) if k <= round(max(1.0, avg), 1)] or [1.0])
    n_col, sg_col, lg_base = RUSHING[key]
    ncol = ['SG'] + ints(n_col)
    if seldom:
        top = max(10, longest)
        sg = [max(10, top - i) for i in range(12)]
        lg = [top] * 12
        notes.append(f'{n}: {att:.0f} carries, {avg:.1f} a carry without his longest ({longest}): SG down from it, LG flat at it.')
    else:
        sg = ints(sg_col)
        longest = longest or lg_base
        lg = [longest] * 12 if longest <= lg_base else [round(lg_base + (longest - lg_base) * ((11 - i) / 11) ** 2) for i in range(12)]
    return [{'n': ncol[i], 'sg': sg[i], 'lg': lg[i]} for i in range(12)]

def catch_column(r, n, notes):
    """Pass gain columns. Few catches: a Q column only; some catches: Q and S, and a short L column then "inc"."""
    rec, yds = num(r.get('Receiving:Rec')), num(r.get('Receiving:Yds'))
    longest = int(num(r.get('Receiving:Lng')))
    seldom = rec < FULL_CARD_CATCHES
    avg = ((yds - longest) / (rec - 1) if seldom and rec > 1 else yds / rec) if rec else 3
    q, s = RECEIVING[max(3, min(28, round(avg)))]
    qv = ints(q)
    sv = ints(s) if s else qv
    cell = lambda v: 'LG' if v == 'L' else v
    if rec <= SPARE_MAX_CATCHES:
        # Short and long passes to him are incomplete; quick passes can't send him to the L column.
        qv = [v if v != 'L' else max(x for x in qv if x != 'L') for v in qv]
        return [{'q': qv[i], 's': None, 'l': None} for i in range(12)]
    base = sv[-1] if sv[-1] != 'L' else 5
    longest = longest or max(x for x in sv if x != 'L')
    if seldom:
        lv = [round(longest - (longest - base) * i / (SELDOM_L_ROWS - 1)) if i < SELDOM_L_ROWS else 'INC' for i in range(12)]
    else:
        lv = [max(base, round(longest - (longest - base) * i / 11)) for i in range(12)]
    return [{'q': cell(qv[i]), 's': cell(sv[i]), 'l': lv[i]} for i in range(12)]

if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('folder'); ap.add_argument('year', type=int); ap.add_argument('team')
    ap.add_argument('--id', required=True); ap.add_argument('--name', required=True); ap.add_argument('--city', required=True)
    ap.add_argument('--abbreviation', required=True); ap.add_argument('--division', required=True); ap.add_argument('--coach', default='')
    ap.add_argument('--suffix', default='')
    a = ap.parse_args()
    meta = {'id': a.id, 'name': a.name, 'city': a.city, 'abbreviation': a.abbreviation, 'division': a.division, 'coach': a.coach}
    json.dump(build(Path(a.folder), a.year, a.team, a.suffix, meta), sys.stdout, indent=2)
    print()
