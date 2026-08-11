#!/bin/bash
# Send one command to the persistent oe_interactive runner and wait for its result.
# Usage: bash oe_drive.sh '{"op":"dump"}'
cd "$(dirname "$0")" || exit 1
SEQ=$(( $(cat logs/oe_seq 2>/dev/null || echo 0) + 1 ))
echo "$SEQ" > logs/oe_seq
python3 -c "import json,sys; json.dump({'seq':$SEQ, **json.loads(sys.argv[1])}, open('logs/oe_cmd.json','w'))" "$1"
until python3 -c "import json,sys; d=json.load(open('logs/oe_result.json')); sys.exit(0 if d.get('seq')==$SEQ else 1)" 2>/dev/null; do sleep 1; done
python3 -c "import json; print(json.dumps(json.load(open('logs/oe_result.json'))['result'], indent=2, default=str)[:1500])"
