# 🚀 LiteLLM AI Gateway — Setup & Usage Guide

## ✅ Status

| Component | Status | Endpoint |
|-----------|--------|----------|
| Custom TypeScript Proxy | ✅ Running | `https://copilot.synetal.com/` |
| LiteLLM AI Gateway | ✅ Running | `https://copilot.synetal.com/litellm/` |
| PostgreSQL DB | ✅ Running | `localhost:5432` |
| pm2 Process Manager | ✅ Running | Both apps managed |

---

## 🔑 LiteLLM Master Key

```
sk-litellm-fixed-master-key-2026
```

---

## 📡 Available Models via LiteLLM

| Model | Provider | Status |
|-------|----------|--------|
| `kimi-k2.6` | Kimi (Moonshot AI) | ✅ Working |
| `deepseek-v4-pro` | DeepSeek | ✅ Working |
| `mimo-v2.5-pro` | Xiaomi (MiMo) | ✅ Working |
| `glm-5.2` | GLM (Zhipu) | ❌ Insufficient balance |

---

## 🖥️ Cursor IDE Setup (LiteLLM)

### Method 1: OpenAI-Compatible API

In Cursor Settings → Models → OpenAI API:

1. **Base URL**: `https://copilot.synetal.com/litellm/v1`
2. **API Key**: `sk-litellm-fixed-master-key-2026`
3. **Model**: Choose from available models above

### Method 2: Using `.cursorrules` for Model Selection

Create `.cursorrules` in your project root:

```json
{
  "model": "kimi-k2.6",
  "api_base": "https://copilot.synetal.com/litellm/v1",
  "api_key": "sk-litellm-fixed-master-key-2026"
}
```

---

## 🤖 GitHub Copilot Setup (LiteLLM)

### VS Code `settings.json`:

```json
{
  "github.copilot.advanced": {
    "debug.testOverrideProxyUrl": "https://copilot.synetal.com/litellm/v1",
    "debug.overrideProxyUrl": "https://copilot.synetal.com/litellm/v1"
  }
}
```

Or use environment variable:
```bash
export OPENAI_API_KEY="sk-litellm-fixed-master-key-2026"
export OPENAI_API_BASE="https://copilot.synetal.com/litellm/v1"
```

---

## 🧪 API Testing Examples

### Chat Completions

```bash
# Kimi
curl -s https://copilot.synetal.com/litellm/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-litellm-fixed-master-key-2026" \
  -d '{
    "model": "kimi-k2.6",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# DeepSeek
curl -s https://copilot.synetal.com/litellm/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-litellm-fixed-master-key-2026" \
  -d '{
    "model": "deepseek-v4-pro",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# Xiaomi MiMo
curl -s https://copilot.synetal.com/litellm/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-litellm-fixed-master-key-2026" \
  -d '{
    "model": "mimo-v2.5-pro",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Streaming

```bash
curl -s -N https://copilot.synetal.com/litellm/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-litellm-fixed-master-key-2026" \
  -d '{
    "model": "kimi-k2.6",
    "messages": [{"role": "user", "content": "Count 1 to 5"}],
    "stream": true
  }'
```

### List Models

```bash
curl -s https://copilot.synetal.com/litellm/v1/models \
  -H "Authorization: Bearer sk-litellm-fixed-master-key-2026"
```

---

## ⚖️ Two Proxies: When to Use Which?

| Feature | Custom Proxy (`/`) | LiteLLM (`/litellm/`) |
|---------|-------------------|----------------------|
| **Caching** | ✅ Built-in SHA256 cache | ❌ Disabled (configurable) |
| **Rate Limiting** | ✅ Sliding window 120 RPM | ❌ Not configured |
| **Smart Routing** | ✅ Auto-detect prompt type | ❌ Manual model selection |
| **Cost Tracking** | ✅ Per-request cost | ❌ Not configured |
| **Fallback Chains** | ✅ Multi-provider fallback | ✅ Configurable fallbacks |
| **Load Balancing** | ✅ Per-task group LB | ✅ Built-in router |
| **WebSocket** | ✅ `/ws` streaming | ❌ HTTP streaming only |
| **Headroom** | ✅ Configurable | ❌ Not supported |
| **Admin UI** | ❌ None | ✅ Built-in UI (port 4002) |
| **Usage Analytics** | ❌ Basic stats | ✅ PostgreSQL analytics |

### Recommendation:
- **Use Custom Proxy** (`/`) for: production apps needing caching, rate limiting, smart routing, cost tracking
- **Use LiteLLM** (`/litellm/`) for: quick testing, admin dashboard, usage analytics, or when you need LiteLLM-specific features

---

## 🔧 Management Commands

```bash
# View both proxy statuses
pm2 status

# View logs
pm2 logs multi-model-proxy
pm2 logs litellm-proxy

# Restart
pm2 restart multi-model-proxy
pm2 restart litellm-proxy

# LiteLLM direct access (local)
curl http://localhost:4002/v1/models \
  -H "Authorization: Bearer sk-litellm-fixed-master-key-2026"
```

---

## 🗄️ PostgreSQL Access

```bash
# Connect to LiteLLM database
psql postgresql://litellm:litellm123@localhost:5432/litellm

# Useful queries
\dt                          # List tables
SELECT * FROM "LiteLLM_VerificationToken" LIMIT 5;  # API keys
SELECT * FROM "LiteLLM_SpendLogs" LIMIT 5;          # Usage logs
```

---

## 📝 Files

| File | Purpose |
|------|---------|
| `litellm-config-minimal.yaml` | LiteLLM model configuration |
| `start-litellm.sh` | LiteLLM startup script |
| `ecosystem.config.js` | pm2 process configuration |

---

Deployed: **v2.1.0** | LiteLLM: **v1.89.2**
