# 🚀 Synetal AI Gateway v2.4.0 — Quick Start Guide

> **Full docs:** See [README.md](README.md) for architecture, innovation, and deep-dive.
> This is a concise, copy-paste-ready setup guide.

**Gateway URL (self-hosted):** `https://your-gateway.com`  
**Local dev:** `http://localhost:3456`  
**API Key:** Your own generated `PROXY_API_KEY` (see below)

---

## 📋 Prerequisites

- Node.js 18+
- At least one LLM provider API key (Kimi, DeepSeek, GLM, or Xiaomi MiMo)

---

## 🛠️ Step 1 — Get the Code

```bash
git clone https://github.com/synetalsolutions/synetal-ai-gateway.git
cd synetal-ai-gateway
npm install
```

## 🔑 Step 2 — Configure Secrets

```bash
# 1. Create your secrets file
cp .env.example .env

# 2. Generate a secure proxy key (DO NOT reuse the example value)
openssl rand -hex 32
# → e.g. d7073400da5167cc9944dac11018c37d5291ff47bf1425199b6d...

# 3. Edit .env — paste the generated key and add provider keys
nano .env
```

Your `.env` should contain:

```ini
PROXY_API_KEY=<your-generated-32-byte-hex-key>

# Add at least one provider key (comment out what you don't have)
KIMI_API_KEY=sk-xxxx         # https://platform.moonshot.cn/
DEEPSEEK_API_KEY=sk-xxxx     # https://platform.deepseek.com/
GLM_API_KEY=xxxx             # https://z.ai/
XIAOMI_API_KEY=tp-xxxx       # https://xiaomimimo.com/
```

> ⚠️ **Never commit `.env` to git.** It's already in `.gitignore`.

## 🏗️ Step 3 — Build & Run

```bash
npm run build
npm start
```

Or with PM2 (production, auto-clustered to CPU cores):

```bash
pm2 start ecosystem.config.js --update-env
curl http://localhost:3456/health | jq
```

Or with Docker:

```bash
docker-compose up -d
```

---

## 💻 IDE Integration

The gateway is OpenAI-compatible. Any IDE that supports custom OpenAI endpoints works out of the box.

### Cursor

`Ctrl+Shift+P` → `Cursor Settings` → **OpenAI API**

| Setting | Value |
|---------|-------|
| Base URL | `https://your-gateway.com/v1` |
| API Key | *Your `PROXY_API_KEY`* |

Recommended model alias in Cursor dropdown: **`synetal-ai`** (auto-route).

### VS Code Copilot

```json
{
  "github.copilot.advanced": {
    "debug.overrideEngine": "synetal-ai",
    "debug.overrideProxyUrl": "https://your-gateway.com"
  }
}
```

> Note: VS Code Copilot doesn't support custom auth headers well. Cursor, Continue.dev, and Cline offer the best experience.

### Continue.dev

In `~/.continue/config.json`:

```json
{
  "models": [
    {
      "title": "Synetal Auto-Route",
      "provider": "openai",
      "model": "synetal-ai",
      "apiBase": "https://your-gateway.com/v1",
      "apiKey": "<YOUR_PROXY_API_KEY>"
    }
  ]
}
```

### Cline / Roo Code

**API Provider** → *OpenAI Compatible*:
- Base URL: `https://your-gateway.com/v1`
- API Key: *Your `PROXY_API_KEY`*
- Model: `synetal-ai`

---

## 🧠 Smart Routing Modes

You control routing by selecting different model names. No special headers needed.

| Model Name | What It Does |
|------------|--------------|
| `synetal-ai` | **Auto-route** — cost-aware routing (recommended) |
| `auto` | Alias for `synetal-ai` |
| `gpt-4o`, `gpt-4`, `gpt-3.5-turbo` | Aliases for Cursor compatibility → auto-route |
| `glm-5.2`, `kimi-k2.7-code`, etc. | **Direct route** to a specific model — bypasses smart routing |

### Force a Specific Provider (optional)

Add a `X-Provider` header: `kimi`, `deepseek`, `glm`, or `xiaomi`. Without it, the gateway picks automatically.

---

## 🔧 Quick API Test

```bash
curl -X POST https://your-gateway.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <YOUR_PROXY_API_KEY>" \
  -d '{
    "model": "synetal-ai",
    "messages": [{"role": "user", "content": "Write a Python function to check palindromes"}]
  }'
```

Use this snippet with the Python SDK:

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://your-gateway.com/v1",
    api_key="<YOUR_PROXY_API_KEY>",
)

resp = client.chat.completions.create(
    model="synetal-ai",
    messages=[{"role": "user", "content": "Hello"}],
)
print(resp.choices[0].message.content)
```

---

## 📊 Monitoring Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Provider status, circuit-breaker states, latency |
| `GET /stats` | Request counts, p50/p95/p99 latencies, cache hit rate |
| `GET /cost` | Per-model token usage & spend accounting |
| `GET /v1/models` | Live model catalog with pricing and capabilities |

---

## 🚨 Troubleshooting

| Issue | Fix |
|-------|-----|
| `401 Unauthorized` | Confirm your `Authorization: Bearer <PROXY_API_KEY>` header matches `.env` |
| "PROXY_API_KEY missing" | The server didn't find `.env` — check the file exists in the working directory |
| "All providers failed" | Check `/health`; all providers may be down or quotas exhausted |
| `429` from gateway | You hit the per-IP rate limit (120 rpm). Reduce request rate. |
| No GLM responses | Verify your Z.AI account has balance — `/health` will flag `(unreachable)` |
| Need admin restart | `pm2 restart synetal-gateway --update-env` |
