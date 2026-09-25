import json
SOLMINTS={'So11111111111111111111111111111111111111112'}
QUOTE={'So11111111111111111111111111111111111111112','EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v','Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'}
PUMP='6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'; PSWAP='pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'
def allkeys(t):
    ks=list(t['transaction']['message']['accountKeys'])
    la=t['meta'].get('loadedAddresses') or {}
    return ks+list(la.get('writable',[]))+list(la.get('readonly',[]))
def programs(t):
    ks=allkeys(t); ps=set()
    for i in t['transaction']['message']['instructions']:
        if i['programIdIndex']<len(ks): ps.add(ks[i['programIdIndex']])
    for ii in (t['meta'].get('innerInstructions') or []):
        for i in ii['instructions']:
            if i['programIdIndex']<len(ks): ps.add(ks[i['programIdIndex']])
    return ps
def deltas(t,owner):
    """net SOL (native+wSOL) and per-mint token deltas for owner"""
    ks=allkeys(t); m=t['meta']
    sol=0
    if owner in ks:
        i=ks.index(owner); sol=(m['postBalances'][i]-m['preBalances'][i])/1e9
    tok={}
    def amt(b): return int(b['uiTokenAmount']['amount'])/(10**b['uiTokenAmount']['decimals'])
    pre={b['accountIndex']:b for b in m['preTokenBalances'] if b.get('owner')==owner}
    post={b['accountIndex']:b for b in m['postTokenBalances'] if b.get('owner')==owner}
    for idx in set(pre)|set(post):
        b=post.get(idx) or pre.get(idx); mint=b['mint']
        d=(amt(post[idx]) if idx in post else 0)-(amt(pre[idx]) if idx in pre else 0)
        tok[mint]=tok.get(mint,0)+d
    wsol=tok.pop('So11111111111111111111111111111111111111112',0)
    return sol+wsol, {k:v for k,v in tok.items() if abs(v)>0}
def signers(t):
    ks=t['transaction']['message']['accountKeys']; n=t['transaction']['message']['header']['numRequiredSignatures']
    return ks[:n]
