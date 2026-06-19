# 🚀 Custom AI Gateway Proxy — Usage Guide

**Proxy URL:** `https://copilot.synetal.com`  
**WebSocket:** `wss://copilot.synetal.com/ws`  
**API Key:** `REDACTED-PROXY-KEY`  
**Version:** `v2.2.0`  
**Features:** Fallback, Load Balancing, Caching, Rate Limiting, Smart Routing, Cost Tracking, Auth, **Multi-Model**

---

## ⚡ AI Gateway Features (Built-in)

| Feature | How It Works | Control |
|---------|-------------|---------|
| **🧠 Smart Routing** | Auto-detects prompt type (code/reasoning/vision/fast) and picks best model | Automatic — no config needed |
| **🔄 Fallback** | If provider fails, automatically tries next provider | Automatic — configurable chain |
| **⚖️ Load Balancing** | Distributes requests across provider pool | `X-Load-Balance: true` header |
| **💾 Caching** | SHA256-based response cache, 5min TTL | Automatic + `X-Cache: true/false` |
| **🚦 Rate Limiting** | 120 requests/min sliding window per IP | Automatic |
| **💰 Cost Tracking** | Tracks spend per request | Automatic — check `/stats` |
| **🎯 Multi-Model** | Send same prompt to multiple models simultaneously | `POST /v1/chat/completions/multi` |

---

## ✅ Supported Providers & Models

| Provider | Working Models | Header | Best For |
|----------|---------------|--------|----------|
| **Kimi** (Moonshot) | `moonshot-v1-auto`, `kimi-k2.5`, `kimi-k2.6`, `kimi-k2.7-code` | `X-Provider: kimi` | Coding, General |
| **DeepSeek** | `deepseek-v4-pro`, `deepseek-v4-flash` | `X-Provider: deepseek` | Reasoning, Math |
| **Xiaomi** (MiMo) | `mimo-v2.5-pro`, `mimo-v2.5`, `mimo-v2-pro` | `X-Provider: xiaomi` | Fast responses |
| **GLM** (Zhipu) | `glm-5.2` (need balance) | `X-Provider: glm` | — |

### 🧠 Smart Auto-Routing (Recommended!)

**Kuch bhi header nahi dalna** — proxy automatically detect karega:

| Prompt Type | Detected Keywords | Routes To |
|-------------|-------------------|-----------|
| **Code** | `code`, `function`, `bug`, `debug`, `python`, `javascript` | `kimi-k2.7-code` |
| **Reasoning** | `explain`, `why`, `how`, `solve`, `math`, `logic` | `deepseek-v4-pro` |
| **Vision** | `image`, `picture`, `describe`, `see` | `moonshot-v1-32k-vision-preview` |
| **Fast** | Short prompts, simple questions | `deepseek-v4-flash` |
| **General** | Everything else | `kimi-k2.6` |

---

## 🔧 1. Cursor IDE Setup (Recommended)

### Step 1: Open Cursor Settings
`Ctrl+Shift+P` → `Cursor Settings` → `Models`

### Step 2: Add OpenAI-Compatible Endpoint

In **Cursor Settings** → **OpenAI API** tab:

| Setting | Value |
|---------|-------|
| Base URL | `https://copilot.synetal.com/v1` |
| API Key | `REDACTED-PROXY-KEY` |
| Model | `deepseek-v4-pro` or any model name |

### Step 3: Use Custom Headers (for Provider Selection)

Create file: `~/.cursor/mcp.json` or use Cursor's **Custom Headers**:

```json
{
  "openai": {
    "baseURL": "https://copilot.synetal.com/v1",
    "apiKey": "REDACTED-PROXY-KEY",
    "defaultHeaders": {
      "X-Provider": "deepseek"
    }
  }
}
```

### 🎯 Smart Routing in Cursor (No Header Needed!)

Just use `synetal-ai` model — proxy **auto-detects** best provider:
```
Model: synetal-ai         → Smart routing (recommended!)
Model: kimi-k2.7-code     → Kimi code model
Model: deepseek-v4-pro    → DeepSeek reasoning
```

---

## 🔧 2. VS Code Copilot Setup

