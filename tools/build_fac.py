import json, re
raw=json.load(open('fac_lines.json'))
OFF={'LT','LG','CN','RG','RT','LE','RE','BK'}
BOX=set('ABCDEFGHIJKLMNO')
notes=[]
def run_dir(s, cid, key):
    s=s.strip()
    if s=='Break': return {'kind':'break'}
    m=re.fullmatch(r'(\w+) vs (\w+)',s)
    if m:
        a,b=m.groups(); assert a in OFF and b in BOX,(cid,s); return {'kind':'matchup','blocker':a,'box':b}
    parts=[x.strip() for x in s.split('+')]
    fixed=[]
    for x in parts:
        if re.fullmatch(r'[1-5]',x):
            notes.append(f"card {cid}: {key} '{s}' read as '{s.replace(x,'I')}' (digit typo, the OB twin of this card prints 'I')"); x='I'
        fixed.append(x)
    if all(x in OFF for x in fixed): return {'kind':'blockers','players':fixed}
    if all(x in BOX for x in fixed): return {'kind':'boxes','boxes':fixed}
    raise ValueError((cid,s))
def pass_target(s):
    s=s.strip()
    return {'Orig':'ORIG','PassRush':'PASS_RUSH'}.get(s,s)
def screen(s):
    s=s.strip()
    if s=='Inc': return {'result':'INC'}
    if s=='Int': return {'result':'INT'}
    m=re.fullmatch(r'Com(?: x (\S+))?',s); assert m,s
    mult={'2':2,'3':3,'½':0.5,None:1}[m.group(1)]
    return {'result':'COM','multiplier':mult}
SOL={'R(NK)':'RUN_NO_KEY','R(BC)':'RUN_KEY_BC','P':'PASS','P(x2)':'PASS_DOUBLE','PR':'PREVENT','PR(x2)':'PREVENT_DOUBLE','BLZ':'BLITZ'}
cards=[]; zc=0
for lines in raw:
    if lines[2]=='Z':
        zc+=1; cards.append({'id':f'Z{zc:02d}','isZ':True}); continue
    if 'Cards' in ' '.join(lines): continue  # title card
    cid=len([c for c in cards if not c.get('isZ')])+1
    t={}
    rn,pn=lines[3].split()
    ob=rn.endswith('(OB)'); rn=int(rn.replace('(OB)',''))
    body=lines[4:]
    def get(label):
        for l in body:
            m=re.search(re.escape(label)+r':\s*(.+?)(?=\s+[A-Z]{2}:|$)', l)
            if m: return m.group(1)
        raise KeyError((cid,label))
    runs={k:run_dir(get(k),cid,k) for k in ['SL','SR','IL','IR']}
    er=[l for l in body if l.startswith('End Around')][0].split(':')[1].strip()
    # passes: line 'QK: x LG: y' and 'SH: x SC: y'
    pl=[l for l in body if l.startswith('QK:')][0]; sl=[l for l in body if l.startswith('SH:')][0]
    qk,lg=re.fullmatch(r'QK: (\S+) LG: (\S+)',pl).groups()
    sh,sc=re.fullmatch(r'SH: (\S+) SC: (.+)',sl).groups()
    zi=body.index('Z Results:'); zline=body[zi+1]
    if zline.startswith('Inj:'): z={'type':'INJURY','target':zline[4:].strip()}
    elif zline.startswith('Pen:'):
        codes=re.findall(r'(\d)\s*\.\s*([ODKR])(\d+)',zline)
        assert len(codes)==4,(cid,zline)
        z={'type':'PENALTY','byCategory':[{'against':a,'penalty':int(n)} for _,a,n in codes]}
    elif zline.startswith('Fumble'):
        z={'type':'FUMBLE','homeTeamExempt': zline=='Fumble(s)'}
    else: raise ValueError(zline)
    sol=body[body.index('Solitaire:')+1]
    defs=[re.sub(r'^\d\.','',x) for x in sol.split('/')]
    assert len(defs)==5,(cid,sol)
    cards.append({'id':f'F{cid:02d}','isZ':False,'runNumber':rn,'outOfBounds':ob,'passNumber':int(pn),
      'runs':runs,'endAround': 'OK' if er=='OK' else int(er),
      'passes':{'QK':pass_target(qk),'SH':pass_target(sh),'LG':pass_target(lg)},'screen':screen(sc),
      'z':z,'solitaire':[SOL[x] for x in defs]})
reg=[c for c in cards if not c['isZ']]
print('regular',len(reg),'z',zc)
# sanity: ranges
assert all(1<=c['runNumber']<=12 and 1<=c['passNumber']<=48 for c in reg)
# duplicates
seen={}
for c in reg:
    k=json.dumps({x:c[x] for x in c if x!='id'},sort_keys=True)
    if k in seen: notes.append(f"card {c['id']} is an exact duplicate of {seen[k]}")
    else: seen[k]=c['id']
from collections import Counter
print('RN dist',sorted(Counter(c['runNumber'] for c in reg).items()))
print('PN 1-48 coverage',sorted(Counter(c['passNumber'] for c in reg).items()))
json.dump(cards, open('fac-deck.json','w'), indent=2, ensure_ascii=False)
print('\n'.join(notes))
