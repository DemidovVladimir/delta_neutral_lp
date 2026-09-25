import json,statistics as st,random,sys
R=[r for r in json.load(open('kol/event_results.json')) if 'err' not in r]
flt=sys.argv[1] if len(sys.argv)>1 else 'all'
if flt=='sol': R=[r for r in R if r['quote']=='So11111111111111111111111111111111111111112']
if flt=='nonsol': R=[r for r in R if r['quote']!='So11111111111111111111111111111111111111112']
print('N events',len(R),'filter',flt, 'KOLs',len(set(r['kol'] for r in R)))
def summ(xs,label):
    xs=[x for x in xs if x is not None]
    if not xs: print(f'{label:34s} n=0'); return
    random.seed(1)
    bs=sorted(st.median(random.choices(xs,k=len(xs))) for _ in range(2000))
    print(f'{label:34s} n={len(xs):3d} median={100*st.median(xs):8.2f}% mean={100*st.mean(xs):8.2f}% win={100*sum(1 for x in xs if x>0)/len(xs):5.1f}%  medCI95=[{100*bs[50]:.1f},{100*bs[1950]:.1f}]')
Hs=[60,300,1800,7200]; Ds=['slot+1','+2s','+10s','+60s']
print('\n-- latency tax: follower entry price vs KOL pool price')
for D in Ds: summ([r['entry'][D]/r['p_kol']-1 if r['entry'][D] else None for r in R],f'entry {D} vs KOL')
print('\n-- KOL own entry, gross mark-to-market')
for H in Hs: summ([r['exit'][str(H)]/r['p_kol']-1 if r['exit'][str(H)] else None for r in R],f'KOL gross {H//60}m')
for c in (0.0,0.04,0.05):
  print(f'\n-- FOLLOWER fixed-horizon exits, round-trip cost {c*100:.0f}%')
  for D in Ds:
    for H in Hs:
        xs=[]
        for r in R:
            e=r['entry'][D]; x=r['exit'][str(H)]
            if e and x: xs.append(x/e*(1-c)-1)
        summ(xs,f'enter {D:6s} exit {H//60:3d}m')
print('\n-- FOLLOWER mirror exit (sell when KOL first sells, same latency), cost 4% / 5%')
for c in (0.04,0.05):
  for D in ['+2s','+10s','+60s']:
    xs=[]
    for r in R:
        e=r['entry'][D]; x=r['mirror_exit'].get(D) if r['mirror_exit'] else None
        if e and x and r['first_sell_after_s'] is not None and r['first_sell_after_s']<=7200: xs.append(x/e*(1-c)-1)
        elif e and r['exit']['7200'] and (r['first_sell_after_s'] is None or r['first_sell_after_s']>7200): xs.append(r['exit']['7200']/e*(1-c)-1)
    summ(xs,f'mirror {D} cost {c*100:.0f}%')
print('\n-- KOL behaviour')
fs=[r['first_sell_after_s'] for r in R]
n=len(R)
for lim in (60,300,1800,7200):
    print(f'KOL first sell within {lim//60:4d} min: {sum(1 for x in fs if x is not None and x<=lim)}/{n} = {100*sum(1 for x in fs if x is not None and x<=lim)/n:.0f}%')
print('never sold in window:',sum(1 for x in fs if x is None),'/',n)
hs=sorted(x for x in fs if x is not None); print('median time to KOL first sell (s):',st.median(hs) if hs else None, 'p25/p75',hs[len(hs)//4] if hs else None,hs[3*len(hs)//4] if hs else None)
print('same-slot co-buys after KOL: median',st.median([r['same_slot_buys'] for r in R]),'mean',round(st.mean([r['same_slot_buys'] for r in R]),1),'share events >=1:',f"{100*sum(1 for r in R if r['same_slot_buys']>=1)/n:.0f}%")
# sold into followers
sif=0;elig=0
for r in R:
    e10=r['entry']['+10s']; x=r['exit']['7200']; ps=r['p_kol_first_sell']; f=r['first_sell_after_s']
    if e10 and x:
        elig+=1
        if f is not None and f<=1800 and ps and ps>e10 and x<e10: sif+=1
print(f'"sold into followers" (KOL first sell <=30m at price > +10s follower entry, and 2h mark < that entry): {sif}/{elig} = {100*sif/elig:.0f}%')
sol=[r for r in R if r['kol_realized_sol'] is not None and r['sold_frac'] and r['sold_frac']>0.95]
print('KOL fully-exited events:',len(sol),'realized SOL median',st.median([r['kol_realized_sol'] for r in sol]) if sol else None,'sum',round(sum(r['kol_realized_sol'] for r in sol),2),'win',f"{100*sum(1 for r in sol if r['kol_realized_sol']>0)/len(sol):.0f}%" if sol else None)
