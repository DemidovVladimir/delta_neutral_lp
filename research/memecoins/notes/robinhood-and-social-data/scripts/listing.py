import json,subprocess,datetime,time,statistics as st
EV=[('WIF','spot','WIFUSDT','2024-11-25'),('PENGU','spot','PENGUUSDT','2025-03-13'),('PNUT','spot','PNUTUSDT','2025-03-13'),('POPCAT','fut','POPCATUSDT','2025-03-13'),
    ('MOODENG','fut','MOODENGUSDT','2025-05-22'),('MEW','fut','MEWUSDT','2025-05-22'),('HYPE','fut','HYPEUSDT','2025-10-23'),('RENDER','spot','RENDERUSDT','2026-01-29'),
    ('PYTH','spot','PYTHUSDT','2026-01-28'),('ZEC','spot','ZECUSDT','2026-04-23'),('VIRTUAL','spot','VIRTUALUSDT','2026-09-07')]
def kl(kind,sym,start,end):
    base='https://api.binance.com/api/v3/klines' if kind=='spot' else 'https://fapi.binance.com/fapi/v1/klines'
    out=[];s=start
    while s<end:
        u=f'{base}?symbol={sym}&interval=1m&startTime={s}&endTime={end}&limit={1000 if kind=="spot" else 1500}'
        r=json.loads(subprocess.run(['curl','-s','--max-time','30',u],capture_output=True).stdout or b'[]')
        if not isinstance(r,list) or not r: break
        out+=r; s=r[-1][0]+60000; time.sleep(0.15)
    return out
res={}
for name,kind,sym,day in EV:
    D=datetime.datetime.fromisoformat(day).replace(tzinfo=datetime.UTC)
    start=int((D-datetime.timedelta(days=2)).timestamp()*1000); end=int((D+datetime.timedelta(days=4)).timestamp()*1000)
    k=kl(kind,sym,start,end)
    json.dump(k,open(f'bn/{name}_{day}.json','w'))
    res[name]=len(k); print(name,sym,day,len(k),flush=True)
