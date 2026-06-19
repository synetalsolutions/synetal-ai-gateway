#!/usr/bin/env bash
# Test script for Multi-Model Headroom Proxy v2.0
# Tests all providers with fallback, load-balancing, and streaming

set -e

PROXY_URL="${PROXY_URL:-http://localhost:3456}"
BOLD='\033[1m'
GREEN='\033[32m'
YELLOW='\033[33m'
CYAN='\033[36m'
RESET='\033[0m'

echo -e "${BOLD}═══════════════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}  Multi-Model Headroom Proxy v2.0 — Test Suite${RESET}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════════${RESET}"
echo ""

# ─── Health Check ───────────────────────────────────────────────────────────
echo -e "${CYAN}▶ Health Check${RESET}"
curl -s "${PROXY_URL}/health" | jq .
echo ""

# ─── Stats ──────────────────────────────────────────────────────────────────
echo -e "${CYAN}▶ Stats${RESET}"
curl -s "${PROXY_URL}/stats" | jq .
echo ""

# ─── Kimi (Auto-detect) ─────────────────────────────────────────────────────
echo -e "${CYAN}▶ Kimi (auto-detect from model name)${RESET}"
curl -s -X POST "${PROXY_URL}/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "kimi-latest",
    "messages": [{"role": "user", "content": "Say hello in 5 words"}],
    "max_tokens": 50
  }' | jq '.choices[0].message.content, ._headroom, ._proxy'
echo ""

# ─── DeepSeek (Explicit provider header) ────────────────────────────────────
echo -e "${CYAN}▶ DeepSeek (explicit X-Provider header)${RESET}"
curl -s -X POST "${PROXY_URL}/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "X-Provider: deepseek" \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "What is 2+2?"}],
    "max_tokens": 50
  }' | jq '.choices[0].message.content, ._proxy'
echo ""

# ─── GLM (Auto-detect) ──────────────────────────────────────────────────────
echo -e "${CYAN}▶ GLM-4 (auto-detect from model name)${RESET}"
curl -s -X POST "${PROXY_URL}/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "glm-4",
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 50
  }' | jq '.choices[0].message.content, ._proxy'
echo ""

# ─── Load Balancing ─────────────────────────────────────────────────────────
echo -e "${CYAN}▶ Load Balancing (X-Load-Balance: true)${RESET}"
for i in 1 2 3; do
  echo -e "  ${YELLOW}Request $i:${RESET}"
  curl -s -X POST "${PROXY_URL}/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -H "X-Load-Balance: true" \
    -d '{
      "model": "deepseek-chat",
      "messages": [{"role": "user", "content": "Hi"}],
      "max_tokens": 20
    }' | jq -r '._proxy.provider'
done
echo ""

# ─── Streaming ──────────────────────────────────────────────────────────────
echo -e "${CYAN}▶ Streaming (SSE)${RESET}"
curl -s -X POST "${PROXY_URL}/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "X-Provider: deepseek" \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "Count 1 to 3"}],
    "stream": true,
    "max_tokens": 50
  }' | while read -r line; do
    if [[ $line == data:* ]]; then
      data="${line#data: }"
      [[ "$data" == "[DONE]" ]] && break
      content=$(echo "$data" | jq -r '.choices[0].delta.content // empty' 2>/dev/null || true)
      [[ -n "$content" ]] && printf "%s" "$content"
    fi
  done
printf "\n\n"

# ─── With Large Context (Headroom Compression) ──────────────────────────────
echo -e "${CYAN}▶ Large Context (triggers Headroom compression)${RESET}"
# Generate a large repetitive context
LARGE_CONTEXT=$(python3 -c "
import json
data = {'servers': [{'id': i, 'status': 'healthy' if i != 42 else 'critical', 'cpu': i % 100} for i in range(200)]}
print(json.dumps(data))
")

curl -s -X POST "${PROXY_URL}/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "X-Provider: deepseek" \
  -d "{
    \"model\": \"deepseek-chat\",
    \"messages\": [
      {\"role\": \"system\", \"content\": \"You analyze server data.\"},
      {\"role\": \"user\", \"content\": \"Find critical servers\"},
      {\"role\": \"assistant\", \"content\": null, \"tool_calls\": [{\"id\": \"c1\", \"type\": \"function\", \"function\": {\"name\": \"list_servers\", \"arguments\": \"{}\"}}]},
      {\"role\": \"tool\", \"content\": \"$LARGE_CONTEXT\", \"tool_call_id\": \"c1\"},
      {\"role\": \"user\", \"content\": \"Which server is critical?\"}
    ],
    \"max_tokens\": 50
  }" | jq '._headroom, ._proxy, .choices[0].message.content'
echo ""

# ─── Final Stats ────────────────────────────────────────────────────────────
echo -e "${CYAN}▶ Final Stats${RESET}"
curl -s "${PROXY_URL}/stats" | jq .
echo ""

echo -e "${GREEN}✓ All tests completed!${RESET}"
