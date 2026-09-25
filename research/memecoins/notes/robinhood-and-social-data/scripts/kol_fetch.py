import sys,json,os,time; sys.path.insert(0,'.')
from hel import rpc,calls
sel=json.load(open('kol/selected.json'))
sel+= [{'name':'Cented','wallet':'CyaE1VxvBrahnPWkqm5VsdCvyS2QmNht2UFrKJHga54o'},{'name':'Cupsey','wallet':'2fg5QD1eD7rzNNCsvnhmXFm5hqNgwTTG8p7kQ6f3rx6f'}]
MAXP=int(sys.argv[1]) if len(sys.argv)>1 else 3
for k in sel:
    W=k['wallet']; out=f'kol/raw_{W}.json'
    if os.path.exists(out): continue
    data=[]; tok=None
    for p in range(MAXP):
        opts={"transactionDetails":"full","sortOrder":"desc","limit":100,"maxSupportedTransactionVersion":1,"encoding":"json","filters":{"status":"succeeded","tokenAccounts":"balanceChanged","tokenTransfer":{"direction":"any"}}}
        if tok: opts['paginationToken']=tok
        r=rpc('getTransactionsForAddress',[W,opts])
        data+=r['data']; tok=r.get('paginationToken')
        if not tok or len(r['data'])<100: break
    json.dump(data,open(out,'w'))
    print(k['name'],W,len(data),'calls',calls(),flush=True)
