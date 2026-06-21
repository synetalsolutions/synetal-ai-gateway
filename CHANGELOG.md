# Changelog

All notable changes to **Kestrel AI Gateway** follow [Semantic Versioning](https://semver.org/).
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [2.5.0] — 2026-06-21

### 🪶 Changed
- **Project rebranded**: Synetal AI Gateway → **Kestrel AI Gateway**.
- New package name: `kestrel-ai` (npm) — available for publishing.
- GitHub repo renamed: `synetalsolutions/synetal-ai-gateway` → `synetalsolutions/kestrel-ai`.
- PM2 process name: `synetal-gateway` → `kestrel-gateway`.
- Docker container name: `synetal-gateway` → `kestrel-gateway`.
- Virtual model alias: `synetal-ai` → `kestrel-ai` (auto-route still also triggered by
  `auto`, `gpt-4`, `gpt-4o`, and other GPT aliases).
- README title emoji: 🧠 → 🪶 (kestrel feather).

### ✨ Added
- `kestrel-ai` model alias now joins `auto`, `gpt-4o`, etc. as smart-routing triggers.

### 🔒 Security
- CI secret scanner: dropped key-prefix patterns from public ci.yml file (was leaking
  key prefixes to public view).

---

## [2.4.0] — 2026-06-21

### ✨ Added
- **Model Registry** (`src/model-registry.ts`): centralized source of truth for all 26+ models
  from 4 providers with pricing, context sizes, and capability metadata.
- **All Kimi/Moonshot models**: `kimi-k2.7-code`, `kimi-k2.7-code-highspeed`, `kimi-k2.6`,
  `kimi-k2.5`, `moonshot-v1-auto`, `moonshot-v1-{8k,32k,128k}`, and 3 vision variants.
- **All GLM/Z.AI models**: `glm-5.2`, `glm-5.1`, `glm-5`, `glm-5-turbo`, `glm-4.7`, `glm-4.6`,
  `glm-4.5`, `glm-4.5-air`.
- **All Xiaomi MiMo models**: `mimo-v2.5-pro`, `mimo-v2.5`, `mimo-v2-pro`, `mimo-v2-omni`.
- **All DeepSeek models**: `deepseek-v4-pro`, `deepseek-v4-flash`.
- `/v1/models` endpoint now serves a live catalog with per-model pricing.
- Virtual aliases `kestrel-ai`, `auto`, `gpt-4o`, `gpt-4`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-3.5-turbo`.
- 3-branch smart routing in `proxy.ts`: direct-route, cost-aware auto-route, legacy fallback.

### 🔒 Security
- Removed all hardcoded secrets from repo files (config, docs, docker-compose, ecosystem).
- Secrets now exclusively read from `.env` — never committed.
- Expanded `.gitignore` for `.env*`, `*.pem`, `*.key`.
- Added `SECURITY.md` reporting policy.

### 🧹 Removed
- **Headroom compression** removed entirely (npm dep + 7 files).
- Legacy files deleted: `headroom-server.js`, `deploy-headroom-fix.sh`,
  `restart-headroom-no-kompress.sh`, `savings-report.js`, `proxy.js`, `kimi-prod.js`,
  `src/preprocessor.ts`.
- `HEADROOM_*` and `PREPROCESS_*` env vars removed from config.

---

## [2.3.0] — 2026-06-20

### ✨ Added
- **Cost-aware smart router v2** (`src/smart-router.ts`): per-prompt complexity analysis maps
  to cheap / medium / premium model tiers.
- **Circuit breaker** (`src/circuit-breaker.ts`): automatic provider quarantine on 429/5xx
  with tiered cooldowns (60s / 10s / 5s).
- **Complexity scorer** (`src/complexity-scorer.ts`): 0-100 score from keywords, length,
  and code structure.
- **Context truncator** (`src/context-truncator.ts`): 57-96% token savings on Cursor traffic.

---

## [2.2.0] — 2026-06-19

### ✨ Added
- Fallback chain, load balancing, SHA256 response cache (5 min TTL).
- Single-key auth: all incoming requests validated against `PROXY_API_KEY`.
- Per-IP rate limiting (120 requests / minute).
- `/health`, `/stats`, `/cost` monitoring endpoints.

---

## [2.0.0] — 2026-06-18

- Initial multi-model proxy with WebSocket streaming and OpenAI-compatible API surface.
