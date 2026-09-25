import json,subprocess,time,sys
def gt(path,retries=6):
    for a in range(retries):
        r=subprocess.run(["curl","-s","--max-time","40","-H","Accept: application/json","https://api.geckoterminal.com/api/v2"+path],capture_output=True).stdout
        try: d=json.loads(r)
        except Exception: d={}
        if 'data' in d: 
            time.sleep(2.2); return d
        time.sleep(15*(a+1))
    return d
