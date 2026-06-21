// Synetal AI Gateway — PM2 Production Configuration
// Usage:
//   1. Copy .env.example to .env and fill in your keys
//   2. Generate a secure PROXY_API_KEY: openssl rand -hex 32
//   3. pm2 start ecosystem.config.js --update-env
//
// PM2 automatically loads .env (via dotenv) before spawning workers.
// Never hardcode secrets here — always read from process.env.

module.exports = {
  apps: [
    {
      name: 'synetal-gateway',
      script: './dist/index.js',
      cwd: '/www/wwwroot/copilot.synetal.com',
      env: {
        NODE_ENV: 'production',
        PROXY_PORT: '3456',
        // PROXY_API_KEY and all provider keys come from .env (loaded by dotenv)
      },
      instances: 'max',
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      log_file: '/tmp/proxy-combined.log',
      out_file: '/tmp/proxy-out.log',
      error_file: '/tmp/proxy-error.log'
    }
  ]
};
