# Helius RPC helper: reads RPC_URL from repo .env; never prints it. Counts calls.
import json,subprocess,os,re,time
ENV='/Users/vladimirdemidov/development/delta_neutral_bot/.env'
URL=None
for line in open(ENV):
    if line.startswith('RPC_URL='): URL=line.strip().split('=',1)[1].strip().strip('"').strip("'")
CNT='/private/tmp/claude-501/-Users-vladimirdemidov-development-delta-neutral-bot/c41967bf-2c09-4dbf-ba85-341deee717d4/scratchpad/rpc_calls.txt'
def _bump(method):
    with open(CNT,'a') as f: f.write(f"{int(time.time())} {method}\n")
def rpc(method,params,retries=3):
    body=json.dumps({"jsonrpc":"2.0","id":1,"method":method,"params":params})
    for a in range(retries):
        _bump(method)
        r=subprocess.run(["curl","-s","--max-time","60","-X","POST",URL,"-H","Content-Type: application/json","--data-binary","@-"],input=body.encode(),capture_output=True).stdout
        try:
            d=json.loads(r)
        except Exception:
            time.sleep(2); continue
        if 'error' in d:
            if a<retries-1 and d['error'].get('code') in (-32429,429,-32005): time.sleep(3); continue
            raise RuntimeError(str(d['error'])[:300])
        return d['result']
    raise RuntimeError('rpc failed')
def calls():
    try: return sum(1 for _ in open(CNT))
    except FileNotFoundError: return 0
