#!/bin/bash
# Requires the persistent runner, started from scraper/ with:
#   python3 -m devtools.oe_interactive
# Send one command via env vars (avoids JSON/quote escaping). Waits for result.
#   OP=eval  JS='<js returning value, `d` = iframe document>'  bash oe.sh
#   OP=click SEL='<css>' [FORCE=1]                              bash oe.sh
#   OP=fill  SEL='<css>' VAL='<text>'                           bash oe.sh
#   OP=func  NAME='<fn>'                                        bash oe.sh
#   OP=dump | OP=shot | OP=cancelpopup                          bash oe.sh
cd "$(dirname "$0")" || exit 1
SEQ=$(( $(cat logs/oe_seq 2>/dev/null || echo 0) + 1 ))
echo "$SEQ" > logs/oe_seq
SEQ="$SEQ" python3 -c "
import json, os
d = {'seq': int(os.environ['SEQ']), 'op': os.environ.get('OP','')}
for k in ('sel','val','js','name','timeout'):
    v = os.environ.get(k.upper())
    if v: d[k] = int(v) if k=='timeout' else v
if os.environ.get('FORCE'): d['force'] = True
json.dump(d, open('logs/oe_cmd.json','w'))
"
until python3 -c "import json,sys; sys.exit(0 if json.load(open('logs/oe_result.json')).get('seq')==$SEQ else 1)" 2>/dev/null; do sleep 1; done
python3 -c "import json; print(json.dumps(json.load(open('logs/oe_result.json'))['result'], default=str, indent=2)[:1000])"
