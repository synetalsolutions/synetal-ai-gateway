#!/usr/bin/env bash
# Restart headroom proxy WITHOUT slow Kompress ML model
# Keeps fast AST-based CodeCompressor + SmartCrusher
# Usage: bash restart-headroom-no-kompress.sh
set -uo pipefail

cd /www/wwwroot/copilot.synetal.com || exit 1

echo "########################################################"
echo "## STEP 1: Delete and restart with new flags"
echo "########################################################"
pm2 delete headroom-proxy 2>&1
sleep 2

HEADROOM_COMPRESS_USER_MESSAGES=1 \
HEADROOM_COMPRESS_SYSTEM_MESSAGES=1 \
HEADROOM_CODE_AWARE_ENABLED=1 \
pm2 start "headroom proxy --port 8787 --mode token --no-cache --no-ccr-inject-tool --no-ccr-marker --code-aware --disable-kompress" --name headroom-proxy 2>&1
sleep 8

echo "--- pm2 list ---"
pm2 list 2>&1 | grep -E "headroom|name"
echo "--- port 8787 ---"
ss -tlnp 2>/dev/null | grep 8787 || echo "(ss: port 8787 not found via ss)"

echo
echo "########################################################"
echo "## STEP 2: Verify it started cleanly (check for errors)"
echo "########################################################"
echo "--- pm2 logs headroom-proxy (last 20, nostream) ---"
pm2 logs headroom-proxy --lines 20 --nostream 2>&1
echo "--- error log tail ---"
tail -20 /root/.pm2/logs/headroom-proxy-error.log 2>&1 || echo "(no error log found)"

echo
echo "########################################################"
echo "## STEP 3: Verify /health responds"
echo "########################################################"
curl -sS http://127.0.0.1:8787/health 2>&1
echo

echo
echo "########################################################"
echo "## STEP 4: FAST compression test (Cursor multi-turn sim)"
echo "########################################################"
timeout 60 python3 -c "
import json, urllib.request, time

big_code = '''class FileSystemScanner:
    def __init__(self, root_dir, ignore_patterns=None, max_depth=10):
        self.root_dir = root_dir
        self.ignore_patterns = ignore_patterns or ['.git', 'node_modules']
        self.max_depth = max_depth
        self._cache = {}

    def scan(self, pattern='*'):
        results = []
        for path in self.root_dir.rglob(pattern):
            if self._should_ignore(path):
                continue
            results.append(path)
        return results
''' * 20

messages = [
    {'role': 'system', 'content': 'You are a helpful coding assistant with extensive knowledge. ' * 20},
]
for i in range(10):
    messages.append({'role': 'user', 'content': f'Here is file_{i}.py:\n\n{big_code}\nPlease review this code for me.'})
    messages.append({'role': 'assistant', 'content': f'I have reviewed file_{i}.py. ' + 'The code looks good. Consider adding type hints. ' * 10})
messages.append({'role': 'user', 'content': 'Now merge all the results.'})

payload = json.dumps({'model': 'kimi-k2.7-code', 'messages': messages}).encode()
print(f'Payload: {len(payload)} bytes, {len(messages)} messages')

start = time.time()
req = urllib.request.Request('http://127.0.0.1:8787/v1/compress', data=payload, headers={'Content-Type': 'application/json'})
resp = urllib.request.urlopen(req, timeout=55)
elapsed = time.time() - start
data = json.loads(resp.read())

before = data['tokens_before']
after = data['tokens_after']
saved = data['tokens_saved']
pct = (1 - after/before) * 100 if before > 0 else 0

print(f'Time: {elapsed:.1f}s')
print(f'Before: {before:>8} tokens')
print(f'After: {after:>8} tokens')
print(f'Saved: {saved:>8} tokens ({pct:.1f}%)')
print(f'Transforms summary: {data[\"transforms_summary\"]}')
" 2>&1
echo "Test exit code: $?"

echo
echo "########################################################"
echo "## STEP 5: /stats endpoint aggregate counters"
echo "########################################################"
curl -sS http://127.0.0.1:8787/stats 2>&1 | python3 -m json.tool 2>&1 | head -40

echo
echo "########################################################"
echo "## STEP 6: Save pm2 config (persist on reboot)"
echo "########################################################"
pm2 save 2>&1

echo
echo "########################################################"
echo "## DONE"
echo "########################################################"
