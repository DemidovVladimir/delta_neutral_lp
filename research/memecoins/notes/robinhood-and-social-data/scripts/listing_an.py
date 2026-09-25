import json,datetime,statistics as st,math,glob,sys
def load(f):
    k=json.load(open(f)); return [(int(c[0])//1000,float(c[1]),float(c[2]),float(c[3]),float(c[4]),float(c[7])) for c in k]  # ts,o,h,l,c,quote_vol
def find(k,day):
    D=int(datetime.datetime.fromisoformat(day).replace(tzinfo=datetime.UTC).timestamp())
    idx={c[0]:i for i,c in enumerate(k)}
    cands=[]
    for i,c in enumerate(k):
        if not (D<=c[0]<D+36*3600): continue
        prev=[x[5] for x in k[max(0,i-1440):i]]
        mv=st.median(prev) if prev else 1
        r=c[4]/k[i-1][4]-1
        if r<=0: continue
        cands.append((r*math.log(1+c[5]/max(mv,1)),i,r,c[5]/max(mv,1)))
    cands.sort(reverse=True)
    return cands[:3]
def px_at(k,ts):
    # close of the candle starting at ts (minute)
    for c in k:
        if c[0]>=ts: return c[4]
    return None
out=[]
for f in sorted(glob.glob('bn/*.json')):
    name,day=f.split('/')[1][:-5].split('_')
    k=load(f)
    c=find(k,day)
    for s,i,r,vr in c[:3]:
        print(name,day,'cand',datetime.datetime.fromtimestamp(k[i][0],datetime.UTC).strftime('%m-%d %H:%M'),f'r1m={100*r:.1f}% volx={vr:.0f}')
    s,i,r,vr=c[0]; T=k[i][0]
    p_pre=k[i-1][4]  # close before spike minute (pre-announcement price)
    hi=max(x[2] for x in k[i:i+10])
    def ret(a,b): 
        pa=px_at(k,T+a*60); pb=px_at(k,T+b*60); return (pb/pa-1) if pa and pb else None
    row=dict(token=name,day=day,T=datetime.datetime.fromtimestamp(T,datetime.UTC).isoformat(),r_1m=r,volx=vr,
        pre_24h=p_pre/px_at(k,T-24*3600)-1, spike_hi10m=hi/p_pre-1,
        insider_exit_1m=px_at(k,T)/p_pre-1, insider_exit_5m=px_at(k,T+4*60)/p_pre-1,
        late1m_to1h=ret(1,60),late1m_to4h=ret(1,240),late1m_to24h=ret(1,1440),late1m_to72h=ret(1,4320),
        late5m_to1h=ret(5,60),late5m_to24h=ret(5,1440),late15m_to24h=ret(15,1440),late60m_to24h=ret(60,1440))
    out.append(row)
json.dump(out,open('bn/listing_results.json','w'),indent=1)
print()
hdr=['token','day','T','pre_24h','insider_exit_1m','spike_hi10m','late1m_to1h','late1m_to4h','late1m_to24h','late1m_to72h','late5m_to24h','late60m_to24h']
print(' | '.join(hdr))
for r in out:
    print(' | '.join((f'{100*r[h]:.1f}%' if isinstance(r[h],float) else str(r[h])) for h in hdr))
for h in ['pre_24h','insider_exit_1m','spike_hi10m','late1m_to1h','late1m_to4h','late1m_to24h','late1m_to72h','late5m_to24h','late60m_to24h']:
    xs=[r[h] for r in out if r[h] is not None]
    print(f'{h:16s} median {100*st.median(xs):6.1f}%  mean {100*st.mean(xs):6.1f}%  pos {sum(1 for x in xs if x>0)}/{len(xs)}')
