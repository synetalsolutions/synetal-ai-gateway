#!/usr/bin/env bash
#
# deploy-headroom-fix.sh
#
# Restarts the Headroom compression proxy with FAST structural compression only
# (AST CodeCompressor + SmartCrusher), disabling the slow Kompress ML model
# that takes 2.8s/chunk (64s+ for Cursor's 250K-token requests — unworkable).
#
# Also rebuilds the Node.js proxy which has been updated to:
#   - Call headroom HTTP proxy directly (no SDK indirection)
#   - Enforce a 15s hard timeout so slow compression falls through gracefully
#
set -euo pipefail

WORKDIR="/www/wwwroot/copilot.synetal.com"
cd "$WORKDIR"

echo "================================================================"
echo "  Headroom Compression Fix — $(date '+%Y-%m-%d %H:%M:%S')"
echo "================================================================"

# ---------------------------------------------------------------- #
# Step 1: Restart headroom proxy with fast compression only
# ---------------------------------------------------------------- #
echo ""
echo "[1/4] Restarting headroom proxy (AST + SmartCrusher, NO slow ML)..."

pm2 delete headroom-proxy 2>/dev/null || true
sleep 2

HEADROOM_COMPRESS_USER_MESSAGES=1 \
HEADROOM_COMPRESS_SYSTEM_MESSAGES=1 \
HEADROOM_CODE_AWARE_ENABLED=1 \
HEADROOM_DISABLE_KOMPRESS=1 \
pm2 start "headroom proxy --port 8787 --mode token --no-cache --no-ccr-inject-tool --no-ccr-marker --code-aware --disable-kompress" \
  --name headroom-proxy 2>&1 | tail -5

sleep 6
ss -tlnp | grep 8787 || { echo "ERROR: headroom not listening on 8787!"; exit 1; }
echo "  ✓ headroom proxy listening on 8787"

# ---------------------------------------------------------------- #
# Step 2: Rebuild + restart the Node proxy
# ---------------------------------------------------------------- #
echo ""
echo "[2/4] Rebuilding Node.js proxy..."

# Check if package.json has a build step
if [ -f package.json ] && grep -q '"build"' package.json; then
  npm run build 2>&1 | tail -3
fi

# Check compile
npx tsc --noEmit 2>&1 | tail -5 || true

pm2 restart multi-model-proxy --update-env 2>&1 | tail -3
sleep 3
echo "  ✓ Node proxy restarted"

# ---------------------------------------------------------------- #
# Step 3: Verify headroom compression works (fast!)
# ---------------------------------------------------------------- #
echo ""
echo "[3/4] Testing compression with simulated Cursor payload..."
echo "      (10-turn conversation with code, should complete in <10s)"

timeout 30 python3 -c "
import json, urllib.request, time

big_code = '''class FileSystemScanner:
    def __init__(self, root_dir, ignore_patterns=None, max_depth=10):
        self.root_dir = root_dir
        self.ignore_patterns = ignore_patterns or ['.git', 'node_modules']
        self._cache = {}

    def scan(self, pattern='*'):
        results = []
        for path in self.root_dir.rglob(pattern):
            results.append(path)
        return results

    def _should_ignore(self, path):
        for p in self.ignore_patterns:
            if p in str(path):
                return True
        return False

    def _hash_file(self, path):
        import hashlib
        h = hashlib.sha256()
        with open(path, 'rb') as f:
            for chunk in iter(lambda: f.read(8192), b''):
                h.update(chunk)
        return h.hexdigest()
''' * 20

messages = [
    {'role': 'system', 'content': 'You are a helpful coding assistant with extensive knowledge of programming languages, frameworks, and best practices. ' * 20},
]
for i in range(10):
    messages.append({'role': 'user', 'content': f'Here is file_{i}.py:\n\n{big_code}\nPlease review this code.'})
    messages.append({'role': 'assistant', 'content': f'I have reviewed file_{i}.py. ' + 'The code looks good. Consider adding type hints, error handling, and documentation. ' * 10})
messages.append({'role': 'user', 'content': 'Now merge all the processed results into a single output.'})

payload = json.dumps({'model': 'kimi-k2.7-code', 'messages': messages}).encode()
print(f'  Payload: {len(payload):,} bytes, {len(messages)} messages')

start = time.time()
req = urllib.request.Request('http://127.0.0.1:8787/v1/compress', data=payload, headers={'Content-Type': 'application/json'})
resp = urllib.request.urlopen(req, timeout=25)
elapsed = time.time() - start
data = json.loads(resp.read())

before = data['tokens_before']
after = data['tokens_after']
saved = data['tokens_saved']
pct = (1 - after/before) * 100 if before > 0 else 0

print(f'  Time:    {elapsed:.1f}s')
print(f'  Before:  {before:>8,} tokens')
print(f'  After:   {after:>8,} tokens')
print(f'  Saved:   {saved:>8,} tokens ({pct:.1f}%)')
summary = data.get('transforms_summary', {})
tx_str = ', '.join(f'{k}={v}' for k,v in summary.items()) if summary else 'none'
print(f'  Transforms: {tx_str}')

if saved > 0:
    print('  ✓ Compression WORKING — non-zero savings!')
elif elapsed < 10:
    print('  ⚠ No savings (content may be all recent/protected), but fast enough')
else:
    print('  ✗ No savings and slow — check transforms')
" 2>&1

echo "  (exit: $?)"

# ---------------------------------------------------------------- #
# Step 4: Save pm2 config for persistence across reboots
# ---------------------------------------------------------------- #
echo ""
echo "[4/4] Saving pm2 process list..."
pm2 save 2>&1 | tail -3

echo ""
echo "================================================================"
echo "  DONE. Headroom compression is now configured for:"
echo "    • AST code compression (--code-aware)   — fast, ms"
echo "    • SmartCrusher for JSON/structured data — fast, ms"
echo "    • Kompress ML DISABLED (--disable-kompress) — was 2.8s/chunk"
echo "    • 15s timeout fallback in Node proxy"
echo "    • User + System message compression ENABLED"
echo ""
echo "  To re-enable ML compression later (if CPU is upgraded):"
echo "    pm2 delete headroom-proxy"
echo "    pm2 start \"headroom proxy --port 8787 --mode token --code-aware\" \\"
echo "      --name headroom-proxy"
echo "================================================================"
