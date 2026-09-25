import sys,json,glob,statistics as st; sys.path.insert(0,'.')
from price import pool_trade
RT_COSTS=[0.04,0.05]   # round-trip cost assumptions
def med(x): return st.median(x) if x else None
rows=[]
for f in sorted(glob.glob('kol/ev/*.json')):
    r=json.load(open(f)); e=r['event']; mint=e['mint']
    pools=set()
    txs={}
    for lst in [r['A'],r.get('B') or [],r.get('S') or []]+list(r['H'].values())+list(r['Hdesc'].values())+list((r.get('X') or {}).values()):
        for t in lst: txs[t['transaction']['signatures'][0]]=t
    trades=[]
    for s,t in txs.items():
        p=pool_trade(t,mint)
        if p: trades.append(p)
    trades.sort(key=lambda p:(p['slot'],p['idx']))
    kol=[p for p in trades if p['sig']==e['sig0']]
    if not kol: 
        rows.append(dict(kol=e['kol'],mint=mint,venue=e['venue'],err='kol tx not parsed')); continue
    k=kol[0]; kpos=(k['slot'],k['idx']); p0=k['price']
    trades=[p for p in trades if p['quote']==k['quote']]
    after=[p for p in trades if (p['slot'],p['idx'])>kpos]
    A_last=r['A'][-1]['blockTime'] if r['A'] else e['t0']
    dead_after = len(r['A'])<100   # all txs after t0 fit in A => nothing beyond A_last
    def P_at(ts_min, ref=kpos, strict_slot=False):
        c=[p for p in after if p['ts']>=ts_min and (p['slot']>ref[0] if strict_slot else True)]
        if c: return med([p['price'] for p in c[:3]]), c[0]['ts']
        return None,None
    def P_mark(ts):
        # price at time ts: first trades at/after ts; else last trade before ts
        v,_=P_at(ts)
        if v is not None: return v,'after'
        before=[p for p in trades if p['ts']<=ts]
        if before: return med([p['price'] for p in before[-3:]]),'last_before'
        return None,None
    # same-slot followers
    same=[p for p in after if p['slot']==k['slot']]
    same_buys=[p for p in same if p['side']=='buy']
    nxt=[p for p in after if p['slot']>k['slot']]
    row=dict(kol=e['kol'],wallet=e['wallet'],mint=mint,venue=e['venue'],quote=k['quote'],t0=e['t0'],kol_sol=round(e['buy_sol'],4),p_kol=p0,
             same_slot_buys=len(same_buys),same_slot_buy_q=round(sum(p['qamt'] for p in same_buys),3),
             p_same_slot_last=(same[-1]['price'] if same else None))
    # entries
    ent={}
    ent['slot+1']=med([p['price'] for p in nxt[:3]]) if nxt else None
    for D in (2,10,60):
        v,_=P_at(e['t0']+D); ent[f'+{D}s']=v
    row['entry']=ent
    # exits
    ex={}
    for H in (60,300,1800,7200):
        v,how=P_mark(e['t0']+H); ex[H]=v; row[f'mark_{H}']=how
    row['exit']=ex
    # KOL behaviour
    fs=e.get('first_sell_ts')
    row['first_sell_after_s']=(fs-e['t0']) if fs else None
    row['sold_frac']=(e['tot_sell_tok']/e['tot_buy_tok']) if e['tot_buy_tok'] else None
    row['kol_realized_sol']=round(e['tot_sell_sol']-e['tot_buy_sol'],4) if e['n_sells'] else None
    row['kol_n_buys']=e['n_buys']; row['kol_n_sells']=e['n_sells']
    # KOL first-sell pool price
    ks=[p for p in trades if p['sig']==e.get('first_sell_sig')]
    row['p_kol_first_sell']=ks[0]['price'] if ks else None
    # mirror exit for followers: price at first sell + D
    mir={}
    if fs:
        for D in (2,10,60):
            v,how=P_mark(fs+D); mir[f'+{D}s']=v
    row['mirror_exit']=mir
    rows.append(row)
json.dump(rows,open('kol/event_results.json','w'),indent=1)
ok=[r for r in rows if 'err' not in r]
print('events',len(rows),'parsed',len(ok),'errors',[ (r['kol'],r['mint'],r['err']) for r in rows if 'err' in r])
