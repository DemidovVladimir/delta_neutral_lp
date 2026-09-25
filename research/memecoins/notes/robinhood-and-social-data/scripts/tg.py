#!/usr/bin/env python3
# tg.py channel [query] [before]  -> messages from public t.me/s preview
import sys,re,html,subprocess,urllib.parse
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
ch=sys.argv[1]; q=sys.argv[2] if len(sys.argv)>2 and sys.argv[2] else None; before=sys.argv[3] if len(sys.argv)>3 else None
u=f"https://t.me/s/{ch}"+("?q="+urllib.parse.quote(q) if q else "")+((("&" if q else "?")+"before="+before) if before else "")
h=subprocess.run(["curl","-sL","--max-time","30","-A",UA,u],capture_output=True).stdout.decode()
for blk in re.findall(r'<div class="tgme_widget_message_wrap.*?(?=<div class="tgme_widget_message_wrap|$)',h,re.S):
    pid=re.search(r'data-post="([^"]+)"',blk); t=re.search(r'<time datetime="([^"]+)"',blk)
    tx=re.search(r'<div class="tgme_widget_message_text[^"]*"[^>]*>(.*?)</div>',blk,re.S)
    links=re.findall(r'href="(https?://[^"]+)"',tx.group(1)) if tx else []
    txt=re.sub(r'\s+',' ',html.unescape(re.sub('<br/?>','\n',re.sub(r'<(?!br)[^>]+>','',tx.group(1))))) if tx else ''
    print('-',t.group(1) if t else '',pid.group(1) if pid else '','|',txt[:600],'|',' '.join(l for l in links if 't.me' not in l)[:400])
