# Contributing to Synetal AI Gateway

Thanks for your interest in contributing! 🎉 This is a small guide to keep things smooth.

## 🛡️ Code of Conduct

Be kind. Use clear, respectful language in issues and PRs. We follow the
[Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).

---

## 🚀 Quick Start for Contributors

```bash
git clone https://github.com/synetalsolutions/synetal-copilot.git
cd synetal-copilot
npm install
cp .env.example .env        # Fill in your keys
npm run build
npm run dev                  # ts-node hot mode
```

---

## 🔄 Development Workflow

1. **Fork** the repo and create a feature branch:
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. **Build & test** locally before pushing:
   ```bash
   npm run build
   curl http://localhost:3456/health | jq
   ```
3. **Commit** with a clear message following [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat: add new provider adapter`
   - `fix: handle 429 in circuit-breaker`
   - `docs: improve routing section in README`
4. **Push** and open a Pull Request against `main`. All PRs require review — direct pushes to `main` are blocked.

---

## 🧠 Project Architecture (Quick Map)

- `src/index.ts` — entry point, loads `.env`, starts the proxy
- `src/proxy.ts` — HTTP + WebSocket server, the three routing branches
- `src/model-registry.ts` — **single source of truth** for models, pricing, capabilities
- `src/smart-router.ts` — cost-aware routing engine
- `src/complexity-scorer.ts` — prompt complexity analysis (0-100)
- `src/circuit-breaker.ts` — self-healing provider management
- `src/cost-tracker.ts` — real-time cost accounting
- `src/context-truncator.ts` — token savings (57-96%)
- `src/{cache,fallback,patcher,streaming,logger,stats,config}.ts` — support modules
- `src/types.ts` — TypeScript interfaces

When adding a new provider:
1. Add it to the `PROVIDERS` constant in `src/config.ts`.
2. Register all its models in `src/model-registry.ts` with pricing, tier, and capabilities.
3. Add an env var to `.env.example` and document it in `README.md`.
4. Update the routing chain in `src/proxy.ts` / `src/fallback.ts` if relevant.

---

## 🧪 Testing Checklist Before a PR

- [ ] `npm run build` completes without TypeScript errors
- [ ] `curl http://localhost:3456/health` returns `{"status":"healthy"}`
- [ ] Auto-route works: send `"hi"` and a complex prompt, confirm different models
- [ ] Direct route works: send `"model": "glm-4.6"` and confirm it's used
- [ ] No secrets / API keys are committed anywhere

---

## 🔒 Security

- **Never commit API keys, tokens, or `.env` to git.**
- Use `process.env` exclusively. `.env` is ignored by `.gitignore`.
- See [SECURITY.md](SECURITY.md) for vulnerability reporting.

---

## 📦 Release Process

Maintainers follow [SemVer](https://semver.org/):

| Change | Bump |
|--------|------|
| New feature, new model | Minor (e.g., 2.4 → 2.5) |
| Bug fix, doc update | Patch (e.g., 2.4 → 2.4.1) |
| Breaking API change | Major (e.g., 2.x → 3.0) |

Releases are tagged on `main` after PR review passes.

---

Questions? Open a [Discussion](https://github.com/synetalsolutions/synetal-copilot/discussions) or an [Issue](https://github.com/synetalsolutions/synetal-copilot/issues). Happy hacking! 💻
