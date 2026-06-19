# Multi-Model Headroom Proxy — Docker Image
# Supports: Kimi, DeepSeek, GLM, OpenAI, Anthropic + Headroom compression

FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --only=production=false

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ─── Production Stage ───────────────────────────────────────────────────────
FROM node:22-alpine AS production

WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json* ./
RUN npm ci --only=production && npm cache clean --force

# Copy compiled output
COPY --from=builder /app/dist ./dist

# Create non-root user for security
RUN addgroup -g 1001 -S proxy && \
    adduser -S proxy -u 1001

USER proxy

EXPOSE 3456

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3456/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

CMD ["node", "dist/index.js"]
