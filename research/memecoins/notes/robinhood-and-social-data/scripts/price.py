import sys,json; sys.path.insert(0,'.')
from parse import allkeys,signers
WSOL='So11111111111111111111111111111111111111112'
def amt(b): return int(b['uiTokenAmount']['amount'])/(10**b['uiTokenAmount']['decimals'])
def owner_deltas(m):
    """{owner:{mint:delta}} from token balances"""
    pre={b['accountIndex']:b for b in m['preTokenBalances']}
    post={b['accountIndex']:b for b in m['postTokenBalances']}
    d={}
    for i in set(pre)|set(post):
        b=post.get(i) or pre.get(i); o=b.get('owner'); mt=b['mint']
        v=(amt(post[i]) if i in post else 0)-(amt(pre[i]) if i in pre else 0)
        if abs(v)>0: d.setdefault(o,{}); d[o][mt]=d[o].get(mt,0)+v
    return d
def pool_trade(t,mint):
    m=t['meta']
    if m.get('err'): return None
    ks=allkeys(t); sg=set(signers(t))
    od=owner_deltas(m)
    cands=[(abs(v[mint]),o) for o,v in od.items() if mint in v and o not in sg]
    if not cands: return None
    _,pool=max(cands)
    dtok=od[pool][mint]
    q={mt:v for mt,v in od[pool].items() if mt!=mint}
    # native SOL of pool owner merges with wSOL
    if pool in ks:
        i=ks.index(pool); nat=(m['postBalances'][i]-m['preBalances'][i])/1e9
        if nat: q[WSOL]=q.get(WSOL,0)+nat
    opp=[(abs(v),mt) for mt,v in q.items() if v!=0 and (v>0)!=(dtok>0)]
    if not opp: return None
    _,qm=max(opp); dq=q[qm]
    return dict(price=abs(dq)/abs(dtok),quote=qm,side=('buy' if dtok<0 else 'sell'),qamt=abs(dq),pool=pool,ts=t['blockTime'],slot=t['slot'],idx=t.get('transactionIndex',0),sig=t['transaction']['signatures'][0],signer=signers(t)[0])
