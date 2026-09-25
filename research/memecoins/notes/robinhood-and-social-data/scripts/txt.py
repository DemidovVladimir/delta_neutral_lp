#!/usr/bin/env python3
# usage: txt.py URL [maxchars] -> visible paragraph text
import sys,re,html,subprocess
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
u=sys.argv[1]; mx=int(sys.argv[2]) if len(sys.argv)>2 else 8000
h=subprocess.run(["curl","-sL","--max-time","40","-A",UA,"-H","Accept-Language: en-US,en;q=0.9",u],capture_output=True).stdout.decode("utf-8","replace")
h=re.sub(r'(?is)<(script|style|noscript|svg|nav|footer|header)[^>]*>.*?</\1>','',h)
t=re.search(r'(?is)<title>(.*?)</title>',h)
print('TITLE:',html.unescape(t.group(1)).strip() if t else None)
for m in re.finditer(r'(?is)<meta[^>]+(?:property|name)="(article:published_time|og:description|datePublished|article:modified_time)"[^>]+content="([^"]+)"',h): print('META',m.group(1),m.group(2))
for m in re.finditer(r'"datePublished"\s*:\s*"([^"]+)"',h): print('LD datePublished',m.group(1)); break
out=[]
for m in re.finditer(r'(?is)<(p|h1|h2|h3|li|blockquote|td)[^>]*>(.*?)</\1>',h):
    s=html.unescape(re.sub(r'(?s)<[^>]+>',' ',m.group(2))); s=re.sub(r'\s+',' ',s).strip()
    if len(s)>25: out.append(s)
txt='\n'.join(out)
print(txt[:mx])
print('[len',len(txt),']')
