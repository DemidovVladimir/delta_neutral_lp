#!/usr/bin/env python3
# usage: gsearch.py "query" [n] [after:YYYY-MM-DD]  -> prints date|title|decoded url
import sys,subprocess,xml.etree.ElementTree as ET,urllib.parse,email.utils
sys.path.insert(0,'.')
from importlib.machinery import SourceFileLoader
g=SourceFileLoader('gdec','gdec.py').load_module() if False else None
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
q=sys.argv[1]; n=int(sys.argv[2]) if len(sys.argv)>2 else 10
t=subprocess.run(["curl","-s","--max-time","30","-A",UA,f"https://news.google.com/rss/search?q={urllib.parse.quote_plus(q)}&hl=en-US&gl=US&ceid=US:en"],capture_output=True).stdout.decode()
root=ET.fromstring(t)
items=list(root.iter('item'))[:n]
links=[it.findtext('link') for it in items]
dec=subprocess.run(["./gdec.py"]+links,capture_output=True).stdout.decode().splitlines()
for it,d in zip(items,dec):
    dt=email.utils.parsedate_to_datetime(it.findtext('pubDate')).strftime('%Y-%m-%d')
    print(dt,'|',it.findtext('title'),'|',d)