### Method A: Custom Endpoint (settings.json)

Open VS Code → `Ctrl+Shift+P` → `Preferences: Open User Settings (JSON)`

```json
{
  "github.copilot.advanced": {
    "debug.overrideEngine": "deepseek-v4-pro",
    "debug.testOverrideProxyUrl": "https://copilot.synetal.com",
    "debug.overrideProxyUrl": "https://copilot.synetal.com"
  }
}
```

> ⚠️ **Note:** VS Code Copilot may not support custom headers. Use **Cursor** or **Continue.dev** for full multi-model support.

---

## 🔧 3. Continue.dev Extension (VS Code)

Install **Continue.dev** extension, then in `~/.continue/config.json`:

```json
{
  "models": [
    {
      "title": "DeepSeek",
      "provider": "openai",
      "model": "deepseek-v4-pro",
      "apiBase": "https://copilot.synetal.com/v1",
      "apiKey": "REDACTED-PROXY-KEY",
      "requestOptions": {
        "headers": {
          "X-Provider": "deepseek"
        }
      }
    },
    {
      "title": "Xiaomi MiMo",
      "provider": "openai",
      "model": "mimo-v2.5-pro",
      "apiBase": "https://copilot.synetal.com/v1",
      "apiKey": "REDACTED-PROXY-KEY",
      "requestOptions": {
        "headers": {
          "X-Provider": "xiaomi"
        }
      }
    },
    {
      "title": "Kimi K2.6",
      "provider": "openai",
      "model": "kimi-k2.6",
      "apiBase": "https://copilot.synetal.com/v1",
      "apiKey": "REDACTED-PROXY-KEY",
      "requestOptions": {
        "headers": {
          "X-Provider": "kimi"
        }
      }
    }
  ]
}
```

---

## 🔧 4. Cline / Roo Code (VS Code)

In Cline settings → **API Provider** → **OpenAI Compatible**:

| Field | Value |
|-------|-------|
| Base URL | `https://copilot.synetal.com/v1` |
| API Key | `REDACTED-PROXY-KEY` |
| Model ID | `deepseek-v4-pro` |
| Custom Headers | `{"X-Provider": "deepseek"}` |

---

## 🔧 5. CLI / curl Usage

```bash
# DeepSeek
curl -X POST https://copilot.synetal.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer REDACTED-PROXY-KEY" \
  -H "X-Provider: deepseek" \
  -d '{"model":"deepseek-v4-pro","messages":[{"role":"user","content":"Hello"}]}'

# Xiaomi MiMo
curl -X POST https://copilot.synetal.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer REDACTED-PROXY-KEY" \
  -H "X-Provider: xiaomi" \
  -d '{"model":"mimo-v2.5-pro","messages":[{"role":"user","content":"Hello"}]}'

# Kimi
curl -X POST https://copilot.synetal.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer REDACTED-PROXY-KEY" \
  -H "X-Provider: kimi" \
  -d '{"model":"synetal-ai","messages":[{"role":"user","content":"Hello"}]}'

# Load Balance (auto-select provider)
curl -X POST https://copilot.synetal.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer REDACTED-PROXY-KEY" \
  -H "X-Load-Balance: true" \
  -d '{"model":"deepseek-v4-pro","messages":[{"role":"user","content":"Hello"}]}'
```

---

## 🔧 6. Python / OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://copilot.synetal.com/v1",
    api_key="REDACTED-PROXY-KEY",  # Proxy API key
    default_headers={
        "X-Provider": "deepseek",  # or "xiaomi", "kimi"
    }
)

response = client.chat.completions.create(
    model="deepseek-v4-pro",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

---

## 🔧 7. WebSocket (Real-time Streaming)

```javascript
// API key must be passed as query parameter for WebSocket
const API_KEY = "REDACTED-PROXY-KEY";
const ws = new WebSocket(`wss://copilot.synetal.com/ws?token=${API_KEY}`);

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: "chat",
    provider: "deepseek",
    payload: {
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "Hello" }],
      stream: true
    }
  }));
};

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === "stream_chunk") console.log(msg.data);
};
```

---

## 🔧 8. 🎯 Multi-Model — Ek Prompt, Multiple Models!

**Endpoint:** `POST /v1/chat/completions/multi`

Same prompt ko **multiple models ko ek saath** bhejo aur sabke responses ek saath compare karo!

### curl Example:

```bash
curl -X POST https://copilot.synetal.com/v1/chat/completions/multi \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer REDACTED-PROXY-KEY" \
  -H "X-Models: kimi:kimi-k2.6,deepseek:deepseek-v4-pro,xiaomi:mimo-v2.5-pro" \
  -d '{
    "messages": [{"role": "user", "content": "What is 2+2?"}],
    "max_tokens": 100
  }'
