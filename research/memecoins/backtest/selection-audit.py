"""
Selection audit of the van de Wouw tape against RED-PUMP-2026-v1's independent launch census
(stdlib only). Question: is inclusion in the tape correlated with the coin's OUTCOME (look-ahead
survivorship)? Output: research/memecoins/results/raw/selection-audit.json

  python3 research/memecoins/backtest/selection-audit.py
"""
import gzip, json, collections, sqlite3, os
ROOT = os.path.join(os.path.dirname(__file__), '..')
con = sqlite3.connect(f"file:{os.path.abspath(ROOT)}/data/public/pumpfun_database.db?immutable=1", uri=True)
vdw = {m for (m,) in con.execute("select mint from tokens")}
vdwdays = collections.Counter(int(ts // 86400) for (ts,) in con.execute("select created_at from tokens"))
good = {d for d, c in vdwdays.items() if c >= 5000}  # days the tape collected fully
rp = {}
for line in gzip.open(f"{ROOT}/data/public/redpump/red_pump_2026_v1_launches.jsonl.gz", 'rt'):
    j = json.loads(line); rp.setdefault(j['mint'], j)
out, fin = {}, {}
for line in gzip.open(f"{ROOT}/data/public/redpump/red_pump_2026_v1_outcomes.csv.gz", 'rt'):
    c = line.rstrip('\n').split(',')
    if len(c) < 7 or c[3] not in ('GRADUATED', 'TIMEOUT'): continue
    if out.get(c[1]) == 'GRADUATED': continue
    out[c[1]] = c[3]
    try: fin[c[1]] = float(c[6])
    except ValueError: pass
def ibucket(im):
    return '=30' if abs(im - 30) < 1e-6 else ('<30' if im < 30 else ('30-32' if im < 32 else ('32-45' if im < 45 else '>=45')))
def fbucket(r):
    return 'fell' if r < 0.9 else ('flat' if r < 1.2 else ('x1.2-2' if r < 2 else ('x2-5' if r < 5 else '>=x5')))
tab = collections.defaultdict(lambda: [0, 0, 0, 0]); tab2 = collections.defaultdict(lambda: [0, 0])
for m, j in rp.items():
    if int(j['created_timestamp'] // 86400000) not in good: continue
    im = j['initial_market_cap_sol']; g = out.get(m) == 'GRADUATED'; i = m in vdw
    t = tab[ibucket(im)]; t[0] += 1; t[1] += i; t[2] += g; t[3] += (g and i)
    if m in fin and im > 0 and not g:
        t2 = tab2[(ibucket(im), fbucket(fin[m] / im))]; t2[0] += 1; t2[1] += i
res = {'fullyCollectedOverlapDays': len(good), 'byInitialMcap': {}, 'byInitialMcapAndEarlyMove_nonGraduated': {}}
for b, (n, i, g, gi) in sorted(tab.items()):
    res['byInitialMcap'][b] = {'n': n, 'pInTape': i / n, 'pInTape_graduated6min': gi / g if g else None, 'pInTape_notGraduated': (i - gi) / (n - g), 'nGraduated6min': g}
for (b, f), (n, i) in sorted(tab2.items()):
    res['byInitialMcapAndEarlyMove_nonGraduated'][f'{b}|{f}'] = {'n': n, 'pInTape': i / n}
os.makedirs(f"{ROOT}/results/raw", exist_ok=True)
json.dump(res, open(f"{ROOT}/results/raw/selection-audit.json", 'w'), indent=1)
print(json.dumps(res, indent=1))
