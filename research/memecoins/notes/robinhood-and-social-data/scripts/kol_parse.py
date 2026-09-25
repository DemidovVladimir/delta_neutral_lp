import sys,json,glob,datetime; sys.path.insert(0,'.')
from parse import *
from collections import Counter,defaultdict
sel=json.load(open('kol/selected.json'))+[{'name':'Cented','wallet':'CyaE1VxvBrahnPWkqm5VsdCvyS2QmNht2UFrKJHga54o'},{'name':'Cupsey','wallet':'2fg5QD1eD7rzNNCsvnhmXFm5hqNgwTTG8p7kQ6f3rx6f'}]
VENUES={'6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P':'pumpfun','pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA':'pumpswap','LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj':'raydium_launchlab','CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C':'raydium_cpmm','CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK':'raydium_clmm','675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8':'raydium_v4','dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN':'meteora_dbc','cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG':'meteora_damm_v2','Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB':'meteora_damm_v1','LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo':'meteora_dlmm','whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc':'orca','JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4':'jupiter'}
PRIO=['pumpfun','pumpswap','raydium_launchlab','meteora_dbc','raydium_cpmm','raydium_v4','meteora_damm_v2','meteora_damm_v1','meteora_dlmm','raydium_clmm','orca','jupiter']
trades=[]
for k in sel:
    W=k['wallet']; data=json.load(open(f'kol/raw_{W}.json'))
    for t in data:
        if W not in signers(t): continue
        sol,tok=deltas(t,W)
        tok={m:v for m,v in tok.items() if m not in QUOTE}
        if len(tok)!=1: continue
        mint,dt=list(tok.items())[0]
        ps=programs(t); vs=[VENUES[p] for p in ps if p in VENUES]
        venue=next((v for v in PRIO if v in vs),'other')
        if dt>0 and sol<0: side='buy'
        elif dt<0 and sol>0: side='sell'
        else: continue
        trades.append(dict(kol=k['name'],wallet=W,sig=t['transaction']['signatures'][0],slot=t['slot'],ts=t['blockTime'],mint=mint,side=side,sol=round(sol,9),tokens=dt,venue=venue,fee_lamports=t['meta']['fee']))
trades.sort(key=lambda x:(x['wallet'],x['ts']))
json.dump(trades,open('kol/kol_trades.json','w'),indent=0)
print('trades',len(trades))
print(Counter(t['venue'] for t in trades))
print(Counter(t['side'] for t in trades))
by=defaultdict(list)
for t in trades: by[t['kol']].append(t)
for n,ts in by.items():
    span=(ts[-1]['ts']-ts[0]['ts'])/3600
    print(f"{n:14s} trades={len(ts):3d} buys={sum(1 for t in ts if t['side']=='buy'):3d} mints={len(set(t['mint'] for t in ts)):3d} span_h={span:6.1f} from {datetime.datetime.fromtimestamp(ts[0]['ts'],datetime.UTC):%m-%d %H:%M} med_buy_sol={sorted(-t['sol'] for t in ts if t['side']=='buy')[len([1 for t in ts if t['side']=='buy'])//2] if any(t['side']=='buy' for t in ts) else 0:.2f}")