```

### Response Format:

```json
{
  "requestId": "b4d3d873",
  "models_requested": 3,
  "models_responded": 3,
  "responses": [
    {
      "provider": "kimi",
      "model": "kimi-k2.6",
      "success": true,
      "statusCode": 200,
      "latencyMs": 2050,
      "content": "4",
      "usage": { "total_tokens": 68 }
    },
    {
      "provider": "deepseek",
      "model": "deepseek-v4-pro",
      "success": true,
      "statusCode": 200,
      "latencyMs": 1948,
      "content": "four",
      "usage": { "total_tokens": 109 }
    },
    {
      "provider": "xiaomi",
      "model": "mimo-v2.5-pro",
      "success": true,
      "statusCode": 200,
      "latencyMs": 2100,
      "content": "Four",
      "usage": { "total_tokens": 310 }
    }
  ]
}
```

### How to Specify Models:

**Method 1: Header (comma-separated)**
```
X-Models: kimi:kimi-k2.6,deepseek:deepseek-v4-pro,xiaomi:mimo-v2.5-pro
```

**Method 2: Body (models array)**
```json
{
  "models": ["kimi:kimi-k2.6", "deepseek:deepseek-v4-pro", "xiaomi:mimo-v2.5-pro"],
  "messages": [{"role": "user", "content": "Hello"}],
  "max_tokens": 100
}
```

### Python Example:

```python
import requests

resp = requests.post(
    "https://copilot.synetal.com/v1/chat/completions/multi",
    headers={
        "Authorization": "Bearer REDACTED-PROXY-KEY",
        "X-Models": "kimi:kimi-k2.6,deepseek:deepseek-v4-pro,xiaomi:mimo-v2.5-pro"
    },
    json={
        "messages": [{"role": "user", "content": "Explain recursion simply"}],
        "max_tokens": 200
    }
)

data = resp.json()
for r in data["responses"]:
    print(f"\n=== {r['provider']}/{r['model']} ({r['latencyMs']}ms) ===")
    print(r.get("content") or r.get("reasoning", "(no content)"))
```

### 🧠 Use Cases:

| Use Case | Benefit |
|----------|---------|
| **Compare models** | Same prompt → see which model gives best answer |
| **Ensemble voting** | Multiple models → pick majority answer |
| **Speed test** | Compare latency across providers |
| **Quality benchmark** | Test model quality on your prompts |
| **Fallback verification** | See which models are healthy |



---

## 🎛️ AI Gateway Features — Detailed Usage

### 1. 🧠 Smart Auto-Routing (No Config Needed!)

Bina kisi header ke bhejo — proxy automatically best model select karega:

```bash
# Ye code prompt hai → automatically kimi-k2.7-code pe jayega
curl -X POST https://copilot.synetal.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer REDACTED-PROXY-KEY" \
  -d '{
    "model": "synetal-ai",
    "messages": [{"role": "user", "content": "Write a Python function to sort a list"}]
  }'

# Ye reasoning prompt hai → automatically deepseek-v4-pro pe jayega
curl -X POST https://copilot.synetal.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer REDACTED-PROXY-KEY" \
  -d '{
    "model": "synetal-ai",
    "messages": [{"role": "user", "content": "Explain quantum computing in simple terms"}]
  }'
```

### 2. ⚖️ Load Balancing

Same request multiple providers mein distribute karne ke liye:

```bash
curl -X POST https://copilot.synetal.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer REDACTED-PROXY-KEY" \
  -H "X-Load-Balance: true" \
  -H "X-Provider: deepseek" \
  -d '{
    "model": "deepseek-v4-pro",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

