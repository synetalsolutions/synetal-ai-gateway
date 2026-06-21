# Security Policy

## 🔐 Reporting a Vulnerability

We take security seriously. If you discover a vulnerability in Synetal AI Gateway, **please do not open a public issue**. Instead, report it privately:

- Email: **security@synetal.com**
- Or use GitHub's [private vulnerability reporting](https://github.com/synetalsolutions/synetal-copilot/security/advisories/new)

Please include:
- A description of the vulnerability and its impact
- Steps to reproduce or a proof-of-concept
- Affected version (check `/health` for the version string)

We will acknowledge receipt within 48 hours and aim to publish a fix within 7 days for critical issues.

---

## 🛡️ Best Practices for Self-Hosters

1. **Generate a strong `PROXY_API_KEY`** (never reuse the example):
   ```bash
   openssl rand -hex 32
   ```
2. **Never commit `.env`** — it's already in `.gitignore`, but double-check before pushing.
3. **Run behind HTTPS** (reverse proxy with TLS, e.g., Nginx, Caddy, Cloudflare).
4. **Rate-limit inbound** at the network layer if exposed publicly.
5. **Rotate provider keys** periodically and after any suspected leak.
6. **Audit your deployment** with `/cost` and `/stats` for unusual usage.

---

## ⚠️ Known Considerations

- The gateway does **not** encrypt secrets at rest by itself — protect the host filesystem as the trust boundary.
- WebSocket auth uses the same `PROXY_API_KEY` — keep it secret and rotate if exposed.
- If a key is compromised, rotate it in `.env` and restart the gateway immediately:
  ```bash
  pm2 restart synetal-gateway --update-env
  ```

---

Thank you for helping keep Synetal AI Gateway and its users safe. 🙏
