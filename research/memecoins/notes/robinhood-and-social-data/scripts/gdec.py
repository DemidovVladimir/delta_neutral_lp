#!/usr/bin/env python3
# decode google news rss article url -> real url
import sys,re,subprocess,json,urllib.parse
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
def curl(args): return subprocess.run(["curl","-s","--max-time","30","-A",UA,"-b","SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg; CONSENT=YES+cb"]+args,capture_output=True).stdout.decode("utf-8","replace")
def dec(u):
    gid=u.split('/articles/')[1].split('?')[0]
    h=curl(["-L",f"https://news.google.com/rss/articles/{gid}?hl=en-US&gl=US&ceid=US:en"])
    sg=re.search(r'data-n-a-sg="([^"]+)"',h); ts=re.search(r'data-n-a-ts="([^"]+)"',h)
    if not sg: return None
    inner=json.dumps(["garturlreq",[["X","X",["X","X"],None,None,1,1,"US:en",None,1,None,None,None,None,None,0,1],"X","X",1,[1,1,1],1,1,None,0,0,None,0],gid,int(ts.group(1)),sg.group(1)])
    freq=json.dumps([[["Fbv4je",inner,None,"generic"]]])
    r=curl(["-X","POST","https://news.google.com/_/DotsSplashUi/data/batchexecute","-H","Content-Type: application/x-www-form-urlencoded;charset=UTF-8","--data","f.req="+urllib.parse.quote(freq)])
    m=re.search(r'\[\\"garturlres\\",\\"(.*?)\\"',r)
    return m.group(1).replace('\\\\u003d','=').replace('\\\\u0026','&') if m else r[:200]
for u in sys.argv[1:]: print(dec(u))