**Load Balance Groups:**
- `reasoning`: deepseek → openai → xiaomi
- `coding`: deepseek → glm → kimi → xiaomi
- `general`: kimi → deepseek → glm → xiaomi
- `vision`: openai → glm → xiaomi

### 3. 💾 Cache Control

```bash
# Force cache read (if available)
curl -X POST https://copilot.synetal.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer REDACTED-PROXY-KEY" \
  -H "X-Cache: true" \
  -d '{...}'

# Skip cache (fresh response)
curl -X POST https://copilot.synetal.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer REDACTED-PROXY-KEY" \
  -H "X-Cache: false" \
  -d '{...}'
```

Cache: **5 minutes TTL**, SHA256 key based on prompt+model

### 4. 🔄 Fallback Chain

Agar ek provider fail ho, automatically next try hota hai:

**Default Chain:** `deepseek → glm → xiaomi → openai`

```bash
# GLM balance nahi hai → automatically DeepSeek pe chala jayega
curl -X POST https://copilot.synetal.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer REDACTED-PROXY-KEY" \
  -H "X-Provider: glm" \
  -d '{
    "model": "glm-5.2",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
# Response: fallback=true, provider=deepseek
```

### 5. 🚦 Rate Limit Headers

Response mein rate limit status milta hai:

```bash
curl -i -X POST https://copilot.synetal.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer REDACTED-PROXY-KEY" \
  -H "X-Provider: deepseek" \
  -d '{...}'

# Response headers:
# X-RateLimit-Limit: 120
# X-RateLimit-Remaining: 119
# X-RateLimit-Reset: 60
```

---

## 📊 Check Proxy Status

```bash
# Health
curl https://copilot.synetal.com/health | jq .

# Stats (requests, tokens saved, latency)
curl https://copilot.synetal.com/stats | jq .
```

---

## ⚡ Quick Switch Providers

| Want to use | Change `X-Provider` to | Model Example |
|-------------|----------------------|---------------|
| DeepSeek | `deepseek` | `deepseek-v4-pro` |
| Xiaomi MiMo | `xiaomi` | `mimo-v2.5-pro` |
| Kimi K2.6 | `kimi` | `kimi-k2.6` |
| Kimi Auto | `kimi` | `moonshot-v1-auto` |

---

## ⚖️ Custom Proxy vs LiteLLM — Konsa Use Kare?

| Feature | Custom Proxy (`/`) | LiteLLM (`/litellm/`) |
|---------|-------------------|----------------------|
| **Caching** | ✅ Built-in (5min) | ❌ Disabled |
| **Rate Limiting** | ✅ 120 RPM | ❌ Not configured |
| **Smart Routing** | ✅ Auto by prompt | ❌ Manual only |
| **Cost Tracking** | ✅ Per request | ❌ Not configured |
| **Fallback Chain** | ✅ Auto-retry | ✅ Configurable |
| **Load Balancing** | ✅ Per task group | ✅ Built-in router |
| **WebSocket** | ✅ `/ws` streaming | ❌ HTTP only |
| **Admin UI** | ❌ None | ✅ Built-in |
| **Usage Analytics** | ❌ Basic stats | ✅ PostgreSQL DB |
| **Best For** | Production apps, IDE integration | Testing, analytics |

**👉 Recommendation:**
- **Development / Production apps** → Custom Proxy (`https://copilot.synetal.com`)
- **Testing / Admin dashboard** → LiteLLM (`https://copilot.synetal.com/litellm/`)

---

## 🚨 Troubleshooting

| Issue | Fix |
|-------|-----|
| `401 Unauthorized` | Add `-H "Authorization: Bearer REDACTED-PROXY-KEY"` |
| "Missing API key" | Proxy auto-uses provider keys from server `.env` |
| "Invalid model" | Use correct model name from table above |
| "All providers failed" | Check `https://copilot.synetal.com/health` |
| Slow responses | Add `X-Load-Balance: true` header |
| GLM not working | Account has no balance — recharge on z.ai |
| Custom proxy down | `pm2 restart multi-model-proxy` |
| LiteLLM down | `pm2 restart litellm-proxy` |
