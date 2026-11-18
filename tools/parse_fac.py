import pdfplumber, json, re
d = pdfplumber.open('/mnt/user-data/uploads/FACdeck.PDF')
cards=[]
for p in d.pages:
    words=p.extract_words()
    heads=sorted([w for w in words if w['text']=='Statis-Pro'], key=lambda w:(round(w['top']),w['x0']))
    for h in heads:
        L=h['x0']-17; R=L+110; T=h['top']-3; B=T+178
        ws=[w for w in words if L<=w['x0']<R and T<=w['top']<B]
        lines={}
        for w in ws:
            k=round(w['top'])
            lines.setdefault(k,[]).append(w)
        txt=[' '.join(x['text'] for x in sorted(v,key=lambda w:w['x0'])) for k,v in sorted(lines.items())]
        cards.append(txt)
json.dump(cards, open('fac_lines.json','w'), indent=1)
print(len(cards))
for c in [cards[0],cards[-14],cards[-1]]: print('\n'.join(c)); print('====')
