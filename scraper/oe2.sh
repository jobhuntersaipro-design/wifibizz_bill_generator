#!/bin/bash
# Requires the persistent runner (window 2), started from scraper/ with:
#   python3 -m devtools.oe_interactive
# Same as oe.sh but drives the SECOND runner (window 2): its own cmd/result/seq
# files so it never clashes with window 1 (oe.sh).
#   OP=eval  JS='<js>'                 bash oe2.sh
#   OP=click SEL='<css>' [FORCE=1]      bash oe2.sh
#   OP=fill  SEL='<css>' VAL='<text>'   bash oe2.sh
#   OP=func  NAME='<fn>'               bash oe2.sh
#   OP=dump | OP=shot | OP=cancelpopup  bash oe2.sh
cd "$(dirname "$0")" || exit 1
CMD=logs/oe2_cmd.json; RES=logs/oe2_result.json; SEQF=logs/oe2_seq
SEQ=$(( $(cat "$SEQF" 2>/dev/null || echo 0) + 1 ))
echo "$SEQ" > "$SEQF"
SEQ="$SEQ" CMDF="$CMD" python3 -c "
import json, os
d = {'seq': int(os.environ['SEQ']), 'op': os.environ.get('OP','')}
for k in ('sel','val','js','name','timeout'):
    v = os.environ.get(k.upper())
    if v: d[k] = int(v) if k=='timeout' else v
if os.environ.get('FORCE'): d['force'] = True
json.dump(d, open(os.environ['CMDF'],'w'))
"
until python3 -c "import json,sys; sys.exit(0 if json.load(open('$RES')).get('seq')==$SEQ else 1)" 2>/dev/null; do sleep 1; done
python3 -c "import json; print(json.dumps(json.load(open('$RES'))['result'], default=str, indent=2)[:1200])"
