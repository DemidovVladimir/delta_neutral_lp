import sys,json,os,random; sys.path.insert(0,'.')
from hel import rpc,calls
from collections import defaultdict
ev=json.load(open('kol/events_all.json'))
venues=set(sys.argv[1].split(',')); per=int(sys.argv[2]); maxcalls=int(sys.argv[3]); seed=int(sys.argv[4]) if len(sys.argv)>4 else 7
random.seed(seed)
by=defaultdict(list)
for e in ev:
    if e['venue'] in venues: by[e['kol']].append(e)
sample=[]
for k,l in sorted(by.items()):
    random.shuffle(l); sample+=l[:per]
print('sample size',len(sample))
os.makedirs('kol/ev',exist_ok=True)
def q(mint,filt,limit,order='asc'):
    return rpc('getTransactionsForAddress',[mint,{"transactionDetails":"full","sortOrder":order,"limit":limit,"maxSupportedTransactionVersion":1,"encoding":"json","filters":dict(status="succeeded",**filt)}])['data']
for e in sample:
    out=f"kol/ev/{e['wallet']}_{e['mint']}.json"
    if os.path.exists(out): continue
    if calls()>maxcalls: print('call cap reached'); break
    res={'event':e,'A':None,'B':None,'H':{},'Hdesc':{},'S':None}
    A=q(e['mint'],{"slot":{"gte":e['slot0']}},100); res['A']=A
    lastA=A[-1]['blockTime'] if A else e['t0']
    if len(A)==100 and lastA<e['t0']+62:
        res['B']=q(e['mint'],{"blockTime":{"gte":e['t0']+60}},20)
    for H in (300,1800,7200):
        if len(A)<100 and lastA<e['t0']+H:
            d=[]  # token had fewer than 100 txs after t0 -> no trades after lastA
        else:
            d=q(e['mint'],{"blockTime":{"gte":e['t0']+H}},12)
        res['H'][H]=d
        if not d:
            res['Hdesc'][H]=q(e['mint'],{"blockTime":{"lte":e['t0']+H}},12,'desc') if (len(A)==100) else []
    fs=e.get('first_sell_ts')
    if fs and not (A and len(A)==100 and lastA>=fs+12) and not (len(A)<100):
        res['S']=q(e['mint'],{"blockTime":{"gte":fs}},60)
    json.dump(res,open(out,'w'))
    print(e['kol'],e['mint'],e['venue'],'A',len(A),'span',lastA-e['t0'],'calls',calls(),flush=True)
